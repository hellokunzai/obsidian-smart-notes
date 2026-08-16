import type AiNoteAgentPlugin from "../main";
import {
  ensureAiFolder,
  getAiFolderPath,
  getMemoryDir,
  loadSessionFile,
  loadSessionsIndex,
  type Session,
} from "../utils/aiFolder";
import { parseJsonFromLLM } from "../ai/prompt";
import type { ChatMessage } from "../ai/provider";

const MEMORY_FILE = "MEMORY.md";
const MAX_SESSIONS_FOR_PROFILE = 50;
const MAX_DIGEST_CHARS = 12000;
const MAX_MESSAGE_CHARS = 2000;

interface MemoryExtractionResult {
  profile: string;
  daily: string;
}

/** memory/ 目录下相对路径 → 绝对 vault 路径。 */
function resolveMemoryPath(plugin: AiNoteAgentPlugin, relativePath: string): string {
  return `${getMemoryDir(plugin)}/${relativePath}`;
}

/** 读取 memory/ 下某个相对路径的文件内容，不存在或失败返回空字符串。 */
export async function loadMemoryFile(
  plugin: AiNoteAgentPlugin,
  relativePath: string
): Promise<string> {
  const vault = plugin.app.vault;
  const path = resolveMemoryPath(plugin, relativePath);
  if (!(await vault.adapter.exists(path))) return "";
  try {
    return await vault.adapter.read(path);
  } catch {
    return "";
  }
}

/** 写入 memory/ 下某个相对路径的文件（不存在则创建，存在则修改）。 */
export async function saveMemoryFile(
  plugin: AiNoteAgentPlugin,
  relativePath: string,
  content: string
): Promise<void> {
  const vault = plugin.app.vault;
  await ensureAiFolder(plugin);
  const path = resolveMemoryPath(plugin, relativePath);
  await vault.adapter.write(path, content);
}

/** 获取文件 mtime（毫秒时间戳），不存在返回 null。 */
async function fileMtime(
  plugin: AiNoteAgentPlugin,
  relativePath: string
): Promise<number | null> {
  const vault = plugin.app.vault;
  const path = resolveMemoryPath(plugin, relativePath);
  try {
    const stat = await vault.adapter.stat(path);
    if (stat && stat.type === "file") {
      return stat.mtime;
    }
  } catch {
    // stat 失败（文件不存在等）
  }
  return null;
}

/** 加载全部会话的完整内容。 */
async function loadAllSessions(plugin: AiNoteAgentPlugin): Promise<Session[]> {
  const index = await loadSessionsIndex(plugin);
  const sessions: Session[] = [];
  for (const meta of index.sessions) {
    const full = await loadSessionFile(plugin, meta.id);
    if (full) sessions.push(full);
  }
  return sessions;
}

/** 将时间戳格式化为本地 YYYY-MM-DD。 */
function formatLocalDate(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 解析用户设置的画像维度（每行一个）。 */
function parseCategories(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 将会话历史压缩为适合 LLM 分析的摘要文本。 */
function buildSessionDigest(sessions: Session[]): string {
  const ordered = [...sessions]
    .filter((s) => s.messages.length > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_SESSIONS_FOR_PROFILE);

  const lines: string[] = [];
  let total = 0;
  for (const s of ordered) {
    const header = `\n--- 会话：${s.title}（${formatLocalDate(
      new Date(s.createdAt)
    )}） ---\n`;
    lines.push(header);
    total += header.length;
    for (const m of s.messages) {
      let text = m.content.trim();
      if (text.length > MAX_MESSAGE_CHARS) {
        text = text.slice(0, MAX_MESSAGE_CHARS) + "…（已截断）";
      }
      const line = `${m.role === "user" ? "用户" : "助手"}：${text}\n`;
      if (total + line.length > MAX_DIGEST_CHARS) {
        lines.push("…（更多历史已省略）\n");
        return lines.join("");
      }
      lines.push(line);
      total += line.length;
    }
  }
  return lines.join("");
}

function buildEmptyProfile(categories: string[]): string {
  const lines = ["# 长期画像记忆", ""];
  for (const cat of categories) {
    lines.push(`## ${cat}`, "", "- 暂无记录", "");
  }
  return lines.join("\n");
}

function buildEmptyDaily(): string {
  return `# ${formatLocalDate()}\n\n- 暂无会话记录\n`;
}

/** 调用 AI 生成新的 MEMORY.md 与当日记忆。 */
async function runMemoryExtraction(
  plugin: AiNoteAgentPlugin,
  sessions: Session[]
): Promise<MemoryExtractionResult | null> {
  const provider = plugin.getProvider();
  const categories = parseCategories(plugin.settings.memoryProfileCategories);
  if (categories.length === 0) return null;

  const currentMemory = await loadMemoryFile(plugin, MEMORY_FILE);
  const digest = buildSessionDigest(sessions);
  const today = formatLocalDate();

  const system =
    "You are a long-term memory organizer for an Obsidian AI assistant. " +
    "Analyze chat history and existing profile memory, then produce updated profile memory and a daily memory note. " +
    "Output valid JSON only, with no markdown fences and no extra commentary.";

  const user = `Below is the user's existing long-term profile memory (may be empty) and recent chat history.
Update the profile memory by merging old facts with new facts. Preserve facts the user has manually written.
Use exactly these categories (one per \`##\` heading):
${categories.map((c) => `- ${c}`).join("\n")}

For each category, write concise bullet points. If a category has no relevant facts, keep the heading and write "- 暂无记录".
For the daily memory, summarize key takeaways, decisions, todos, and any important facts from today's sessions.

Output JSON format:
{
  "profile": "# 长期画像记忆\\n\\n## 职业\\n\\n- ...",
  "daily": "# YYYY-MM-DD\\n\\n- ..."
}

Today's date: ${today}

Existing MEMORY.md:
${currentMemory || "（空）"}

Chat history digest:
${digest}`;

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  try {
    const raw = await provider.complete(messages, {
      temperature: 0.2,
      maxTokens: 2048,
    });
    const parsed = parseJsonFromLLM<MemoryExtractionResult>(raw);
    if (!parsed || !parsed.profile || !parsed.daily) return null;
    return {
      profile: parsed.profile.trim(),
      daily: parsed.daily.trim(),
    };
  } catch (e) {
    console.error("[Smart Notes] memory extraction failed", e);
    return null;
  }
}

/**
 * 在后台重建长期画像记忆。
 * 仅当会话有更新，或 MEMORY.md 不存在时才会真正调用 AI；
 * 否则直接跳过，避免每次启动都消耗 token。
 */
export async function rebuildProfileMemory(plugin: AiNoteAgentPlugin): Promise<void> {
  if (!plugin.settings.memoryProfileEnabled) return;
  try {
    await ensureAiFolder(plugin);
    const sessions = await loadAllSessions(plugin);
    const memoryMtime = await fileMtime(plugin, MEMORY_FILE);
    const maxUpdated = sessions.reduce(
      (max, s) => Math.max(max, s.updatedAt),
      0
    );
    const memoryExists = memoryMtime !== null;

    // 没有会话且已有总记忆：无需生成
    if (sessions.length === 0 && memoryExists) return;

    // 会话没有更新且总记忆已存在：跳过
    if (memoryExists && maxUpdated <= memoryMtime) return;

    let profileMarkdown: string;
    let dailyMarkdown: string;

    if (sessions.length === 0) {
      profileMarkdown = buildEmptyProfile(
        parseCategories(plugin.settings.memoryProfileCategories)
      );
      dailyMarkdown = buildEmptyDaily();
    } else {
      const extracted = await runMemoryExtraction(plugin, sessions);
      if (!extracted) return;
      profileMarkdown = extracted.profile;
      dailyMarkdown = extracted.daily;
    }

    await saveMemoryFile(plugin, MEMORY_FILE, profileMarkdown);
    await saveMemoryFile(plugin, `${formatLocalDate()}.md`, dailyMarkdown);
  } catch (e) {
    // 后台整理失败不应打扰用户
    console.error("[Smart Notes] rebuildProfileMemory failed", e);
  }
}

/**
 * 读取长期画像记忆内容，作为 system prompt 的上下文片段。
 * 返回空字符串表示无有效画像。
 */
export async function getProfileMemoryContext(
  plugin: AiNoteAgentPlugin
): Promise<string> {
  if (!plugin.settings.memoryProfileEnabled) return "";
  const content = await loadMemoryFile(plugin, MEMORY_FILE);
  if (!content.trim()) return "";
  // 防止长期记忆无限膨胀：注入前按字符上限截断
  const cap = plugin.settings.profileMemoryMaxChars;
  const capped =
    cap && cap > 0 && content.length > cap
      ? content.slice(0, cap) + "\n…（已截断，完整内容见 memory/MEMORY.md）"
      : content;
  return `## 长期画像记忆

${capped.trim()}`;
}
