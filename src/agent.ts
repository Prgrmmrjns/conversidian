import { App, normalizePath, requestUrl } from "obsidian";
import type { LMVoiceSettings } from "./settings";

export type ChatMsg = { role: "user" | "assistant" | "tool"; content: string; tool_call_id?: string };

type ToolCall = { id: string; function: { name: string; arguments: string } };

const API = "https://api.mistral.ai/v1";

function tool(name: string, description: string, properties: Record<string, unknown>, required: string[]) {
  return {
    type: "function" as const,
    function: {
      name,
      description,
      parameters: { type: "object", properties, required },
    },
  };
}

const TOOL_LIST = tool("list_files", "List markdown files in a vault folder.", {
  folder: { type: "string", description: "Vault-relative folder. Empty = vault root or the allowed folder." },
}, []);
const TOOL_READ = tool("read_file", "Read a markdown note.", { path: { type: "string" } }, ["path"]);
const TOOL_CREATE = tool("create_file", "Create a new markdown note. Fails if it exists.", {
  path: { type: "string" },
  content: { type: "string" },
}, ["path", "content"]);
const TOOL_EDIT = tool("edit_file", "Replace the full contents of an existing markdown note.", {
  path: { type: "string" },
  content: { type: "string" },
}, ["path", "content"]);
const TOOL_PATCH = tool("patch_file", "Replace one exact substring in a markdown note.", {
  path: { type: "string" },
  old: { type: "string" },
  new: { type: "string" },
}, ["path", "old", "new"]);
const TOOL_DELETE = tool("delete_file", "Move a markdown note to the Obsidian trash.", {
  path: { type: "string" },
}, ["path"]);

export class VaultAgent {
  constructor(
    private app: App,
    private settings: () => LMVoiceSettings,
    private key: () => Promise<string>
  ) {}

  systemText(): string {
    const s = this.settings();
    const file = this.app.workspace.getActiveFile()?.path || "(none)";
    const d = new Date().toISOString().slice(0, 10);
    const caps: string[] = [];
    if (s.allowList) caps.push("list");
    if (s.allowRead) caps.push("read");
    if (s.allowCreate) caps.push("create");
    if (s.allowEdit) caps.push("edit");
    if (s.allowDelete) caps.push("delete (trash)");
    const scope = s.notesFolder ? `Only inside folder: ${normalizePath(s.notesFolder)}.` : "Whole vault.";
    const extra = `\nYou may ${caps.join(", ") || "not change files"}. ${scope}`;
    return s.systemPrompt.replaceAll("{{date}}", d).replaceAll("{{file}}", file) + extra;
  }

  private tools() {
    const s = this.settings();
    const out = [];
    if (s.allowList) out.push(TOOL_LIST);
    if (s.allowRead) out.push(TOOL_READ);
    if (s.allowCreate) out.push(TOOL_CREATE);
    if (s.allowEdit) {
      out.push(TOOL_EDIT, TOOL_PATCH);
    }
    if (s.allowDelete) out.push(TOOL_DELETE);
    return out;
  }

  async run(history: ChatMsg[], onTool: (name: string, detail: string) => void): Promise<string> {
    const s = this.settings();
    const auth = { Authorization: "Bearer " + (await this.key()), "Content-Type": "application/json" };
    const messages: Record<string, unknown>[] = [{ role: "system", content: this.systemText() }, ...history];
    const tools = this.tools();
    let spoken = "";
    for (let hop = 0; hop < 8; hop++) {
      const body: Record<string, unknown> = {
        model: s.llmModel || "mistral-small-latest",
        temperature: 0.3,
        messages,
      };
      if (tools.length) {
        body.tools = tools;
        body.tool_choice = "auto";
      }
      const res = await requestUrl({
        url: `${API}/chat/completions`,
        method: "POST",
        headers: auth,
        body: JSON.stringify(body),
        throw: false,
      });
      if (res.status >= 300) throw new Error(`LLM ${res.status}: ${(res.text || "").slice(0, 200)}`);
      const json = typeof res.json === "object" && res.json ? res.json : JSON.parse(res.text || "{}");
      const msg = (json as { choices?: { message?: { content?: string; tool_calls?: ToolCall[] } }[] }).choices?.[0]
        ?.message;
      const calls = msg?.tool_calls || [];
      if (!calls.length) {
        spoken = msg?.content || spoken;
        break;
      }
      messages.push({
        role: "assistant",
        content: msg?.content || "",
        tool_calls: calls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.function.name, arguments: c.function.arguments },
        })),
      });
      for (const call of calls) {
        const result = await this.exec(call, onTool);
        messages.push({ role: "tool", tool_call_id: call.id, content: result });
      }
    }
    return spoken.trim();
  }

  private async exec(call: ToolCall, onTool: (name: string, detail: string) => void): Promise<string> {
    let args: Record<string, string> = {};
    try {
      args = JSON.parse(call.function.arguments || "{}");
    } catch {
      return `Bad arguments: ${call.function.arguments}`;
    }
    try {
      const out = await this.dispatch(call.function.name, args);
      onTool(call.function.name, out.slice(0, 160));
      return out;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onTool(call.function.name, msg);
      return `Error: ${msg}`;
    }
  }

  private allowedFolder(): string {
    const f = this.settings().notesFolder.trim();
    return f ? normalizePath(f) : "";
  }

  private inScope(path: string): boolean {
    const folder = this.allowedFolder();
    if (!folder) return true;
    return path === folder || path.startsWith(folder + "/");
  }

  private safeMd(path: string): string {
    const p = normalizePath(path || "");
    if (!p || p.split("/").includes("..")) throw new Error(`Blocked path: ${path}`);
    if (!p.toLowerCase().endsWith(".md")) throw new Error("Markdown only (.md)");
    if (!this.inScope(p)) throw new Error(`Outside allowed folder: ${p}`);
    return p;
  }

  private async ensureParent(path: string) {
    const parts = path.split("/");
    parts.pop();
    let acc = "";
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      if (!this.app.vault.getFolderByPath(acc)) await this.app.vault.createFolder(acc);
    }
  }

  private async dispatch(name: string, args: Record<string, string>): Promise<string> {
    const s = this.settings();
    if (name === "list_files") {
      if (!s.allowList) throw new Error("Listing notes is disabled");
      const folder = normalizePath(args.folder || this.allowedFolder() || "");
      if (folder.split("/").includes("..")) throw new Error("Blocked path");
      if (folder && !this.inScope(folder)) throw new Error(`Outside allowed folder: ${folder}`);
      const files = this.app.vault
        .getMarkdownFiles()
        .filter((f) => this.inScope(f.path))
        .filter((f) => (folder ? f.path === folder || f.path.startsWith(folder + "/") : true))
        .slice(0, 80)
        .map((f) => f.path);
      return files.join("\n") || "(empty)";
    }
    const path = this.safeMd(args.path || "");
    if (name === "read_file") {
      if (!s.allowRead) throw new Error("Reading notes is disabled");
      const file = this.app.vault.getFileByPath(path);
      if (!file) throw new Error(`Missing: ${path}`);
      return (await this.app.vault.read(file)).slice(0, 12000);
    }
    if (name === "create_file") {
      if (!s.allowCreate) throw new Error("Creating notes is disabled");
      if (this.app.vault.getAbstractFileByPath(path)) throw new Error(`Exists: ${path}`);
      await this.ensureParent(path);
      await this.app.vault.create(path, args.content || "");
      return `Created ${path}`;
    }
    if (name === "edit_file") {
      if (!s.allowEdit) throw new Error("Editing notes is disabled");
      const file = this.app.vault.getFileByPath(path);
      if (!file) throw new Error(`Missing: ${path}`);
      await this.app.vault.process(file, () => args.content || "");
      return `Wrote ${path}`;
    }
    if (name === "patch_file") {
      if (!s.allowEdit) throw new Error("Editing notes is disabled");
      const file = this.app.vault.getFileByPath(path);
      if (!file) throw new Error(`Missing: ${path}`);
      const old = args.old || "";
      await this.app.vault.process(file, (text) => {
        if (!old || !text.includes(old)) throw new Error("old text not found");
        return text.replace(old, args.new || "");
      });
      return `Patched ${path}`;
    }
    if (name === "delete_file") {
      if (!s.allowDelete) throw new Error("Deleting notes is disabled");
      const file = this.app.vault.getFileByPath(path);
      if (!file) throw new Error(`Missing: ${path}`);
      await this.app.vault.trash(file, false);
      return `Trashed ${path}`;
    }
    throw new Error(`Unknown tool: ${name}`);
  }
}
