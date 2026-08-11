# AI Note Agent

An [Obsidian](https://obsidian.md) plugin that turns your vault into a self-improving knowledge base, powered by an AI model of your choice.

## Features

- **Analyze & bidirectional links** — Scan a note (or the whole vault) and let AI find related notes, then automatically insert links in **both** notes so the relationship shows up in Obsidian's backlinks and graph.
- **Enrich properties** — AI generates `tags`, `aliases`, and a `summary` and writes them into each note's frontmatter.
- **Optimize notes** — AI polishes wording, reorganizes structure, or writes a summary. Preview the result in a diff-style modal before applying.
- **AI chat panel** — Open a dedicated right-sidebar chat. Ask questions about your vault or the active note.
- **In-editor autocompletion** — Two modes:
  - **Command** (`AI: Autoprompt`): trigger on demand at the cursor.
  - **Realtime** (optional, toggle in settings): debounced inline "ghost text" suggestion you accept with `Tab`.

## AI provider (network usage disclosure)

This plugin makes **network requests** to an AI provider you configure:

- **OpenAI-compatible** (e.g. OpenAI, Azure OpenAI, local gateways): sends note text to the `chat/completions` endpoint you configure. Requires an API key.
- **Ollama** (local): sends note text to a local Ollama instance (default `http://localhost:11434`). No API key, fully offline if the model runs locally.

No data is sent anywhere except the endpoint you explicitly configure. There is no telemetry. Choose the provider in **Settings → AI Note Agent**.

## Link style

By default the plugin inserts **standard Markdown relative links** (`[Title](path.md)`) to stay compatible with plain-Markdown tools. You can switch to Obsidian **wikilinks** (`[[Note]]`) in settings if you prefer.

## Localization

The plugin UI is fully internationalized and **follows your Obsidian language** (`Settings → About → Language`):

- **English** (default) and **简体中文** are bundled out of the box.
- All commands, settings, notices, and dialogs switch automatically — no restart needed beyond reloading the plugin.
- To add another language, copy `src/i18n/locales/en.json`, translate the values, and register it in `src/i18n/index.ts` (`locales` map). The `related.heading` key controls the `##` section title inserted into your notes.

## Settings

| Setting | Description |
|---------|-------------|
| Provider | `openai` or `ollama` |
| OpenAI API key / Base URL / Model | Used when provider = openai |
| Ollama Base URL / Model | Used when provider = ollama |
| Test connection | Button that sends a tiny ping to verify provider settings |
| Link style | `relative` (default) or `wikilink` |
| Auto-insert bidirectional links | on/off |
| Enrich properties | on/off |
| Realtime autoprompt | on/off + debounce ms |
| Related notes per note | how many suggestions to insert |

## Install (development)

1. Copy the built `main.js`, `manifest.json`, and `styles.css` into `<your-test-vault>/.obsidian/plugins/ai-note-agent/`.
2. Enable the plugin in Obsidian settings.
3. Configure your provider and API key.

> Use a **separate test vault** while developing — do not run this on your main vault.

## Commands

- Analyze current note (分析当前笔记)
- Analyze entire vault (分析整个仓库)
- Enrich properties of current note (补充当前笔记的属性)
- Optimize current note (优化当前笔记)
- Autoprompt at cursor (在光标处自动提示)
- Open AI chat panel (打开 AI 对话面板)

## License

MIT © hellokunzai
