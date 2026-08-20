import type { CompletionResult, StreamChunk, TokenUsage } from "./provider";

/** 单行解析结果：从 SSE / NDJSON 行中提取的增量字段。 */
export interface ParsedLine {
  content?: string;
  reasoning?: string;
  usage?: TokenUsage;
}

/**
 * 共享的流式读取循环：读取 ReadableStream、按行分发给 parseLine 回调、
 * 累积 content / reasoning 并实时回调 onChunk。
 *
 * OpenAI（SSE `data:` 前缀）与 Ollama（裸 NDJSON）的 reader/decoder 循环完全一致，
 * 仅 JSON 结构不同——差异由 parseLine 回调处理。
 *
 * @param body fetch Response 的 body（ReadableStream）
 * @param onChunk 增量回调，每收到一段 content/reasoning 即调用
 * @param parseLine 行解析回调：接收原始行，返回 ParsedLine 或 null（跳过）
 * @returns 累积的完整结果
 */
export async function readStreamLines(
  body: ReadableStream<Uint8Array>,
  onChunk: (chunk: StreamChunk) => void,
  parseLine: (line: string) => ParsedLine | null
): Promise<CompletionResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let fullContent = "";
  let fullReasoning = "";
  let usage: TokenUsage | undefined;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split("\n")) {
        const parsed = parseLine(line);
        if (!parsed) continue;
        if (parsed.reasoning) {
          fullReasoning += parsed.reasoning;
          onChunk({ reasoning: parsed.reasoning, done: false });
        }
        if (parsed.content) {
          fullContent += parsed.content;
          onChunk({ content: parsed.content, done: false });
        }
        if (parsed.usage) {
          usage = parsed.usage;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { content: fullContent, reasoning: fullReasoning || undefined, usage };
}

/** 检查 fetch 环境是否可用（Obsidian 1.4+ 内置 fetch）。 */
export function isFetchAvailable(): boolean {
  return typeof fetch !== "undefined";
}
