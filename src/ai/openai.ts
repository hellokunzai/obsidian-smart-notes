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

/** 解析 OpenAI SSE 行：`data: {json}` 格式，提取 delta.content / reasoning_content / usage。 */
function parseSSELine(line: string): ParsedLine | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("data:")) return null;
  const data = trimmed.slice(5).trim();
  if (data === "[DONE]") return null;
  try {
    const json = JSON.parse(data);
    const delta = json.choices?.[0]?.delta ?? {};
    // 推理模型（DeepSeek-R1）用 reasoning_content，OpenAI o 系列用 reasoning
    const reasoning =
      delta.reasoning_content ?? (delta as Record<string, unknown>).reasoning;
    const content = delta.content;
    const result: ParsedLine = {};
    if (typeof reasoning === "string" && reasoning.length > 0)
      result.reasoning = reasoning;
    if (typeof content === "string" && content.length > 0)
      result.content = content;
    if (json.usage) {
      const details =
        (json.usage as Record<string, unknown>).completion_tokens_details as
          | Record<string, unknown>
          | undefined;
      result.usage = {
        promptTokens: json.usage.prompt_tokens ?? 0,
        completionTokens: json.usage.completion_tokens ?? 0,
        totalTokens: json.usage.total_tokens ?? 0,
        reasoningTokens:
          (details?.reasoning_tokens as number | undefined) ?? undefined,
      };
    }
    return Object.keys(result).length > 0 ? result : null;
  } catch {
    return null;
  }
}

/**
 * 把内部 ChatMessage 转换为 OpenAI API 格式。
 * tool / tool_calls 需要特殊字段映射。
 */
function toOpenAIMessages(messages: ChatMessage[]): unknown[] {
  return messages.map((m) => {
    const base: Record<string, unknown> = {
      role: m.role,
      content: m.content,
    };
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      base.tool_calls = m.toolCalls.map((tc) => ({
        id: tc.id,
        type: tc.type,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      }));
    }
    if (m.role === "tool" && m.toolCallId) {
      base.tool_call_id = m.toolCallId;
    }
    return base;
  });
}

/**
 * 从非流式 OpenAI 响应中解析 CompletionResult（含可能的 tool_calls）。
 */
function parseCompletionResponse(json: unknown): CompletionResult {
  const j = json as Record<string, unknown>;
  const choices = Array.isArray(j.choices) ? j.choices : [];
  const message = (choices[0] as Record<string, unknown> | undefined)
    ?.message as Record<string, unknown> | undefined;
  const content = (message?.content as string) || "";

  let toolCalls: ToolCall[] | undefined;
  const rawToolCalls = message?.tool_calls;
  if (Array.isArray(rawToolCalls) && rawToolCalls.length > 0) {
    toolCalls = rawToolCalls
      .map((tc: unknown) => {
        const t = tc as Record<string, unknown>;
        const fn = t.function as Record<string, unknown> | undefined;
        if (!fn) return null;
        return {
          id: String(t.id ?? ""),
          type: "function" as const,
          function: {
            name: String(fn.name ?? ""),
            arguments: String(fn.arguments ?? "{}"),
          },
        };
      })
      .filter((tc): tc is NonNullable<typeof tc> => tc !== null);
  }

  let usage: TokenUsage | undefined;
  const u = j.usage as Record<string, unknown> | undefined;
  if (u) {
    const details =
      u.completion_tokens_details as Record<string, unknown> | undefined;
    usage = {
      promptTokens: (u.prompt_tokens as number) ?? 0,
      completionTokens: (u.completion_tokens as number) ?? 0,
      totalTokens: (u.total_tokens as number) ?? 0,
      reasoningTokens: (details?.reasoning_tokens as number) ?? undefined,
    };
  }

  return { content: content.trim(), usage, toolCalls };
}

export class OpenAIProvider implements AIProvider {
  id = "openai";

  constructor(
    private baseUrl: string,
    private apiKey: string,
    private model: string
  ) {}

  async complete(
    messages: ChatMessage[],
    opts?: CompletionOptions
  ): Promise<CompletionResult> {
    if (!this.apiKey) {
      throw new Error(t("error.noApiKey"));
    }
    const url = this.baseUrl.replace(/\/+$/, "") + "/chat/completions";
    const body: Record<string, unknown> = {
      model: this.model,
      messages: toOpenAIMessages(messages),
      temperature: opts?.temperature ?? 0.3,
      stream: false,
    };
    if (opts?.maxTokens) {
      body.max_tokens = opts.maxTokens;
    }
    if (opts?.tools && opts.tools.length > 0) {
      body.tools = opts.tools;
    }

    const resp = await requestUrl({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (resp.status !== 200) {
      throw new Error(
        t("error.openaiFailed", {
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
    if (!this.apiKey) {
      throw new Error(t("error.noApiKey"));
    }
    if (!isFetchAvailable()) {
      return this.complete(messages, opts);
    }

    const url = this.baseUrl.replace(/\/+$/, "") + "/chat/completions";
    const body: Record<string, unknown> = {
      model: this.model,
      messages: toOpenAIMessages(messages),
      temperature: opts?.temperature ?? 0.3,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (opts?.maxTokens) {
      body.max_tokens = opts.maxTokens;
    }
    if (opts?.tools && opts.tools.length > 0) {
      body.tools = opts.tools;
    }

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(
        t("error.openaiFailed", {
          status: resp.status,
          text: text.slice(0, 300),
        })
      );
    }

    if (!resp.body) {
      throw new Error(t("error.streamingNotSupported"));
    }

    return readStreamLines(resp.body, onChunk, parseSSELine);
  }
}
