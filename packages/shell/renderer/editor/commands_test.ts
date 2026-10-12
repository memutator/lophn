import { assertEquals } from "@std/assert";
import {
  EditorSelection,
  EditorState,
  type StateCommand,
} from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";

import {
  continueList,
  indentList,
  insertLink,
  listPrefix,
  outdentList,
  setHeading,
  toggleMark,
  toggleTask,
} from "./commands.ts";

function run(
  command: StateCommand,
  doc: string,
  from: number,
  to = from,
): { doc: string; from: number; to: number } | null {
  let state = EditorState.create({
    doc,
    selection: EditorSelection.single(from, to),
    extensions: [markdown({ base: markdownLanguage })],
  });
  ensureSyntaxTree(state, state.doc.length, 1000);
  let handled = false;
  command({
    state,
    dispatch: (transaction) => {
      state = transaction.state;
      handled = true;
    },
  });
  if (!handled) return null;
  const range = state.selection.main;
  return { doc: state.doc.toString(), from: range.from, to: range.to };
}

Deno.test("shell/editor#R7: 굵게는 선택을 감싸고 다시 누르면 푼다", () => {
  assertEquals(run(toggleMark("**"), "a word b", 2, 6), {
    doc: "a **word** b",
    from: 4,
    to: 8,
  });
  assertEquals(run(toggleMark("**"), "a **word** b", 4, 8), {
    doc: "a word b",
    from: 2,
    to: 6,
  });
});

Deno.test("shell/editor#R7: 링크 넣기는 괄호 안에 커서를 둔다", () => {
  assertEquals(run(insertLink, "see plan", 4, 8), {
    doc: "see [plan]()",
    from: 11,
    to: 11,
  });
});

Deno.test("shell/editor#R7: 제목 단계를 바꾸고 0이면 보통 글이다", () => {
  assertEquals(run(setHeading(2), "# Title", 3)?.doc, "## Title");
  assertEquals(run(setHeading(0), "## Title", 3)?.doc, "Title");
});

Deno.test("shell/editor#R7: 목록 Enter는 다음 항목을 잇고 빈 항목은 목록을 끝낸다", () => {
  assertEquals(run(continueList, "- one", 5)?.doc, "- one\n- ");
  assertEquals(run(continueList, "1. one", 6)?.doc, "1. one\n2. ");
  assertEquals(run(continueList, "- [x] done", 10)?.doc, "- [x] done\n- [ ] ");
  assertEquals(run(continueList, "- one\n- ", 8)?.doc, "- one\n");
  assertEquals(run(continueList, "plain", 5), null);
});

Deno.test("shell/editor#R7: Tab은 목록만 들이고 Shift-Tab은 내어 쓴다", () => {
  assertEquals(run(indentList, "- one", 3)?.doc, "  - one");
  assertEquals(run(outdentList, "  - one", 5)?.doc, "- one");
  assertEquals(run(indentList, "plain", 2), null);
});

Deno.test("shell/editor#R10: 체크박스 click은 커서 없이 task 표지만 바꾼다", () => {
  const state = EditorState.create({ doc: "- [ ] todo" });
  const spec = toggleTask(state, 0);
  assertEquals(spec?.changes, { from: 3, to: 4, insert: "x" });
  assertEquals(toggleTask(EditorState.create({ doc: "- todo" }), 0), null);
  assertEquals(listPrefix("  1. [x] a")?.task, "[x] ");
});
