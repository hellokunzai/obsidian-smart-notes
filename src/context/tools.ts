import { App, TFile } from "obsidian";
import type { ToolDefinition, ToolHandler } from "../ai/tools";
import { extractQueryKeywords, matchesKeywords } from "./knowledge";
import type { AiNoteAgentSettings } from "../settings";
import { asText } from "../utils/json";

/**
 * 知识库搜索工具集。
 *
 * 为 Tool Calling 提供四个本地能力：
 * - search_vault_paths：按关键词搜索文件路径（默认附带命中文件的正文）
 * - search_vault_frontmatter：按关键词搜索 Frontmatter 元数据（默认附带命中文件的正文）
 * - search_vault_content：按关键词搜索文件正文内容（返回命中片段）
 * - read_vault_notes：按精确路径读取一个或多个笔记的正文
 *
 * 前两个工具默认返回命中文件的路径/属性并附带正文，附带数量即本次实际返回的命中条数
 * （条数由各自的「最多文件数」设置控制，单个文件按 chatContextMaxChars 截断）；
 * 模型传 includeContent=false 时只返回路径/属性，可再用 read_vault_notes 按需补读。
 * 所有搜索工具均从用户自然语言中自动提取关键词，无需用户手动拆分。
 */

/** 单条内容搜索结果。 */
interface ContentSearchResult {
  path: string;
  snippet: string;
}

/** 单条搜索命中：path 必有，meta 仅在属性搜索时存在。 */
interface SearchHit {
  path: string;
  meta?: string;
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
          "Search for Markdown files in the vault by keywords. Returns matching file paths together with their content. Use this when you need to locate files related to a specific topic and see what they contain.",
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
            includeContent: {
              type: "boolean",
              description:
                "Whether to also return each matching note's content (default true). Set to false when you only need the file list.",
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
          "Search for files by their Frontmatter (YAML metadata). Returns file paths along with matching metadata key-value pairs and each matching note's content. Use this when you need to find files by tags, dates, categories, or other metadata.",
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
            includeContent: {
              type: "boolean",
              description:
                "Whether to also return each matching note's content (default true). Set to false when you only need the file list with metadata.",
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
    {
      type: "function",
      function: {
        name: "read_vault_notes",
        description:
          "Read the content of one or more Markdown notes by their exact vault paths. Use this after a search when a note was returned as a path only, or when you need to read further into a note whose content was truncated. Never invent paths — use paths returned by the search tools.",
        parameters: {
          type: "object",
          properties: {
            paths: {
              type: "string",
              description:
                "One or more vault paths of the notes to read, separated by newlines or commas. Example: 'Projects/roadmap.md, Daily/2026-01-02.md'",
            },
            maxCharsPerFile: {
              type: "number",
              description:
                "Maximum characters per note (default: the configured max chars per attached file).",
            },
            maxFiles: {
              type: "number",
              description: "Maximum number of notes to read (default 5)",
            },
          },
          required: ["paths"],
        },
      },
    },
  ];
}

/**
 * 创建知识库搜索工具的执行器集合。
 * @param app Obsidian App 实例
 * @param settings 插件设置（用于读取 maxFiles / maxChars 等限制）
 */
export function createVaultToolHandlers(
  app: App,
  settings?: AiNoteAgentSettings
): Record<string, ToolHandler> {
  const handlers: Record<string, ToolHandler> = {};

  // Tool 1: search_vault_paths
  handlers["search_vault_paths"] = {
    name: "search_vault_paths",
    definition: createVaultToolDefinitions()[0],
    async execute(args) {
      const keywordsRaw = asText(args.keywords);
      // 优先使用 AI 传入的 maxResults，否则 fallback 到设置项 vaultIndexMaxFiles
      const settingsMax = settings && settings.vaultIndexMaxFiles > 0
        ? settings.vaultIndexMaxFiles
        : 20;
      const maxResults = Math.max(
        1,
        Math.min(100, Number(args.maxResults) || settingsMax)
      );
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

      // 返回的每个命中都附带正文；模型显式传 includeContent=false 时只返回路径
      if (args.includeContent === false) {
        let result = sliced.map((p) => `- ${p}`).join("\n");
        if (total > sliced.length) {
          result += `\n... (${total - sliced.length} more files omitted)`;
        }
        return result;
      }

      return buildHitsResult(
        app,
        sliced.map((p) => ({ path: p })),
        resolveContentMaxChars(settings?.chatContextMaxChars),
        total
      );
    },
  };

  // Tool 2: search_vault_frontmatter
  handlers["search_vault_frontmatter"] = {
    name: "search_vault_frontmatter",
    definition: createVaultToolDefinitions()[1],
    async execute(args) {
      const keywordsRaw = asText(args.keywords);
      const settingsMax = settings && settings.frontmatterIndexMaxFiles > 0
        ? settings.frontmatterIndexMaxFiles
        : 20;
      const maxResults = Math.max(
        1,
        Math.min(100, Number(args.maxResults) || settingsMax)
      );
      const keywords = extractQueryKeywords(keywordsRaw);

      // 属性白名单从设置读取；属性值不再截断，正文长度由 frontmatterContentMaxChars 控制
      const keysRaw = settings?.frontmatterIndexKeys ?? "";
      const keys = parseKeyWhitelist(keysRaw);

      const mdFiles = app.vault.getMarkdownFiles();
      const hits: SearchHit[] = [];

      for (const f of mdFiles) {
        const fm = app.metadataCache.getFileCache(f)?.frontmatter;
        if (!fm || Object.keys(fm).length === 0) continue;

        const pairs: string[] = [];
        for (const [k, v] of Object.entries(fm)) {
          if (k === "position") continue;
          if (keys.length > 0 && !keys.includes(k.toLowerCase())) continue;
          const formatted = formatFrontmatterValue(v);
          if (formatted === "") continue;
          pairs.push(`${k}=${formatted}`);
        }
        if (pairs.length === 0) continue;

        const meta = pairs.join("; ");
        const line = `- ${f.path}: ${meta}`;
        if (keywords.length === 0 || matchesKeywords(line, keywords)) {
          hits.push({ path: f.path, meta });
        }
      }

      hits.sort((a, b) => a.path.localeCompare(b.path));
      const total = hits.length;
      const sliced = hits.slice(0, maxResults);

      if (sliced.length === 0) {
        return "No matching files with Frontmatter found.";
      }

      // 返回的每个命中都附带正文；模型显式传 includeContent=false 时只返回元数据
      if (args.includeContent === false) {
        let result = sliced.map((h) => `- ${h.path}: ${h.meta}`).join("\n");
        if (total > sliced.length) {
          result += `\n... (${total - sliced.length} more files omitted)`;
        }
        return result;
      }

      return buildHitsResult(
        app,
        sliced,
        resolveContentMaxChars(settings?.frontmatterContentMaxChars),
        total
      );
    },
  };

  // Tool 3: search_vault_content
  handlers["search_vault_content"] = {
    name: "search_vault_content",
    definition: createVaultToolDefinitions()[2],
    async execute(args) {
      const keywordsRaw = asText(args.keywords);
      const maxResults = Math.max(1, Math.min(50, Number(args.maxResults) || 5));
      // 单文件片段字符上限：优先使用设置项 chatContextMaxChars，否则 fallback 800
      const settingsMaxChars = settings && settings.chatContextMaxChars > 0
        ? settings.chatContextMaxChars
        : 800;
      const maxCharsPerFile = Math.max(
        100,
        Math.min(5000, Number(args.maxCharsPerFile) || settingsMaxChars)
      );
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

  // Tool 4: read_vault_notes
  handlers["read_vault_notes"] = {
    name: "read_vault_notes",
    definition: createVaultToolDefinitions()[3],
    async execute(args) {
      const raw = asText(args.paths);
      const requested = raw
        .split(/[\n,，;；]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (requested.length === 0) {
        return "No file paths provided.";
      }

      const maxFiles = Math.max(1, Math.min(20, Number(args.maxFiles) || 5));
      const argMaxChars = Number(args.maxCharsPerFile);
      const maxChars =
        argMaxChars > 0
          ? Math.max(200, Math.min(50_000, argMaxChars))
          : resolveContentMaxChars(settings?.chatContextMaxChars);

      const seen = new Set<string>();
      const blocks: string[] = [];
      const missing: string[] = [];

      for (const p of requested) {
        if (blocks.length >= maxFiles) break;
        const file = resolveNote(app, p);
        if (!file) {
          missing.push(p);
          continue;
        }
        if (seen.has(file.path)) continue;
        seen.add(file.path);
        const body = await readNoteBody(app, file.path, maxChars);
        blocks.push(
          body
            ? `## ${file.path}\n\n${body}`
            : `## ${file.path}\n\n(Content unavailable.)`
        );
      }

      const parts: string[] = [];
      if (blocks.length > 0) {
        parts.push(blocks.join("\n\n---\n\n"));
      }
      if (missing.length > 0) {
        parts.push(
          `Notes not found in the vault: ${missing.join(", ")}. Use a search tool first to get exact paths.`
        );
      }
      if (requested.length > maxFiles) {
        parts.push(`... (${requested.length - maxFiles} more requested paths omitted)`);
      }
      return parts.length > 0 ? parts.join("\n\n") : "Nothing to read.";
    },
  };

  return handlers;
}

/**
 * 把「单文件注入字符上限」收敛到合理区间。
 * 文件搜索传 chatContextMaxChars、属性搜索传 frontmatterContentMaxChars；
 * 下限 200 避免无意义的小读取，上限 5 万防止超大文件撑爆 token。
 */
function resolveContentMaxChars(raw: number | undefined): number {
  const n = raw ?? 0;
  return Math.max(200, Math.min(50_000, n > 0 ? n : 8000));
}

/**
 * 读取单个笔记正文并截断到 maxChars。
 * 文件不存在、不是 Markdown 或读取失败时返回空串（由调用方决定如何提示）。
 */
async function readNoteBody(
  app: App,
  path: string,
  maxChars: number
): Promise<string> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile) || file.extension !== "md") return "";
  try {
    const raw = (await app.vault.cachedRead(file)).trim();
    if (raw.length <= maxChars) return raw;
    return `${raw.slice(0, maxChars).trimEnd()}\n... (truncated to ${maxChars} chars, total ${raw.length})`;
  } catch {
    return "";
  }
}

/**
 * 按路径定位笔记。优先精确路径；失败时回退到「文件名 / 去掉 .md 的路径」匹配，
 * 因为模型有时只给文件名而省略文件夹层级。
 */
function resolveNote(app: App, rawPath: string): TFile | null {
  const cleaned = rawPath
    .replace(/^\[\[|\]\]$/g, "")
    .replace(/^\.\//, "")
    .trim();
  if (cleaned === "") return null;

  const direct = app.vault.getAbstractFileByPath(cleaned);
  if (direct instanceof TFile && direct.extension === "md") return direct;

  const lower = cleaned.toLowerCase();
  const lowerNoExt = lower.replace(/\.md$/, "");
  const matches = app.vault
    .getMarkdownFiles()
    .filter(
      (f) =>
        f.path.toLowerCase() === lower ||
        f.path.toLowerCase().replace(/\.md$/, "") === lowerNoExt ||
        f.basename.toLowerCase() === lowerNoExt
    );
  return matches.length > 0 ? matches[0] : null;
}

/**
 * 把搜索命中组装成工具结果：本次返回的每条命中都附带正文。
 * 命中条数已由调用方按各自的「最多文件数」设置裁剪；maxChars 由调用方按各自的
 * 「单文件注入字符上限」算好传入（文件搜索与属性搜索用的不是同一个设置项）。
 */
async function buildHitsResult(
  app: App,
  hits: SearchHit[],
  maxChars: number,
  total: number
): Promise<string> {
  const blocks: string[] = [];
  for (const hit of hits) {
    const body = await readNoteBody(app, hit.path, maxChars);
    const head = hit.meta ? `## ${hit.path}\n\nmeta: ${hit.meta}` : `## ${hit.path}`;
    blocks.push(
      body
        ? `${head}\n\n${body}`
        : `${head}\n\n(Content unavailable for this note.)`
    );
  }

  let out = blocks.join("\n\n---\n\n");
  if (total > hits.length) {
    out += `\n... (${total - hits.length} more files omitted)`;
  }
  return out;
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
 * 格式化 frontmatter 值（序列化，不再截断）。
 * 从 knowledge.ts 中提取的辅助函数。
 */
function formatFrontmatterValue(value: unknown): string {
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
  return str.replace(/\n/g, " ");
}

/**
 * 执行一组 tool calls，返回 tool results。
 * @param app Obsidian App 实例
 * @param toolCalls 模型返回的 tool_calls
 * @param settings 可选，插件设置（用于读取搜索限制参数）
 */
export async function executeToolCalls(
  app: App,
  toolCalls: { id: string; function: { name: string; arguments: string } }[],
  settings?: AiNoteAgentSettings
): Promise<{ toolCallId: string; name: string; content: string }[]> {
  const handlers = createVaultToolHandlers(app, settings);
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

/** 解析属性白名单：按换行 / 逗号 / 中文逗号拆分，去空并转小写。空数组表示索引全部。 */
function parseKeyWhitelist(raw: string): string[] {
  return raw
    .split(/[\n,，]/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}
