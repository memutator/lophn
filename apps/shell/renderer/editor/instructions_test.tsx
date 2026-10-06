// [Instructions] 진입(shell#T32, flow edit-instructions, shell/editor#R17). main 통로는 가짜 preload 통로다.
// 파일이 없으면 빈 초안이고 사람의 편집 종료만 첫 저장을 하며, 있으면 일반 문서와 같은 DocumentView·정보
// 패널로 열린다. 경로·version 식별자는 기본 화면에 없다. 실제 core 위의 흐름은
// instructions-real-core_test.ts가 본다.
import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import { EditorView } from "@codemirror/view";
import {
  click,
  one,
  render,
  settle,
} from "../../../../packages/design/components/testing.ts";

import type { EditorFilesApi } from "../../ipc/editor.ts";
import type {
  InstructionsCreated,
  InstructionsOpened,
  InstructionsPlace,
} from "../../ipc/instructions.ts";
import type { EditorDeps } from "./document-view.tsx";
import {
  InstructionsEntry,
  type InstructionsSource,
} from "./instructions-entry.tsx";
import { readingWidthStore, type SettingsPort } from "./reading-width.ts";
import { EditorSessions } from "./sessions.ts";
import type { EditorSource } from "./source.ts";

const DOC = "doc_01kq12a1pha000000000000000";
const V1 = "ver_01kq12a1pha000000000000001";
const GLOBAL: InstructionsPlace = { layer: "global" };

async function flush(): Promise<void> {
  await settle();
  await settle();
}

const settings: SettingsPort = {
  get: () => Promise.resolve({ value: null, revision: 1 }),
  apply: () => Promise.resolve({ ok: true, revision: 2 }),
};

function editorOf(): EditorDeps {
  const unavailable = () =>
    Promise.resolve({ ok: false as const, code: "unavailable" as const });
  const api: EditorFilesApi = {
    open: unavailable,
    write: unavailable,
    lookup: unavailable,
    current: unavailable,
    watch: () => new Promise(() => {}),
    restore: unavailable,
    create: unavailable,
    release: () => Promise.resolve(),
    counts: () => {},
    onCloseRequest: () => () => {},
    answerClose: () => {},
  };
  const source: EditorSource = {
    document: (id) =>
      Promise.resolve({
        ok: true,
        value: {
          id,
          title: "Global instructions",
          fileName: "LOPHN.md",
          path: "LOPHN.md",
          version: V1,
          versionNumber: 1,
          savedAt: Date.parse("2026-10-05T09:00:00Z"),
        },
      }),
    body: (_id, _version, onPage) => {
      const body = {
        kind: "text" as const,
        text: "# Global instructions\n\nBe brief.\n",
        complete: true,
      };
      onPage(body);
      return Promise.resolve(body);
    },
    outline: () => Promise.resolve({ ok: true, value: [] }),
    linkTargets: () => Promise.resolve({ ok: true, value: [] }),
    resolveLink: () => Promise.resolve({ ok: true, value: null }),
  };
  return {
    source,
    readingWidth: readingWidthStore(settings),
    menu: { open: () => Promise.resolve(null) },
    files: new EditorSessions(api, { ask: () => Promise.resolve("keep") }),
  };
}

function sourceOf(
  options: {
    opened?: () => InstructionsOpened | null;
    created?: InstructionsCreated;
  } = {},
) {
  const created: { target: InstructionsPlace; bytes: Uint8Array }[] = [];
  const opens: InstructionsPlace[] = [];
  const source: InstructionsSource = {
    open: ({ target }) => {
      opens.push(target);
      const opened = options.opened
        ? options.opened()
        : { document: null, version: null };
      return Promise.resolve(
        opened === null
          ? { ok: false as const, code: "unavailable" as const }
          : { ok: true as const, value: opened },
      );
    },
    create: (input) => {
      created.push({ target: input.target, bytes: input.bytes });
      return Promise.resolve({
        ok: true as const,
        value: options.created ??
          {
            outcome: "saved",
            version: V1,
            failure: null,
            document: DOC,
          },
      });
    },
  };
  return { source, created, opens };
}

function typeText(container: HTMLElement, text: string): void {
  const editor = EditorView.findFromDOM(one(container, ".cm-editor"))!;
  act(() =>
    editor.dispatch({
      changes: { from: editor.state.doc.length, insert: text },
    })
  );
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

Deno.test("shell/editor#R17 shell/editor#R2 shell/editor#R12: 파일이 없으면 빈 초안이고 사람의 편집 종료만 첫 저장을 하며 저장하면 같은 문서 화면으로 바뀐다", async () => {
  let saved = false;
  const fake = sourceOf({
    opened: () =>
      saved
        ? { document: DOC, version: V1 }
        : { document: null, version: null },
  });
  const original = fake.source.create;
  fake.source.create = (input) => {
    saved = true;
    return original(input);
  };
  using rendered = render(
    <InstructionsEntry
      place={GLOBAL}
      source={fake.source}
      editor={editorOf()}
    />,
  );
  await flush();
  const draft = one(rendered.container, "[data-instructions-view='draft']");
  assertEquals(
    one(draft, "[data-document-title]").textContent,
    "Global instructions",
  );
  // 초안 보존과 판 확정은 다른 상태다. 저장 버튼은 없다.
  const status = one(draft, "[data-instructions-draft]");
  assertEquals(status.getAttribute("data-instructions-draft"), "draft");
  assertEquals(status.textContent, "Not saved yet. Finish editing to keep it.");
  assertEquals(draft.querySelector("[data-save]"), null);
  // 열기만으로는, 고치기만으로는 아무것도 저장하지 않는다(agent의 제안도 이 통로에 없다).
  typeText(rendered.container, "Always answer briefly.\n");
  await flush();
  assertEquals(fake.created.length, 0);

  ctrlS(draft);
  await flush();
  await flush();
  assertEquals(fake.created.length, 1);
  assertEquals(fake.created[0]!.target, GLOBAL);
  assertEquals(
    new TextDecoder().decode(fake.created[0]!.bytes),
    "Always answer briefly.\n",
  );
  // 첫 판이 서면 일반 문서와 같은 화면이다. 경로와 version 식별자는 기본 화면에 없다.
  const view = one(rendered.container, "[data-instructions-view='document']");
  assert(view.querySelector("[data-document-view]"));
  const text = rendered.container.textContent ?? "";
  for (const hidden of ["LOPHN.md", "ver_", "doc_", "/"]) {
    assert(!text.includes(hidden), `${hidden}가 기본 화면에 보인다`);
  }
});

Deno.test("shell/editor#R2 shell/editor#R17: 파일은 썼지만 판이 아직이면 판 대기로 구별해 보이고 다시 확인하면 문서로 바뀐다", async () => {
  let observed = false;
  const fake = sourceOf({
    opened: () =>
      observed
        ? { document: DOC, version: V1 }
        : { document: null, version: null },
    created: {
      outcome: "pending",
      version: null,
      failure: null,
      document: null,
    },
  });
  using rendered = render(
    <InstructionsEntry
      place={GLOBAL}
      source={fake.source}
      editor={editorOf()}
    />,
  );
  await flush();
  typeText(rendered.container, "Be brief.\n");
  ctrlS(one(rendered.container, "[data-instructions-view='draft']"));
  await flush();
  await flush();
  const status = one(rendered.container, "[data-instructions-draft]");
  assertEquals(status.getAttribute("data-instructions-draft"), "pending");
  assertEquals(status.textContent, "Saved to the file. Keeping a version.");
  // 다시 쓰지 않고 조회로만 본다.
  observed = true;
  click(one(rendered.container, "[data-instructions-action]"));
  await flush();
  await flush();
  assertEquals(fake.created.length, 1);
  assert(
    rendered.container.querySelector("[data-instructions-view='document']"),
  );
});

Deno.test("shell/editor#R17: 파일에 연결된 문서가 있으면 같은 문서 편집기와 정보 패널로 열고 project 층은 project id로 연다", async () => {
  const fake = sourceOf({ opened: () => ({ document: DOC, version: V1 }) });
  const place: InstructionsPlace = {
    layer: "project",
    place: "prj_01kq12a1pha000000000000000",
  };
  using rendered = render(
    <InstructionsEntry
      place={place}
      source={fake.source}
      editor={editorOf()}
    />,
  );
  await flush();
  assertEquals(fake.opens, [place]);
  const view = one(rendered.container, "[data-document-view]");
  assertEquals(view.getAttribute("data-document-view"), "read");
  assertEquals(
    one(view, "[data-document-title]").textContent,
    "Global instructions",
  );
  assertEquals(fake.created.length, 0);
  // 정보 패널(버전 이력·비교·복원)은 일반 문서와 같은 자리에서 연다.
  assertEquals(rendered.container.querySelector("[data-info-panel]"), null);
  click(one(view, "[data-document-info]"));
  await flush();
  assert(rendered.container.querySelector("[data-info-panel]"));
});

Deno.test("shell/editor#R17: 대상을 열지 못하면 다시 시도를 보인다", async () => {
  let attempts = 0;
  const fake = sourceOf({
    opened: () => (attempts++ === 0 ? null : { document: null, version: null }),
  });
  using rendered = render(
    <InstructionsEntry
      place={GLOBAL}
      source={fake.source}
      editor={editorOf()}
    />,
  );
  await flush();
  const failed = one(rendered.container, "[data-instructions-view='failed']");
  assert(failed.textContent?.includes("these instructions"));
  click(one(failed, "button"));
  await flush();
  assert(rendered.container.querySelector("[data-instructions-view='draft']"));
});
