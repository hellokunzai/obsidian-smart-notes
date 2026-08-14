# Vault Mind - 角色信息功能原型

> 目标：把设置页「系统指令」改造为可搜索、可多选、可增删改的「角色信息」列表。
> 设计参考：现有「模型配置」中模型链接的添加/搜索/列表交互。

---

## 一、数据结构变更

### 1.1 新增类型

```typescript
export interface RoleInfo {
  /** 唯一标识 */
  id: string;
  /** 角色名称（用户可见，不可重复） */
  name: string;
  /** 角色提示词，注入 system prompt */
  prompt: string;
}
```

### 1.2 设置项替换

| 旧字段 | 新字段 | 说明 |
|---|---|---|
| `customInstructions: string` | `roles: RoleInfo[]` | 角色列表 |
| — | `activeRoleIds: string[]` | 当前启用的角色 ID（可多选） |

### 1.3 默认值

```typescript
roles: [],
activeRoleIds: [],
```

---

## 二、设置页交互（会话与记忆 → 角色信息）

### 2.1 整体布局

```
┌─────────────────────────────────────────────┐
│ 角色信息                                      │
├─────────────────────────────────────────────┤
│ 添加角色                              [+ 添加角色] │  ← Setting 行：左侧说明，右侧按钮
├─────────────────────────────────────────────┤
│ 搜索角色                              [🔍 输入关键词...] │  ← 实时过滤列表
├─────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────┐ │
│ │ ☑  默认助手   你是得力助手，回答简洁...   [编辑][删除] │ ← 角色列表行（可多选）
│ │ ☐  翻译专家   将用户输入翻译为地道中文...  [编辑][删除] │
│ │ ☑  代码审查   审查代码并给出改进建议...   [编辑][删除] │
│ └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

### 2.2 分组标题

- 旧：`settings.memoryGroup.system`（系统指令）
- 新：新增 key `settings.memoryGroup.roles`（角色信息）

### 2.3 新增角色按钮

- 位置：分组下的第一个 Setting 行
- 左侧：名称 + 描述
  - `settings.roles.add.name`：角色信息
  - `settings.roles.add.desc`：可创建多个角色，启用后其提示词将注入到对话、优化、Frontmatter 等 AI 功能的 system prompt 中。
- 右侧按钮：`settings.roles.add.button`（添加角色）
- 点击：打开 `RoleInfoModal`（新增模式）

### 2.4 搜索框

- Setting 行：左侧名称/描述，右侧文本输入框
  - `settings.roles.search.name`：搜索角色
  - `settings.roles.search.desc`：按角色名称过滤
  - `settings.roles.search.placeholder`：输入关键词...
- 输入时实时过滤下方列表，支持空搜索显示全部

### 2.5 角色列表

- 表格表头：
  - 启用（复选框/开关列）
  - 角色名称
  - 提示词摘要
  - 操作
- 每行内容：
  - 启用：Toggle 或 Checkbox，切换后更新 `activeRoleIds`
  - 角色名称：文本
  - 提示词摘要：截断显示前 40 字符，鼠标悬停显示完整提示词（`title` 属性）
  - 操作：编辑、删除按钮
- 空状态：
  - 无数据：`settings.roles.empty`（暂无角色，点击上方按钮添加）
  - 搜索无结果：`settings.roles.searchNoResults`

---

## 三、角色编辑弹窗（RoleInfoModal）

参考 `ModelLinkModal` 实现。

### 3.1 弹窗字段

```
┌─────────────────────────────────────────────┐
│ 添加角色                                      │
├─────────────────────────────────────────────┤
│ 角色名称 *                                    │
│ [请输入角色名称...]                          │
├─────────────────────────────────────────────┤
│ 角色提示词                                    │
│ [例如：用中文回答，回答要简洁...]              │
│                                             │
│                                             │
├─────────────────────────────────────────────┤
│                                  [取消] [保存] │
└─────────────────────────────────────────────┘
```

### 3.2 字段说明

| 字段 | 控件 | 校验 |
|---|---|---|
| 角色名称 | 单行文本输入 | 必填；不能与已有角色名称重复 |
| 角色提示词 | 多行文本域 | 允许为空；过长时纵向扩展 |

### 3.3 弹窗按钮

- 取消：关闭弹窗，不保存
- 保存：校验通过后写入 `roles` 数组，调用 `plugin.saveSettings()`，刷新设置页

---

## 四、与 AI 调用的集成

原 `customInstructions` 在调用时直接拼接到 system prompt；改造后：

1. 取出 `activeRoleIds` 对应启用的角色
2. 按角色列表顺序拼接提示词
3. 将拼接后的内容注入到 system prompt

伪代码：

```typescript
function buildSystemPrompt(settings: AiNoteAgentSettings, base: string): string {
  const activeRoles = settings.roles.filter((r) =>
    settings.activeRoleIds.includes(r.id)
  );
  const rolePrompts = activeRoles.map((r) => `## ${r.name}\n${r.prompt}`).join("\n\n");
  return rolePrompts ? `${base}\n\n${rolePrompts}` : base;
}
```

---

## 五、迁移策略

用户在旧版本中已填写 `customInstructions`，升级时不应丢失：

```typescript
// loadSettings 中
if (!settings.roles && settings.customInstructions) {
  const legacyId = genId();
  settings.roles = [
    {
      id: legacyId,
      name: "默认角色",
      prompt: settings.customInstructions,
    },
  ];
  settings.activeRoleIds = [legacyId];
  delete (settings as any).customInstructions;
}
```

---

## 六、新增 i18n Key 清单

| Key | 中文 | 英文 |
|---|---|---|
| `settings.memoryGroup.roles` | 角色信息 | Roles |
| `settings.roles.add.name` | 角色信息 | Role information |
| `settings.roles.add.desc` | 创建多个角色，启用后其提示词将注入 system prompt | Create roles and enable them to inject prompts into the system prompt |
| `settings.roles.add.button` | 添加角色 | Add role |
| `settings.roles.search.name` | 搜索角色 | Search roles |
| `settings.roles.search.desc` | 按角色名称过滤 | Filter by role name |
| `settings.roles.search.placeholder` | 输入关键词... | Search roles... |
| `settings.roles.empty` | 暂无角色，点击上方按钮添加 | No roles yet, click the button above to add one |
| `settings.roles.searchNoResults` | 未找到匹配角色 | No matching roles |
| `settings.roles.table.enabled` | 启用 | Enabled |
| `settings.roles.table.name` | 角色名称 | Role name |
| `settings.roles.table.prompt` | 提示词 | Prompt |
| `settings.roles.table.actions` | 操作 | Actions |
| `settings.roles.edit` | 编辑 | Edit |
| `settings.roles.delete` | 删除 | Delete |
| `settings.roles.modal.addTitle` | 添加角色 | Add role |
| `settings.roles.modal.editTitle` | 编辑角色 | Edit role |
| `settings.roles.modal.name` | 角色名称 | Role name |
| `settings.roles.modal.nameDesc` | 角色显示名称，不可重复 | Display name, must be unique |
| `settings.roles.modal.namePlaceholder` | 请输入角色名称... | Enter role name... |
| `settings.roles.modal.nameRequired` | 请输入角色名称 | Role name is required |
| `settings.roles.modal.nameDuplicate` | 角色名称已存在 | Role name already exists |
| `settings.roles.modal.prompt` | 角色提示词 | Role prompt |
| `settings.roles.modal.promptDesc` | 将注入到 system prompt 中 | Will be injected into the system prompt |
| `settings.roles.modal.promptPlaceholder` | 例如：用中文回答，回答要简洁... | e.g. Answer in Chinese, keep it concise... |
| `settings.roles.modal.save` | 保存 | Save |
| `settings.roles.modal.add` | 添加 | Add |

---

## 七、原型确认清单

请确认以下内容后进入开发：

- [ ] 「角色信息」分组标题名称是否合适？
- [ ] 多选采用 Toggle 开关还是 Checkbox？（原型采用 Toggle，与 Skill 列表风格一致）
- [ ] 角色列表中提示词摘要截断长度（建议 40 字符）是否合适？
- [ ] 旧 `customInstructions` 迁移为「默认角色」并自动启用，是否合适？
- [ ] 是否需要在弹窗中额外支持「设为默认」之类的单选功能？（当前按多选 `activeRoleIds` 设计）
