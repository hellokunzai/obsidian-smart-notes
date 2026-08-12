import { App, TFile, TFolder, Vault } from "obsidian";
import type AiNoteAgentPlugin from "../main";
import { getSkillsDir } from "../utils/aiFolder";

/**
 * Skill 管理模块。
 *
 * Skill = vault 内 `<AI 文件夹>/skills/` 目录下的 .md 文件，
 * 内容是给 AI 的指令 / 模板 / 参考资料。
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
 * 优先级：frontmatter 的 name > 第一个 # 标题 > 文件名（去 .md）。
 */
function resolveSkillName(content: string, fallback: string): string {
  // frontmatter: 形如 ---\nname: xxx\n---
  const fm = /^---\s*\n([\s\S]*?)\n---\s*\n?/.exec(content);
  if (fm) {
    const m = /^name:\s*(.+)$/m.exec(fm[1]);
    if (m && m[1].trim()) return m[1].trim();
  }
  const h1 = /^#\s+(.+)$/m.exec(content);
  if (h1) return h1[1].trim();
  return fallback;
}

/**
 * 递归收集 skills/ 目录下所有 .md 文件（排除 README.md 与隐藏文件/文件夹）。
 */
function collectSkillFiles(vault: Vault, folderPath: string): TFile[] {
  const af = vault.getAbstractFileByPath(folderPath);
  if (!(af instanceof TFolder)) return [];
  const out: TFile[] = [];
  const walk = (f: TFolder) => {
    for (const child of f.children) {
      // 跳过隐藏文件夹（以 . 开头）
      if (child instanceof TFolder) {
        if (child.name.startsWith(".")) continue;
        walk(child);
      } else if (child instanceof TFile) {
        if (child.extension !== "md") continue;
        if (child.name.startsWith(".")) continue;
        if (child.basename.toLowerCase() === "readme") continue;
        out.push(child);
      }
    }
  };
  walk(af);
  return out;
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
  const files = collectSkillFiles(app.vault, base);
  const entries: SkillEntry[] = [];
  for (const f of files) {
    const rel = f.path.startsWith(base + "/")
      ? f.path.slice(base.length + 1)
      : f.path;
    let name = rel;
    try {
      const content = await app.vault.cachedRead(f);
      name = resolveSkillName(content, rel);
    } catch {
      // 读不到就用相对路径作为名字
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
    const af = app.vault.getAbstractFileByPath(absPath);
    if (!(af instanceof TFile)) continue;
    let content = "";
    try {
      content = await app.vault.cachedRead(af);
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
