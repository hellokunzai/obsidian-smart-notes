import type { TFile } from "obsidian";
import type AiNoteAgentPlugin from "../main";
import { buildPropertiesPrompt, parseJsonFromLLM } from "../ai/prompt";
import { parseFrontmatter, mergeFrontmatter } from "../utils/vault";

interface PropertiesResponse {
  tags?: unknown;
  aliases?: unknown;
  summary?: string;
  category?: string;
}

function uniqueStrings(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  return Array.from(
    new Set(arr.filter((x) => typeof x === "string" && x.trim() !== ""))
  ) as string[];
}

function normalizeTags(v: unknown): string[] {
  if (Array.isArray(v)) return uniqueStrings(v).map((t) => t.toLowerCase());
  if (typeof v === "string")
    return uniqueStrings(v.split(",")).map((t) => t.toLowerCase());
  return [];
}

export async function enrichNote(
  plugin: AiNoteAgentPlugin,
  file: TFile,
  content: string
): Promise<void> {
  const provider = plugin.getProvider();
  const raw = await provider.complete(buildPropertiesPrompt(content), {
    temperature: plugin.settings.temperature,
    maxTokens: plugin.settings.maxTokens,
  });
  const parsed = parseJsonFromLLM<PropertiesResponse>(raw);
  if (!parsed) return;

  const { data } = parseFrontmatter(content);
  const merged: Record<string, unknown> = { ...data };

  const newTags = normalizeTags(parsed.tags);
  if (newTags.length) {
    merged.tags = Array.from(new Set([...normalizeTags(data.tags), ...newTags]));
  }

  const newAliases = uniqueStrings(parsed.aliases);
  if (newAliases.length) {
    merged.aliases = Array.from(
      new Set([...uniqueStrings(data.aliases), ...newAliases])
    );
  }

  if (parsed.summary && typeof parsed.summary === "string") {
    merged.summary = parsed.summary.slice(0, 300);
  }
  if (parsed.category && typeof parsed.category === "string") {
    merged.category = parsed.category.slice(0, 100);
  }

  const newContent = mergeFrontmatter(content, merged);
  if (newContent !== content) {
    await plugin.app.vault.modify(file, newContent);
  }
}
