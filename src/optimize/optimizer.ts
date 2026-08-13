import type AiNoteAgentPlugin from "../main";
import { buildOptimizePrompt } from "../ai/prompt";

export async function optimizeNote(
  plugin: AiNoteAgentPlugin,
  content: string,
  linkFormat?: "wikilink" | "markdown",
  linkType?: "shortest" | "relative" | "absolute"
): Promise<string> {
  const provider = plugin.getProvider();
  const raw = await provider.complete(
    buildOptimizePrompt(content, linkFormat, linkType),
    {
      temperature: plugin.settings.temperature,
      maxTokens: Math.max(plugin.settings.maxTokens, 2048),
    }
  );
  return raw.trim();
}
