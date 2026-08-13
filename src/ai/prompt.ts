import { ChatMessage } from "./provider";

const SYSTEM_JSON =
  "You are a knowledge-base assistant for Obsidian. You reply with valid JSON only, no prose, no markdown fences.";

/**
 * 构造统一的 system prompt，并把用户在设置中填写的「自定义指令」注入其中。
 * 若 customInstructions 为空，则原样返回 base（无注入）。
 * @param customInstructions 用户自定义指令（可为空）
 * @param base 基础系统提示词；不传则使用通用助手提示
 */
export function buildSystemPrompt(
  customInstructions?: string,
  base?: string
): string {
  const basePrompt =
    base && base.trim()
      ? base.trim()
      : "You are a helpful AI assistant embedded in Obsidian.";
  const ci = (customInstructions || "").trim();
  if (!ci) return basePrompt;
  return `${basePrompt}\n\n--- User custom instructions ---\n${ci}`;
}

export function buildOptimizePrompt(
  content: string,
  linkFormat?: "wikilink" | "markdown"
): ChatMessage[] {
  const linkRule =
    linkFormat === "markdown"
      ? " Use standard Markdown links `[text](path.md)` for internal links; do NOT use Wikilinks [[...]]."
      : linkFormat === "wikilink"
      ? " Use Obsidian Wikilinks [[...]] for internal links."
      : "";
  const sys =
    "You are an expert editor. Improve the note while preserving its meaning and facts." +
    linkRule +
    " Reply with the full improved Markdown only, no commentary, no markdown fences.";
  const user = `Polish wording, fix structure, and improve clarity.\n${content}`;
  return [
    { role: "system", content: sys },
    { role: "user", content: user },
  ];
}

export function buildAutopromptPrompt(before: string, after: string): ChatMessage[] {
  const sys =
    "You are an inline writing assistant. Continue the text naturally from the cursor. Reply with ONLY the continuation text, no quotes, no commentary, no markdown fences.";
  const user = `TEXT BEFORE CURSOR:\n${before.slice(-2000)}\n\nTEXT AFTER CURSOR:\n${after.slice(0, 500)}\n\nContinue the text at the cursor position:`;
  return [
    { role: "system", content: sys },
    { role: "user", content: user },
  ];
}

export function parseJsonFromLLM<T>(text: string): T | null {
  if (!text) return null;
  let t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(t);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
