import { requestUrl } from "obsidian";
import {
  AIProvider,
  ChatMessage,
  CompletionOptions,
  CompletionResult,
  StreamChunk,
  type TokenUsage,
  type ToolCall,
} from "./provider";
import {
  readStreamLines,
  isFetchAvailable,
  streamingFetch,
  type ParsedLine,
} from "./stream";
import { t } from "../i18n";
import { asNumber, asRecord, asText, parseJson, parseJsonOrThrow } from "../utils/json";

/** 解析 Ollama NDJSON 行：裸 JSON，提取 message.content / thinking / usage。 */
function parseNDJSONLine(line: string): ParsedLine | null {
  if (!line.trim()) return null;
  const json = asRecord(parseJson(line));
  const msg = asRecord(json.message);
  // Ollama 本地推理模型（qwq / deepseek-r1 蒸馏等）用 thinking 字段，
  // 部分兼容实现用 reasoning_content。
  const thinking = msg.thinking ?? msg.reasoning_content;
  const delta = msg.content;
  const result: ParsedLine = {};
  if (typeof thinking === "string" && thinking.length > 0)
    result.reasoning = thinking;
  if (typeof delta === "string" && delta.length > 0) result.content = delta;
  if (json.done) {
    const rawPrompt = json.prompt_eval_count;
    const rawCompletion = json.eval_count;
    const gotUsage =
      typeof rawPrompt === "number" || typeof rawCompletion === "number";
    if (gotUsage) {
      const promptTokens = asNumber(rawPrompt);
      const completionTokens = asNumber(rawCompletion);
      result.usage = {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      };
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

/**
 * 把内部 ChatMessage 转换为 Ollama /api/chat 格式。
 */
function toOllamaMessages(messages: ChatMessage[]): unknown[] {
  return messages.map((m) => {
    const base: Record<string, unknown> = {
      role: m.role,
      content: m.content,
    };
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      base.tool_calls = m.toolCalls.map((tc) => ({
        function: {
          name: tc.function.name,
          arguments: parseJsonOrThrow(tc.function.arguments || "{}"),
        },
      }));
    }
    if (m.role === "tool" && m.toolCallId) {
      // Ollama 的工具结果消息格式比较特殊，通常直接作为 user/assistant 消息传递
      // 这里保留 tool_call_id 供后续处理
      base.tool_call_id = m.toolCallId;
    }
    return base;
  });
}

/**
 * 从 Ollama 非流式响应中解析 CompletionResult（含可能的 tool_calls）。
 */
function parseCompletionResponse(json: unknown): CompletionResult {
  const j = asRecord(json);
  const message = asRecord(j.message);
  const content = asText(message.content);

  let toolCalls: ToolCall[] | undefined;
  const rawToolCalls = message.tool_calls;
  if (Array.isArray(rawToolCalls) && rawToolCalls.length > 0) {
    toolCalls = rawToolCalls
      .map((tc: unknown, idx: number): ToolCall | null => {
        const call = asRecord(tc);
        const fn = asRecord(call.function);
        if (Object.keys(fn).length === 0) return null;
        // Ollama 的 arguments 可能是对象，需要序列化为 JSON 字符串
        const args = fn.arguments;
        const argsStr =
          typeof args === "string" ? args : JSON.stringify(args ?? {});
        return {
          id: asText(call.id) || `call_ollama_${idx}`,
          type: "function" as const,
          function: {
            name: asText(fn.name),
            arguments: argsStr,
          },
        };
      })
      .filter((tc): tc is ToolCall => tc !== null);
  }

  let usage: TokenUsage | undefined;
  const rawPrompt = j.prompt_eval_count;
  const rawCompletion = j.eval_count;
  if (typeof rawPrompt === "number" || typeof rawCompletion === "number") {
    const promptTokens = asNumber(rawPrompt);
    const completionTokens = asNumber(rawCompletion);
    usage = {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    };
  }

  return { content: content.trim(), usage, toolCalls };
}

export class OllamaProvider implements AIProvider {
  id = "ollama";

  constructor(private baseUrl: string, private model: string) {}

  async complete(
    messages: ChatMessage[],
    opts?: CompletionOptions
  ): Promise<CompletionResult> {
    const url = this.baseUrl.replace(/\/+$/, "") + "/api/chat";
    const options: Record<string, unknown> = {
      temperature: opts?.temperature ?? 0.3,
    };
    if (opts?.maxTokens) {
      options.num_predict = opts.maxTokens;
    }

    const body: Record<string, unknown> = {
      model: this.model,
      messages: toOllamaMessages(messages),
      stream: false,
      options,
    };
    if (opts?.tools && opts.tools.length > 0) {
      body.tools = opts.tools;
    }

    const resp = await requestUrl({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (resp.status !== 200) {
      throw new Error(
        t("error.ollamaFailed", {
          status: resp.status,
          text: resp.text.slice(0, 300),
        })
      );
    }
    return parseCompletionResponse(resp.json);
  }

  async stream(
    messages: ChatMessage[],
    opts: CompletionOptions,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<CompletionResult> {
    if (!isFetchAvailable()) {
      return this.complete(messages, opts);
    }

    const url = this.baseUrl.replace(/\/+$/, "") + "/api/chat";
    const options: Record<string, unknown> = {
      temperature: opts?.temperature ?? 0.3,
    };
    if (opts?.maxTokens) {
      options.num_predict = opts.maxTokens;
    }

    const body: Record<string, unknown> = {
      model: this.model,
      messages: toOllamaMessages(messages),
      stream: true,
      options,
    };
    if (opts?.tools && opts.tools.length > 0) {
      body.tools = opts.tools;
    }

    const resp = await streamingFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(
        t("error.ollamaFailed", {
          status: resp.status,
          text: text.slice(0, 300),
        })
      );
    }

    if (!resp.body) {
      throw new Error(t("error.streamingNotSupported"));
    }

    return readStreamLines(resp.body, onChunk, parseNDJSONLine);
  }
}
