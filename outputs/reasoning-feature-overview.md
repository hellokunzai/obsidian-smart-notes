# 功能实现：AI 对话框展示模型「思考过程」

> 版本 `0.12.1 → 0.13.0`（Minor）。`npm run build` 通过，安全扫描无禁 API。
> 改动完全向后兼容：旧会话文件无 `reasoningContent` 字段也能正常加载；普通模型不返回思考字段时自动不显示。

## 能否在代码里判断模型是否支持 reasoning_content？

**可以，且推荐「运行时动态判断」**，不依赖模型名：

- 推理模型在流式输出的每个 `delta` 上会**额外**返回一个思考字段；普通模型该字段为空。
- 因此第一个带非空思考内容的 chunk 到来，即说明「这个模型在输出思考」，UI 当场渲染；普通模型永远不返回，自然不渲染。

## 判断逻辑（按 provider）

| Provider | 思考字段 | 兼容字段 |
|----------|----------|----------|
| OpenAI 兼容（DeepSeek-R1 等） | `delta.reasoning_content` | `delta.reasoning`（OpenAI o 系列） |
| Ollama 本地（qwq / deepseek-r1 蒸馏） | `message.thinking` | `message.reasoning_content` |

## 改动清单

| 文件 | 改动 |
|------|------|
| `src/ai/provider.ts` | `StreamChunk`、`CompletionResult` 增加 `reasoning?` 可选字段 |
| `src/ai/openai.ts` | 流式解析循环读取 `reasoning_content` / `reasoning`，累积并经 `onChunk` 传出，返回结果带 `reasoning` |
| `src/ai/ollama.ts` | 读取 `message.thinking` / `message.reasoning_content`，同上 |
| `src/utils/aiFolder.ts` | `SessionMessage` 增加 `reasoningContent?`（向后兼容，未升级 `SESSIONS_VERSION`） |
| `src/settings.ts` | 新增 `showReasoning` 开关（默认 `true`），设置面板「AI对话面板」分组加 toggle |
| `src/view/chatView.ts` | 流式实时渲染可折叠思考块（首个 reasoning chunk 懒创建、默认展开；流结束自动折叠）；历史消息按开关重渲染；持久化 `reasoningContent` |
| `src/i18n/locales/zh.json`、`en.json` | 新增 `view.reasoning.title`、`settings.showReasoning.name/desc` |
| `styles.css` | `.ana-chat-reasoning` 可折叠思考块样式（全部使用 Obsidian 主题 CSS 变量，明暗主题兼容） |
| `manifest.json` / `package.json` / `versions.json` | 版本号升至 `0.13.0` |

## UX 行为

- 流式过程中：思考块实时出现在助手回复**上方**，默认展开。
- 流结束后：思考块**自动折叠**（点标题栏可展开/收起），避免占屏。
- 历史消息：若保存了 `reasoningContent` 且开启「显示 AI 思考过程」，重渲染时同样展示可折叠思考块。
- 设置项「显示 AI 思考过程」关闭后，不渲染任何思考块（已保存内容也不显示）。

## 手动验证建议

1. 在 Obsidian 中用推理模型（如 DeepSeek-R1 / `deepseek-reasoner`）发一条消息，确认对话框出现可折叠「思考过程」块。
2. 换成普通模型（如 `gpt-4o-mini`、`deepseek-chat`），确认不出现思考块。
3. 关闭设置 → Vault Mind → 交互设置 →「显示 AI 思考过程」，确认思考块不再显示。
4. 折叠/展开点击正常，暗色/亮色主题下样式正常。

> 注：Ollama 仅读取 `thinking` 字段，未主动开启 `think` 参数。qwq / deepseek-r1 蒸馏版默认会思考；若需让任意 Ollama 模型强制思考，后续可在请求 `options` 加 `think: true`。
