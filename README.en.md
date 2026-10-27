# Smart Notes

> Let AI analyze your knowledge base: auto-generate backlinks, fill in Frontmatter properties, optimize notes, offer in-editor autocompletion, and chat with a multi-session AI panel.

Smart Notes is an AI assistant plugin for Obsidian that turns the scattered notes in your vault into a connected, structured, and searchable knowledge network. All AI capabilities share one "model link" configuration (OpenAI-compatible / local Ollama), and support multi-turn conversations, long-term profile memory, role-play, skill injection, and web search.

- **Plugin ID**: `smart-notes`
- **Minimum Obsidian version**: `1.11.4`
- **Current version**: `0.24.5`
- **License**: MIT

---

## 📌 Key Features

### 1. AI Chat Panel
- A multi-session chat panel in the right sidebar, supporting create / rename / delete / bulk-delete sessions.
- Each turn shows token usage (prompt + completion); reasoning models can expand the "thinking process".
- Built-in model selector (grouped by link) and role selector.
- Supports streaming output, a "Stop" button, and activity-timeout protection (for reasoning models such as DeepSeek-R1).

### 2. In-Editor Live Autocompletion (Autoprompt)
- Real-time inline "ghost text" suggestions at the cursor while you type; press `Tab` to accept.
- Off by default; debounce time (ms) is configurable.

### 3. Optimize Current Note
- Rewrite the current Markdown note with AI: strengthen structure, generate backlinks, add context.
- Configurable internal link syntax (Wikilink / Markdown) and path style (shortest / relative / absolute).
- Triggered via command; a "original vs. optimized" diff modal appears before writing, and only commits after confirmation.

### 4. Auto-Generate Frontmatter
- Reads the current note body and lets AI generate YAML Frontmatter from your configured field template.
- The template is editable (one field per line); the `date` field is always forced to today.

### 5. Model Configuration (Multiple Links)
- Configure multiple "model links", each pointing to one AI backend (e.g. DeepSeek, OpenRouter, local Ollama); one link can host multiple models.
- API keys are stored only in the Obsidian keychain and are **never written to `data.json`**.
- The list view supports search by name, set-as-default, edit, and delete.

### 6. Knowledge Base Context
- **File index / Property index**: let AI call tools on demand to retrieve from the vault.
  - `search_vault_paths`: search file/folder paths; matching notes include their body by default.
  - `read_vault_notes`: read the full text of any note.
  - `search_vault_frontmatter`: search by Frontmatter metadata (tags, category, summary, etc.).
- **File selection / Property selection**: manually attach vault files or pick Frontmatter properties to inject into a conversation.
- **History window**: only the most recent N messages are sent; older content is compressed into a summary and injected.

### 7. Long-Term Profile Memory (User Profile)
- AI extracts a user profile from chat history and persists it to `data folder/memory/MEMORY.md`.
- Configurable update timing (after each conversation / on plugin startup) and extraction dimensions.
- Truncated by character limit before injection into the system prompt to avoid unbounded token growth.

### 8. Roles
- Supports multiple role prompts (name + stance/tone/responsibility); a default role can be injected into all AI features.
- Roles support avatars (built-in emoji, an in-vault image, or an uploaded image; defaults to a colored initial block).

### 9. Skills
- A Skill is the `SKILL.md` of each suite under the `skills/` directory in the data folder.
- Enabled skills enter the system prompt only as an index (name + path + one-line description); AI can wake them with `@use-skill: <path>` in a reply, and the plugin automatically injects the full content into the next turn.
- Skills can also be injected manually via the Skill button in the chat box; `.zip` packages downloaded from SkillHub can be uploaded.

### 10. Web Search
- Supports Tavily / Serper (Google) / Brave / SearXNG.
- Master toggle is off by default and will **not proactively go online**; the external API is only called when the 🌐 button is explicitly turned on in a conversation.
- AI can be asked to cite sources with `[n]` markers.

### 11. Tool Calling
- Uses the OpenAI-compatible function calling format, compatible with Ollama / Claude and similar endpoints.
- Built-in vault tools (path search, note reading, property search) are invoked at the model's discretion.

### 12. Internationalization
- Built-in English and Simplified Chinese, switching automatically with the Obsidian display language.

---

## 🔧 Installation

### From the Community Marketplace (Recommended)
In Obsidian, go to Settings → Community plugins → Browse, search for **Smart Notes**, then install and enable it.

### Manual Installation
1. Download the latest `main.js`, `manifest.json`, and `styles.css` from [GitHub Releases](https://github.com/hellokunzai/obsidian-smart-notes/releases).
2. Place these three files into `.obsidian/plugins/smart-notes/` in your vault.
3. Enable **Smart Notes** in Obsidian Settings → Community plugins.

---

## ⚙️ Configuration

After enabling the plugin, configure it under **Settings → Smart Notes**. The settings page is organized into the following tabs:

| Tab | Contents |
| --- | --- |
| **Models** | AI backend links, data storage folder, credentials (keychain) |
| **Interaction** | AI chat panel, live autocompletion, note optimization, Frontmatter generation |
| **Knowledge Base** | File index, property index, file/property selection, history window |
| **User Profile** | Long-term profile memory toggle, update timing, extraction dimensions |
| **Roles** | Role prompt management, default role |
| **Skills** | Skill toggles, upload, list management |
| **Web Search** | Provider, keys/instance, result and citation settings |

### Key Steps
1. In **Models**, add a model link (e.g. DeepSeek, OpenAI, or local Ollama) and enter its credentials.
2. Set that link as the default in the settings.
3. Enable feature toggles as needed (chat panel, live autocompletion, note optimization, Frontmatter generation, etc.).

---

## 🖱️ Usage

### Command Palette / Editor Right-Click Menu
The plugin provides the following commands in the command palette and the editor right-click menu (under the "Smart Notes" parent):
- **Optimize current note**
- **Autoprompt at cursor**
- **Open AI chat panel**
- **Generate frontmatter**

### Chat Panel
- Open the chat panel via the left sidebar icon or a command.
- Type a message in the input box; `Enter` sends, `Shift+Enter` inserts a newline.
- The top bar lets you switch between: new session, session history sidebar, model selection, role selection, attach file/folder, select properties, skills, and the web search toggle.

---

## 🔒 Privacy & Security
- **API keys never hit disk**: all secrets are stored only in the Obsidian keychain, never in the plugin data file.
- **No proactive networking**: web search is off by default and only calls external APIs when explicitly enabled in a conversation.
- **Local models supported**: via an Ollama link, everything can run fully on-device with no data leaving your machine.
- **Data folder**: the plugin creates a data folder at the vault root (default `.smartnotes`, renameable in settings) that holds `memory/` (profile memory) and `skills/`.

---

## 💻 Local Development

```bash
# Install dependencies
npm install

# Development mode (watch and bundle)
npm run dev

# Production build (type check + minify)
npm run build
```

The build artifacts `main.js` and `styles.css` are used directly for distribution. The plugin requires Node.js ≥ 18.

---

## 📄 License
This project is open source under the [MIT License](./LICENSE).
