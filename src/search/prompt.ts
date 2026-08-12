import type { SearchResult } from "./search";

/**
 * 联网搜索结果的上下文拼接模块。
 *
 * 与 knowledge.ts 的上下文块风格保持一致：用分隔标题包裹，
 * 作为「临时背景知识」注入到当前用户消息之后（不污染 system prompt）。
 */

/**
 * 把搜索结果格式化成上下文块，供拼接到 user message。
 * @param results 搜索结果（已截断）
 * @param showCitations 是否在结尾追加「请用 [n] 标注来源」的指令
 * @returns 拼接后的上下文块字符串；无结果时返回空串
 */
export function buildWebSearchContext(
  results: SearchResult[],
  showCitations: boolean
): string {
  if (!results || results.length === 0) return "";
  const blocks: string[] = [
    "--- Web search results (provided because the user enabled web search for this message) ---",
  ];
  results.forEach((r, i) => {
    blocks.push(
      `[${i + 1}] ${r.title}\nURL: ${r.url}\nContent: ${r.content}`
    );
  });
  if (showCitations) {
    blocks.push(
      "When you use information from the web search results above, cite the source inline using the format [n] (matching the numbered entries). If the results are not relevant, answer normally without citing."
    );
  }
  return blocks.join("\n\n");
}
