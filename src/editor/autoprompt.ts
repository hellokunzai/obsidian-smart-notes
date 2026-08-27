import { EditorView, ViewPlugin, ViewUpdate, keymap } from "@codemirror/view";
import { Annotation, Prec } from "@codemirror/state";
import { Editor, Notice } from "obsidian";
import type AiNoteAgentPlugin from "../main";
import { buildAutopromptPrompt } from "../ai/prompt";
import { t } from "../i18n";
import {
  suggestionField,
  setSuggestion,
  ghostDecorations,
} from "./suggestWidget";

const acceptAnnotation = Annotation.define<boolean>();

async function requestSuggestion(
  plugin: AiNoteAgentPlugin,
  view: EditorView
): Promise<void> {
  const provider = plugin.getProvider();
  const state = view.state;
  const pos = state.selection.main.head;
  const before = state.doc.sliceString(Math.max(0, pos - 2000), pos);
  const after = state.doc.sliceString(
    pos,
    Math.min(state.doc.length, pos + 500)
  );
  try {
    const raw = (await provider.complete(buildAutopromptPrompt(before, after), {
      temperature: plugin.settings.temperature,
      maxTokens: 256,
    })).content;
    const text = raw.trim();
    if (text && view.state.selection.main.head === pos) {
      view.dispatch({ effects: setSuggestion.of({ text, pos }) });
    }
  } catch {
    // realtime failures are silent by design
  }
}

function acceptSuggestion(view: EditorView): boolean {
  const val = view.state.field(suggestionField);
  if (!val) return false;
  view.dispatch({
    changes: { from: val.pos, insert: val.text },
    effects: setSuggestion.of(null),
    annotations: acceptAnnotation.of(true),
  });
  return true;
}

function clearSuggestion(view: EditorView): boolean {
  if (!view.state.field(suggestionField)) return false;
  view.dispatch({ effects: setSuggestion.of(null) });
  return true;
}

export function createRealtimeExtension(plugin: AiNoteAgentPlugin) {
  const realtimePlugin = ViewPlugin.fromClass(
    class {
      private timer: number | null = null;
      update(u: ViewUpdate) {
        if (!plugin.settings.realtimeEnabled) return;
        if (!u.docChanged) return;
        if (u.transactions.some((t) => t.annotation(acceptAnnotation))) return;
        if (this.timer !== null) clearTimeout(this.timer);
        const view = u.view;
        const debounce = plugin.settings.realtimeDebounceMs;
        this.timer = window.setTimeout(() => {
          void requestSuggestion(plugin, view);
        }, debounce);
      }
      destroy() {
        if (this.timer !== null) clearTimeout(this.timer);
      }
    }
  );

  return [
    suggestionField,
    ghostDecorations,
    realtimePlugin,
    Prec.highest(
      keymap.of([
        { key: "Tab", run: (view) => acceptSuggestion(view) },
        { key: "Escape", run: (view) => clearSuggestion(view) },
      ])
    ),
  ];
}

export async function autopromptAtCursor(
  plugin: AiNoteAgentPlugin,
  editor: Editor
): Promise<void> {
  const provider = plugin.getProvider();
  const pos = editor.getCursor();
  const before = editor.getRange({ line: 0, ch: 0 }, pos);
  const end = editor.offsetToPos(editor.getValue().length);
  const after = editor.getRange(pos, end);
  const raw = (await provider.complete(buildAutopromptPrompt(before, after), {
    temperature: plugin.settings.temperature,
    maxTokens: 512,
  })).content;
  const text = raw.trim();
  if (text) {
    editor.replaceSelection(text);
  } else {
    new Notice(t("notice.noSuggestion"));
  }
}
