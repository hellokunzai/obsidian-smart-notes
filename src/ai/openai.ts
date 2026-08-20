import { requestUrl } from "obsidian";
import {
  AIProvider,
  ChatMessage,
  CompletionOptions,
  CompletionResult,
  StreamChunk,
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

export class OpenAIProvider implements AIProvider {
  id = "openai";

  constructor(
    private baseUrl: string,
    private apiKey: string,
    private model: string
  ) {}

  async complete(messages: ChatMessage[], opts?: CompletionOptions): Promise<string> {
    if (!this.apiKey) {
      throw new Error(t("error.noApiKey"));
    }
    const url = this.baseUrl.replace(/\/+$/, "") + "/chat/completions";
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: opts?.temperature ?? 0.3,
      stream: false,
    };
    if (opts?.maxTokens) {
      body.max_tokens = opts.maxTokens;
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
    const json = resp.json;
    return json?.choices?.[0]?.message?.content?.trim() ?? "";
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
      const content = await this.complete(messages, opts);
      return { content };
    }

    const url = this.baseUrl.replace(/\/+$/, "") + "/chat/completions";
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: opts?.temperature ?? 0.3,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (opts?.maxTokens) {
      body.max_tokens = opts.maxTokens;
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
