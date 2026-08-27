/**
 * Tool Calling 类型定义。
 *
 * 采用 OpenAI 兼容的 function calling 格式，同时兼容 Ollama / Claude 等主流接口。
 */

/** 单条工具参数定义（简化版 JSON Schema）。 */
export interface ToolParameterSchema {
  type: string;
  description?: string;
  enum?: string[];
  items?: unknown;
  properties?: Record<string, unknown>;
  required?: string[];
}

/** 工具定义（注册到 Provider）。 */
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, ToolParameterSchema>;
      required?: string[];
    };
  };
}

/** LLM 返回的单条 tool call。 */
export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON 字符串，需 JSON.parse
  };
}

/** 工具执行结果，供重新注入对话。 */
export interface ToolResult {
  toolCallId: string;
  name: string;
  content: string;
}

/** 可执行的工具 Handler 接口。 */
export interface ToolHandler {
  name: string;
  definition: ToolDefinition;
  execute(args: Record<string, unknown>): Promise<string>;
}

/**
 * 把工具执行错误包装成安全字符串，避免 tool 消息内容过长或包含敏感栈 trace。
 */
export function formatToolError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  return `Error: ${msg.slice(0, 500)}`;
}
