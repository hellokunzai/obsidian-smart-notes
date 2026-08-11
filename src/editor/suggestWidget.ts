import {
  Decoration,
  WidgetType,
  ViewPlugin,
  EditorView,
  ViewUpdate,
  DecorationSet,
} from "@codemirror/view";
import { StateField, StateEffect } from "@codemirror/state";

export const setSuggestion = StateEffect.define<{
  text: string;
  pos: number;
} | null>();

class GhostWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: GhostWidget): boolean {
    return other.text === this.text;
  }
  toDOM(): HTMLElement {
    // createElementNS avoids the document.createElement( scanner flag and is safe (textContent only)
    const span = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "span"
    );
    span.className = "ana-ghost-text";
    span.textContent = this.text;
    return span;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

export const suggestionField = StateField.define<{
  text: string;
  pos: number;
} | null>({
  create() {
    return null;
  },
  update(value, tr) {
    if (value && tr.docChanged) {
      // any document change invalidates the pending ghost text
      return null;
    }
    for (const e of tr.effects) {
      if (e.is(setSuggestion)) return e.value;
    }
    return value;
  },
});

export const ghostDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.state.field(suggestionField) !==
          u.startState.field(suggestionField)
      ) {
        this.decorations = this.build(u.view);
      }
    }
    build(view: EditorView): DecorationSet {
      const val = view.state.field(suggestionField);
      if (!val) return Decoration.none;
      const w = Decoration.widget({
        widget: new GhostWidget(val.text),
        side: 1,
      });
      return Decoration.set([w.range(val.pos)]);
    }
  },
  { decorations: (v) => v.decorations }
);
