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
