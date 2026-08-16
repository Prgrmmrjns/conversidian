import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type LMVoicePlugin from "./main";
import { VoiceIO } from "./audio";
import {
  CHAT_PROVIDERS,
  DEFAULT_CHAT_URL,
  SPEECH_PROVIDERS,
  defaultChatModel,
  listChatModels,
  usesMistral,
  type ChatProvider,
  type SpeechProvider,
} from "./providers";
import { LLM_MODELS, STT_MODELS, TTS_MODELS, TTS_VOICES } from "./voices";

export const ACCENTS = [
  { id: "theme", label: "Theme" },
  { id: "red", label: "Red" },
  { id: "orange", label: "Orange" },
  { id: "yellow", label: "Yellow" },
  { id: "green", label: "Green" },
  { id: "cyan", label: "Cyan" },
  { id: "blue", label: "Blue" },
  { id: "pink", label: "Pink" },
  { id: "purple", label: "Purple" },
] as const;

export type AccentId = (typeof ACCENTS)[number]["id"];

export interface LMVoiceSettings {
  apiKey: string;
  chatProvider: ChatProvider;
  sttProvider: SpeechProvider;
  ttsProvider: SpeechProvider;
  ollamaUrl: string;
  lmStudioUrl: string;
  llmModel: string;
  sttModel: string;
  ttsModel: string;
  ttsVoice: string;
  accent: AccentId;
  speakReplies: boolean;
  keepListening: boolean;
  hideChat: boolean;
  dictation: boolean;
  allowTools: boolean;
  readOnly: boolean;
  allowList: boolean;
  allowRead: boolean;
  allowCreate: boolean;
  allowEdit: boolean;
  allowDelete: boolean;
  allowInternet: boolean;
  openAfterWrite: boolean;
  activeFileOnly: boolean;
  notesFolder: string;
  personalityFile: string;
  contextNotes: string;
  systemPrompt: string;
}

export const DEFAULT_SETTINGS: LMVoiceSettings = {
  apiKey: "",
  chatProvider: "mistral",
  sttProvider: "mistral",
  ttsProvider: "mistral",
  ollamaUrl: DEFAULT_CHAT_URL.ollama,
  lmStudioUrl: DEFAULT_CHAT_URL.lmstudio,
  llmModel: "mistral-small-latest",
  sttModel: "voxtral-mini-latest",
  ttsModel: "voxtral-mini-tts-2603",
  ttsVoice: "en_paul_confident",
  accent: "theme",
  speakReplies: true,
  keepListening: true,
  hideChat: false,
  dictation: false,
  allowTools: true,
  readOnly: false,
  allowList: true,
  allowRead: true,
  allowCreate: true,
  allowEdit: true,
  allowDelete: false,
  allowInternet: false,
  openAfterWrite: false,
  activeFileOnly: false,
  notesFolder: "",
  personalityFile: "Personality.md",
  contextNotes: "",
  systemPrompt: `You are a fast English voice agent inside Obsidian.
Speak short. One or two sentences, then act. No markdown in spoken replies.
After a file change, confirm the path in one short sentence.
Never touch PDFs or binary files. Markdown only.
Today: {{date}}. Active file: {{file}}.`,
};

function dropdown(
  setting: Setting,
  options: { id: string; label: string }[],
  value: string,
  onChange: (v: string) => Promise<void>
) {
  setting.addDropdown((d) => {
    for (const o of options) d.addOption(o.id, o.label);
    if (value && !options.some((o) => o.id === value)) d.addOption(value, value);
    d.setValue(value);
    d.onChange((v) => void onChange(v));
  });
}

export class LMVoiceSettingTab extends PluginSettingTab {
  plugin: LMVoicePlugin;

  constructor(app: App, plugin: LMVoicePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
    const save = async (fn: () => void) => {
      fn();
      await this.plugin.saveSettings();
    };

    new Setting(containerEl).setName("Providers").setHeading();

    const chat = new Setting(containerEl)
      .setName("Chat")
      .setDesc("Mistral cloud, or a local OpenAI-compatible server (Ollama / LM Studio).");
    dropdown(chat, CHAT_PROVIDERS, s.chatProvider, async (v) => {
      await save(() => {
        const next = v as ChatProvider;
        s.chatProvider = next;
        if (next !== "mistral" && /^mistral-/i.test(s.llmModel)) s.llmModel = defaultChatModel(next);
        if (next === "mistral" && !LLM_MODELS.some((m) => m.id === s.llmModel)) {
          s.llmModel = defaultChatModel("mistral");
        }
      });
      this.display();
    });

    if (s.chatProvider === "ollama") {
      new Setting(containerEl)
        .setName("Ollama URL")
        .setDesc("OpenAI-compatible base. Default http://127.0.0.1:11434/v1")
        .addText((t) => {
          t.setPlaceholder(DEFAULT_CHAT_URL.ollama);
          t.setValue(s.ollamaUrl).onChange((v) => save(() => (s.ollamaUrl = v.trim())));
        });
    }
    if (s.chatProvider === "lmstudio") {
      new Setting(containerEl)
        .setName("LM Studio URL")
        .setDesc("Developer server. Default http://127.0.0.1:1234/v1")
        .addText((t) => {
          t.setPlaceholder(DEFAULT_CHAT_URL.lmstudio);
          t.setValue(s.lmStudioUrl).onChange((v) => save(() => (s.lmStudioUrl = v.trim())));
        });
    }

    if (s.chatProvider === "mistral") {
      dropdown(
        new Setting(containerEl).setName("Chat model"),
        LLM_MODELS,
        s.llmModel,
        (v) => save(() => (s.llmModel = v))
      );
    } else {
      const model = new Setting(containerEl)
        .setName("Chat model")
        .setDesc("Must be loaded. Refresh lists /v1/models.");
      model.addText((t) => {
        t.setPlaceholder(s.chatProvider === "ollama" ? "llama3.2" : "model id");
        t.setValue(s.llmModel).onChange((v) => save(() => (s.llmModel = v.trim())));
      });
      model.addExtraButton((btn) =>
        btn
          .setIcon("refresh-cw")
          .setTooltip("List models")
          .onClick(async () => {
            try {
              const ids = await listChatModels(this.plugin.settings);
              if (!ids.length) throw new Error("No models. Is the server running?");
              const first = ids[0] || "";
              if (!ids.includes(s.llmModel) && first) {
                s.llmModel = first;
                await this.plugin.saveSettings();
              }
              new Notice(ids.slice(0, 12).join("\n"));
              this.display();
            } catch (err) {
              new Notice(err instanceof Error ? err.message : String(err));
            }
          })
      );
    }

    const stt = new Setting(containerEl)
      .setName("Speech to text")
      .setDesc("Mistral Voxtral, or this computer’s recognizer.");
    dropdown(stt, SPEECH_PROVIDERS, s.sttProvider, async (v) => {
      await save(() => (s.sttProvider = v as SpeechProvider));
      this.display();
    });
    if (s.sttProvider === "mistral") {
      dropdown(
        new Setting(containerEl).setName("STT model"),
        STT_MODELS,
        s.sttModel,
        (v) => save(() => (s.sttModel = v))
      );
    }

    const tts = new Setting(containerEl)
      .setName("Text to speech")
      .setDesc("Mistral Voxtral, or this computer’s voice.");
    dropdown(tts, SPEECH_PROVIDERS, s.ttsProvider, async (v) => {
      await save(() => (s.ttsProvider = v as SpeechProvider));
      this.display();
    });
    if (s.ttsProvider === "mistral") {
      dropdown(
        new Setting(containerEl).setName("TTS model"),
        TTS_MODELS,
        s.ttsModel,
        (v) => save(() => (s.ttsModel = v))
      );
    }

    const voice = new Setting(containerEl).setName("Voice").setDesc(
      s.ttsProvider === "mistral" ? "Spoken replies use this Voxtral voice." : "Uses this computer’s default voice."
    );
    if (s.ttsProvider === "mistral") dropdown(voice, TTS_VOICES, s.ttsVoice, (v) => save(() => (s.ttsVoice = v)));
    voice.addExtraButton((btn) =>
      btn
        .setIcon("play")
        .setTooltip("Play sample")
        .onClick(async () => {
          try {
            const io = new VoiceIO(() => this.plugin.settings, () => this.plugin.mistralKey());
            await io.speak("Hi. This is how I sound.");
          } catch (err) {
            new Notice(err instanceof Error ? err.message : String(err));
          }
        })
    );

    if (usesMistral(s)) {
      new Setting(containerEl)
        .setName("API key")
        .setDesc("From console.mistral.ai. Leave empty to use MISTRAL_API_KEY in a vault .env file.")
        .addText((t) => {
          t.inputEl.type = "password";
          t.setPlaceholder("mistral-…");
          t.setValue(s.apiKey).onChange((v) => save(() => (s.apiKey = v.trim())));
        });
    }

    new Setting(containerEl).setName("Interface").setHeading();

    const accent = new Setting(containerEl)
      .setName("Accent")
      .setDesc("Theme follows Appearance. Or pick a color for the mic, buttons, and chat.");
    const swatches = accent.controlEl.createDiv({ cls: "lm-voice-swatches" });
    for (const a of ACCENTS) {
      const btn = swatches.createEl("button", {
        cls: "lm-voice-swatch",
        attr: { type: "button", "data-accent": a.id, "aria-label": a.label, title: a.label },
      });
      btn.toggleClass("is-on", s.accent === a.id);
      btn.addEventListener("click", () =>
        void save(() => {
          s.accent = a.id;
          for (const el of Array.from(swatches.children)) {
            if (el instanceof HTMLElement) el.toggleClass("is-on", el.getAttr("data-accent") === a.id);
          }
        })
      );
    }

    new Setting(containerEl)
      .setName("Speak replies")
      .setDesc("Play the assistant’s answer out loud.")
      .addToggle((t) => t.setValue(s.speakReplies).onChange((v) => save(() => (s.speakReplies = v))));

    new Setting(containerEl)
      .setName("Keep listening")
      .setDesc("After each reply, listen again until you stop.")
      .addToggle((t) => t.setValue(s.keepListening).onChange((v) => save(() => (s.keepListening = v))));

    new Setting(containerEl)
      .setName("Hide chat")
      .setDesc("Mic only. No transcript — useful if you just want notes edited.")
      .addToggle((t) => t.setValue(s.hideChat).onChange((v) => save(() => (s.hideChat = v))));

    new Setting(containerEl).setName("Dictation").setHeading();
    new Setting(containerEl)
      .setName("Dictation")
      .setDesc("Speech to text into the open note — no chat, no spoken reply. Click a heading or place the cursor; the section highlights. Fn on Mac (set Globe key to Fn). Ctrl+Shift+D on Windows, or bind Dictate in Hotkeys.")
      .addToggle((t) => t.setValue(s.dictation).onChange((v) => save(() => (s.dictation = v))));

    new Setting(containerEl).setName("Tools").setHeading();

    new Setting(containerEl)
      .setName("Tool calls")
      .setDesc("Let the model list/read/edit notes and use other tools. Off = talk only.")
      .addToggle((t) => t.setValue(s.allowTools).onChange((v) => save(() => (s.allowTools = v))));

    new Setting(containerEl)
      .setName("Read only")
      .setDesc("Block create, edit, and delete even if those toggles are on.")
      .addToggle((t) => t.setValue(s.readOnly).onChange((v) => save(() => (s.readOnly = v))));

    new Setting(containerEl)
      .setName("List notes")
      .addToggle((t) => t.setValue(s.allowList).onChange((v) => save(() => (s.allowList = v))));
    new Setting(containerEl)
      .setName("Read notes")
      .addToggle((t) => t.setValue(s.allowRead).onChange((v) => save(() => (s.allowRead = v))));
    new Setting(containerEl)
      .setName("Create notes")
      .addToggle((t) => t.setValue(s.allowCreate).onChange((v) => save(() => (s.allowCreate = v))));
    new Setting(containerEl)
      .setName("Edit notes")
      .addToggle((t) => t.setValue(s.allowEdit).onChange((v) => save(() => (s.allowEdit = v))));
    new Setting(containerEl)
      .setName("Delete notes")
      .setDesc("Moves markdown notes to the Obsidian trash. Off by default.")
      .addToggle((t) => t.setValue(s.allowDelete).onChange((v) => save(() => (s.allowDelete = v))));

    new Setting(containerEl)
      .setName("Use internet")
      .setDesc("Allow fetching a public http(s) page as text.")
      .addToggle((t) => t.setValue(s.allowInternet).onChange((v) => save(() => (s.allowInternet = v))));

    new Setting(containerEl)
      .setName("Open after write")
      .setDesc("Open a note after the agent creates or edits it.")
      .addToggle((t) => t.setValue(s.openAfterWrite).onChange((v) => save(() => (s.openAfterWrite = v))));

    new Setting(containerEl)
      .setName("Active file only")
      .setDesc("File tools may touch only the note that is open.")
      .addToggle((t) => t.setValue(s.activeFileOnly).onChange((v) => save(() => (s.activeFileOnly = v))));

    new Setting(containerEl)
      .setName("Notes folder")
      .setDesc("Limit file tools to this folder. Empty = whole vault.")
      .addText((t) => {
        t.setPlaceholder("e.g. Notes");
        t.setValue(s.notesFolder).onChange((v) => save(() => (s.notesFolder = v.trim())));
      });

    new Setting(containerEl).setName("Agent").setHeading();
    new Setting(containerEl)
      .setName("Personality note")
      .setDesc("Vault path read each turn for tone and style. Empty = skip.")
      .addText((t) => {
        t.setPlaceholder("Personality.md");
        t.setValue(s.personalityFile).onChange((v) => save(() => (s.personalityFile = v.trim())));
      });

    new Setting(containerEl)
      .setName("System prompt")
      .setDesc("{{date}} and {{file}} are filled in each turn.")
      .addTextArea((t) => {
        t.setValue(s.systemPrompt).onChange((v) => save(() => (s.systemPrompt = v)));
        t.inputEl.rows = 10;
        t.inputEl.addClass("lm-voice-prompt");
      });

    new Setting(containerEl)
      .setName("Context notes")
      .setDesc("Vault paths, one per line. Compacted and appended to the system prompt each turn.")
      .addTextArea((t) => {
        t.setPlaceholder("AGENTS.md\nJonas.md");
        t.setValue(s.contextNotes).onChange((v) => save(() => (s.contextNotes = v)));
        t.inputEl.rows = 4;
        t.inputEl.addClass("lm-voice-prompt");
      });
  }
}
