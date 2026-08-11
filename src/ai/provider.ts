import { OpenAIProvider } from "./openai";
import { OllamaProvider } from "./ollama";
import type { AiNoteAgentSettings } from "../settings";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionOptions {
  temperature?: number;
  maxTokens?: number;
}

export interface AIProvider {
  id: string;
  complete(messages: ChatMessage[], opts?: CompletionOptions): Promise<string>;
}

export function createProvider(settings: AiNoteAgentSettings): AIProvider {
  if (settings.provider === "ollama") {
    return new OllamaProvider(settings.ollamaBaseUrl, settings.ollamaModel);
  }
  return new OpenAIProvider(
    settings.openaiBaseUrl,
    settings.openaiApiKey,
    settings.openaiModel
  );
}
