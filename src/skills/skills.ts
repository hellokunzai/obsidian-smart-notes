import { App, Platform, Stat, Vault } from "obsidian";
import type AiNoteAgentPlugin from "../main";
import { getSkillsDir } from "../utils/aiFolder";

/**
 * Skill 管理模块。
 *
 * Skill = `<AI 文件夹>/skills/` 目录下每个 skill 套件的 SKILL.md 文件。
 * 一个 skill 套件即一个文件夹，套件内部可包含 assets/、references/、scripts/ 等；
 * 插件只识别并加载套件根目录下的 SKILL.md 作为该 skill 的内容。
 * 套件内可以再嵌套子套件（子文件夹里有自己的 SKILL.md），会被识别为独立的 skill。
 *
 * 设计原则：
 * - 设置页「启用」的 skill 仅以「索引」形式进入 system prompt（名称 + 路径 +
 *   一句话描述），不发送完整内容；未启用的 skill 对 AI 完全不可见。
 * - AI 可根据用户需求，在回复末尾用 `@use-skill: <path>` 标记声明调用某 skill；
 *   插件收到后自动把该 skill 的完整内容加入会话，下一轮对话生效。
 * - 用户也可在对话框手动通过 Skill 按钮选择要注入内容的 skill。
 *
 * 扩展点：所有 skill 注入复用 knowledge.ts 的上下文拼接风格（统一区块）。
 */

/** 一个 skill 的元信息。 */
export interface SkillEntry {
  /** skills/ 下的相对路径（vault 内路径） */
  path: string;
  /** 展示名：frontmatter name > 首个 H1 > 文件名 */
  name: string;
}

/** skills 目录下的路径前缀，用于把绝对 vault 路径转成相对路径。 */
function skillsBasePath(plugin: AiNoteAgentPlugin): string {
  return getSkillsDir(plugin); // 形如 "<AI 文件夹>/skills"
}

/** skill 套件的入口文件名。 */
const SKILL_FILE_NAME = "SKILL.md";

/**
 * 从 skill 文件内容解析展示名。
 * 优先级：frontmatter 的 displayName > name > 第一个 # 标题 > 文件名（去 .md）。
 */
function resolveSkillName(content: string, fallback: string): string {
  // frontmatter: 形如 ---\nname: xxx\n---
  const fm = /^---\s*\n([\s\S]*?)\n---\s*\n?/.exec(content);
  if (fm) {
    const displayName = /^displayName:\s*(.+)$/m.exec(fm[1]);
    if (displayName && displayName[1].trim()) return displayName[1].trim();
    const name = /^name:\s*(.+)$/m.exec(fm[1]);
    if (name && name[1].trim()) return name[1].trim();
  }
  const h1 = /^#\s+(.+)$/m.exec(content);
  if (h1) return h1[1].trim();
  return fallback;
}

/**
 * 收集 skills/ 目录下所有 skill 套件的 SKILL.md 路径。
 *
 * 一个 skill 套件 = 一个文件夹，套件根目录下有 SKILL.md。
 * 如果某个文件夹下没有 SKILL.md，则递归进入其直接子文件夹继续寻找；
 * 这允许「套件包」里再嵌套多个子套件（如 obsidian-skills/json-canvas）。
 *
 * 关键：使用 vault.adapter 直接读文件系统（而非 vault 缓存的
 * getAbstractFileByPath），以覆盖「.」开头的隐藏文件夹（如 .workbuddy）。
 * Obsidian 的 vault 缓存不会索引隐藏文件夹，导致 getAbstractFileByPath 对
 * .workbuddy/skills 内部文件返回 undefined；adapter 走底层文件系统，可正常访问。
 *
 * 排除隐藏文件/文件夹（以 . 开头）。
 */
async function collectSkillFiles(
  vault: Vault,
  folderPath: string
): Promise<string[]> {
  const out: string[] = [];
  const root = folderPath.endsWith("/") ? folderPath : folderPath + "/";

  let listed: { files: string[]; folders: string[] };
  try {
    listed = await vault.adapter.list(root);
  } catch {
    return out;
  }

  // skills/ 根目录下直接放一个 SKILL.md 也允许（虽然通常建议放文件夹里）
  for (const file of listed.files) {
    const fileName = file.slice(file.lastIndexOf("/") + 1);
    if (fileName === "SKILL.md") {
      out.push(file.endsWith("/") ? file.slice(0, -1) : file);
    }
  }

  for (const folder of listed.folders) {
    const normalized = folder.endsWith("/") ? folder.slice(0, -1) : folder;
    const folderName = normalized.slice(normalized.lastIndexOf("/") + 1);
    if (folderName.startsWith(".")) continue;

    const skillFile = normalized + "/SKILL.md";
    let stat: Stat | null;
    try {
      stat = await vault.adapter.stat(skillFile);
    } catch {
      stat = null;
    }
    if (stat && stat.type === "file") {
      out.push(skillFile);
      continue;
    }

    // 本层没有 SKILL.md，继续向子文件夹递归
    await walkSkillFolder(vault, normalized + "/", out);
  }

  return out;
}

async function walkSkillFolder(
  vault: Vault,
  dir: string,
  out: string[]
): Promise<void> {
  let listed: { files: string[]; folders: string[] };
  try {
    listed = await vault.adapter.list(dir);
  } catch {
    return;
  }

  for (const folder of listed.folders) {
    const normalized = folder.endsWith("/") ? folder.slice(0, -1) : folder;
    const folderName = normalized.slice(normalized.lastIndexOf("/") + 1);
    if (folderName.startsWith(".")) continue;

    const skillFile = normalized + "/SKILL.md";
    let stat: Stat | null;
    try {
      stat = await vault.adapter.stat(skillFile);
    } catch {
      stat = null;
    }
    if (stat && stat.type === "file") {
      out.push(skillFile);
      continue;
    }

    await walkSkillFolder(vault, normalized + "/", out);
  }
}

/**
 * 列出 skills/ 目录下的全部 skill（含名称）。
 * 若目录不存在或为空，返回空数组。
 */
export async function listSkills(
  plugin: AiNoteAgentPlugin,
  app: App
): Promise<SkillEntry[]> {
  const base = skillsBasePath(plugin);
  const paths = await collectSkillFiles(app.vault, base);
  const entries: SkillEntry[] = [];
  for (const absPath of paths) {
    const rel =
      absPath.startsWith(base + "/")
        ? absPath.slice(base.length + 1)
        : absPath;
    // 默认展示名：SKILL.md 用所在文件夹名，否则用文件名
    const lastSlash = rel.lastIndexOf("/");
    const fileName = rel.slice(lastSlash + 1);
    const parentName = lastSlash > 0 ? rel.slice(0, lastSlash) : rel;
    const fallback = fileName.toLowerCase() === "skill.md" ? parentName : rel;
    let name = fallback;
    try {
      const content = await app.vault.adapter.read(absPath);
      name = resolveSkillName(content, fallback);
    } catch {
      // 读不到就用 fallback 作为名字
    }
    entries.push({ path: rel, name });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

/* ── 套件的文件操作（删除 / 在系统文件管理器中显示）───────────────── */

/**
 * 一个 skill 在 vault 内的可操作目标。
 *
 * 套件 = 一个文件夹（其根目录下有 SKILL.md），所以绝大多数情况下目标就是
 * 该文件夹本身；删除它即连同 assets/ scripts/ references/ 一起移除。
 * 少数情况下 SKILL.md 直接放在 skills/ 根目录，此时没有"套件文件夹"，
 * 目标退化为那一个文件——绝不会出现「删掉 skills/ 目录本身」这种结果。
 */
export interface SkillTarget {
  /** vault 内相对路径（可直接交给 vault.adapter / app.showInFolder）。 */
  path: string;
  /** true = 套件文件夹；false = skills/ 根目录下的单个 SKILL.md。 */
  isFolder: boolean;
}

/**
 * 由 skill 的展示路径解析出可操作目标。
 *
 * @param relPath 相对 skills/ 目录的路径，如 `obsidian-plugin-dev/SKILL.md`
 */
export function resolveSkillTarget(
  plugin: AiNoteAgentPlugin,
  relPath: string
): SkillTarget {
  const base = skillsBasePath(plugin);
  const suffix = "/" + SKILL_FILE_NAME;
  if (relPath.endsWith(suffix)) {
    return {
      path: `${base}/${relPath.slice(0, -suffix.length)}`,
      isFolder: true,
    };
  }
  return { path: `${base}/${relPath}`, isFolder: false };
}

/**
 * 把 skill 套件（或其单个 SKILL.md）移入回收站。
 *
 * 优先用系统回收站；系统回收站不可用（被系统设置禁用、或移动端没有）时
 * 回落到 vault 根目录的 `.trash/`，与 Obsidian 自己删除文件的行为一致。
 * 目标不存在时视为已删除，直接返回（幂等，避免重复删除报错）。
 *
 * @throws 两种回收站都失败时抛出底层错误，由调用方提示用户。
 */
export async function trashSkill(
  plugin: AiNoteAgentPlugin,
  relPath: string
): Promise<void> {
  const adapter = plugin.app.vault.adapter;
  const target = resolveSkillTarget(plugin, relPath);
  if (!(await adapter.exists(target.path))) return;

  const trashed = await adapter
    .trashSystem(target.path)
    .catch(() => false);
  if (!trashed) await adapter.trashLocal(target.path);
}

/**
 * 在系统文件管理器中显示该 skill 的套件文件夹。
 *
 * skill 位于 `<AI 文件夹>/skills/`（默认 `.smartnotes/skills`，vault 隐藏目录），
 * Obsidian 的文件浏览器不索引隐藏目录，所以「打开文件夹」只能交给系统文件管理器。
 *
 * 用的是 Obsidian 自己的 `app.showInFolder()`——文件浏览器右键菜单里
 * 「在系统资源管理器中显示」就是它：桌面端经 `adapter.getFullPath()` 换算绝对
 * 路径后交给 Electron shell，路径不存在时它自己会弹 Notice。该方法未收录进公开
 * 的 obsidian.d.ts，所以这里用交叉类型补出签名后调用（而不是用 any / @ts-ignore）。
 *
 * @returns false 表示当前平台不支持（移动端），调用方应据此不展示该菜单项。
 */
export function revealSkillInFileManager(app: App, path: string): boolean {
  if (!Platform.isDesktopApp) return false;
  (app as App & { showInFolder(path: string): void }).showInFolder(path);
  return true;
}

/**
 * 从 skill 内容解析一句话描述（用于索引块）。
 * 优先级：frontmatter 的 `description` > 第一个 `#` 标题 > 空串。
 */
function resolveSkillDescription(content: string): string {
  const fm = /^---\s*\n([\s\S]*?)\n---\s*\n?/.exec(content);
  if (fm) {
    const desc = /^description:\s*(.+)$/m.exec(fm[1]);
    if (desc && desc[1].trim()) return desc[1].trim();
  }
  const h1 = /^#\s+(.+)$/m.exec(content);
  if (h1) return h1[1].trim();
  return "";
}

/**
 * 构建注入 system prompt 的 skill 索引块。
 *
 * 仅列出「已启用」的 skill（enabledPaths），每个条目含名称、路径与一句话描述，
 * 末尾附加 AI 调用指令：当任务与某 skill 匹配时，AI 可在回复末尾写出
 * `@use-skill: <path>` 标记；宿主收到后会自动加载该 skill 的完整内容。
 * 未启用的 skill 不在此块中出现，对 AI 不可见。
 *
 * @param plugin 插件
 * @param app Obsidian app
 * @param enabledPaths 设置中默认启用的 skill 相对路径列表
 */
export async function buildSkillIndex(
  plugin: AiNoteAgentPlugin,
  app: App,
  enabledPaths: string[]
): Promise<string> {
  if (enabledPaths.length === 0) return "";
  const all = await listSkills(plugin, app);
  const base = skillsBasePath(plugin);
  const enabledSet = new Set(enabledPaths);
  const entries = all.filter((e) => enabledSet.has(e.path));
  if (entries.length === 0) return "";

  const lines = await Promise.all(
    entries.map(async (e) => {
      let desc = "";
      try {
        const content = await app.vault.adapter.read(`${base}/${e.path}`);
        desc = resolveSkillDescription(content);
      } catch {
        // 读不到就用空描述
      }
      const suffix = desc ? `: ${desc}` : "";
      return `- ${e.name} (${e.path})${suffix}`;
    })
  );

  return [
    "# Available skills (index — the host loads a skill's full instructions only after you invoke it with `@use-skill: <path>`)",
    ...lines,
    "",
    "If the user's request matches one of the skills above, you MAY use it. To invoke, write the marker on its own line at the end of your reply:",
    "`@use-skill: <path>`  (replace <path> with the exact path shown above)",
    "Do NOT paste the skill's instructions yourself; the host will automatically load them into the next turn.",
  ].join("\n");
}

/**
 * 构建注入 system prompt 的 skill 内容块。
 *
 * 仅把给定路径的 skill 完整内容注入（按 maxChars 截断）。这些路径通常来自：
 * - 用户在对话框 Skill 按钮中手动选择的 skill；
 * - AI 通过 `@use-skill` 标记触发、由插件加入会话的 skill。
 *
 * @param plugin 插件
 * @param app Obsidian app
 * @param paths 需要注入内容的 skill 相对路径列表
 * @param maxChars 单文件内容截断上限
 */
export async function buildSkillContent(
  plugin: AiNoteAgentPlugin,
  app: App,
  paths: string[],
  maxChars: number
): Promise<string> {
  if (paths.length === 0) return "";
  const all = await listSkills(plugin, app);
  const base = skillsBasePath(plugin);
  const set = new Set(paths);
  const entries = all.filter((e) => set.has(e.path));
  if (entries.length === 0) return "";

  const contentBlocks: string[] = [];
  for (const e of entries) {
    const absPath = `${base}/${e.path}`;
    let content = "";
    try {
      content = await app.vault.adapter.read(absPath);
    } catch {
      continue;
    }
    let truncated = false;
    if (content.length > maxChars) {
      content = content.slice(0, maxChars);
      truncated = true;
    }
    contentBlocks.push(
      `## Skill: ${e.name} (${e.path})` +
        (truncated ? ` (truncated to ${maxChars} chars)\n` : "\n") +
        content
    );
  }

  return contentBlocks.length > 0
    ? ["# Active skill instructions", ...contentBlocks].join("\n\n")
    : "";
}
