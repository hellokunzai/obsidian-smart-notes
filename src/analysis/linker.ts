import type { TFile } from "obsidian";
import type AiNoteAgentPlugin from "../main";
import { t } from "../i18n";

const MARKER = "<!-- ai-note-agent:related -->";

/**
 * Build the plugin-managed "related notes" section. The heading is resolved at
 * call time (not module load) so it follows the active UI language.
 */
export function buildRelatedSection(links: string[]): string {
  if (!links.length) return "";
  const heading = t("related.heading");
  return `\n\n${heading}\n${MARKER}\n${links
    .map((l) => "- " + l)
    .join("\n")}\n`;
}

/**
 * Idempotently replace the plugin-managed "related notes" section in a file.
 * The section is always appended at the end, so updating = strip old block + re-append.
 */
export async function upsertRelatedSection(
  plugin: AiNoteAgentPlugin,
  file: TFile,
  links: string[]
): Promise<void> {
  if (!links.length) return;
  const content = await plugin.app.vault.read(file);
  const heading = t("related.heading");
  const section = buildRelatedSection(links);
  let newContent: string;
  if (content.includes(MARKER)) {
    const idx = content.indexOf(heading);
    if (idx === -1) {
      // marker present but heading (e.g. from another language) not found;
      // fall back to re-appending the section at the end.
      newContent = content.replace(/\s*$/, "") + section;
    } else {
      newContent = content.slice(0, idx).replace(/\s*$/, "") + section;
    }
  } else {
    newContent = content.replace(/\s*$/, "") + section;
  }
  if (newContent !== content) {
    await plugin.app.vault.modify(file, newContent);
  }
}
