# Smart Notes

An [Obsidian](https://obsidian.md) plugin that turns your vault into an AI-assisted knowledge workspace. Chat with your notes, optimize them, autocomplete inside the editor, and give the AI a structured view of your vault — all powered by the model provider you configure.

> Display name: **Smart Notes** · Plugin ID: `smart-notes` · Requires Obsidian 1.11.4+

## Features

### AI chat panel
A dedicated right-sidebar chat about your vault and the active note.
- **Multiple sessions** — create, switch, rename, and delete conversations; collapse/expand the history sidebar. Each session keeps its own messages, attachments, skills, and web-search state.
- **Streaming replies** with live Markdown rendering, a typing indicator, and per-reply **token usage**.
- **Per-conversation model & role** — pick the model (grouped by link) and the role for each chat; the choice stays scoped to that conversation.
- **Reasoning display** — for reasoning models (e.g. DeepSeek-R1, OpenAI o1) the model's thinking process is shown in a collapsible block above the reply (toggle in settings).
- **History window** — older turns are compressed into a summary so long chats don't blow the token budget.

### Model configuration (multi-provider)
Configure one or more **model links**, each pointing at an AI backend:
- **OpenAI-compatible** (OpenAI, Azure OpenAI, DeepSeek, local gateways, …) — Base URL + API key.
- **Ollama** (local) — Base URL only, fully offline if the model runs locally.
- Each link can list **multiple models** and carry optional per-link **max tokens** / **temperature**.
- API keys are stored in **Obsidian's secret storage (keychain)**, not in plain plugin data. A **Test connection** button verifies a link before saving.
- Set any link as the **default**; the active link is used by every AI feature.

### Roles
Define reusable **system-prompt roles** (name + prompt, with an optional avatar). A default role is injected into the system prompt of *every* AI feature (chat, optimize, autoprompt, frontmatter). In a chat you can switch the active role per conversation. This replaces the old single "custom instructions" field.

### Knowledge base & privacy model
The plugin is designed so the AI only sees what you explicitly share:
- **File-path index** (optional) — injects a list of all Markdown file paths so the AI knows what's in your vault, without loading any content.
- **Frontmatter index** (optional) — injects each note's YAML properties (tags, category, summary, …) so the AI understands your vault's structure, again without body text.
- **Attachments** — attach specific files or whole folders to a conversation; only their content is read.
- **@-mentions** — if you name a vault file in a message, that file's content is pulled in.
- Everything else stays local. You can hide the "Attach file/folder" button entirely.

### Skills
Drop skill bundles (a folder containing `SKILL.md`) into the AI folder's `skills/` directory. Skills can be toggled on for new chats, and managed per conversation via the chat's **Skill** button. Only **active** skills' content is sent to the AI; inactive skills are listed by name so the AI knows they exist and can suggest enabling them.

### Web search
Optional web search inside a chat (🌐 button, per session). Supports **Tavily / Serper (Google) / Brave / SearXNG**, with multi-key polling (one key fails → try the next). Results can be cited inline with `[n]`. Off by default and only runs when you explicitly enable it in a chat.

### Note optimization
The **Optimize current note** command asks the AI to polish wording, restructure, or summarize the active note. Preview the result in a diff-style modal (Original vs Optimized) and apply with one click. Internal-link format (`[[wikilink]]` vs `[markdown](path.md)`) and path style are configurable.

### Frontmatter generation
The **Generate frontmatter** command reads the current note and asks the AI to produce a YAML frontmatter block (title, date, tags, category, summary, keywords, …). A custom template can override the default system prompt.

### In-editor autocompletion
- **Realtime autoprompt** (optional, off by default) — debounced inline "ghost text" suggestions as you type; accept with `Tab`.
- **Autoprompt at cursor** command — trigger a suggestion on demand.

### Conversation memory & long-term profile
- All chat sessions are persisted in your vault, so conversations survive restarts.
- In the background the plugin distills your chat history into a **long-term profile memory** (`memory/MEMORY.md` + a daily note) along configurable dimensions (occupation, tech stack, preferences, …). It is injected as background context and is fully **user-editable**.

### Localization
The UI is fully internationalized and follows your Obsidian language (`Settings → About → Language`). **English** and **简体中文** are bundled. To add a language, copy `src/i18n/locales/en.json`, translate the values, and register it in `src/i18n/index.ts`.

## Privacy & network usage

This plugin makes **network requests** to the endpoints you configure:
- Your chosen **model link** (OpenAI-compatible or Ollama) — note text is sent to the `chat/completions` endpoint you set.
- Optional **web search** providers (Tavily / Serper / Brave / SearXNG) — only when you enable web search in a chat.

No data is sent anywhere except the endpoints you explicitly configure. There is **no telemetry**. API keys live in Obsidian's secret storage, not in plain plugin data. Vault file *contents* are only transmitted when you attach a file/folder or mention it by name in a message; indexes carry paths/metadata only.

## Settings

| Section | Setting | Description |
|---------|---------|-------------|
| Model configuration | Model links | Add / edit / delete / set default AI backends; each holds type, Base URL, API key (keychain), models, optional max tokens & temperature. |
| | Test connection | Verify a link with a tiny ping. |
| | Data storage path | Name of the vault-root folder for memory & skills (default `.smartnotes`). |
| Interaction | Realtime autoprompt | Inline ghost-text suggestions while typing (off by default). |
| | Realtime debounce (ms) | Idle time before a realtime suggestion is requested. |
| | Optimize current note | Enable the optimize command. |
| | Open AI chat panel | Enable the chat command. |
| | Attach current note to chat | Auto-attach the active note when opening chat (off by default). |
| | Show AI reasoning | Show reasoning models' thinking block. |
| | Generate frontmatter | Enable the frontmatter command. |
| | Frontmatter template | Custom system prompt for frontmatter generation. |
| | Internal link format / type | Wikilink vs Markdown link; shortest / relative / absolute paths. |
| | Max tokens / Temperature | Global generation limits (per-link values override). |
| Knowledge base | Enable file selection | Show the "Attach file/folder" button in chat. |
| | Enable file index | Inject all Markdown file paths into the system prompt (off by default). |
| | Max files in file index | Cap injected paths (0 = unlimited). |
| | Enable property index | Inject Frontmatter metadata into the system prompt (off by default). |
| | Properties to index / Max files / Max chars | Fine-tune the Frontmatter index. |
| | Max chars per attached file | Truncate attached content sent to the AI. |
| | History window | Recent N messages sent to the model; older turns compressed to a summary (0 = send all). |
| User profile | Enable user profile memory | Build & inject long-term profile memory. |
| | Profile dimensions | One dimension per line used to extract the profile. |
| | Memory file (MEMORY.md) | View/edit the AI-curated profile; auto-saved. |
| | Profile memory char cap | Truncate profile before injection. |
| Roles | Enable roles | Show the Role button and inject the default role. |
| | Role info | Add / edit / delete roles; set a default. |
| Skills | Enable skills | Show the Skill button and allow injection. |
| | Default skills | Toggle which skills are enabled for new chats. |
| Web search | Enable web search | Master switch for web search. |
| | Search provider | Tavily / Serper / Brave / SearXNG. |
| | API keys / instances | Per-provider credentials (multi-key polling). |
| | Max results / Max chars / Show citations | Search tuning. |

## AI folder layout

On load the plugin creates the following at your vault root (folder name configurable, default `.smartnotes`):

```
.smartnotes/
├── sessions/
│   ├── index.json            # session index (metadata only: id, title, time, message count)
│   └── session-<id>.json     # one conversation's full content (messages, attachments, skills, web search)
├── memory/
│   ├── MEMORY.md             # long-term profile memory (auto-built, editable)
│   └── yyyy-mm-dd.md         # daily memory note
└── skills/
    └── README.md            # what this folder is for
```

- The **index** holds only lightweight metadata; the last 10 sessions are fully loaded on startup, older ones are read lazily when you open them.
- Each **per-session file** is written only when that session changes.

## Commands

- Optimize current note
- Autoprompt at cursor
- Open AI chat panel
- Generate frontmatter

## Install (development)

1. Copy the built `main.js`, `manifest.json`, and `styles.css` into `<your-test-vault>/.obsidian/plugins/smart-notes/`.
2. Enable the plugin in Obsidian settings.
3. Configure a model link (Settings → Smart Notes → Model configuration) and add your API key / Ollama URL.

> Use a **separate test vault** while developing — do not run this on your main vault.

## License

MIT © hellokunzai
