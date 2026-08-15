import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type LMVoicePlugin from "./main";
import { VoiceIO } from "./audio";
import { LLM_MODELS, STT_MODELS, TTS_MODELS, TTS_VOICES } from "./voices";

export interface LMVoiceSettings {
  apiKey: string;
  llmModel: string;
  sttModel: string;
  ttsModel: string;
  ttsVoice: string;
  speakReplies: boolean;
  keepListening: boolean;
  hideChat: boolean;
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
  contextNotes: string;
  systemPrompt: string;
}

export const DEFAULT_SETTINGS: LMVoiceSettings = {
  apiKey: "",
  llmModel: "mistral-small-latest",
  sttModel: "voxtral-mini-latest",
  ttsModel: "voxtral-mini-tts-2603",
  ttsVoice: "en_paul_confident",
  speakReplies: true,
  keepListening: true,
  hideChat: false,
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

    new Setting(containerEl)
      .setName("API key")
      .setDesc("From console.mistral.ai. Leave empty to use MISTRAL_API_KEY in a vault .env file.")
      .addText((t) => {
        t.inputEl.type = "password";
        t.setPlaceholder("mistral-…");
        t.setValue(s.apiKey).onChange((v) => save(() => (s.apiKey = v.trim())));
      });

    const voice = new Setting(containerEl).setName("Voice").setDesc("Spoken replies use this Voxtral voice.");
    dropdown(voice, TTS_VOICES, s.ttsVoice, (v) => save(() => (s.ttsVoice = v)));
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

    new Setting(containerEl).setName("Interface").setHeading();

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

    new Setting(containerEl).setName("Models").setHeading();
    dropdown(
      new Setting(containerEl).setName("Chat model"),
      LLM_MODELS,
      s.llmModel,
      (v) => save(() => (s.llmModel = v))
    );
    dropdown(
      new Setting(containerEl).setName("Speech to text"),
      STT_MODELS,
      s.sttModel,
      (v) => save(() => (s.sttModel = v))
    );
    dropdown(
      new Setting(containerEl).setName("Text to speech"),
      TTS_MODELS,
      s.ttsModel,
      (v) => save(() => (s.ttsModel = v))
    );

    new Setting(containerEl).setName("Agent").setHeading();
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
