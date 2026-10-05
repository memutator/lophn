import { assert, assertEquals } from "@std/assert";
import { act, createRef } from "react";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  click,
  one,
  render,
  settle,
  style,
} from "../../../../packages/design/components/testing.ts";

import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from "./markdown-editor.tsx";

const DOC = [
  "---",
  "title: Plan",
  "owner: lophn",
  "---",
  "",
  "# Title",
  "",
  "> quoted",
  "",
  "- [ ] task",
  "",
  "Use `code` here.",
  "",
  "![missing](./local.png)",
].join("\n");

const PROBLEM_DOC = ["# Title", "", "text", "", "more"].join("\n");

function keydown(
  target: Element,
  key: string,
  init: KeyboardEventInit = {},
): void {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  });
}

function content(container: HTMLElement): HTMLElement {
  return one(container, ".cm-content");
}

function viewOf(container: HTMLElement): EditorView {
  const found = EditorView.findFromDOM(one(container, ".cm-editor"));
  if (!found) throw new Error("no editor view");
  return found;
}

Deno.test("shell/editor#R7: CodeMirror 편집기가 shell 안에서 글을 고치고 바꾼 글을 알린다", async () => {
  const changes: string[] = [];
  const handle = createRef<MarkdownEditorHandle>();
  using view = render(
    <MarkdownEditor
      ref={handle}
      initialText="# Title"
      label="notes.md"
      onChange={(text) => changes.push(text)}
    />,
  );
  await settle();
  const editable = content(view.container);
  assertEquals(editable.getAttribute("contenteditable"), "true");
  assertEquals(editable.getAttribute("aria-label"), "notes.md");
  const editor = viewOf(view.container);
  act(() =>
    editor.dispatch({
      changes: { from: editor.state.doc.length, insert: " two" },
      userEvent: "input.type",
    })
  );
  assertEquals(changes, ["# Title two"]);
  act(() => handle.current?.revealLine(1));
  assertEquals(editor.state.selection.main.head, 0);
});

Deno.test("shell/editor#R10: 코드는 고정폭·muted 배경이고 인용 막대는 2px, 체크박스는 16px이다", async () => {
  using view = render(<MarkdownEditor initialText={DOC} label="plan.md" />);
  await settle();
  const code = one(view.container, ".cm-lp-code");
  assertEquals(style(code).fontFamily, '"JetBrains Mono", monospace');
  assertEquals(style(code).backgroundColor !== "", true);
  // 문법 강조 token class가 없다.
  assertEquals(view.container.querySelectorAll("[class*='tok-']").length, 0);
  const quote = one(view.container, ".cm-line.cm-lp-quote");
  assertEquals(style(quote).borderLeftWidth, "2px");
  const task = one(view.container, ".cm-lp-task") as HTMLInputElement;
  assertEquals(style(task).width, "16px");
  assertEquals(style(task).height, "16px");
  assertEquals(task.getAttribute("aria-label"), "Check task");
});

Deno.test("shell/editor#R10: 그림 실패는 아이콘과 alt를, frontmatter는 두 열을 보인다", async () => {
  using view = render(<MarkdownEditor initialText={DOC} label="plan.md" />);
  await settle();
  const failed = one(view.container, ".cm-lp-image-failed");
  assert(failed.querySelector("svg"), "image failure draws an icon");
  assertEquals(failed.textContent, "missing");
  const props = one(view.container, ".cm-lp-props");
  assertEquals(
    [...props.querySelectorAll("dt")].map((node) => node.textContent),
    ["title", "owner"],
  );
  assertEquals(
    [...props.querySelectorAll("dd")].map((node) => node.textContent),
    ["Plan", "lophn"],
  );
  const grid = one(props, "dl");
  assertEquals(style(grid).display, "grid");
});

Deno.test("shell/editor#R10: 불러오는 그림 자리는 16:9 skeleton이다", async () => {
  using view = render(
    <MarkdownEditor
      initialText="![cat](https://example.com/cat.png)"
      label="cat.md"
    />,
  );
  await settle();
  const loading = one(view.container, ".cm-lp-image-loading");
  assertEquals(style(loading).aspectRatio, "16 / 9");
});

Deno.test("shell/editor#R11: 형식 문제는 왼쪽 24px 여백에 14px 아이콘과 200px 목록으로 보이고 줄로 간다", async () => {
  using view = render(
    <MarkdownEditor
      initialText={PROBLEM_DOC}
      label="plan.md"
      problems={[
        { line: 3, message: "Broken link", severity: "warning" },
        { line: null, message: "Missing title", severity: "error" },
      ]}
    />,
  );
  await settle();
  const marker = one(view.container, ".cm-lp-problem[aria-label]");
  assertEquals(
    marker.getAttribute("aria-label"),
    "Format problem: Broken link",
  );
  const gutterCell = marker.closest(".cm-gutterElement") as HTMLElement;
  assertEquals(style(gutterCell).width, "24px");
  const icon = one(marker, "svg");
  assertEquals(style(icon).width, "14px");
  const list = one(view.container, "[data-problem-list]");
  assertEquals(style(list).maxHeight, "200px");
  const rows = [...list.querySelectorAll("button")];
  assertEquals(rows.map((row) => row.textContent), [
    "Whole documentMissing title",
    "Line 3Broken link",
  ]);
  assertEquals((rows[0] as HTMLButtonElement).disabled, true);
  click(rows[1]!);
  assertEquals(rows[1]!.getAttribute("data-severity"), "warning");
});

Deno.test("shell/editor#R11: Mod-F는 36px 찾기 줄과 28px 입력을 열고 키보드로 일치를 오간다", async () => {
  using view = render(
    <MarkdownEditor initialText="cat dog cat" label="pets.md" />,
  );
  await settle();
  const editor = one(view.container, "[data-markdown-editor]");
  keydown(editor, "f", { ctrlKey: true });
  await settle();
  const bar = one(view.container, "[data-find-bar]");
  const row = bar.firstElementChild as HTMLElement;
  assertEquals(style(row).height, "36px");
  const input = one(bar, "[data-find-input]") as HTMLInputElement;
  assertEquals(style(input).height, "28px");
  assertEquals(document.activeElement, input);
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, "cat");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
  assertEquals(one(bar, "[data-find-count]").textContent, "1/2");
  keydown(input, "Enter");
  await settle();
  assertEquals(one(bar, "[data-find-count]").textContent, "2/2");
  keydown(input, "Enter", { shiftKey: true });
  await settle();
  assertEquals(one(bar, "[data-find-count]").textContent, "1/2");
  assertEquals(view.container.querySelectorAll(".cm-lp-match").length, 2);
  keydown(input, "Escape");
  await settle();
  assertEquals(view.container.querySelector("[data-find-bar]"), null);
});

Deno.test("shell/editor#R11: Mod-Alt-F는 바꾸기 줄을 함께 연다", async () => {
  using view = render(<MarkdownEditor initialText="a a" label="a.md" />);
  await settle();
  keydown(one(view.container, "[data-markdown-editor]"), "f", {
    ctrlKey: true,
    altKey: true,
    code: "KeyF",
  });
  await settle();
  assert(view.container.querySelector("[data-replace-row]"));
  const buttons = [
    ...one(view.container, "[data-replace-row]").querySelectorAll("button"),
  ].map((button) => button.getAttribute("aria-label"));
  assertEquals(buttons, ["Replace", "Replace all"]);
});

Deno.test("shell/editor#R11: `[[`는 320px popover에 32px 행으로 문서를 보이고 화살표·Enter로 링크를 넣는다", async () => {
  const targets = [
    { address: "lophn/plan", title: "Plan", name: "plan" },
    { address: "lophn/notes", title: "Notes", name: "notes" },
  ];
  using view = render(
    <MarkdownEditor initialText="See " label="a.md" linkTargets={targets} />,
  );
  await settle();
  const editor = viewOf(view.container);
  act(() =>
    editor.dispatch({
      changes: { from: 4, insert: "[[" },
      selection: EditorSelection.cursor(6),
    })
  );
  await settle();
  const picker = one(view.container, "[data-link-picker]");
  assertEquals(style(picker).width, "320px");
  const rows = [...picker.querySelectorAll("[data-link-row]")];
  assertEquals(rows.length, 2);
  assertEquals(style(rows[0]!).minHeight, "32px");
  assertEquals(
    one(picker, "[role=listbox]").getAttribute("aria-label"),
    "Link to a document",
  );
  const host = one(view.container, "[data-markdown-editor]");
  keydown(host, "ArrowDown");
  await settle();
  assertEquals(
    one(view.container, "[data-link-picker] [data-active]").getAttribute(
      "data-link-row",
    ),
    "lophn/notes",
  );
  keydown(host, "Enter");
  await settle();
  assertEquals(editor.state.doc.toString(), "See [Notes](lophn/notes)");
  assertEquals(view.container.querySelector("[data-link-picker]"), null);
});

Deno.test("shell/editor#R11: Escape는 링크 고르기를 먼저 닫는다", async () => {
  using view = render(
    <MarkdownEditor
      initialText=""
      label="a.md"
      linkTargets={[{ address: "lophn/plan", title: "Plan", name: "plan" }]}
    />,
  );
  await settle();
  const editor = viewOf(view.container);
  act(() =>
    editor.dispatch({
      changes: { from: 0, insert: "[[pl" },
      selection: EditorSelection.cursor(4),
    })
  );
  await settle();
  assert(view.container.querySelector("[data-link-picker]"));
  keydown(one(view.container, "[data-markdown-editor]"), "Escape");
  await settle();
  assertEquals(view.container.querySelector("[data-link-picker]"), null);
});
