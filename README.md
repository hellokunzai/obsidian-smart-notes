<div align="center">

**Language:** English · [中文](README.zh.md)

</div>

---

# Smart Notes

An [Obsidian](https://obsidian.md) plugin that turns your vault into an AI-assisted knowledge workspace. Chat about your vault, let the AI search your notes on demand, optimize notes, autocomplete inside the editor, and generate frontmatter — all powered by the model provider you configure.

> Display name: **Smart Notes** · Plugin ID: `smart-notes` · Requires Obsidian 1.11.4+

## Features

### AI chat panel
A dedicated right-sidebar chat about your vault and the active note.
- **Multiple sessions** — create, switch, rename, and delete conversations; collapse/expand the history sidebar. Each session keeps its own messages, attachments, skills, selected properties, and web-search state.
- **Batch actions** — enter batch mode in the session list to select multiple sessions (select all / clear selection) and delete them in one go.
- **Streaming replies** with live Markdown rendering, a typing indicator, a stop button, and per-reply **token usage**.
- **Per-conversation model & role** — pick the model (grouped by link) and the role for each chat; the choice stays scoped to that conversation.
- **Reasoning display** — for reasoning models (e.g. DeepSeek-R1, OpenAI o1) the model's thinking process is shown in a collapsible block above the reply (toggle in settings).
- **Activity timeout** — a streaming request is treated as timed out after N seconds without any data; raise it for slow reasoning models. There is also a fixed 10-minute overall timeout.
- **History window** — older turns are compressed into a summary so long chats don't blow the token budget.

### Model configuration (multi-provider)
Configure one or more **model links**, each pointing at an AI backend:
- **OpenAI-compatible** (OpenAI, Azure OpenAI, DeepSeek, local gateways, …) — Base URL + API key.
- **Ollama** (local) — Base URL only, fully offline if the model runs locally.
- Each link can list **multiple models** and carry optional per-link **max tokens** / **temperature**.
- API keys are stored in **Obsidian's secret storage (keychain)**, not in plain plugin data. The secret picker lets you search, create, inspect, and delete keychain secrets. A **Test connection** button verifies a link before you rely on it.
- Set any link as the **default**; the active link is used by every AI feature. The link list is searchable by name.

### Roles
Define reusable **system-prompt roles** (name + prompt, with an optional avatar). A default role is injected into the system prompt of *every* AI feature (chat, optimize, autoprompt, frontmatter). In a chat you can switch the active role per conversation. This replaces the old single "custom instructions" field.

### Knowledge base & on-demand vault search
The plugin is designed so the AI only sees what you explicitly share, and it **searches your vault on demand** instead of loading everything up front:
- **File index** (optional) — when enabled, the AI can call `search_vault_paths` to find notes by path/name keywords. Each match is returned **with its content**.
- **Property index** (optional) — the AI can call `search_vault_frontmatter` to find notes by their YAML properties (tags, category, summary, …). Matches come back with the metadata **and the note's content**.
- **Content search** — `search_vault_content` finds notes by text inside the body and returns matching snippets.
- **Read on demand** — `read_vault_notes` reads the full text of one or more notes by exact path, for notes beyond the result limit or whose content was truncated.
- **Property selection** (optional) — the "Select properties" button lets you choose which Frontmatter properties apply to the current chat, temporarily overriding the global whitelist.
- **Attachments** — attach specific files or whole folders to a conversation; only their content is read.
- **@-mentions** — if you name a vault file in a message, that file's content is pulled in.
- Everything else stays local. No file content is ever sent for notes the AI hasn't searched for or read. Attached files and search hits are each truncated to a configurable character cap (the **Files** and **Properties** groups have independent caps).

### Skills
Drop skill bundles (a folder containing `SKILL.md`) into the AI folder's `skills/` directory, or **upload a `.zip` package** downloaded from a skill hub and let the plugin extract it. Skills can be searched, deleted (moved to the system trash, including their assets), toggled on for new chats, and managed per conversation via the chat's **Skill** button.

The AI receives an **index** of skills (name + path + one-line description) and can request one by emitting `@use-skill: <path>`; the plugin then loads that skill's full instructions and continues automatically. Only **active** skills' content is sent; inactive skills are listed by name so the AI knows they exist and can suggest enabling them.

### Web search
Optional web search inside a chat (🌐 button, per session). Supports **Tavily / Serper (Google) / Brave / SearXNG**, with multi-key polling (one key fails → try the next). Results can be cited inline with `[n]`. Off by default and only runs when you explicitly enable it in a chat.

### Note optimization
The **Optimize current note** command asks the AI to polish wording, restructure, or summarize the active note. Preview the result in a diff-style modal (Original vs Optimized) and apply with one click. Internal-link format (`[[wikilink]]` vs `[markdown](path.md)`) and path style are configurable.

### Frontmatter generation
The **Generate frontmatter** command reads the current note and asks the AI to produce a YAML frontmatter block. The template is a **list of fields, one per line** (comma-separated also works); only the listed fields are generated, and the `date` field (if present) is forced to today.

### In-editor autocompletion
- **Realtime autoprompt** (optional, off by default) — debounced inline "ghost text" suggestions as you type; accept with `Tab`.
- **Autoprompt at cursor** command — trigger a suggestion on demand.

### Conversation memory & long-term profile
- All chat sessions are persisted in your vault, so conversations survive restarts.
- In the background the plugin distills your chat history into a **long-term profile memory** (`memory/MEMORY.md` + a daily note) along configurable dimensions (occupation, tech stack, preferences, …). Choose whether it updates **per chat** or **on startup**, or trigger it manually with **Organize now**. The result is injected as background context and is fully **user-editable**.

### Localization
The UI is fully internationalized and follows your Obsidian language (`Settings → About → Language`). **English** and **简体中文** are bundled. To add a language, copy `src/i18n/locales/en.json`, translate the values, and register it in `src/i18n/index.ts`.

## Privacy & network usage

This plugin makes **network requests** to the endpoints you configure:
- Your chosen **model link** (OpenAI-compatible or Ollama) — note text is sent to the `chat/completions` endpoint you set.
- Optional **web search** providers (Tavily / Serper / Brave / SearXNG) — only when you enable web search in a chat.

No data is sent anywhere except the endpoints you explicitly configure. There is **no telemetry**. API keys live in Obsidian's secret storage, not in plain plugin data. Vault file *contents* are only transmitted when the AI searches/reads a note, when you attach a file/folder, or when you mention a file by name in a message.

## Settings

| Section | Setting | Description |
|---------|---------|-------------|
| Model configuration | Model links | Add / edit / delete / set default AI backends; each holds type, Base URL, secret (keychain), models, optional max tokens & temperature. Search the list by name. |
| | Test connection | Verify a link with a tiny ping. |
| | Data storage path | Name of the vault-root folder for memory & skills (default `.smartnotes`). |
| Interaction settings → AI chat panel | Open AI chat panel | Enable the chat command. |
| | Attach current note to chat | Auto-attach the active note when opening chat (off by default). |
| | Show AI reasoning | Show reasoning models' thinking block. |
| | History window | Recent N messages sent to the model; older turns compressed to a summary (0 = send all). |
| | Activity timeout (seconds) | No streamed data for N seconds → treat as timed out (min 10). |
| Interaction settings → Autoprompt | Realtime autoprompt | Inline ghost-text suggestions while typing (off by default). |
| | Realtime debounce (ms) | Idle time before a realtime suggestion is requested. |
| Interaction settings → Note optimization | Optimize current note | Enable the optimize command. |
| | Internal link type | Shortest / relative / absolute paths. |
| | Internal link format | Wikilink vs Markdown link. |
| Interaction settings → Generate frontmatter | Auto-generate frontmatter | Enable the frontmatter command. |
| | Frontmatter template | One field per line; only the listed fields are generated. |
| Knowledge base → Files | Enable file index | Turn on the on-demand file tools (`search_vault_paths`, content search, read). |
| | Enable file selection | Show the "Add file/folder" button in chat. |
| | Max files in file index | Cap on how many paths a single `search_vault_paths` call returns (0 = unlimited); also how many notes carry content per search. |
| | Max chars per attached file | Truncate each attached file / file-search hit to this length. |
| Knowledge base → Properties | Enable property index | Turn on the on-demand property tool (`search_vault_frontmatter`). |
| | Enable property selection | Show the "Select properties" button in chat. |
| | Max files in property index | Cap on how many files a single `search_vault_frontmatter` call returns (0 = unlimited). |
| | Max chars per attached file | Truncate each note returned by the property search (independent from the cap under Files). |
| | Properties to index | Only index the listed properties, one per line or comma-separated; empty = all non-empty properties. |
| User profile | Enable user profile memory | Build & inject long-term profile memory. |
| | Update mode | Update the profile per chat, or on startup. |
| | Organize now | Run a profile-organization pass immediately. |
| | Profile dimensions | One dimension per line used to extract the profile. |
| | Memory file (MEMORY.md) | View/edit the AI-curated profile; auto-saved. |
| | Profile memory char cap | Truncate the profile before injection. |
| Roles | Enable roles | Show the Role button and inject the default role. |
| | Role info | Add / edit / delete roles; set a default. |
| Skills | Enable skills | Show the Skill button and allow injection. |
| | Upload skill | Pick a `.zip` skill package to extract into `skills/`. |
| | Default skills | Toggle which skills are enabled for new chats; search, refresh, open folder, or delete a skill. |
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
│   └── session-<id>.json     # one conversation's full content (messages, attachments, skills, selected properties, web search)
├── memory/
│   ├── MEMORY.md             # long-term profile memory (auto-built, editable)
│   └── yyyy-mm-dd.md         # daily memory note
└── skills/
    └── README.md             # what this folder is for
```

- The **index** holds only lightweight metadata; the last 10 sessions are fully loaded on startup, older ones are read lazily when you open them.
- Each **per-session file** is written only when that session changes.
- The AI folder is a hidden (dot-prefixed) folder, so its contents are not indexed by the vault search tools.

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
