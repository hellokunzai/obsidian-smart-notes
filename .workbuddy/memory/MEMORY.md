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

## Obsidian CSS 变量/选择器使用规范
- **不要把 `--font-normal` 当 `font-size` 用**：在 Obsidian 官方变量体系里 `--font-normal` 是 **font-weight（默认 400）**，不是字号。用它做 `font-size` 在 1.12.x 可能碰巧继承正常大小，在 1.13.x 下会解析异常，导致文字被放大成巨字。UI 弹窗字号应使用 `--font-ui-medium` / `--font-ui-small` / `--font-ui-smaller` 等标准 UI 字体变量；编辑器相关内容才用 `--font-text-size`。
- **不要使用不存在的变量**：如 `--font-xs` 不是 Obsidian 标准变量，主题没定义时就会 fallback 到不可预期的大小。
- **Obsidian 1.13+ 对 `.modal` 内的 `button` / `input` 套用了更高优先级的全局样式**（`.modal button`、`.modal input`，specificity 0,1,1）。插件自定义 Modal 若用单类名选择器（specificity 0,1,0）定义 `width`/`flex`/`display`，可能被覆盖。修复模式：给弹窗内自定义选择器统一加父级类前缀（如 `.ana-secret-picker-modal .ana-secret-picker-*`），specificity 提升到 0,2,0；并对 radio/按钮补 `flex: 0 0 auto` / `margin:0` / `padding:0` 固化布局。
- 当 1.12.x 正常、1.13.x 自定义弹窗样式「崩了」时，优先检查 **变量误用** 和 **选择器优先级**。
