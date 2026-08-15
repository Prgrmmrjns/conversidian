# Mistral Voice

Talk to your [Obsidian](https://obsidian.md) vault with [Mistral](https://mistral.ai). Speak or type; the agent can list, read, create, edit, or trash markdown notes — only the actions you allow.

Desktop only (microphone). Requires a Mistral API key.

## How to use

1. Install the plugin and enable it.
2. Open **Settings → Mistral Voice** and paste your API key from [console.mistral.ai](https://console.mistral.ai).
3. Click the ribbon mic, or run **Open Mistral Voice**.
4. Tap the round **mic** button, talk, then pause. Type in the box if you prefer.

Toolbar (in the view):

| Control | What it does |
|---------|----------------|
| Speaker | Speak replies on/off |
| Pencil | Allow creating and editing notes |
| Trash | Allow moving notes to the Obsidian trash |
| Voice | Choose a Voxtral voice |
| Gear | Open full settings |
| X | Clear the conversation |

Delete is **off** by default. Turn it on in the view or in settings. File tools can be limited to one folder.

## Privacy

Audio you record and the text of notes the agent reads or writes are sent to Mistral’s API (`api.mistral.ai`). Do not enable write/delete on vaults you would not trust with that.

## Commands

- Open Mistral Voice
- Start talking
- Stop talking

## Development

```bash
npm install
npm run dev
```

Reload the plugin in Obsidian after a rebuild.

Release: bump `package.json` version, run `npm run version`, commit, tag `x.y.z` (no `v` prefix), and push the tag. GitHub Actions attaches `main.js`, `manifest.json`, and `styles.css`.

## License

MIT
