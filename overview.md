# 从知识库附加 · 树形选择器 设计说明

> 阶段一产出：交互原型已落地（`outputs/attachment-picker-tree-prototype.html`）。
> 本文档供「开发阶段」对照实现，确认原型手感后再改 `src/view/chatView.ts` 的 `AttachmentPickerModal`。

## 一、目标与确认的方案

将当前**扁平列表**的「从知识库附加」弹窗改为**可折叠树形结构**。已与用户确认的关键决策：

| 决策点 | 结论 |
|--------|------|
| 复选框 | 三态（☑ 全选 / ⊟ 半选 / ☐ 未选） |
| folder 选中语义 | 整文件夹一条引用 `{ type: "folder", path }`，不展开成多条 file |
| 初始展开 | 只展开第一级（根目录的直接子文件夹可见，内部折叠） |
| 搜索行为 | 命中节点的父级链自动展开；不命中节点隐藏；命中文字高亮 |

## 二、交互规则（原型已实现，开发需对齐）

1. **展开/折叠**
   - 文件夹行左侧 ▼/▶ 点击切换展开；整行点击文件夹 = 切换展开（原型里整行点 folder 走 toggle）。
   - 文件行无箭头（占位对齐）。
   - 默认展开第一级；用户可逐层下钻。

2. **三态复选框（文件夹）**
   - `folderState(folder)` 推导：自身在 `selected` → checked；否则按后代叶子 file 选中数：
     - 0 → unchecked；全部 → checked；部分 → indeterminate。
   - 点击文件夹：`folderState !== "checked"` → 选中自身 + 全部叶子；否则 → 取消自身 + 全部叶子。
   - 子 file 勾选变化后，父级状态在每次 `render()` 时自动重算（无需向上冒泡代码）。

3. **搜索**
   - `computeVisible(query)` 返回需要显示的节点 path 集合（自身命中 **或** 有命中后代）。
   - 命中节点的父链在搜索态强制加入 `expanded`（父链自动展开）。
   - 命中文字用 `<mark>` 高亮（区分大小写不敏感）。
   - 清空搜索 → 恢复按 `expanded` 控制（回到用户折叠状态，不是全展开）。
   - 无结果 → 显示「没有匹配的文件或文件夹。」空态。

4. **已选计数**
   - 顶部「已选 N 项」实时刷新；`附加所选` 按钮在 N=0 时 disabled。

5. **回传压缩**
   - `onSubmit(refs)` 回传前做父文件夹去重：若某 file 的祖先 folder 已在 `selected`，则该 file 不单独回传（避免 folder 引用与子 file 重复）。

## 三、数据结构

- 复用 Obsidian 原生 `TFolder` / `TFile`：`vault.getAllLoadedFiles()` 已是树，直接递归。
- 不再用 `allEntries: {type, path, name}[]` 扁平数组，改为在 `onOpen` 取 `app.vault.getRoot()` 递归构建。
- 状态容器：
  - `selected: Set<string>`（path）
  - `expanded: Set<string>`（folder path，初始 = 第一级 folder）
  - `query: string`

## 四、i18n 待加 key（中/英）

| key | zh-cn | en |
|-----|-------|-----|
| `view.picker.expandAll` | 全部展开 | Expand all |
| `view.picker.collapseAll` | 全部折叠 | Collapse all |
| `view.picker.selectedCount` | 已选 {{count}} 项 | {{count}} selected |

现有 `view.picker.*` 文案沿用。

## 五、styles.css 待加 class（贴 Obsidian 主题变量，勿用 `--font-normal` 当字号）

```
.ana-picker-toolbar
.ana-picker-toolbar .tool-btn
.ana-picker-count
.ana-tree-row
.ana-tree-row.is-folder
.ana-tree-toggle (.collapsed / .leaf)
.ana-tree-cb (accent-color: var(--interactive-accent))
.ana-tree-icon
.ana-tree-name
.ana-tree-name mark
```

> 注意：弹窗内选择器需加 `.ana-picker` 父级前缀以压过 Obsidian 1.13+ 的 `.modal button/input` 全局规则（specificity 0,2,0），并给 checkbox 补 `flex:0 0 auto; margin:0;`。

## 六、开发阶段检查清单（已完成）

- [x] `AttachmentPickerModal.onOpen` 改为取 `app.vault.getRoot()` 递归
- [x] `renderList` → `render`：递归渲染 + 缩进（depth*18px）
- [x] 三态推导 `folderState` + 点击逻辑
- [x] 搜索 `computeVisible` + 高亮（不污染 expanded，清空恢复折叠态）
- [x] 工具栏（展开/折叠/计数）+ 回传去重 `buildRefs`
- [x] i18n 补 3 个 key（zh/en）
- [x] styles.css 补 tree 相关样式（加 `.ana-picker` 父级前缀 + checkbox `flex:0 0 auto`）
- [x] `npm run build` 通过 + 安全扫描（无 createContextualFragment / eval / new Function）

## 七、改动文件清单

| 文件 | 改动 |
|------|------|
| `src/view/chatView.ts` | `AttachmentPickerModal` 整体重写为树形（状态改为 `selected:Set` + `expanded:Set` + `query`；新增 `vaultRoot/walkFolders/allLeaves/folderState/computeVisible/highlight/render/onToggle/buildRefs/findNode/updateCount`） |
| `src/i18n/locales/zh.json` | 新增 `view.picker.expandAll/collapseAll/selectedCount` |
| `src/i18n/locales/en.json` | 同上（英文） |
| `styles.css` | 新增 `.ana-picker-toolbar`、`.ana-picker .ana-tree-*` 等树形样式 |

## 八、手动验证步骤（请在 Obsidian 中执行）

1. 把 `main.js` + `styles.css` + `manifest.json` 三件套复制到插件目录
   `<vault>/.obsidian/plugins/vault-mind/`（**styles.css 是独立文件，必须一起复制，否则新样式不生效**）。
2. `Ctrl+P` → 「Reload app without saving」重载插件。
3. 打开 AI 对话框，点左下角 📎「从知识库附加」：
   - 验证树形折叠/展开、三态复选框（勾文件夹→子项全选、父级联动半选）。
   - 搜索「AI」：命中父链自动展开、不命中隐藏、文字高亮；清空恢复折叠态。
   - 「全部展开 / 全部折叠」按钮。
   - 勾一个大文件夹点「附加所选」，确认对话气泡只显示一条 📁 而非刷屏文件名。
4. 暗色/亮色主题切换后 UI 正常，无控制台报错。

---
**状态**：开发完成，`npm run build` + 安全扫描通过。等待用户手动验证；版本号 bump（minor）与发布待验证通过后再做。**未做 git 提交 / 未发布**。
