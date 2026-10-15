// 검색 결과로 열린 줄을 잠깐 칠하는 CodeMirror 확장. 줄을 가운데로 scroll하고 커서를 둔다.
import { EditorSelection, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

/** 줄이 칠해져 있는 시간. */
export const FLASH_MS = 2000;

const flash = StateEffect.define<number | null>();

const hitLine = Decoration.line({ class: "cm-hit-line" });

/** `cm-hit-line` class를 단 줄 하나. 글이 바뀌면 사라진다. */
export const lineFlash = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    if (transaction.docChanged) value = Decoration.none;
    for (const effect of transaction.effects) {
      if (effect.is(flash)) {
        value = effect.value === null
          ? Decoration.none
          : Decoration.set([hitLine.range(effect.value)]);
      }
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** n번째 줄(1부터)로 scroll하고 커서를 두고 잠깐 칠한다. */
export function revealLine(view: EditorView, line: number): void {
  const target = view.state.doc.line(
    Math.min(Math.max(1, line), view.state.doc.lines),
  );
  view.dispatch({
    selection: EditorSelection.cursor(target.from),
    effects: [
      EditorView.scrollIntoView(target.from, { y: "center" }),
      flash.of(target.from),
    ],
  });
  view.focus();
  setTimeout(() => {
    if (view.dom.isConnected) view.dispatch({ effects: flash.of(null) });
  }, FLASH_MS);
}
