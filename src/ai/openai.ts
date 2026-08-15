import { requestUrl } from "obsidian";
import {
  AIProvider,
  ChatMessage,
  CompletionOptions,
  CompletionResult,
  StreamChunk,
  TokenUsage,
} from "./provider";
import { t } from "../i18n";

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
    if (typeof fetch === "undefined") {
      // 当前环境不支持 fetch 流式读取，回退到普通请求
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

    const reader = resp.body.getReader();
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
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") continue;
          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta ?? {};
            // 推理模型（DeepSeek-R1）用 reasoning_content，OpenAI o 系列用 reasoning
            const reasoning =
              delta.reasoning_content ?? (delta as Record<string, unknown>).reasoning;
            const content = delta.content;
            if (typeof reasoning === "string" && reasoning.length > 0) {
              fullReasoning += reasoning;
              onChunk({ reasoning, done: false });
            }
            if (typeof content === "string" && content.length > 0) {
              fullContent += content;
              onChunk({ content, done: false });
            }
            if (json.usage) {
              usage = {
                promptTokens: json.usage.prompt_tokens ?? 0,
                completionTokens: json.usage.completion_tokens ?? 0,
                totalTokens: json.usage.total_tokens ?? 0,
              };
            }
          } catch {
            // 忽略无法解析的 SSE 片段
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return { content: fullContent, reasoning: fullReasoning || undefined, usage };
  }
}
