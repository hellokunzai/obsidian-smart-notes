import type AiNoteAgentPlugin from "../main";
import { buildOptimizePrompt } from "../ai/prompt";
import { getActiveModelLink, resolveLinkParams } from "../ai/provider";

export async function optimizeNote(
  plugin: AiNoteAgentPlugin,
  content: string,
  linkFormat?: "wikilink" | "markdown",
  linkType?: "shortest" | "relative" | "absolute"
): Promise<string> {
  const provider = plugin.getProvider();
  const activeLink = getActiveModelLink(plugin.settings);
  const params = resolveLinkParams(activeLink, plugin.settings);
  // 优化笔记通常需要较长输出：无限制（0）保持无限制，否则至少保证 2048。
  const maxTokens =
    params.maxTokens === 0 ? 0 : Math.max(params.maxTokens, 2048);
  const raw = await provider.complete(
    buildOptimizePrompt(content, linkFormat, linkType),
    {
      temperature: params.temperature,
      maxTokens,
    }
  );
  return raw.trim();
}
