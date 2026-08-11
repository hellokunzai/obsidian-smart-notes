import { requestUrl } from "obsidian";
import { AIProvider, ChatMessage, CompletionOptions } from "./provider";
import { t } from "../i18n";

export class OllamaProvider implements AIProvider {
  id = "ollama";

  constructor(private baseUrl: string, private model: string) {}

  async complete(messages: ChatMessage[], opts?: CompletionOptions): Promise<string> {
    const url = this.baseUrl.replace(/\/+$/, "") + "/api/chat";
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
        options: {
          temperature: opts?.temperature ?? 0.3,
          num_predict: opts?.maxTokens ?? 1024,
        },
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
}
