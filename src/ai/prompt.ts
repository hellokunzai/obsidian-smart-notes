import { ChatMessage } from "./provider";

const SYSTEM_JSON =
  "You are a knowledge-base assistant for Obsidian. You reply with valid JSON only, no prose, no markdown fences.";

export interface CandidateNote {
  path: string;
  title: string;
}

export function buildRelationsPrompt(
  title: string,
  content: string,
  candidates: CandidateNote[],
  limit: number
): ChatMessage[] {
  const candList = candidates
    .map((c, i) => `${i + 1}. path=${c.path} | title=${c.title}`)
    .join("\n");
  const user = `Given the note below, find up to ${limit} related notes from the candidate list.
Return JSON only: {"related":[{"index":<number>,"reason":"<short reason>"}]}

NOTE TITLE: ${title}
NOTE CONTENT:
${content.slice(0, 6000)}

CANDIDATE NOTES:
${candList || "(none)"}`;
  return [
    { role: "system", content: SYSTEM_JSON },
    { role: "user", content: user },
  ];
}

export function buildPropertiesPrompt(content: string): ChatMessage[] {
  const user = `Analyze the note and suggest metadata. Return JSON only:
{"tags":["lowercase","kebab-case","topics"],"aliases":["alternate name"],"summary":"one sentence summary","category":"optional short category"}
Rules: tags lowercase kebab-case, 3-6 tags; summary <= 120 chars; preserve facts; do not invent sensitive data.

NOTE CONTENT:
${content.slice(0, 6000)}`;
  return [
    { role: "system", content: SYSTEM_JSON },
    { role: "user", content: user },
  ];
}

export function buildOptimizePrompt(
  content: string,
  instruction?: string
): ChatMessage[] {
  const sys =
    "You are an expert editor. Improve the note while preserving its meaning and facts. Reply with the full improved Markdown only, no commentary, no markdown fences.";
  const user = `${instruction ? instruction + "\n" : "Polish wording, fix structure, and improve clarity.\n"}${content}`;
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
