import { Vault } from "obsidian";
import type AiNoteAgentPlugin from "../main";
import type { TokenUsage } from "../ai/provider";

const SESSIONS_DIR = "sessions";
const SESSIONS_INDEX = "index.json";
const SESSION_FILE_PREFIX = "session-";
const SESSION_FILE_SUFFIX = ".json";
const SESSIONS_VERSION = 3;

/** 旧版记忆目录与文件名（用于向后迁移）。 */
const MEMORY_LEGACY_DIR = "memory";
const MEMORY_LEGACY_FILE = "chat-history.json";

const SKILLS_DIR = "skills";
const SKILLS_README = "README.md";
const MEMORY_DIR = "memory";

const SKILLS_README_CONTENT = `# Skills 目录

此目录用于存放自定义 AI skill 文件（建议 \`.md\` 格式）。

你可以在这里放置给 AI 的额外指令、模板或参考资料。
插件后续版本将支持扫描本目录下的 \`.md\` 文件，并将其内容注入到对话的上下文（system prompt）中。

## 会话记忆目录结构

对话记忆存放在 \`sessions/\` 目录下：

\`\`\`
<AI 文件夹>
├── sessions/
│   ├── index.json            # 会话索引（仅基本信息，轻量，始终加载）
│   └── session-<id>.json     # 单个会话的完整内容（消息 / 附件 / skill / 联网开关）
├── memory/                   # 长期画像记忆
│   ├── MEMORY.md             # 跨会话整理的总体画像
│   └── yyyy-mm-dd.md         # 当日记忆
└── skills/                   # 自定义 skill（当前为预留目录）
    └── README.md             # 本说明文件
\`\`\`

- \`index.json\` 只保存每个会话的 id、标题、时间、消息数等基本信息，不含对话内容。
- 每个会话的完整内容独立存于 \`session-<id>.json\`，仅在打开该会话时才读取（懒加载）。
- \`memory/MEMORY.md\` 由插件在后台根据全部会话历史自动整理，也可手动编辑。

记忆文件路径：\`../sessions/index.json\`
`;

/** 单个对话中的一条消息：仅 user / assistant（system 每次动态构造，不持久化）。 */
export type SessionMessage = {
  role: "user" | "assistant";
  content: string;
  /** 可选：该助手消息返回的 token 消耗统计。 */
  usage?: TokenUsage;
  /** 可选：推理模型（DeepSeek-R1 / o1 等）返回的「思考过程」。普通模型无此字段。 */
  reasoningContent?: string;
  /** 可选：生成该助手消息时使用的角色 id（发送时快照）。无角色或旧会话无此字段。 */
  roleId?: string;
};

/** 附件引用：用户显式附加到会话的文件或文件夹（仅此部分内容会被读取并注入上下文）。 */
export type AttachmentRef = {
  type: "file" | "folder";
  /** vault 内相对路径 */
  path: string;
};

/** 一次完整会话（存于 session-<id>.json）。 */
export interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: SessionMessage[];
  /** 显式附加的文件/文件夹（每个会话独立保存）。 */
  attachments: AttachmentRef[];
  /** 当前会话启用的 skill（skills/ 目录下的 .md 路径），按会话独立保存。 */
  skills: string[];
  /** 当前会话是否开启联网搜索（仅开启时发消息才会调用外部搜索 API）。 */
  webSearch: boolean;
}

/** 会话元数据（仅存于 index.json，不含对话内容）。 */
export interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

/** sessions/index.json 结构。 */
export interface SessionsIndex {
  version: number;
  activeSessionId: string | null;
  sessions: SessionMeta[];
}

/** 获取 vault 根目录下的 AI 文件夹名称（去除首尾空格，空值回退默认名）。 */
export function getAiFolderName(plugin: AiNoteAgentPlugin): string {
  return (plugin.settings.aiFolderName || ".smartnotes").trim() || ".smartnotes";
}

/** AI 文件夹根路径（vault 根目录下的相对路径）。 */
export function getAiFolderPath(plugin: AiNoteAgentPlugin): string {
  return getAiFolderName(plugin);
}

/** sessions 目录路径。 */
export function getSessionsDir(plugin: AiNoteAgentPlugin): string {
  return `${getAiFolderPath(plugin)}/${SESSIONS_DIR}`;
}

/** 会话索引文件路径（index.json）。 */
export function getSessionsIndexFile(plugin: AiNoteAgentPlugin): string {
  return `${getSessionsDir(plugin)}/${SESSIONS_INDEX}`;
}

/** 单个会话文件路径（session-<id>.json）。 */
export function getSessionFile(plugin: AiNoteAgentPlugin, id: string): string {
  return `${getSessionsDir(plugin)}/${SESSION_FILE_PREFIX}${id}${SESSION_FILE_SUFFIX}`;
}

/** skills 目录路径。 */
export function getSkillsDir(plugin: AiNoteAgentPlugin): string {
  return `${getAiFolderPath(plugin)}/${SKILLS_DIR}`;
}

/** memory 目录路径（长期画像记忆与每日记忆）。 */
export function getMemoryDir(plugin: AiNoteAgentPlugin): string {
  return `${getAiFolderPath(plugin)}/${MEMORY_DIR}`;
}

/**
 * 若指定路径的文件夹不存在则创建（已存在则跳过）。
 * 使用 vault.adapter 而非 vault 缓存 API：Obsidian 的 vault 缓存不会索引
 * 「.」开头的隐藏文件夹（如 .smartnotes），导致 getAbstractFileByPath 对
 * 其内部文件/目录返回 undefined；adapter 走底层文件系统，可正常访问。
 */
export async function ensureFolder(vault: Vault, path: string): Promise<void> {
  try {
    if (await vault.adapter.exists(path)) return;
    await vault.adapter.mkdir(path);
  } catch (e) {
    // 并发/已存在等情况下再次确认，避免误报
    if (!(await vault.adapter.exists(path))) throw e;
  }
}

/**
 * 确保 AI 文件夹及其 sessions/、skills/ 子目录存在，
 * 并在 skills/ 下写入 README 说明文件（若不存在）。
 * 在插件 onload 时调用，即可在 vault 根目录自动生成 AI 数据目录。
 */
export async function ensureAiFolder(plugin: AiNoteAgentPlugin): Promise<void> {
  const vault = plugin.app.vault;
  const root = getAiFolderPath(plugin);
  await ensureFolder(vault, root);
  await ensureFolder(vault, getSessionsDir(plugin));
  await ensureFolder(vault, getMemoryDir(plugin));
  await ensureFolder(vault, getSkillsDir(plugin));

  const readmePath = `${getSkillsDir(plugin)}/${SKILLS_README}`;
  if (!(await vault.adapter.exists(readmePath))) {
    await vault.adapter.write(readmePath, SKILLS_README_CONTENT);
  }
}

function isValidMessage(m: unknown): m is SessionMessage {
  if (!m || typeof m !== "object") return false;
  const obj = m as Record<string, unknown>;
  // 记忆中只保存 user/assistant 消息；system 是每次动态构造的，不应持久化
  if (
    !(obj.role === "user" || obj.role === "assistant") ||
    typeof obj.content !== "string"
  ) {
    return false;
  }
  if (obj.usage && typeof obj.usage === "object") {
    const u = obj.usage as Record<string, unknown>;
    if (
      typeof u.promptTokens !== "number" ||
      typeof u.completionTokens !== "number" ||
      typeof u.totalTokens !== "number"
    ) {
      return false;
    }
  }
  return true;
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

/** 校验一个对象是否为合法的完整会话，并对旧数据补齐可选字段。 */
function isValidSession(m: unknown): m is Session {
  if (!m || typeof m !== "object") return false;
  const obj = m as Record<string, unknown>;
  if (typeof obj.id !== "string" || typeof obj.title !== "string") return false;
  if (!Array.isArray(obj.messages) || !obj.messages.every(isValidMessage)) return false;
  // 补齐旧版缺失字段
  if (!Array.isArray(obj.attachments)) obj.attachments = [];
  if (!Array.isArray(obj.skills)) obj.skills = [];
  if (typeof obj.createdAt !== "number") obj.createdAt = Date.now();
  if (typeof obj.updatedAt !== "number") obj.updatedAt = obj.createdAt;
  if (typeof obj.webSearch !== "boolean") obj.webSearch = false;
  return true;
}

function emptyIndex(): SessionsIndex {
  return { version: SESSIONS_VERSION, activeSessionId: null, sessions: [] };
}

/**
 * 将任意对象规整为合法的 SessionsIndex。
 * 过滤非法条目，缺失的时间/数量字段补默认值。
 */
function normalizeIndex(data: unknown): SessionsIndex {
  if (!data || typeof data !== "object") return emptyIndex();
  const obj = data as Record<string, unknown>;
  const metas = Array.isArray(obj.sessions)
    ? obj.sessions
        .filter((m): m is SessionMeta => {
          if (!m || typeof m !== "object") return false;
          const meta = m as Record<string, unknown>;
          return typeof meta.id === "string" && typeof meta.title === "string";
        })
        .map((meta) => ({
          id: meta.id,
          title: meta.title,
          createdAt: typeof meta.createdAt === "number" ? meta.createdAt : Date.now(),
          updatedAt: typeof meta.updatedAt === "number" ? meta.updatedAt : Date.now(),
          messageCount: typeof meta.messageCount === "number" ? meta.messageCount : 0,
        }))
    : [];
  return {
    version: SESSIONS_VERSION,
    activeSessionId: typeof obj.activeSessionId === "string" ? obj.activeSessionId : null,
    sessions: metas,
  };
}

/** 从完整会话提取元数据。 */
export function sessionToMeta(s: Session): SessionMeta {
  return {
    id: s.id,
    title: s.title,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    messageCount: s.messages.length,
  };
}

/**
 * 将完整会话写入其独立文件 session-<id>.json。
 */
export async function saveSessionFile(
  plugin: AiNoteAgentPlugin,
  session: Session
): Promise<void> {
  const vault = plugin.app.vault;
  await ensureFolder(vault, getAiFolderPath(plugin));
  await ensureFolder(vault, getSessionsDir(plugin));
  const path = getSessionFile(plugin, session.id);
  // adapter.write 同时支持「不存在则创建 / 已存在则覆盖」，且绕过 vault 缓存，
  // 对隐藏文件夹（.smartnotes）也能正常读写。
  await vault.adapter.write(path, JSON.stringify(session, null, 2));
}

/**
 * 删除指定会话的独立文件 session-<id>.json。
 */
export async function deleteSessionFile(
  plugin: AiNoteAgentPlugin,
  id: string
): Promise<void> {
  const vault = plugin.app.vault;
  const path = getSessionFile(plugin, id);
  if (await vault.adapter.exists(path)) {
    await vault.adapter.remove(path);
  }
}

/**
 * 将会话索引写入 index.json。
 */
export async function saveSessionsIndex(
  plugin: AiNoteAgentPlugin,
  index: SessionsIndex
): Promise<void> {
  const vault = plugin.app.vault;
  await ensureFolder(vault, getAiFolderPath(plugin));
  await ensureFolder(vault, getSessionsDir(plugin));
  const path = getSessionsIndexFile(plugin);
  const out: SessionsIndex = { ...index, version: SESSIONS_VERSION };
  await vault.adapter.write(path, JSON.stringify(out, null, 2));
}

/**
 * 加载会话索引（index.json）。
 * 若 index.json 不存在但存在旧版 memory/chat-history.json，则自动迁移：
 * 把旧数据拆分为 index.json + 各 session-<id>.json 后再返回。
 * 未启用记忆或文件缺失/损坏时返回空结构。
 */
export async function loadSessionsIndex(
  plugin: AiNoteAgentPlugin
): Promise<SessionsIndex> {
  const vault = plugin.app.vault;

  const idxPath = getSessionsIndexFile(plugin);
  if (await vault.adapter.exists(idxPath)) {
    try {
      const content = await vault.adapter.read(idxPath);
      if (content.trim()) return normalizeIndex(JSON.parse(content));
    } catch {
      // 损坏则继续尝试迁移 / 返回空
    }
  }

  const migrated = await tryMigrateLegacy(plugin);
  if (migrated) return migrated;

  // 兜底恢复：旧版在隐藏文件夹上用普通 vault API 持久化，可能把 session 文件
  // 实际写到了磁盘，却始终无法维护/读取 index；这里扫描 sessions 目录，把磁盘上
  // 残留的 session-<id>.json 重新编入索引，避免用户历史对话丢失。
  const recovered = await recoverFromOrphanedFiles(plugin);
  if (recovered) return recovered;

  return emptyIndex();
}

/**
 * 扫描 sessions 目录，从磁盘上残留的 session-<id>.json 重建索引。
 * 仅当 index 缺失/为空时作为兜底调用；无任何残留文件时返回 null。
 */
async function recoverFromOrphanedFiles(
  plugin: AiNoteAgentPlugin
): Promise<SessionsIndex | null> {
  const vault = plugin.app.vault;
  const dir = getSessionsDir(plugin);
  if (!(await vault.adapter.exists(dir))) return null;

  let listed: { files: string[]; folders: string[] };
  try {
    listed = await vault.adapter.list(dir);
  } catch {
    return null;
  }

  const metas: SessionMeta[] = [];
  for (const file of listed.files) {
    const name = file.slice(file.lastIndexOf("/") + 1);
    if (
      !name.startsWith(SESSION_FILE_PREFIX) ||
      !name.endsWith(SESSION_FILE_SUFFIX)
    ) {
      continue;
    }
    const id = name.slice(
      SESSION_FILE_PREFIX.length,
      name.length - SESSION_FILE_SUFFIX.length
    );
    const full = await loadSessionFile(plugin, id);
    if (full) metas.push(sessionToMeta(full));
  }

  if (metas.length === 0) return null;
  metas.sort((a, b) => b.updatedAt - a.updatedAt);
  const index: SessionsIndex = {
    version: SESSIONS_VERSION,
    activeSessionId: metas[0].id,
    sessions: metas,
  };
  // 写回索引，使后续加载走正常路径
  await saveSessionsIndex(plugin, index);
  return index;
}

/**
 * 加载单个会话的完整内容（session-<id>.json）。
 * 文件缺失/损坏或校验失败时返回 null。
 */
export async function loadSessionFile(
  plugin: AiNoteAgentPlugin,
  id: string
): Promise<Session | null> {
  const vault = plugin.app.vault;
  const path = getSessionFile(plugin, id);
  if (!(await vault.adapter.exists(path))) return null;
  try {
    const content = await vault.adapter.read(path);
    if (!content.trim()) return null;
    const obj = JSON.parse(content);
    if (isValidSession(obj)) return obj;
  } catch {
    // 损坏忽略
  }
  return null;
}

/**
 * 尝试将旧版 memory/chat-history.json 迁移为新结构。
 * 成功返回索引；无可迁移数据时返回 null。
 */
async function tryMigrateLegacy(
  plugin: AiNoteAgentPlugin
): Promise<SessionsIndex | null> {
  const vault = plugin.app.vault;
  const legacyPath = `${getAiFolderPath(plugin)}/${MEMORY_LEGACY_DIR}/${MEMORY_LEGACY_FILE}`;
  if (!(await vault.adapter.exists(legacyPath))) return null;

  try {
    const content = await vault.adapter.read(legacyPath);
    if (!content.trim()) return null;
    const legacy = migrateLegacy(JSON.parse(content));
    if (legacy.sessions.length === 0) return null;

    await ensureFolder(vault, getSessionsDir(plugin));
    const index: SessionsIndex = {
      version: SESSIONS_VERSION,
      activeSessionId: legacy.activeSessionId,
      sessions: legacy.sessions.map(sessionToMeta),
    };
    for (const s of legacy.sessions) {
      await saveSessionFile(plugin, s);
    }
    await saveSessionsIndex(plugin, index);
    // 迁移完成后删除旧文件，避免重复迁移
    await vault.adapter.remove(legacyPath).catch(() => undefined);
    return index;
  } catch {
    return null;
  }
}

/** 旧版完整存储结构（用于迁移）。 */
interface LegacySessionsFile {
  version: number;
  activeSessionId: string | null;
  sessions: Session[];
}

/**
 * 将旧版任意数据迁移为完整会话数组结构（兼容裸数组）。
 */
function migrateLegacy(data: unknown): LegacySessionsFile {
  // 旧版格式：裸数组（version 1 / 无 version）
  if (Array.isArray(data)) {
    const msgs = data.filter(isValidMessage);
    if (msgs.length === 0) return { version: SESSIONS_VERSION, activeSessionId: null, sessions: [] };
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
      skills: [],
      webSearch: false,
    };
    return {
      version: SESSIONS_VERSION,
      activeSessionId: session.id,
      sessions: [session],
    };
  }

  // 已经是多会话结构（含 sessions 数组）
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
    // 为旧版会话补齐 attachments / skills / webSearch 字段（向后兼容）
    for (const sess of sessions) {
      sess.attachments = Array.isArray(sess.attachments)
        ? sess.attachments.filter(isValidAttachment)
        : [];
      sess.skills = Array.isArray(sess.skills)
        ? sess.skills.filter((p) => typeof p === "string")
        : [];
      sess.webSearch = sess.webSearch === true;
    }
    return {
      version: SESSIONS_VERSION,
      activeSessionId:
        typeof obj.activeSessionId === "string" ? obj.activeSessionId : null,
      sessions,
    };
  }

  return { version: SESSIONS_VERSION, activeSessionId: null, sessions: [] };
}

/**
 * 新建一个空白会话。
 *
 * 注意：新会话的 `skills` 始终为空数组。在「Skill 技能」设置页勾选的 skill
 * 不再默认塞进对话框选择框，而是作为「可用索引」注入 system prompt；
 * 用户仍可在对话框手动通过 Skill 按钮添加要注入内容的 skill。
 */
export function createSession(title = "新对话"): Session {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title,
    createdAt: now,
    updatedAt: now,
    messages: [],
    attachments: [],
    skills: [],
    webSearch: false,
  };
}

/** 清空当前所有会话（重建空索引并删除所有会话文件）。 */
export async function clearAllSessions(plugin: AiNoteAgentPlugin): Promise<void> {
  const vault = plugin.app.vault;
  const dir = getSessionsDir(plugin);
  if (await vault.adapter.exists(dir)) {
    try {
      const listed = await vault.adapter.list(dir);
      for (const file of listed.files) {
        const name = file.slice(file.lastIndexOf("/") + 1);
        if (
          name.startsWith(SESSION_FILE_PREFIX) &&
          name.endsWith(SESSION_FILE_SUFFIX)
        ) {
          await vault.adapter.remove(file).catch(() => undefined);
        }
      }
    } catch {
      // 列出失败则忽略，仍可重置索引
    }
  }
  await saveSessionsIndex(plugin, emptyIndex());
}
