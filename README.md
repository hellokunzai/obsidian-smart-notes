# Vault Mind

An [Obsidian](https://obsidian.md) plugin that turns your vault into a self-improving knowledge base, powered by an AI model of your choice.

## Features

- **Analyze & bidirectional links** — Scan a note (or the whole vault) and let AI find related notes, then automatically insert links in **both** notes so the relationship shows up in Obsidian's backlinks and graph.
- **Enrich properties** — AI generates `tags`, `aliases`, and a `summary` and writes them into each note's frontmatter.
- **Optimize notes** — AI polishes wording, reorganizes structure, or writes a summary. Preview the result in a diff-style modal before applying.
- **AI chat panel** — Open a dedicated right-sidebar chat. Ask questions about your vault or the active note. Supports **multiple sessions** with a collapsible history sidebar: create, switch to, rename, and delete any session, and continue chatting where you left off.
- **In-editor autocompletion** — Two modes:
  - **Command** (`AI: Autoprompt`): trigger on demand at the cursor.
  - **Realtime** (optional, toggle in settings): debounced inline "ghost text" suggestion you accept with `Tab`.
- **Custom instructions** — Set persistent instructions that are injected into the system prompt of *every* AI feature (chat, analysis, optimize, autoprompt). e.g. "Reply in Chinese; keep answers concise; act as my legal advisor."
- **Conversation memory** — Chat history is persisted in your vault so multi-turn conversations continue after a restart. Toggle it on/off and cap how many recent messages are kept in context/disk.
- **AI folder** — On load the plugin auto-creates a folder (default `.vaultmind`) at your vault root to store chat memory (`sessions/index.json` plus one `session-<id>.json` per conversation) and a `skills/` directory where you can drop custom skill `.md` files for future use.

## AI provider (network usage disclosure)

This plugin makes **network requests** to an AI provider you configure:

- **OpenAI-compatible** (e.g. OpenAI, Azure OpenAI, local gateways): sends note text to the `chat/completions` endpoint you configure. Requires an API key.
- **Ollama** (local): sends note text to a local Ollama instance (default `http://localhost:11434`). No API key, fully offline if the model runs locally.

No data is sent anywhere except the endpoint you explicitly configure. There is no telemetry. Choose the provider in **Settings → Vault Mind**.

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
| Custom instructions | multi-line text injected into every AI system prompt |
| Conversation memory | on/off; persist chat history in the vault |
| Max memory messages | cap of recent messages kept in context and on disk |
| AI folder name | name of the vault-root folder that stores memory & skills |

## Multiple sessions

The chat panel keeps an ongoing list of **sessions** (conversations) instead of a single thread:

- **New chat** (`+`) starts a fresh session and switches to it.
- **History sidebar** shows all sessions ordered by last activity; click any item to switch back into that conversation.
- **Rename** (`✎`) lets you set a title; the first assistant reply also auto-suggests a title from your opening message.
- **Delete** (`🗑`) removes a session after a confirmation; if you delete the active one, the next session is opened automatically (or a new blank one is created).
- **Clear current** wipes the messages of the active session but keeps the session itself.
- The `≡` button collapses/expands the history sidebar.

All sessions are stored together in `memory/chat-history.json` (one file). Legacy single-array files are migrated automatically into a single imported session.

## AI folder layout

When the plugin loads, it creates the following structure at your vault root (folder name configurable):

```
.vaultmind/
├── sessions/
│   ├── index.json            # session index (lightweight metadata only: id, title, time, message count)
│   └── session-<id>.json     # full content of one conversation (messages, attachments, skills, web search)
└── skills/                  # custom skill files (reserved for future loading)
    └── README.md            # what this folder is for
```

- **Index** (`index.json`) holds only lightweight metadata for every session — fast to load even with many conversations. The last N sessions (most recent) are fully loaded on startup; older ones are read lazily from their own file only when you click them.
- **Per-session files** (`session-<id>.json`) store the full conversation. Each is written only when that session changes, so an unused old session is never rewritten.
- **Clear current** button in the chat header wipes the active session's messages (but keeps the session and the rest of your history).
- **Skills** is a reserved directory; later versions will load `.md` files placed here into the chat context.

## Install (development)

1. Copy the built `main.js`, `manifest.json`, and `styles.css` into `<your-test-vault>/.obsidian/plugins/vault-mind/`.
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
