import { App, TFile, TFolder } from "obsidian";
import type { AttachmentRef } from "../utils/aiFolder";

/**
 * 知识库上下文构建模块。
 *
 * 设计原则（用户要求）：
 * - AI 只通过「路径索引」看见库里有哪些文件，但默认读不到内容；
 * - 只有当用户显式附加（文件/文件夹）或在消息中引用某个文件时，
 *   该文件的内容才会被读取并注入上下文；
 * - 未选中的文件，AI 永远读不到其内容。
 *
 * 扩展点（已实现的后续功能）：
 * - 加载 skill：由 src/skills/skills.ts 处理，将 skills 目录下的 .md 视为特殊附件注入；
 * - 联网搜索：由 src/search/{search,prompt}.ts 处理，把 web 结果作为独立上下文块
 *   追加到当前 user message（而非 system），与附件/知识库索引保持一致的区块风格。
 * 具体注入逻辑见各自模块。
 */

/**
 * 构造知识库路径索引（仅路径，不含内容），用于注入 system prompt，
 * 让 AI 知道库里有哪些文件，但不自动加载内容。
 * @param app Obsidian app
 * @param enabled 是否启用索引（设置项 includeVaultIndex）
 */
export function buildKnowledgeIndex(app: App, enabled: boolean): string {
  if (!enabled) return "";
  const mdFiles = app.vault.getMarkdownFiles();
  if (mdFiles.length === 0) return "";
  const lines = mdFiles
    .map((f) => `- ${f.path}`)
    .sort();
  return [
    "# Knowledge base index (paths only — file contents are NOT loaded unless explicitly attached or referenced)",
    ...lines,
  ].join("\n");
}

/** 转义正则特殊字符。 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 判断一条消息文本是否「点名」了某个文件（完整路径或文件名）。
 * 匹配规则：
 *  - 消息包含文件完整 path（如 Projects/foo.md）；
 *  - 或消息在词边界处出现文件名（basename，带或不带 .md 后缀）。
 */
function messageMentionsFile(message: string, file: TFile): boolean {
  if (message.includes(file.path)) return true;
  const base = file.basename;
  // 词边界匹配文件名（允许后面跟 .md 或换行/空格/斜杠）
  const re = new RegExp(
    `(^|[^\\w./\\\\-])${escapeRegExp(base)}(?:\\.md)?($|[^\\w./\\\\-])`
  );
  return re.test(message);
}

/**
 * 收集一个文件夹下的所有 Markdown 文件（递归）。
 */
function collectMarkdownUnderFolder(app: App, folderPath: string): TFile[] {
  const af = app.vault.getAbstractFileByPath(folderPath);
  if (!(af instanceof TFolder)) return [];
  const out: TFile[] = [];
  const walk = (f: TFolder) => {
    for (const child of f.children) {
      if (child instanceof TFile && child.extension === "md") {
        out.push(child);
      } else if (child instanceof TFolder) {
        walk(child);
      }
    }
  };
  walk(af);
  return out;
}

/**
 * 根据附件引用解析出需要读取的 Markdown 文件集合（去重）。
 * @param app Obsidian app
 * @param attachments 用户显式附加的文件/文件夹引用
 */
export function resolveAttachedFiles(
  app: App,
  attachments: AttachmentRef[]
): TFile[] {
  const map = new Map<string, TFile>();
  for (const ref of attachments) {
    if (ref.type === "file") {
      const af = app.vault.getAbstractFileByPath(ref.path);
      if (af instanceof TFile && af.extension === "md") {
        map.set(af.path, af);
      }
    } else {
      for (const f of collectMarkdownUnderFolder(app, ref.path)) {
        map.set(f.path, f);
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * 构造发送给模型的「附件内容」上下文块。
 * 仅包含：
 *  - 用户显式附加的文件/文件夹；
 *  - 消息文本中点名的库内已知文件（满足「用户指定文件名」场景）。
 * 每个文件内容截断到 maxChars，超出部分标注被截断。
 * @param app Obsidian app
 * @param attachments 显式附件
 * @param message 当前用户消息文本（用于点名匹配）
 * @param maxChars 单文件注入字符上限
 */
export async function buildAttachmentContext(
  app: App,
  attachments: AttachmentRef[],
  message: string,
  maxChars: number
): Promise<string> {
  const files = new Map<string, TFile>();

  // 1) 显式附件
  for (const f of resolveAttachedFiles(app, attachments)) {
    files.set(f.path, f);
  }

  // 2) 消息文本中点名的库内文件
  if (message) {
    for (const f of app.vault.getMarkdownFiles()) {
      if (!files.has(f.path) && messageMentionsFile(message, f)) {
        files.set(f.path, f);
      }
    }
  }

  if (files.size === 0) return "";

  const blocks: string[] = [];
  for (const f of files.values()) {
    let content = "";
    try {
      content = await app.vault.cachedRead(f);
    } catch {
      continue;
    }
    let truncated = false;
    if (content.length > maxChars) {
      content = content.slice(0, maxChars);
      truncated = true;
    }
    blocks.push(
      `[file: ${f.path}]` +
        (truncated ? ` (truncated to ${maxChars} chars)\n` : "\n") +
        content
    );
  }

  if (blocks.length === 0) return "";
  return (
    "--- Attached knowledge base content ---\n" + blocks.join("\n\n")
  );
}
