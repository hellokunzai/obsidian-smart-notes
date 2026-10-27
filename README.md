# Smart Notes

> 用 AI 分析你的知识库：自动生成双向链接、补全 Frontmatter 属性、优化笔记、在编辑器内补全，并提供多会话 AI 对话面板。

Smart Notes 是一个面向 Obsidian 的 AI 助手插件，帮助你把散落在 vault 里的笔记变成一张互相连接、结构化、可被检索的知识网络。所有 AI 能力共享同一套「模型链接」配置（OpenAI 兼容 / Ollama 本地模型），并支持多轮对话、长期画像记忆、角色扮演、技能（Skill）注入与联网搜索。

- **插件 ID**：`smart-notes`
- **最低 Obsidian 版本**：`1.11.4`
- **当前版本**：`0.24.5`
- **许可协议**：MIT

---

## 📌 主要功能

### 1. AI 对话面板
- 右侧边栏多会话聊天面板，支持新建 / 重命名 / 删除 / 批量删除会话。
- 每轮对话显示 Token 消耗（提示 + 完成），推理模型可展开「思考过程」。
- 内置模型选择器（按链接分组）与角色选择器。
- 支持流式输出与「停止」按钮、活动超时保护（适配 DeepSeek-R1 等推理模型）。

### 2. 编辑器内实时补全（Autoprompt）
- 打字时在光标处实时给出行内「幽灵文本」建议，按 `Tab` 接受。
- 默认关闭；可配置防抖时间（毫秒）。

### 3. 优化当前笔记
- 用 AI 重写当前 Markdown 笔记：补强结构、生成双向链接、补全上下文。
- 可配置内部链接语法（Wikilink / Markdown）与路径风格（最短 / 相对 / 绝对）。
- 通过命令触发，调用前弹出「原文 vs 优化后」对比弹窗，确认后再写入。

### 4. 自动生成 Frontmatter
- 读取当前笔记正文，让 AI 按你设定的字段模板生成 YAML Frontmatter。
- 模板可编辑（每行一个字段），自动把 `date` 字段强制写为今天。

### 5. 模型配置（多链接）
- 支持配置多个「模型链接」，每个链接对应一个 AI 后端（如 DeepSeek、OpenRouter、本地 Ollama），一条链接可挂多个模型。
- API Key 仅保存在 Obsidian 钥匙串（keychain），**不写入 `data.json`**。
- 列表页支持按名称搜索、设为默认、编辑与删除。

### 6. 知识库上下文
- **文件索引 / 属性索引**：让 AI 在对话中按需调用工具检索 vault。
  - `search_vault_paths`：搜索文件/文件夹路径；匹配笔记默认附带正文。
  - `read_vault_notes`：读取任意笔记全文。
  - `search_vault_frontmatter`：按 Frontmatter 元数据（tags、category、summary 等）检索。
- **文件选择 / 属性选择**：对话中手动附加 vault 文件或挑选要注入的 Frontmatter 属性。
- **历史窗口**：仅发送最近 N 条历史，更早内容压缩为摘要注入。

### 7. 长期画像记忆（User Profile）
- AI 从聊天历史中提取用户画像，落地到 `数据文件夹/memory/MEMORY.md`。
- 可配置更新时机（每次对话后 / 插件启动时）与提取维度。
- 注入 system prompt 前按字符上限截断，避免 token 无限膨胀。

### 8. 角色（Roles）
- 支持多条角色提示词（名称 + 立场/语气/职责），可设默认角色注入所有 AI 功能。
- 角色支持头像（内置 emoji、vault 内图片或上传图片，缺省显示名字首字母色块）。

### 9. 技能（Skills）
- Skill = 数据文件夹下 `skills/` 目录中每个套件的 `SKILL.md`。
- 设置中「启用」的 skill 仅以索引（名称 + 路径 + 一句话描述）进入 system prompt；AI 可在回复中用 `@use-skill: <path>` 唤醒，插件自动把完整内容注入下一轮会话。
- 也可在对话框手动通过 Skill 按钮注入；支持从 SkillHub 下载的 `.zip` 包上传。

### 10. 联网搜索
- 支持 Tavily / Serper（Google）/ Brave / SearXNG。
- 默认总开关关闭且**不会主动联网**；仅在对话中显式开启 🌐 按钮时才调用外部 API。
- 可要求 AI 用 `[n]` 标注来源。

### 11. 工具调用（Tool Calling）
- 采用 OpenAI 兼容的 function calling 格式，兼容 Ollama / Claude 等接口。
- 内置 vault 工具（路径检索、读取笔记、属性检索），由模型自主决定调用。

### 12. 国际化
- 内置英文与简体中文，跟随 Obsidian 显示语言自动切换。

---

## 🔧 安装

### 从社区市场（推荐）
在 Obsidian 设置 → 社区插件 → 浏览中搜索 **Smart Notes** 安装并启用。

### 手动安装
1. 从 [GitHub Releases](https://github.com/hellokunzai/obsidian-smart-notes/releases) 下载最新版本的 `main.js`、`manifest.json`、`styles.css` 三个文件。
2. 在 vault 的 `.obsidian/plugins/smart-notes/` 目录下放入这三个文件。
3. 在 Obsidian 设置 → 社区插件中启用 **Smart Notes**。

---

## ⚙️ 配置

启用插件后，在 **设置 → Smart Notes** 中配置。设置页分为以下标签页：

| 标签页 | 内容 |
| --- | --- |
| **模型配置** | AI 后端链接、数据存储文件夹、凭据（钥匙串） |
| **交互设置** | AI 对话面板、实时补全、笔记优化、Frontmatter 生成 |
| **知识库** | 文件索引、属性索引、文件/属性选择、历史窗口 |
| **用户画像** | 长期画像记忆开关、更新时机、提取维度 |
| **角色** | 角色提示词管理、默认角色 |
| **技能** | 技能开关、上传、列表管理 |
| **联网搜索** | Provider、密钥/实例、结果与引用设置 |

### 关键步骤
1. 在 **模型配置** 中添加一个模型链接（如 DeepSeek、OpenAI 或本地 Ollama），并填入凭据。
2. 设置中把该链接设为默认。
3. 按需开启各功能开关（对话面板、实时补全、笔记优化、Frontmatter 生成等）。

---

## 🖱️ 使用

### 命令面板 / 编辑器右键菜单
插件在命令面板与编辑器右键菜单（「Smart Notes」父项下）提供以下命令：
- **优化当前笔记**（Optimize current note）
- **光标处自动补全**（Autoprompt at cursor）
- **打开 AI 对话面板**（Open AI chat panel）
- **生成 Frontmatter**（Generate frontmatter）

### 对话面板
- 通过左侧边栏图标或命令打开对话面板。
- 在输入框键入消息，`Enter` 发送、`Shift+Enter` 换行。
- 顶栏可切换：新建会话、会话历史侧栏、模型选择、角色选择、附加文件/文件夹、选择属性、技能、联网搜索开关。

---

## 🔒 隐私与安全
- **API Key 不落盘**：所有密钥仅保存在 Obsidian 钥匙串，不写入插件数据文件。
- **不主动联网**：联网搜索默认关闭，仅在对话中显式开启时调用外部 API。
- **本地模型可用**：通过 Ollama 链接可完全在本地运行，数据不出本机。
- **数据文件夹**：插件在 vault 根目录创建数据文件夹（默认 `.smartnotes`，可在设置中改名），存放 `memory/`（画像记忆）与 `skills/`。

---

## 💻 本地开发

```bash
# 安装依赖
npm install

# 开发模式（监听并打包）
npm run dev

# 生产构建（类型检查 + 压缩）
npm run build
```

构建产物 `main.js` 与 `styles.css` 直接用于分发。插件要求 Node.js ≥ 18。

---

## 📄 许可
本项目基于 [MIT 许可证](./LICENSE) 开源。
