import { OpenAIProvider } from "./openai";
import { OllamaProvider } from "./ollama";
import type { AiNoteAgentSettings, ModelLink } from "../settings";
import { t } from "../i18n";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionOptions {
  temperature?: number;
  maxTokens?: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface StreamChunk {
  content: string;
  done: boolean;
}

export interface CompletionResult {
  content: string;
  usage?: TokenUsage;
}

export interface AIProvider {
  id: string;
  complete(messages: ChatMessage[], opts?: CompletionOptions): Promise<string>;
  stream(
    messages: ChatMessage[],
    opts: CompletionOptions,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<CompletionResult>;
}

/** 返回当前生效的模型链接：优先 defaultModelLinkId，否则列表第一个。 */
export function getActiveModelLink(
  settings: AiNoteAgentSettings
): ModelLink | undefined {
  if (settings.modelLinks.length === 0) return undefined;
  return (
    settings.modelLinks.find((l) => l.id === settings.defaultModelLinkId) ??
    settings.modelLinks[0]
  );
}

/**
 * 解析单条模型链接的有效参数（maxTokens / temperature）。
 * 链接自身有值则优先使用，否则 fallback 到全局设置。
 */
export function resolveLinkParams(
  link: ModelLink,
  settings: AiNoteAgentSettings
): { maxTokens: number; temperature: number } {
  return {
    maxTokens: link.maxTokens ?? settings.maxTokens,
    temperature: link.temperature ?? settings.temperature,
  };
}

/** 由单条模型链接构造 provider（运行时使用其第一个模型）。 */
export function createProviderFromLink(link: ModelLink): AIProvider {
  if (link.type === "ollama") {
    return new OllamaProvider(link.baseUrl, link.models[0] ?? "");
  }
  return new OpenAIProvider(link.baseUrl, link.apiKey, link.models[0] ?? "");
}

/** 占位 provider：尚未配置任何链接时返回，调用即报错并提示去设置。 */
class NoopProvider implements AIProvider {
  id = "noop";
  async complete(): Promise<string> {
    throw new Error(t("error.noModelLink"));
  }
  async stream(): Promise<CompletionResult> {
    throw new Error(t("error.noModelLink"));
  }
}

export function createProvider(settings: AiNoteAgentSettings): AIProvider {
  const link = getActiveModelLink(settings);
  if (!link) {
    return new NoopProvider();
  }
  return createProviderFromLink(link);
}
