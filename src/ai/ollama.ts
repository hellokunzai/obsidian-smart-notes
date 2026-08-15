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

export class OllamaProvider implements AIProvider {
  id = "ollama";

  constructor(private baseUrl: string, private model: string) {}

  async complete(messages: ChatMessage[], opts?: CompletionOptions): Promise<string> {
    const url = this.baseUrl.replace(/\/+$/, "") + "/api/chat";
    const options: Record<string, unknown> = {
      temperature: opts?.temperature ?? 0.3,
    };
    if (opts?.maxTokens) {
      options.num_predict = opts.maxTokens;
    }

    const resp = await requestUrl({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
        options,
      }),
    });
    if (resp.status !== 200) {
      throw new Error(
        t("error.ollamaFailed", {
          status: resp.status,
          text: resp.text.slice(0, 300),
        })
      );
    }
    return resp.json?.message?.content?.trim() ?? "";
  }

  async stream(
    messages: ChatMessage[],
    opts: CompletionOptions,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<CompletionResult> {
    if (typeof fetch === "undefined") {
      // 当前环境不支持 fetch 流式读取，回退到普通请求
      const content = await this.complete(messages, opts);
      return { content };
    }

    const url = this.baseUrl.replace(/\/+$/, "") + "/api/chat";
    const options: Record<string, unknown> = {
      temperature: opts?.temperature ?? 0.3,
    };
    if (opts?.maxTokens) {
      options.num_predict = opts.maxTokens;
    }

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: true,
        options,
      }),
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

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = "";
    let promptTokens = 0;
    let completionTokens = 0;
    let gotUsage = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (!line.trim()) continue;
          try {
            const json = JSON.parse(line);
            const delta = json.message?.content;
            if (typeof delta === "string") {
              fullContent += delta;
              onChunk({ content: delta, done: false });
            }
            if (json.done) {
              if (typeof json.prompt_eval_count === "number") {
                promptTokens = json.prompt_eval_count;
                gotUsage = true;
              }
              if (typeof json.eval_count === "number") {
                completionTokens = json.eval_count;
                gotUsage = true;
              }
            }
          } catch {
            // 忽略无法解析的 NDJSON 片段
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const usage: TokenUsage | undefined = gotUsage
      ? {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        }
      : undefined;

    return { content: fullContent, usage };
  }
}
