import { requestUrl } from "obsidian";
import type { LMVoiceSettings } from "./settings";

const API = "https://api.mistral.ai/v1";

function speakable(t: string) {
  return t
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#*_~>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1600);
}

function multipart(fields: Record<string, string>, filename: string, bytes: Uint8Array, mime: string) {
  const boundary = "----ObsidianForm" + Date.now();
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const push = (s: string | Uint8Array) => chunks.push(typeof s === "string" ? enc.encode(s) : s);
  for (const [k, v] of Object.entries(fields)) {
    push(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`);
  }
  push(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`
  );
  push(bytes);
  push(`\r\n--${boundary}--\r\n`);
  let len = 0;
  for (const c of chunks) len += c.byteLength;
  const body = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) {
    body.set(c, o);
    o += c.byteLength;
  }
  return { boundary, body };
}

function pickMime() {
  const opts = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const t of opts) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

function watchSilence(stream: MediaStream, onFire: () => void) {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AC) return () => {};
  const ctx = new AC();
  void ctx.resume?.();
  const src = ctx.createMediaStreamSource(stream);
  const anal = ctx.createAnalyser();
  anal.fftSize = 2048;
  src.connect(anal);
  const data = new Uint8Array(anal.fftSize);
  let heard = false;
  let heardAt = 0;
  let quietAt = 0;
  let fired = false;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(id);
    void ctx.close();
  };
  const id = window.setInterval(() => {
    anal.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = ((data[i] ?? 128) - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / data.length);
    const now = Date.now();
    if (rms > 0.035) {
      if (!heard) heardAt = now;
      heard = true;
      quietAt = 0;
    } else if (heard && now - heardAt > 600) {
      if (!quietAt) quietAt = now;
      if (now - quietAt > 900 && !fired) {
        fired = true;
        close();
        onFire();
      }
    }
  }, 60);
  return () => {
    if (fired) return;
    fired = true;
    close();
    onFire();
  };
}

function b64ToBytes(b64: string) {
  const bin = atob(String(b64).replace(/\s/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class VoiceIO {
  private audio: HTMLAudioElement | null = null;
  private unvad: (() => void) | null = null;
  private rec: MediaRecorder | null = null;

  constructor(
    private settings: () => LMVoiceSettings,
    private key: () => Promise<string>
  ) {}

  cancelSpeak() {
    if (this.audio) {
      this.audio.pause();
      this.audio.src = "";
      this.audio = null;
    }
  }

  stopListen() {
    this.unvad?.();
    this.unvad = null;
    try {
      if (this.rec && this.rec.state !== "inactive") this.rec.stop();
    } catch {
      /* ignore */
    }
  }

  async listenTurn(): Promise<string> {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      throw new Error("Microphone not available. Allow mic for Obsidian.");
    }
    const mime = pickMime();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    this.rec = rec;
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
    };
    rec.start(200);
    await new Promise<void>((resolve) => {
      this.unvad = watchSilence(stream, () => resolve());
      window.setTimeout(() => resolve(), 20000);
    });
    this.unvad = null;
    const blob = await new Promise<Blob>((resolve, reject) => {
      rec.onerror = () => reject(new Error("Recording failed"));
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        this.rec = null;
        resolve(new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" }));
      };
      rec.stop();
    });
    if (!blob.size) throw new Error("Empty recording");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const ext = (blob.type || "").includes("mp4") ? "m4a" : "webm";
    const s = this.settings();
    const { boundary, body } = multipart(
      { model: s.sttModel || "voxtral-mini-latest", language: "en" },
      `speech.${ext}`,
      bytes,
      blob.type || "audio/webm"
    );
    const res = await requestUrl({
      url: `${API}/audio/transcriptions`,
      method: "POST",
      headers: {
        Authorization: "Bearer " + (await this.key()),
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
      throw: false,
    });
    if (res.status >= 300) throw new Error(`STT ${res.status}: ${(res.text || "").slice(0, 180)}`);
    const json = typeof res.json === "object" && res.json ? res.json : JSON.parse(res.text || "{}");
    const text = String((json as { text?: string }).text || "").trim();
    if (!text) throw new Error("Empty transcript");
    return text;
  }

  async speak(text: string): Promise<void> {
    const t = speakable(text);
    if (!t) return;
    this.cancelSpeak();
    const s = this.settings();
    const payload: Record<string, string> = {
      model: s.ttsModel || "voxtral-mini-tts-2603",
      input: t,
      response_format: "mp3",
      voice_id: s.ttsVoice || "en_paul_confident",
    };
    let res = await requestUrl({
      url: `${API}/audio/speech`,
      method: "POST",
      headers: { Authorization: "Bearer " + (await this.key()), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      throw: false,
    });
    if (res.status >= 300) {
      delete payload.voice_id;
      res = await requestUrl({
        url: `${API}/audio/speech`,
        method: "POST",
        headers: { Authorization: "Bearer " + (await this.key()), "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        throw: false,
      });
    }
    if (res.status >= 300) throw new Error(`TTS ${res.status}: ${(res.text || "").slice(0, 180)}`);
    let bytes: Uint8Array;
    const rawText = String(res.text || "").trim();
    if (rawText.startsWith("{")) {
      const json = typeof res.json === "object" && res.json ? res.json : JSON.parse(rawText);
      const b64 = (json as { audio_data?: string; audio?: string; data?: string }).audio_data || (json as { audio?: string }).audio || (json as { data?: string }).data;
      if (!b64) throw new Error("Empty speech");
      bytes = b64ToBytes(b64);
    } else if (res.arrayBuffer && res.arrayBuffer.byteLength > 80) {
      bytes = new Uint8Array(res.arrayBuffer);
    } else {
      throw new Error("Empty speech");
    }
    const copy = new Uint8Array(bytes);
    const url = URL.createObjectURL(new Blob([copy], { type: "audio/mpeg" }));
    await new Promise<void>((resolve) => {
      const a = new Audio(url);
      this.audio = a;
      a.onended = () => {
        URL.revokeObjectURL(url);
        if (this.audio === a) this.audio = null;
        resolve();
      };
      a.onerror = () => {
        URL.revokeObjectURL(url);
        if (this.audio === a) this.audio = null;
        resolve();
      };
      void a.play().catch(() => resolve());
    });
  }
}
