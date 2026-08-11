import { Notice } from "obsidian";
import { TFile } from "obsidian";
import type AiNoteAgentPlugin from "../main";
import { t } from "../i18n";
import {
  buildRelationsPrompt,
  parseJsonFromLLM,
  type CandidateNote,
} from "../ai/prompt";
import { basename, formatLink } from "../utils/note";
import { upsertRelatedSection } from "./linker";
import { enrichNote } from "../properties/enrich";

interface RelationResult {
  index: number;
  reason: string;
}
interface RelationsResponse {
  related: RelationResult[];
}

/** Cap candidate list size so the prompt stays within token limits. */
const MAX_CANDIDATES = 60;

export function getCandidateNotes(
  plugin: AiNoteAgentPlugin,
  exclude: TFile
): CandidateNote[] {
  return plugin.app.vault
    .getMarkdownFiles()
    .filter((f) => f.path !== exclude.path)
    .map((f) => ({ path: f.path, title: basename(f.path) }))
    .slice(0, MAX_CANDIDATES);
}

export async function analyzeNote(
  plugin: AiNoteAgentPlugin,
  file: TFile
): Promise<void> {
  const provider = plugin.getProvider();
  const content = await plugin.app.vault.read(file);
  const title = basename(file.path);

  if (plugin.settings.autoLink) {
    const candidates = getCandidateNotes(plugin, file);
    const prompt = buildRelationsPrompt(
      title,
      content,
      candidates,
      plugin.settings.relatedPerNote
    );
    const raw = await provider.complete(prompt, {
      temperature: plugin.settings.temperature,
      maxTokens: plugin.settings.maxTokens,
    });
    const parsed = parseJsonFromLLM<RelationsResponse>(raw);
    if (parsed?.related?.length) {
      const links: string[] = [];
      const backlinks: { target: TFile; link: string }[] = [];
      for (const r of parsed.related) {
        const c = candidates[r.index - 1];
        if (!c) continue;
        const target = plugin.app.vault.getAbstractFileByPath(c.path);
        if (!(target instanceof TFile)) continue;
        links.push(formatLink(file.path, c.path, plugin.settings.linkStyle));
        backlinks.push({
          target,
          link: formatLink(c.path, file.path, plugin.settings.linkStyle),
        });
      }
      if (links.length) {
        await upsertRelatedSection(plugin, file, links);
        for (const b of backlinks) {
          await upsertRelatedSection(plugin, b.target, [b.link]);
        }
      }
    }
  }

  if (plugin.settings.enrichProperties) {
    await enrichNote(plugin, file, content);
  }
}

export async function analyzeVault(
  plugin: AiNoteAgentPlugin,
  files: TFile[]
): Promise<void> {
  let done = 0;
  const notice = new Notice(t("analyzer.analyzingVault"), 0);
  try {
    for (const file of files) {
      await analyzeNote(plugin, file);
      done++;
      notice.setMessage(
        t("analyzer.progress", { done, total: files.length })
      );
    }
    notice.hide();
    new Notice(t("analyzer.finished", { count: done }));
  } catch (e) {
    notice.hide();
    new Notice(t("analyzer.stopped", { error: (e as Error).message }));
    throw e;
  }
}
