import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import type LMVoicePlugin from "./main";
import { VaultAgent, type ChatMsg } from "./agent";
import { VoiceIO } from "./audio";
import { TTS_VOICES } from "./voices";

export const VIEW_TYPE = "mistral-voice-view";

type Phase = "idle" | "listen" | "think" | "speak";

export class VoiceView extends ItemView {
  private logEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private micBtn!: HTMLButtonElement;
  private speakBtn!: HTMLButtonElement;
  private writeBtn!: HTMLButtonElement;
  private deleteBtn!: HTMLButtonElement;
  private voiceSel!: HTMLSelectElement;
  private inputEl!: HTMLTextAreaElement;
  private running = false;
  private history: ChatMsg[] = [];
  private agent: VaultAgent;
  private voice: VoiceIO;

  constructor(leaf: WorkspaceLeaf, private plugin: LMVoicePlugin) {
    super(leaf);
    const key = () => this.plugin.mistralKey();
    this.agent = new VaultAgent(this.app, () => this.plugin.settings, key);
    this.voice = new VoiceIO(() => this.plugin.settings, key);
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return "Mistral Voice";
  }

  getIcon() {
    return "mic";
  }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass("lm-voice");

    const head = root.createDiv({ cls: "lm-voice-head" });
    const titles = head.createDiv({ cls: "lm-voice-titles" });
    titles.createDiv({ cls: "lm-voice-title", text: "Mistral Voice" });
    this.statusEl = titles.createDiv({ cls: "lm-voice-status", text: "Ready" });

    const headBtns = head.createDiv({ cls: "lm-voice-head-btns" });
    this.iconBtn(headBtns, "x", "Clear conversation", () => this.clearChat());
    this.iconBtn(headBtns, "settings", "Open settings", () => this.openSettings());

    const stage = root.createDiv({ cls: "lm-voice-stage" });
    this.micBtn = stage.createEl("button", { cls: "lm-voice-mic", attr: { type: "button", "aria-label": "Talk" } });
    setIcon(this.micBtn, "mic");
    this.micBtn.addEventListener("click", () => void this.toggle());

    const tools = root.createDiv({ cls: "lm-voice-tools" });
    this.speakBtn = this.iconBtn(tools, "volume-2", "Speak replies", () =>
      this.toggleSetting("speakReplies")
    );
    this.writeBtn = this.iconBtn(tools, "pencil", "Allow writing notes", () => this.toggleWrite());
    this.deleteBtn = this.iconBtn(tools, "trash-2", "Allow deleting notes", () =>
      this.toggleSetting("allowDelete")
    );

    this.voiceSel = tools.createEl("select", { cls: "dropdown lm-voice-voice" });
    for (const v of TTS_VOICES) {
      this.voiceSel.createEl("option", { text: v.label, value: v.id });
    }
    this.voiceSel.value = this.plugin.settings.ttsVoice;
    this.voiceSel.addEventListener("change", async () => {
      this.plugin.settings.ttsVoice = this.voiceSel.value;
      await this.plugin.saveSettings();
    });

    this.logEl = root.createDiv({ cls: "lm-voice-log" });
    this.line("sys", "Tap the mic. Pause when you’re done. The agent can change markdown if you allow it.");

    const row = root.createDiv({ cls: "lm-voice-row" });
    this.inputEl = row.createEl("textarea", {
      cls: "lm-voice-input",
      attr: { rows: "2", placeholder: "Or type a message…" },
    });
    const send = row.createEl("button", { cls: "lm-voice-send", attr: { type: "button", "aria-label": "Send" } });
    setIcon(send, "send");
    send.addEventListener("click", () => void this.sendTyped());
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void this.sendTyped();
      }
    });

    this.syncTools();
  }

  async onClose() {
    this.running = false;
    this.voice.stopListen();
    this.voice.cancelSpeak();
  }

  private iconBtn(parent: HTMLElement, icon: string, tip: string, onClick: () => void | Promise<void>) {
    const btn = parent.createEl("button", { cls: "clickable-icon", attr: { type: "button", "aria-label": tip } });
    btn.setAttr("title", tip);
    setIcon(btn, icon);
    btn.addEventListener("click", () => void onClick());
    return btn;
  }

  private openSettings() {
    const setting = (this.app as unknown as { setting?: { open: () => void; openTabById: (id: string) => void } })
      .setting;
    setting?.open();
    setting?.openTabById(this.plugin.manifest.id);
  }

  private clearChat() {
    this.history = [];
    this.logEl.empty();
    this.line("sys", "Conversation cleared.");
  }

  private async toggleSetting(key: "speakReplies" | "allowDelete") {
    this.plugin.settings[key] = !this.plugin.settings[key];
    await this.plugin.saveSettings();
    this.syncTools();
  }

  private async toggleWrite() {
    const on = !(this.plugin.settings.allowCreate && this.plugin.settings.allowEdit);
    this.plugin.settings.allowCreate = on;
    this.plugin.settings.allowEdit = on;
    await this.plugin.saveSettings();
    this.syncTools();
  }

  private syncTools() {
    const s = this.plugin.settings;
    this.speakBtn.toggleClass("is-off", !s.speakReplies);
    this.writeBtn.toggleClass("is-off", !(s.allowCreate && s.allowEdit));
    this.deleteBtn.toggleClass("is-off", !s.allowDelete);
    this.voiceSel.value = s.ttsVoice;
  }

  private setPhase(p: Phase) {
    const label = { idle: "Ready", listen: "Listening…", think: "Thinking…", speak: "Speaking…" }[p];
    this.statusEl.setText(label);
    this.micBtn.toggleClass("is-live", p !== "idle");
    this.micBtn.setAttr("aria-label", p === "idle" ? "Talk" : "Stop");
    setIcon(this.micBtn, p === "idle" ? "mic" : "square");
  }

  private line(kind: "you" | "bot" | "tool" | "sys" | "err", text: string) {
    const el = this.logEl.createDiv({ cls: `lm-voice-msg is-${kind}` });
    el.setText(text);
    this.logEl.scrollTop = this.logEl.scrollHeight;
    return el;
  }

  async startTalking() {
    if (!this.running) await this.toggle();
  }

  async stopTalking() {
    if (this.running) await this.toggle();
  }

  async toggle() {
    if (this.running) {
      this.running = false;
      this.voice.stopListen();
      this.voice.cancelSpeak();
      this.setPhase("idle");
      return;
    }
    this.running = true;
    this.setPhase("listen");
    try {
      do {
        this.setPhase("listen");
        const heard = await this.voice.listenTurn();
        if (!this.running) break;
        await this.turn(heard);
      } while (this.running && this.plugin.settings.keepListening);
    } catch (err) {
      if (this.running) this.line("err", err instanceof Error ? err.message : String(err));
    } finally {
      this.running = false;
      this.setPhase("idle");
    }
  }

  private async sendTyped() {
    const t = this.inputEl.value.trim();
    if (!t || this.running) return;
    this.inputEl.value = "";
    this.running = true;
    try {
      await this.turn(t);
    } catch (err) {
      this.line("err", err instanceof Error ? err.message : String(err));
    } finally {
      this.running = false;
      this.setPhase("idle");
    }
  }

  private async turn(user: string) {
    this.line("you", user);
    this.history.push({ role: "user", content: user });
    this.setPhase("think");
    const botEl = this.line("bot", "…");
    const reply = await this.agent.run(this.history, (name, detail) => this.line("tool", `${name}: ${detail}`));
    botEl.setText(reply || "(no reply)");
    this.history.push({ role: "assistant", content: reply });
    if (this.history.length > 24) this.history = this.history.slice(-24);
    if (reply && this.plugin.settings.speakReplies) {
      this.setPhase("speak");
      await this.voice.speak(reply);
    }
  }
}
