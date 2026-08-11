import { TFile, TFolder, Vault } from "obsidian";
import type AiNoteAgentPlugin from "../main";
import type { ChatMessage } from "../ai/provider";

const MEMORY_DIR = "memory";
const MEMORY_FILE = "chat-history.json";
const SKILLS_DIR = "skills";
const SKILLS_README = "README.md";

const SKILLS_README_CONTENT = `# Skills 目录

此目录用于存放自定义 AI skill 文件（建议 \`.md\` 格式）。

你可以在这里放置给 AI 的额外指令、模板或参考资料。
插件后续版本将支持扫描本目录下的 \`.md\` 文件，并将其内容注入到对话的上下文（system prompt）中。

## 目录结构

\`\`\`
<AI 文件夹>
├── memory/
│   └── chat-history.json    # 对话记忆（自动生成，可删除以清空记忆）
└── skills/                  # 自定义 skill（当前为预留目录）
    └── README.md            # 本说明文件
\`\`\`

记忆文件路径：\`../memory/${MEMORY_FILE}\`
`;

/** 获取 vault 根目录下的 AI 文件夹名称（去除首尾空格，空值回退默认名）。 */
export function getAiFolderName(plugin: AiNoteAgentPlugin): string {
  return (plugin.settings.aiFolderName || "AI-Note-Agent").trim() || "AI-Note-Agent";
}

/** AI 文件夹根路径（vault 根目录下的相对路径）。 */
export function getAiFolderPath(plugin: AiNoteAgentPlugin): string {
  return getAiFolderName(plugin);
}

/** memory 目录路径。 */
export function getMemoryDir(plugin: AiNoteAgentPlugin): string {
  return `${getAiFolderPath(plugin)}/${MEMORY_DIR}`;
}

/** 记忆文件路径（chat-history.json）。 */
export function getMemoryFilePath(plugin: AiNoteAgentPlugin): string {
  return `${getMemoryDir(plugin)}/${MEMORY_FILE}`;
}

/** skills 目录路径。 */
export function getSkillsDir(plugin: AiNoteAgentPlugin): string {
  return `${getAiFolderPath(plugin)}/${SKILLS_DIR}`;
}

/** 若指定路径的文件夹不存在则创建（逐级创建，已存在则跳过）。 */
async function ensureFolder(vault: Vault, path: string): Promise<void> {
  if (vault.getAbstractFileByPath(path) instanceof TFolder) return;
  try {
    await vault.createFolder(path);
  } catch (e) {
    // 并发/已存在等情况下再次确认，避免误报
    if (!(vault.getAbstractFileByPath(path) instanceof TFolder)) throw e;
  }
}

/**
 * 确保 AI 文件夹及其 memory/、skills/ 子目录存在，
 * 并在 skills/ 下写入 README 说明文件（若不存在）。
 * 在插件 onload 时调用，即可在 vault 根目录自动生成 AI 数据目录。
 */
export async function ensureAiFolder(plugin: AiNoteAgentPlugin): Promise<void> {
  const vault = plugin.app.vault;
  const root = getAiFolderPath(plugin);
  await ensureFolder(vault, root);
  await ensureFolder(vault, getMemoryDir(plugin));
  await ensureFolder(vault, getSkillsDir(plugin));

  const readmePath = `${getSkillsDir(plugin)}/${SKILLS_README}`;
  if (!vault.getAbstractFileByPath(readmePath)) {
    await vault.create(readmePath, SKILLS_README_CONTENT);
  }
}

function isValidMessage(m: unknown): m is ChatMessage {
  if (!m || typeof m !== "object") return false;
  const obj = m as Record<string, unknown>;
  // 记忆中只保存 user/assistant 消息；system 是每次动态构造的，不应持久化
  return (
    typeof obj.role === "string" &&
    (obj.role === "user" || obj.role === "assistant") &&
    typeof obj.content === "string"
  );
}

/**
 * 从 vault 中的记忆文件加载对话历史。
 * 未启用记忆、文件不存在或解析失败时返回空数组。
 */
export async function loadMemory(plugin: AiNoteAgentPlugin): Promise<ChatMessage[]> {
  if (!plugin.settings.enableMemory) return [];
  const file = plugin.app.vault.getAbstractFileByPath(getMemoryFilePath(plugin));
  if (!(file instanceof TFile)) return [];
  try {
    const content = await plugin.app.vault.read(file);
    const parsed: unknown = JSON.parse(content);
    if (Array.isArray(parsed)) {
      return parsed.filter(isValidMessage);
    }
  } catch {
    // 文件损坏或为空，忽略并返回空记忆
  }
  return [];
}

/**
 * 将对话历史保存到 vault 中的记忆文件（JSON 格式）。
 * 未启用记忆时直接跳过，不落盘。
 */
export async function saveMemory(
  plugin: AiNoteAgentPlugin,
  messages: ChatMessage[]
): Promise<void> {
  if (!plugin.settings.enableMemory) return;
  const vault = plugin.app.vault;
  await ensureFolder(vault, getAiFolderPath(plugin));
  await ensureFolder(vault, getMemoryDir(plugin));
  const path = getMemoryFilePath(plugin);
  const data = JSON.stringify(messages, null, 2);
  const file = vault.getAbstractFileByPath(path);
  if (file instanceof TFile) {
    await vault.modify(file, data);
  } else {
    await vault.create(path, data);
  }
}

/** 清空记忆：将记忆文件内容写为空数组（保留文件结构，安全可恢复）。 */
export async function clearMemory(plugin: AiNoteAgentPlugin): Promise<void> {
  await saveMemory(plugin, []);
}
