import { App, TFile } from "obsidian";
import type { ToolDefinition, ToolHandler } from "../ai/tools";
import { extractQueryKeywords, matchesKeywords } from "./knowledge";

/**
 * 知识库搜索工具集。
 *
 * 为 Tool Calling 提供三个本地搜索能力：
 * - search_vault_paths：按关键词搜索文件路径
 * - search_vault_frontmatter：按关键词搜索 Frontmatter 元数据
 * - search_vault_content：按关键词搜索文件正文内容
 *
 * 所有工具均从用户自然语言中自动提取关键词，无需用户手动拆分。
 */

/** 单条内容搜索结果。 */
interface ContentSearchResult {
  path: string;
  snippet: string;
}

/**
 * 创建知识库搜索工具定义。
 */
export function createVaultToolDefinitions(): ToolDefinition[] {
  return [
    {
      type: "function",
      function: {
        name: "search_vault_paths",
        description:
          "Search for Markdown files in the vault by keywords. Returns matching file paths. Use this when you need to locate files related to a specific topic.",
        parameters: {
          type: "object",
          properties: {
            keywords: {
              type: "string",
              description:
                "Search keywords extracted from the user's question. Multiple keywords separated by spaces. Example: 'project management' or 'Java Spring'",
            },
            maxResults: {
              type: "number",
              description: "Maximum number of results to return (default 20)",
            },
          },
          required: ["keywords"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "search_vault_frontmatter",
        description:
          "Search for files by their Frontmatter (YAML metadata). Returns file paths along with matching metadata key-value pairs. Use this when you need to find files by tags, dates, categories, or other metadata.",
        parameters: {
          type: "object",
          properties: {
            keywords: {
              type: "string",
              description:
                "Search keywords extracted from the user's question. Multiple keywords separated by spaces.",
            },
            maxResults: {
              type: "number",
              description: "Maximum number of results to return (default 20)",
            },
          },
          required: ["keywords"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "search_vault_content",
        description:
          "Search inside the actual content of Markdown files. Returns file paths and text snippets around matching lines. Use this when you need to find specific text, concepts, or notes that contain certain content.",
        parameters: {
          type: "object",
          properties: {
            keywords: {
              type: "string",
              description:
                "Search keywords extracted from the user's question. Multiple keywords separated by spaces.",
            },
            maxResults: {
              type: "number",
              description: "Maximum number of files to return (default 5)",
            },
            maxCharsPerFile: {
              type: "number",
              description:
                "Maximum characters per file snippet (default 800)",
            },
          },
          required: ["keywords"],
        },
      },
    },
  ];
}

/**
 * 创建知识库搜索工具的执行器集合。
 * @param app Obsidian App 实例
 */
export function createVaultToolHandlers(app: App): Record<string, ToolHandler> {
  const handlers: Record<string, ToolHandler> = {};

  // Tool 1: search_vault_paths
  handlers["search_vault_paths"] = {
    name: "search_vault_paths",
    definition: createVaultToolDefinitions()[0],
    async execute(args) {
      const keywordsRaw = String(args.keywords || "");
      const maxResults = Math.max(1, Math.min(100, Number(args.maxResults) || 20));
      const keywords = extractQueryKeywords(keywordsRaw);

      const mdFiles = app.vault.getMarkdownFiles();
      let paths = mdFiles.map((f) => f.path);

      if (keywords.length > 0) {
        paths = paths.filter((p) => matchesKeywords(p, keywords));
      }

      paths.sort();
      const total = paths.length;
      const sliced = paths.slice(0, maxResults);

      if (sliced.length === 0) {
        return "No matching files found.";
      }

      let result = sliced.map((p) => `- ${p}`).join("\n");
      if (total > sliced.length) {
        result += `\n... (${total - sliced.length} more files omitted)`;
      }
      return result;
    },
  };

  // Tool 2: search_vault_frontmatter
  handlers["search_vault_frontmatter"] = {
    name: "search_vault_frontmatter",
    definition: createVaultToolDefinitions()[1],
    async execute(args) {
      const keywordsRaw = String(args.keywords || "");
      const maxResults = Math.max(1, Math.min(100, Number(args.maxResults) || 20));
      const keywords = extractQueryKeywords(keywordsRaw);

      const mdFiles = app.vault.getMarkdownFiles();
      const lines: string[] = [];

      for (const f of mdFiles) {
        const fm = app.metadataCache.getFileCache(f)?.frontmatter;
        if (!fm || Object.keys(fm).length === 0) continue;

        const pairs: string[] = [];
        for (const [k, v] of Object.entries(fm)) {
          if (k === "position") continue;
          const formatted = formatFrontmatterValue(v, 200);
          if (formatted === "") continue;
          pairs.push(`${k}=${formatted}`);
        }
        if (pairs.length === 0) continue;

        const line = `- ${f.path}: ${pairs.join("; ")}`;
        if (keywords.length === 0 || matchesKeywords(line, keywords)) {
          lines.push(line);
        }
      }

      lines.sort();
      const total = lines.length;
      const sliced = lines.slice(0, maxResults);

      if (sliced.length === 0) {
        return "No matching files with Frontmatter found.";
      }

      let result = sliced.join("\n");
      if (total > sliced.length) {
        result += `\n... (${total - sliced.length} more files omitted)`;
      }
      return result;
    },
  };

  // Tool 3: search_vault_content
  handlers["search_vault_content"] = {
    name: "search_vault_content",
    definition: createVaultToolDefinitions()[2],
    async execute(args) {
      const keywordsRaw = String(args.keywords || "");
      const maxResults = Math.max(1, Math.min(50, Number(args.maxResults) || 5));
      const maxCharsPerFile = Math.max(100, Math.min(5000, Number(args.maxCharsPerFile) || 800));
      const keywords = extractQueryKeywords(keywordsRaw);

      if (keywords.length === 0) {
        return "No valid keywords provided for content search.";
      }

      const mdFiles = app.vault.getMarkdownFiles();
      const results: ContentSearchResult[] = [];

      for (const f of mdFiles) {
        if (results.length >= maxResults) break;

        try {
          const content = await app.vault.cachedRead(f);
          const snippet = findContentSnippet(content, keywords, maxCharsPerFile);
          if (snippet) {
            results.push({ path: f.path, snippet });
          }
        } catch {
          // 跳过无法读取的文件
        }
      }

      if (results.length === 0) {
        return "No files found containing the specified keywords.";
      }

      return results
        .map((r) => `## ${r.path}\n\n${r.snippet}`)
        .join("\n\n---\n\n");
    },
  };

  return handlers;
}

/**
 * 在文件内容中查找包含关键词的片段。
 * 优先返回第一个匹配位置周围的上下文，带高亮标记。
 */
function findContentSnippet(
  content: string,
  keywords: string[],
  maxChars: number
): string | null {
  const lower = content.toLowerCase();
  let bestPos = -1;

  // 找第一个匹配任一关键词的位置
  for (const kw of keywords) {
    const pos = lower.indexOf(kw.toLowerCase());
    if (pos !== -1) {
      bestPos = pos;
      break;
    }
  }

  if (bestPos === -1) return null;

  // 提取匹配位置周围的上下文
  const contextHalf = Math.floor(maxChars / 2);
  const start = Math.max(0, bestPos - contextHalf);
  const end = Math.min(content.length, bestPos + contextHalf);
  let snippet = content.slice(start, end);

  // 裁剪到整行边界（避免截断单词）
  if (start > 0) {
    const firstNewline = snippet.indexOf("\n");
    if (firstNewline !== -1 && firstNewline < 50) {
      snippet = snippet.slice(firstNewline + 1);
    }
  }
  if (end < content.length) {
    const lastNewline = snippet.lastIndexOf("\n");
    if (lastNewline !== -1 && lastNewline > snippet.length - 50) {
      snippet = snippet.slice(0, lastNewline);
    }
  }

  snippet = snippet.trim();
  if (start > 0) snippet = "..." + snippet;
  if (end < content.length) snippet = snippet + "...";

  return snippet;
}

/**
 * 格式化 frontmatter 值（截断、序列化）。
 * 从 knowledge.ts 中提取的辅助函数。
 */
function formatFrontmatterValue(value: unknown, maxChars: number): string {
  let str: string;
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    str = value;
  } else if (typeof value === "number" || typeof value === "boolean") {
    str = String(value);
  } else if (Array.isArray(value)) {
    str = value
      .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
      .join(", ");
  } else {
    str = JSON.stringify(value);
  }
  str = str.replace(/\n/g, " ");
  if (str.length > maxChars) {
    str = str.slice(0, maxChars) + "…";
  }
  return str;
}

/**
 * 执行一组 tool calls，返回 tool results。
 */
export async function executeToolCalls(
  app: App,
  toolCalls: { id: string; function: { name: string; arguments: string } }[]
): Promise<{ toolCallId: string; name: string; content: string }[]> {
  const handlers = createVaultToolHandlers(app);
  const results: { toolCallId: string; name: string; content: string }[] = [];

  for (const tc of toolCalls) {
    const handler = handlers[tc.function.name];
    if (!handler) {
      results.push({
        toolCallId: tc.id,
        name: tc.function.name,
        content: `Error: Tool "${tc.function.name}" not found.`,
      });
      continue;
    }

    try {
      const args = JSON.parse(tc.function.arguments || "{}") as Record<
        string,
        unknown
      >;
      const content = await handler.execute(args);
      results.push({
        toolCallId: tc.id,
        name: tc.function.name,
        content,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({
        toolCallId: tc.id,
        name: tc.function.name,
        content: `Error executing tool: ${msg.slice(0, 500)}`,
      });
    }
  }

  return results;
}
