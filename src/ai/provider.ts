import { App } from "obsidian";
import { OpenAIProvider } from "./openai";
import { OllamaProvider } from "./ollama";
import type { AiNoteAgentSettings, ModelLink } from "../settings";
import { resolveModelLinkApiKey } from "../settings";
import { t } from "../i18n";
import type { ToolDefinition, ToolCall } from "./tools";

export type { ToolCall } from "./tools";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** assistant 消息的 tool_calls */
  toolCalls?: ToolCall[];
  /** tool 消息对应的 tool_call_id */
  toolCallId?: string;
}

export interface CompletionOptions {
  temperature?: number;
  maxTokens?: number;
  /** 可用的工具列表；提供时模型可决定调用工具。 */
  tools?: ToolDefinition[];
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** 推理模型（DeepSeek-R1 / o 系列）的思考 token，单独计费，需计入真实消耗。 */
  reasoningTokens?: number;
}

export interface StreamChunk {
  /** 增量正文内容（reasoning chunk 时可能为空）。 */
  content?: string;
  /** 增量推理（思考）内容，仅推理模型（DeepSeek-R1 / o1 等）返回。 */
  reasoning?: string;
  done: boolean;
}

export interface CompletionResult {
  content: string;
  /** 完整推理（思考）内容，仅推理模型返回；普通模型为 undefined。 */
  reasoning?: string;
  usage?: TokenUsage;
  /** 模型决定调用的工具列表（非流式 / 流式结束后汇总）。 */
  toolCalls?: ToolCall[];
}

export interface AIProvider {
  id: string;
  complete(
    messages: ChatMessage[],
    opts?: CompletionOptions
  ): Promise<CompletionResult>;
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
  link: ModelLink | undefined,
  settings: AiNoteAgentSettings
): { maxTokens: number; temperature: number } {
  return {
    // 0 表示不限制，优先于全局默认值；仅当未设置时才回退到全局。
    maxTokens: link?.maxTokens != null ? link.maxTokens : settings.maxTokens,
    temperature: link?.temperature ?? settings.temperature,
  };
}

/** 由单条模型链接构造 provider（运行时使用其第一个模型）。 */
export function createProviderFromLink(
  app: App,
  link: ModelLink
): AIProvider {
  if (link.type === "ollama") {
    return new OllamaProvider(link.baseUrl, link.models[0] ?? "");
  }
  const apiKey = resolveModelLinkApiKey(app, link) ?? "";
  return new OpenAIProvider(link.baseUrl, apiKey, link.models[0] ?? "");
}

/** 占位 provider：尚未配置任何链接时返回，调用即报错并提示去设置。 */
class NoopProvider implements AIProvider {
  id = "noop";
  async complete(): Promise<CompletionResult> {
    throw new Error(t("error.noModelLink"));
  }
  async stream(): Promise<CompletionResult> {
    throw new Error(t("error.noModelLink"));
  }
}

export function createProvider(
  app: App,
  settings: AiNoteAgentSettings
): AIProvider {
  const link = getActiveModelLink(settings);
  if (!link) {
    return new NoopProvider();
  }
  return createProviderFromLink(app, link);
}
