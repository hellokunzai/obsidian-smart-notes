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
    if (!isFetchAvailable()) {
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

    return readStreamLines(resp.body, onChunk, parseNDJSONLine);
  }
}
