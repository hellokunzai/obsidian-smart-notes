import { TFile, TFolder, Vault } from "obsidian";
import type AiNoteAgentPlugin from "../main";
import type { ChatMessage } from "../ai/provider";

const MEMORY_DIR = "memory";
const MEMORY_FILE = "chat-history.json";
const SKILLS_DIR = "skills";
const SKILLS_README = "README.md";

const SESSIONS_VERSION = 2;

const SKILLS_README_CONTENT = `# Skills 目录

此目录用于存放自定义 AI skill 文件（建议 \`.md\` 格式）。

你可以在这里放置给 AI 的额外指令、模板或参考资料。
插件后续版本将支持扫描本目录下的 \`.md\` 文件，并将其内容注入到对话的上下文（system prompt）中。

## 目录结构

\`\`\`
<AI 文件夹>
├── memory/
│   └── chat-history.json    # 多会话对话记录（自动生成，可删除以清空记忆）
└── skills/                  # 自定义 skill（当前为预留目录）
    └── README.md            # 本说明文件
\`\`\`

记忆文件路径：\`../memory/${MEMORY_FILE}\`
`;

/** 单个对话中的一条消息：仅 user / assistant（system 每次动态构造，不持久化）。 */
export type SessionMessage = { role: "user" | "assistant"; content: string };

/** 附件引用：用户显式附加到会话的文件或文件夹（仅此部分内容会被读取并注入上下文）。 */
export type AttachmentRef = {
  type: "file" | "folder";
  /** vault 内相对路径 */
  path: string;
};

/** 一次完整会话。 */
export interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: SessionMessage[];
  /** 显式附加的文件/文件夹（每个会话独立保存）。 */
  attachments: AttachmentRef[];
}

/** 多会话存储文件结构。 */
export interface SessionsFile {
  version: number;
  activeSessionId: string | null;
  sessions: Session[];
}

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

function isValidMessage(m: unknown): m is SessionMessage {
  if (!m || typeof m !== "object") return false;
  const obj = m as Record<string, unknown>;
  // 记忆中只保存 user/assistant 消息；system 是每次动态构造的，不应持久化
  return (
    (obj.role === "user" || obj.role === "assistant") &&
    typeof obj.content === "string"
  );
}

/** 校验一个附件引用是否合法（文件/文件夹、路径为字符串）。 */
function isValidAttachment(m: unknown): m is AttachmentRef {
  if (!m || typeof m !== "object") return false;
  const obj = m as Record<string, unknown>;
  return (
    (obj.type === "file" || obj.type === "folder") &&
    typeof obj.path === "string"
  );
}

function emptySessions(): SessionsFile {
  return { version: SESSIONS_VERSION, activeSessionId: null, sessions: [] };
}

function migrateLegacy(data: unknown): SessionsFile {
  // 旧版格式：裸数组（version 1 / 无 version）
  if (Array.isArray(data)) {
    const msgs = data.filter(isValidMessage);
    if (msgs.length === 0) return emptySessions();
    const firstUser = msgs.find((m) => m.role === "user");
    const title = firstUser
      ? firstUser.content.slice(0, 30).replace(/\s+/g, " ").trim() || "已导入的对话"
      : "已导入的对话";
    const now = Date.now();
    const session: Session = {
      id: crypto.randomUUID(),
      title,
      createdAt: now,
      updatedAt: now,
      messages: msgs,
      attachments: [],
    };
    return {
      version: SESSIONS_VERSION,
      activeSessionId: session.id,
      sessions: [session],
    };
  }

  // 已经是新版结构
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const sessions = Array.isArray(obj.sessions)
      ? obj.sessions.filter((s): s is Session => {
          if (!s || typeof s !== "object") return false;
          const sess = s as Record<string, unknown>;
          return (
            typeof sess.id === "string" &&
            typeof sess.title === "string" &&
            Array.isArray(sess.messages) &&
            sess.messages.every(isValidMessage)
          );
        })
      : [];
    // 为旧版会话补齐 attachments 字段（向后兼容，旧数据无附件）
    for (const sess of sessions) {
      sess.attachments = Array.isArray(sess.attachments)
        ? sess.attachments.filter(isValidAttachment)
        : [];
    }
    return {
      version: SESSIONS_VERSION,
      activeSessionId:
        typeof obj.activeSessionId === "string" ? obj.activeSessionId : null,
      sessions,
    };
  }

  return emptySessions();
}

/**
 * 从 vault 中的记忆文件加载多会话数据。
 * 兼容旧版裸数组（自动迁移为单个会话）。
 * 未启用记忆或文件缺失/损坏时返回空结构。
 */
export async function loadSessions(plugin: AiNoteAgentPlugin): Promise<SessionsFile> {
  if (!plugin.settings.enableMemory) return emptySessions();
  const file = plugin.app.vault.getAbstractFileByPath(getMemoryFilePath(plugin));
  if (!(file instanceof TFile)) return emptySessions();
  try {
    const content = await plugin.app.vault.read(file);
    if (!content.trim()) return emptySessions();
    return migrateLegacy(JSON.parse(content));
  } catch {
    // 文件损坏或为空，忽略并返回一个空结构
  }
  return emptySessions();
}

/**
 * 将多会话数据保存到 vault 中的记忆文件（JSON 格式）。
 * 未启用记忆时直接跳过，不落盘。
 */
export async function saveSessions(
  plugin: AiNoteAgentPlugin,
  data: SessionsFile
): Promise<void> {
  if (!plugin.settings.enableMemory) return;
  const vault = plugin.app.vault;
  await ensureFolder(vault, getAiFolderPath(plugin));
  await ensureFolder(vault, getMemoryDir(plugin));
  const path = getMemoryFilePath(plugin);
  const out: SessionsFile = { ...data, version: SESSIONS_VERSION };
  const file = vault.getAbstractFileByPath(path);
  if (file instanceof TFile) {
    await vault.modify(file, JSON.stringify(out, null, 2));
  } else {
    await vault.create(path, JSON.stringify(out, null, 2));
  }
}

/** 新建一个空白会话。 */
export function createSession(title = "新对话"): Session {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title,
    createdAt: now,
    updatedAt: now,
    messages: [],
    attachments: [],
  };
}

/** 清空当前所有会话（清空记忆文件为结构骨架）。 */
export async function clearAllSessions(plugin: AiNoteAgentPlugin): Promise<void> {
  await saveSessions(plugin, emptySessions());
}
