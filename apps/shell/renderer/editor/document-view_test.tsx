import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import { EditorView } from "@codemirror/view";
import {
  click,
  one,
  render,
  settle,
  style,
} from "../../../../packages/design/components/testing.ts";

import type {
  EditorFilesApi,
  EditorReply,
  EditorWrite,
  SaveReport,
} from "../../ipc/editor.ts";
import { type DocumentTabMeta, DocumentView } from "./document-view.tsx";
import { EditorSessions } from "./sessions.ts";
import type { MenuChoice, MenuOpener } from "./document-menu.ts";
import { readingWidthStore, type SettingsPort } from "./reading-width.ts";
import type {
  BodyState,
  DocumentInfo,
  EditorSource,
  OutlineSection,
} from "./source.ts";

const NOTES = [
  "# Release notes",
  "",
  "Intro paragraph.",
  "",
  "## Usage",
  "",
  "> quoted",
  "",
  "Use `code` here.",
].join("\n");

function info(id: string, title = "Release notes"): DocumentInfo {
  return {
    id,
    title,
    fileName: `${id}.md`,
    path: `docs/${id}.md`,
    version: `ver_${id}`,
    versionNumber: 3,
    savedAt: Date.parse("2026-10-05T09:00:00Z"),
  };
}

interface FakeSource extends EditorSource {
  readonly reads: string[];
}

function sourceOf(
  options: {
    body?: BodyState;
    failDocument?: boolean;
    sections?: readonly OutlineSection[];
  } = {},
): FakeSource {
  const reads: string[] = [];
  const body = options.body ??
    { kind: "text", text: NOTES, complete: true } as BodyState;
  return {
    reads,
    document(id) {
      reads.push(id);
      return Promise.resolve(
        options.failDocument
          ? { ok: false, code: "unavailable" }
          : { ok: true, value: info(id) },
      );
    },
    body(_id, _version, onPage) {
      onPage(body);
      return Promise.resolve(body);
    },
    outline: () =>
      Promise.resolve({
        ok: true,
        value: options.sections ??
          [
            { key: "release-notes", title: "Release notes", level: 1, line: 1 },
            { key: "usage", title: "Usage", level: 2, line: 5 },
          ],
      }),
    linkTargets: () => Promise.resolve({ ok: true, value: [] }),
    resolveLink: () => Promise.resolve({ ok: true, value: null }),
  };
}

/** platform settings 자리. 창·재시작을 넘어 남는 저장값이다. */
function settingsOf(initial: unknown = null) {
  let value = initial;
  let revision = 1;
  const port: SettingsPort = {
    get: () => Promise.resolve({ value, revision }),
    apply: (next, compare) => {
      if (compare !== revision) {
        return Promise.resolve({ ok: false, conflict: true });
      }
      value = next;
      revision += 1;
      return Promise.resolve({ ok: true, revision });
    },
  };
  return { port, stored: () => value };
}

function menuOf(answer: string | null | "unavailable") {
  const opened: { label: string; choices: readonly MenuChoice[] }[] = [];
  const menu: MenuOpener = {
    open(_anchor, label, choices) {
      opened.push({ label, choices });
      return Promise.resolve(answer);
    },
  };
  return { menu, opened };
}

function ctrlE(target: Element): void {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "e",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

async function flush(): Promise<void> {
  await settle();
  await settle();
}

function view(
  props: {
    source?: EditorSource;
    settings?: ReturnType<typeof settingsOf>;
    menu?: MenuOpener;
    documentId?: string;
    onMeta?: (meta: DocumentTabMeta) => void;
    onToggleInfo?: () => void;
    files?: EditorSessions;
  } = {},
) {
  const settings = props.settings ?? settingsOf();
  return render(
    <DocumentView
      documentId={props.documentId ?? "doc_notes"}
      projectId="prj_1"
      source={props.source ?? sourceOf()}
      readingWidth={readingWidthStore(settings.port)}
      menu={props.menu ?? menuOf(null).menu}
      onMeta={props.onMeta}
      onToggleInfo={props.onToggleInfo ?? (() => {})}
      {...(props.files ? { files: props.files } : {})}
      now={() => Date.parse("2026-10-05T10:00:00Z")}
    />,
  );
}

Deno.test("shell/editor#R16: 문서 머리는 제목 20px·메타 12px과 편집 ghost·정보 패널·메뉴를 두고 primary가 없다", async () => {
  let toggled = 0;
  using rendered = view({ onToggleInfo: () => toggled++ });
  await flush();
  const head = one(rendered.container, "[data-document-head]");
  const title = one(head, "[data-document-title]");
  assertEquals(title.textContent, "Release notes");
  assertEquals(style(title).fontSize, "20px");
  const meta = one(head, "[data-document-meta]");
  assertEquals(style(meta).fontSize, "12px");
  assertEquals(meta.textContent, "Version 3, saved 1 hour ago");
  const edit = one(head, "[data-edit-toggle]");
  assertEquals(edit.getAttribute("data-variant"), "ghost");
  assertEquals(edit.getAttribute("aria-label"), "Edit");
  assertEquals(edit.textContent, "");
  assertEquals(
    one(head, "[data-document-menu]").getAttribute("aria-label"),
    "Document menu",
  );
  click(one(head, "[data-document-info]"));
  assertEquals(toggled, 1);
  assertEquals(
    rendered.container.querySelectorAll("[data-variant='primary']").length,
    0,
  );
});

Deno.test("shell/editor#R16: CommandOrControl+E가 편집과 읽기를 바꾼다", async () => {
  using rendered = view();
  await flush();
  const root = one(rendered.container, "[data-document-view]");
  assertEquals(root.getAttribute("data-document-view"), "read");
  ctrlE(root);
  await flush();
  assertEquals(root.getAttribute("data-document-view"), "edit");
  assert(rendered.container.querySelector(".cm-editor"));
  assertEquals(
    one(rendered.container, "[data-edit-toggle]").getAttribute("aria-label"),
    "Read",
  );
  ctrlE(root);
  await flush();
  assertEquals(root.getAttribute("data-document-view"), "read");
  assertEquals(rendered.container.querySelector(".cm-editor"), null);
});

Deno.test("shell/editor#R9: 편집 mode는 머리 버튼과 커서만 바뀌고 같은 칸·머리·배경·테두리를 쓴다", async () => {
  using rendered = view();
  await flush();
  const root = one(rendered.container, "[data-document-view]");
  const title = one(rendered.container, "[data-document-title]");
  const frame = one(rendered.container, "[data-frame='reading']");
  const background = style(root).backgroundColor;
  ctrlE(root);
  await flush();
  // 같은 scroll 칸, 같은 머리 node, 같은 읽기 틀이다.
  assertEquals(one(rendered.container, "[data-document-view]") === root, true);
  assertEquals(
    one(rendered.container, "[data-document-title]") === title,
    true,
  );
  assertEquals(
    one(rendered.container, "[data-frame='reading']") === frame,
    true,
  );
  assertEquals(style(root).backgroundColor, background);
  const cm = one(rendered.container, ".cm-editor");
  assertEquals(
    style(cm).borderTopWidth === "" || style(cm).borderTopWidth === "0px",
    true,
  );
  assertEquals(
    ["transparent", "rgba(0, 0, 0, 0)", ""].includes(style(cm).backgroundColor),
    true,
  );
});

Deno.test("shell/editor#R8: 읽기와 편집의 본문·제목·인용·코드가 같은 글자와 모양이다", async () => {
  using rendered = view();
  await flush();
  const article = one(rendered.container, "[data-document-body]");
  const readHeading = one(article, "h1");
  const readQuote = one(article, "blockquote");
  const readCode = one(article, "p code");
  const read = {
    heading: [style(readHeading).fontSize, style(readHeading).lineHeight],
    quote: style(readQuote).borderLeftWidth,
    code: style(readCode).fontFamily,
  };
  ctrlE(one(rendered.container, "[data-document-view]"));
  await flush();
  const editHeading = one(article, ".cm-line.cm-lp-h1");
  const content = one(article, ".cm-editor");
  assertEquals(style(content).fontSize, "16px");
  assertEquals(style(content).lineHeight, "28px");
  assertEquals(read, {
    heading: [style(editHeading).fontSize, style(editHeading).lineHeight],
    quote: style(one(article, ".cm-line.cm-lp-quote")).borderLeftWidth,
    code: style(one(article, ".cm-lp-code")).fontFamily,
  });
  // 편집 첫 줄은 위 여백 없이 본문 맨 위에서 시작한다(읽기 첫 블록도 margin-top 0).
  // 실제 위치 차이 4px 이하는 e2e/shell/read-edit_test.ts가 잰다.
  assertEquals(style(editHeading).paddingTop, "0px");
});

Deno.test("shell/editor#R8: 편집한 초안은 읽기로 돌아와도 보이고 본문을 다 읽기 전에는 편집하지 않는다", async () => {
  using rendered = view();
  await flush();
  const root = one(rendered.container, "[data-document-view]");
  ctrlE(root);
  await flush();
  const editor = EditorView.findFromDOM(one(rendered.container, ".cm-editor"))!;
  act(() =>
    editor.dispatch({
      changes: { from: editor.state.doc.length, insert: "\n\nAdded line." },
    })
  );
  ctrlE(root);
  await flush();
  assert(
    one(rendered.container, "[data-document-body]").textContent?.includes(
      "Added line.",
    ),
  );

  using partial = view({
    source: sourceOf({ body: { kind: "text", text: "# A", complete: false } }),
  });
  await flush();
  const toggle = one(
    partial.container,
    "[data-edit-toggle]",
  ) as HTMLButtonElement;
  assertEquals(toggle.disabled, true);
  ctrlE(one(partial.container, "[data-document-view]"));
  await flush();
  assertEquals(
    one(partial.container, "[data-document-view]").getAttribute(
      "data-document-view",
    ),
    "read",
  );
});

Deno.test("shell/editor#R4: 문서를 읽으면 탭에 파일 이름·문서 제목·상대 경로를 알린다", async () => {
  const metas: DocumentTabMeta[] = [];
  using _rendered = view({ onMeta: (meta) => metas.push(meta) });
  await flush();
  assertEquals(metas, [{
    fileName: "doc_notes.md",
    title: "Release notes",
    path: "docs/doc_notes.md",
  }]);
});

Deno.test("shell/editor#R4: 제목이 scroll 위로 사라지면 32px sticky 머리에 제목과 지금 절이 보인다", async () => {
  using rendered = view();
  await flush();
  const root = one(rendered.container, "[data-document-view]");
  const title = one(rendered.container, "[data-document-title]");
  const headings = [...rendered.container.querySelectorAll(
    "[data-document-body] h1, [data-document-body] h2",
  )];
  // happy-dom은 배치를 재지 않는다. 화면이 읽는 사각형만 정한다.
  const at = (top: number) => () =>
    ({
      top: top - root.scrollTop,
      bottom: top + 28 - root.scrollTop,
      left: 0,
      right: 0,
      width: 0,
      height: 28,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  root.getBoundingClientRect = () => ({ ...at(0)(), top: 0 }) as DOMRect;
  title.getBoundingClientRect = at(40);
  headings[0]!.getBoundingClientRect = at(200);
  headings[1]!.getBoundingClientRect = at(700);
  act(() => {
    root.scrollTop = 10;
    root.dispatchEvent(new Event("scroll"));
  });
  assertEquals(rendered.container.querySelector("[data-sticky-head]"), null);
  act(() => {
    root.scrollTop = 690;
    root.dispatchEvent(new Event("scroll"));
  });
  const sticky = one(rendered.container, "[data-sticky-head]");
  assertEquals(style(sticky).height, "32px");
  assertEquals(sticky.textContent, "Release notesUsage");
});

Deno.test("shell/design-system#R23: 문서 메뉴로 읽기 폭을 바꾸면 전역 선택으로 저장하고 다른 문서와 재시작에 같다", async () => {
  const settings = settingsOf();
  const { menu, opened } = menuOf("wide");
  using rendered = view({ settings, menu });
  await flush();
  assertEquals(
    one(rendered.container, "[data-document-view]").getAttribute(
      "data-reading-width",
    ),
    "default",
  );
  click(one(rendered.container, "[data-document-menu]"));
  await flush();
  assertEquals(opened[0]?.label, "Reading width");
  assertEquals(opened[0]?.choices.map((choice) => choice.label), [
    "Narrow, 600px",
    "Default, 680px (current)",
    "Wide, 800px",
  ]);
  assertEquals(
    one(rendered.container, "[data-frame='reading'] [data-width]")
      .getAttribute("data-width"),
    "wide",
  );
  assertEquals(settings.stored(), "wide");
  // 다른 문서와 재시작은 같은 settings를 새로 읽는다.
  using other = view({ settings, documentId: "doc_plan" });
  await flush();
  assertEquals(
    one(other.container, "[data-document-view]").getAttribute(
      "data-reading-width",
    ),
    "wide",
  );
  using unknown = view({ settings: settingsOf("enormous") });
  await flush();
  assertEquals(
    one(unknown.container, "[data-document-view]").getAttribute(
      "data-reading-width",
    ),
    "default",
  );
});

Deno.test("shell/design-system#R23: 메뉴를 열지 못하면 그렇다고 보인다", async () => {
  using rendered = view({ menu: menuOf("unavailable").menu });
  await flush();
  click(one(rendered.container, "[data-document-menu]"));
  await flush();
  assertEquals(
    one(rendered.container, "[role=status]").textContent,
    "This action couldn't be completed. Try again.",
  );
});

Deno.test("shell/design-system#R23: 목차는 outline 절로 읽기 틀에 붙는다", async () => {
  using rendered = view();
  await flush();
  const reading = one(rendered.container, "[data-frame='reading'] [data-toc]");
  assertEquals(reading.getAttribute("data-toc") !== "none", true);
});

Deno.test("shell/editor#R8: 글을 줄 수 없는 문서와 읽기 실패는 이유와 다시 읽기를 보인다", async () => {
  using hidden = view({ source: sourceOf({ body: { kind: "hidden" } }) });
  await flush();
  assertEquals(
    one(hidden.container, "[data-document-body] [role=status]").textContent,
    "This document's text is hidden here.",
  );
  const failing = sourceOf({ failDocument: true });
  using failed = view({ source: failing });
  await flush();
  const state = one(failed.container, "[data-state='error']");
  assertEquals(
    state.textContent?.includes("Couldn't load this document."),
    true,
  );
  click(one(state, "button"));
  await flush();
  assertEquals(failing.reads.length, 2);
});

// ---- 저장 흐름(shell#T17). main 파일 adapter 자리는 가짜 preload 통로다.

const DISK = "# Release notes\n\nOn disk.\n";

function report(over: Partial<SaveReport> = {}): SaveReport {
  return {
    disk: "written",
    written_hash: "a".repeat(64),
    observed_hash: null,
    observed_at: null,
    changed_again: false,
    recording: "recorded",
    version: null,
    saved_version: null,
    latest_version: null,
    problems: null,
    failure: null,
    ...over,
  };
}

function filesOf(write: (input: EditorWrite) => EditorReply<SaveReport>) {
  const writes: EditorWrite[] = [];
  const api: EditorFilesApi = {
    open: () =>
      Promise.resolve({
        ok: true,
        value: {
          session: "es_session1x",
          text: DISK,
          base_hash: "0".repeat(64),
          target: "project_file",
          primary_path: "doc_notes.md",
        },
      }),
    write: (input) => {
      writes.push(input);
      return Promise.resolve(write(input));
    },
    lookup: () =>
      Promise.resolve({
        ok: true,
        value: { state: "unknown", observed_hash: null, observed_at: null },
      }),
    current: () =>
      Promise.resolve({
        ok: true,
        value: { text: "# Release notes\n\nOutside.\n", hash: "e".repeat(64) },
      }),
    // 바깥 상태는 이 test에서 오지 않는다.
    watch: () => new Promise(() => {}),
    restore: () => Promise.resolve({ ok: false, code: "unavailable" }),
    release: () => Promise.resolve(),
    counts: () => {},
    onCloseRequest: () => () => {},
    answerClose: () => {},
  };
  const files = new EditorSessions(api, {
    ask: () => Promise.resolve("keep"),
  });
  return { files, writes };
}

function ctrlS(target: Element): void {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "s",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

function typeText(container: HTMLElement, text: string): void {
  const editor = EditorView.findFromDOM(one(container, ".cm-editor"))!;
  act(() =>
    editor.dispatch({
      changes: { from: editor.state.doc.length, insert: text },
    })
  );
}

Deno.test("shell/editor#R11 shell/editor#R12: 편집은 main이 연 디스크 글로 시작하고, 저장 버튼 없이 CommandOrControl+S가 편집 종료로 쓰며, 저장 상태가 머리 메타 줄에 보인다", async () => {
  const { files, writes } = filesOf((input) => ({
    ok: true,
    value: report({ version: input.end ? "preparing" : null }),
  }));
  using rendered = view({ files });
  await flush();
  const root = one(rendered.container, "[data-document-view]");
  ctrlE(root);
  await flush();
  assertEquals(root.getAttribute("data-document-view"), "edit");
  assert(
    one(rendered.container, ".cm-content").textContent?.includes("On disk."),
  );
  // 저장 버튼은 없다.
  assertEquals(
    [...rendered.container.querySelectorAll("button")].some((button) =>
      button.textContent === "Save"
    ),
    false,
  );
  typeText(rendered.container, "More.\n");
  ctrlS(root);
  await flush();
  assertEquals(writes.length, 1);
  assertEquals(writes[0]!.end, true);
  assertEquals(writes[0]!.base_hash, "0".repeat(64));
  assertEquals(
    new TextDecoder().decode(writes[0]!.bytes),
    `${DISK}More.\n`,
  );
  const meta = one(rendered.container, "[data-document-meta]");
  assertEquals(
    one(meta, "[data-save-status]").getAttribute("data-save-status"),
    "version-pending",
  );
  assert(meta.textContent?.includes("Saved to the file. Keeping a version."));
  // 단계별 사실은 상세에서 펼친다.
  assertEquals(rendered.container.querySelector("[data-save-details]"), null);
  click(one(meta, "[data-save-details-toggle]"));
  await flush();
  const details = one(rendered.container, "[data-save-details]");
  assertEquals(
    [...details.querySelectorAll("[data-save-stage]")].map((row) => [
      row.getAttribute("data-save-stage"),
      row.getAttribute("data-save-value"),
    ]),
    [
      ["file", "saved"],
      ["record", "recorded"],
      ["version", "preparing"],
      ["format", "none"],
    ],
  );
});

Deno.test("shell/editor#R2 shell/editor#R11: 형식 검사 실패는 파일 저장 성공과 따로 메타 줄에 보이고 문제 목록에 줄로 보인다", async () => {
  const { files } = filesOf(() => ({
    ok: true,
    value: report({
      version: "validation_failed",
      problems: [{
        severity: "error",
        message: "Heading is missing",
        file: "doc_notes.md",
        start_line: 1,
      }],
    }),
  }));
  using rendered = view({ files });
  await flush();
  const root = one(rendered.container, "[data-document-view]");
  ctrlE(root);
  await flush();
  typeText(rendered.container, "x");
  ctrlS(root);
  await flush();
  const meta = one(rendered.container, "[data-document-meta]");
  assertEquals(
    one(meta, "[data-save-status]").getAttribute("data-save-status"),
    "format-failed",
  );
  assertEquals(one(meta, "[data-save-action]").textContent, "Show problems");
  assert(
    one(rendered.container, "[data-problem-list]").textContent?.includes(
      "Heading is missing",
    ),
  );
  click(one(meta, "[data-save-details-toggle]"));
  await flush();
  assertEquals(
    one(rendered.container, "[data-save-stage='file']").getAttribute(
      "data-save-value",
    ),
    "saved",
  );
});

Deno.test("shell/editor#R15: 충돌 notice는 32px로 해결까지 남고 현재 파일과 비교하는 해결 화면으로 가며, 사람이 고르기 전에는 초안을 덮지 않는다", async () => {
  let conflict = true;
  const { files, writes } = filesOf(() =>
    conflict
      ? { ok: true, value: report({ disk: "conflict", failure: "conflict" }) }
      : { ok: true, value: report() }
  );
  using rendered = view({ files });
  await flush();
  const root = one(rendered.container, "[data-document-view]");
  ctrlE(root);
  await flush();
  typeText(rendered.container, "Mine.\n");
  ctrlS(root);
  await flush();
  const notice = one(rendered.container, "[data-notice]");
  assertEquals(notice.getAttribute("data-notice"), "conflict");
  assertEquals(notice.getAttribute("role"), "alert");
  assertEquals(style(notice).minHeight, "32px");
  assertEquals(style(notice).marginBottom, "12px");
  // 시간이 지나도 사라지지 않는다.
  await new Promise((resolve) => setTimeout(resolve, 50));
  await flush();
  assert(rendered.container.querySelector("[data-notice='conflict']"));
  click(one(notice, "[data-notice-compare]"));
  await flush();
  const resolving = one(rendered.container, "[data-conflict-view]");
  assertEquals(resolving.getAttribute("data-conflict-view"), "disk");
  assert(resolving.textContent?.includes("Outside."));
  assert(resolving.textContent?.includes("Mine."));
  assertEquals(
    rendered.container.querySelectorAll("[data-variant='primary']").length,
    0,
  );
  // 내 글을 고르면 지금 파일 hash 위에 쓴다.
  conflict = false;
  click(one(resolving, "[data-conflict-mine]"));
  await flush();
  const last = writes.at(-1)!;
  assertEquals(last.base_hash, "e".repeat(64));
  assert(new TextDecoder().decode(last.bytes).includes("Mine."));
  assertEquals(
    rendered.container.querySelector("[data-notice='conflict']"),
    null,
  );
  assertEquals(rendered.container.querySelector("[data-conflict-view]"), null);
});
