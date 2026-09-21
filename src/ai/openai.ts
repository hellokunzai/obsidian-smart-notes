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
import { asNumber, asRecord, asText, parseJson } from "../utils/json";

/** 解析 OpenAI SSE 行：`data: {json}` 格式，提取 delta.content / reasoning_content / usage。 */
function parseSSELine(line: string): ParsedLine | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("data:")) return null;
  const data = trimmed.slice(5).trim();
  if (data === "[DONE]") return null;
  const json = asRecord(parseJson(data));
  const choices = Array.isArray(json.choices) ? json.choices : [];
  const delta = asRecord(asRecord(choices[0]).delta);
  // 推理模型（DeepSeek-R1）用 reasoning_content，OpenAI o 系列用 reasoning
  const reasoning = delta.reasoning_content ?? delta.reasoning;
  const content = delta.content;
  const result: ParsedLine = {};
  if (typeof reasoning === "string" && reasoning.length > 0)
    result.reasoning = reasoning;
  if (typeof content === "string" && content.length > 0)
    result.content = content;
  const usage = json.usage;
  if (usage) {
    const u = asRecord(usage);
    const details = asRecord(u.completion_tokens_details);
    result.usage = {
      promptTokens: asNumber(u.prompt_tokens),
      completionTokens: asNumber(u.completion_tokens),
      totalTokens: asNumber(u.total_tokens),
      reasoningTokens:
        typeof details.reasoning_tokens === "number"
          ? details.reasoning_tokens
          : undefined,
    };
  }
  return Object.keys(result).length > 0 ? result : null;
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
  const j = asRecord(json);
  const choices = Array.isArray(j.choices) ? j.choices : [];
  const message = asRecord(asRecord(choices[0]).message);
  const content = asText(message.content);

  let toolCalls: ToolCall[] | undefined;
  const rawToolCalls = message.tool_calls;
  if (Array.isArray(rawToolCalls) && rawToolCalls.length > 0) {
    toolCalls = rawToolCalls
      .map((tc: unknown): ToolCall | null => {
        const call = asRecord(tc);
        const fn = asRecord(call.function);
        if (Object.keys(fn).length === 0) return null;
        return {
          id: asText(call.id),
          type: "function" as const,
          function: {
            name: asText(fn.name),
            arguments: asText(fn.arguments, "{}"),
          },
        };
      })
      .filter((tc): tc is ToolCall => tc !== null);
  }

  let usage: TokenUsage | undefined;
  const u = j.usage;
  if (u) {
    const record = asRecord(u);
    const details = asRecord(record.completion_tokens_details);
    usage = {
      promptTokens: asNumber(record.prompt_tokens),
      completionTokens: asNumber(record.completion_tokens),
      totalTokens: asNumber(record.total_tokens),
      reasoningTokens:
        typeof details.reasoning_tokens === "number"
          ? details.reasoning_tokens
          : undefined,
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

    const resp = await streamingFetch(url, {
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
