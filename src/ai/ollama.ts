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
import { readStreamLines, isFetchAvailable, type ParsedLine } from "./stream";
import { t } from "../i18n";

/** 解析 Ollama NDJSON 行：裸 JSON，提取 message.content / thinking / usage。 */
function parseNDJSONLine(line: string): ParsedLine | null {
  if (!line.trim()) return null;
  try {
    const json = JSON.parse(line);
    const msg = json.message ?? {};
    // Ollama 本地推理模型（qwq / deepseek-r1 蒸馏等）用 thinking 字段，
    // 部分兼容实现用 reasoning_content。
    const thinking = msg.thinking ?? msg.reasoning_content;
    const delta = msg.content;
    const result: ParsedLine = {};
    if (typeof thinking === "string" && thinking.length > 0)
      result.reasoning = thinking;
    if (typeof delta === "string" && delta.length > 0)
      result.content = delta;
    if (json.done) {
      let promptTokens = 0;
      let completionTokens = 0;
      let gotUsage = false;
      if (typeof json.prompt_eval_count === "number") {
        promptTokens = json.prompt_eval_count;
        gotUsage = true;
      }
      if (typeof json.eval_count === "number") {
        completionTokens = json.eval_count;
        gotUsage = true;
      }
      if (gotUsage) {
        result.usage = {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        };
      }
    }
    return Object.keys(result).length > 0 ? result : null;
  } catch {
    return null;
  }
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
          arguments: JSON.parse(tc.function.arguments || "{}"),
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
  const j = json as Record<string, unknown>;
  const message = j.message as Record<string, unknown> | undefined;
  const content = (message?.content as string) || "";

  let toolCalls: ToolCall[] | undefined;
  const rawToolCalls = message?.tool_calls;
  if (Array.isArray(rawToolCalls) && rawToolCalls.length > 0) {
    toolCalls = rawToolCalls
      .map((tc: unknown, idx: number) => {
        const t = tc as Record<string, unknown>;
        const fn = t.function as Record<string, unknown> | undefined;
        if (!fn) return null;
        // Ollama 的 arguments 可能是对象，需要序列化为 JSON 字符串
        const args = fn.arguments;
        const argsStr =
          typeof args === "string" ? args : JSON.stringify(args ?? {});
        return {
          id: String(t.id ?? `call_ollama_${idx}`),
          type: "function" as const,
          function: {
            name: String(fn.name ?? ""),
            arguments: argsStr,
          },
        };
      })
      .filter((tc): tc is NonNullable<typeof tc> => tc !== null);
  }

  let usage: TokenUsage | undefined;
  const gotPrompt = typeof j.prompt_eval_count === "number";
  const gotComplete = typeof j.eval_count === "number";
  if (gotPrompt || gotComplete) {
    usage = {
      promptTokens: (j.prompt_eval_count as number) ?? 0,
      completionTokens: (j.eval_count as number) ?? 0,
      totalTokens:
        ((j.prompt_eval_count as number) ?? 0) +
        ((j.eval_count as number) ?? 0),
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

    const resp = await fetch(url, {
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
