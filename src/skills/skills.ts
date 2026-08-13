import { App, Stat, Vault } from "obsidian";
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
 * 设计原则（与知识库一致）：
 * - 默认不加载任何 skill 的内容；
 * - 仅「启用」的 skill 内容会注入 system prompt；
 * - 未启用的 skill 仅以「名字索引」形式告知 AI（列出有哪些可用、可提示用户开启），
 *   AI 读不到其内容。
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

/**
 * 根据启用的 skill 路径，构建注入到 system prompt 的 skill 上下文。
 * 产出两块（中间用空行分隔，整体可能为空）：
 *  1) Available skills (index)：列出全部 skill 名，标注 [active]/[inactive]，
 *     让 AI 知道有哪些可用，并可在用户需要时提示开启；未启用者不含内容。
 *  2) Active skill instructions：仅启用 skill 的完整内容（按 maxChars 截断）。
 * @param plugin 插件
 * @param app Obsidian app
 * @param activeSkills 当前启用的 skill 相对路径列表
 * @param maxChars 单文件内容截断上限
 */
export async function buildSkillContext(
  plugin: AiNoteAgentPlugin,
  app: App,
  activeSkills: string[],
  maxChars: number
): Promise<string> {
  const all = await listSkills(plugin, app);
  if (all.length === 0) return "";

  const base = skillsBasePath(plugin);
  const activeSet = new Set(activeSkills);

  // 索引块：列出全部 skill 名 + active/inactive 标注
  const indexLines = all.map((e) => {
    const isActive = activeSet.has(e.path);
    return `- ${e.name} [${isActive ? "active" : "inactive"}]${isActive ? "" : " (enable to load its content)"}`;
  });
  const indexBlock = [
    "# Available skills (index — contents are loaded only for active ones)",
    ...indexLines,
  ].join("\n");

  // 内容块：仅启用 skill
  const activeEntries = all.filter((e) => activeSet.has(e.path));
  if (activeEntries.length === 0) {
    return indexBlock;
  }

  const contentBlocks: string[] = [];
  for (const e of activeEntries) {
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

  const contentBlock =
    contentBlocks.length > 0
      ? ["# Active skill instructions", ...contentBlocks].join("\n\n")
      : "";

  return [indexBlock, contentBlock].filter(Boolean).join("\n\n");
}
