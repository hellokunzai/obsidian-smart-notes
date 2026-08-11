import { requestUrl } from "obsidian";
import { AIProvider, ChatMessage, CompletionOptions } from "./provider";
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
    const resp = await requestUrl({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: opts?.temperature ?? 0.3,
        max_tokens: opts?.maxTokens ?? 1024,
        stream: false,
      }),
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
}
