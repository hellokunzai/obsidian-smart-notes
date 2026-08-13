# Vault Mind 插件 — 长期约定（MEMORY.md）

## Skill 搜索机制
- skill 扫描目录 = `<设置项 aiFolderName>/skills`，`aiFolderName` 即设置项「数据存储路径」，默认 `.vaultmind`。
- **Skill = 套件**：一个 skill 是一个文件夹，插件只识别该文件夹下的 `SKILL.md` 作为 skill 内容；文件夹内有 `assets/`、`references/`、`scripts/` 等附加资源不影响识别。
- 套件内可以再嵌套子套件（子文件夹里也有自己的 `SKILL.md`），会被识别为独立的 skill（如 `obsidian-skills/json-canvas`）。
- 插件通过 `vault.adapter`（底层文件系统）扫描，以绕过 Obsidian vault 缓存不索引 `.` 开头隐藏文件夹（如 `.workbuddy`）的限制；不依赖 `getAbstractFileByPath`/`cachedRead`。
- 排除隐藏文件/文件夹（以 `.` 开头），不加载 `README.md`。
- 2026-08-13 起：`aiFolderName` 变更时 `saveSettings()` 自动迁移 `skills/memory/sessions` 到新目录（`migrateAiFolder`）。
- 设置页 Skill 分组会显示「当前 skill 扫描目录」（`settings.defaultSkills.pathHint`），用于诊断文件是否放错位置。

## 发布红线（上架社区市场）
- `manifest.json` 的 `author` 必须为 `hellokunzai`（与 GitHub 用户名一致）；`description` 必须英文。
- 禁止 `createContextualFragment` / `eval` / `new Function`；图标用 `addIcon`+`setIcon`。
- 压缩库用 `fflate`（不用 `jszip`）；release 不带 `--draft`。

## 构建
- `npm run build` = `tsc -noEmit -skipLibCheck && node esbuild.config.mjs production`，产物 `main.js`。
- 默认 `isDesktopOnly:false`，不能依赖 Node `fs`。

## 模型配置数据模型（2026-08-13 重构）
- 旧的单一 provider 扁平字段（`provider`/`openaiApiKey`/`openaiBaseUrl`/`openaiModel`/`ollamaBaseUrl`/`ollamaModel`）已弃用，仅作为旧配置迁移来源。
- 新模型：`modelLinks: ModelLink[]`（`id`/`name`/`type`/`baseUrl`/`apiKey`/`models[]`）+ `defaultModelLinkId`。
- 运行时（对话/优化/Frontmatter）通过 `getActiveModelLink()` 取默认链接、用其 `models[0]` 作为生效模型；`createProviderFromLink()` 供弹窗「测试连接」按草稿配置构造 provider。
- 设置页「模型配置」标签页：添加按钮 + 按名称搜索 + 列表（编辑/删除/设为默认）；`ModelLinkModal` 负责新增/编辑。
- 旧配置迁移在 `main.ts` 的 `loadSettings()` 中：无 `modelLinks` 时把旧字段合成一条名为「默认」的链接。
- 未配置任何链接时 `createProvider()` 返回 NoopProvider，调用即提示去设置添加。
