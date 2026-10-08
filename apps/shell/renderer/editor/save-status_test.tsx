// save-status의 core 끊김 줄(shell/editor#R12, desktop#R7). 저장 불가와 초안 유지는 파일
// 상태와 따로 메타 줄에서 함께 보인다. 파일 상태 headline은 save-state_test가 본다.
// bundle 진입은 editor_test.ts가 이 폴더를 같이 등록한다.
import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import { render } from "../../../../packages/design/components/testing.ts";

import type {
  ConnectionState,
  CoreSource,
} from "../desktop/connection/connection.ts";
import { EditorView } from "@codemirror/view";
import type { EditorFilesApi } from "../../ipc/editor.ts";
import { DocumentView } from "./document-view.tsx";
import { EditorSessions } from "./sessions.ts";
import { readingWidthStore, type SettingsPort } from "./reading-width.ts";
import { INITIAL_FACTS } from "./save-state.ts";
import { SaveStatus } from "./save-status.tsx";

function factsOf(over: Record<string, unknown> = {}) {
  return {
    ...INITIAL_FACTS,
    dirty: true,
    pipeline: "waiting" as const,
    disk: { state: "saved" as const, at: 1_000 },
    ...over,
  };
}

Deno.test("shell/editor#R12: core가 끊기면 저장 불가와 초안 유지를 메타 줄에서 함께 보인다", () => {
  using view = render(
    <SaveStatus
      facts={factsOf()}
      detailsOpen={false}
      onToggleDetails={() => {}}
      onAction={() => {}}
      connection={{ state: "stale", confirmedAt: 1_700_000_000_000 }}
      formatTime={(confirmedAt) => `at ${confirmedAt}`}
    />,
  );
  const status = view.container.querySelector(
    "[data-save-status]",
  ) as HTMLElement;
  assert(status, "the stale line is missing");
  assertEquals(status.getAttribute("data-save-status"), "stale");
  assertEquals(status.getAttribute("data-tone"), "warning");
  assert(
    status.textContent?.includes("Not connected. Your changes are kept here."),
    `save is not shown as unavailable while the draft is kept: ${status.textContent}`,
  );
  assert(
    status.textContent?.includes("at 1700000000000"),
    "the last confirmed time is missing",
  );
  assertEquals(status.querySelectorAll("[data-save-action]").length, 0);
});

Deno.test("shell/desktop#R7: core 끊김에서 파일 저장이 끝난 상태여도 끊김 줄은 남는다", () => {
  using view = render(
    <SaveStatus
      facts={INITIAL_FACTS}
      detailsOpen={false}
      onToggleDetails={() => {}}
      onAction={() => {}}
      connection={{ state: "stale", confirmedAt: null }}
    />,
  );
  const status = view.container.querySelector(
    "[data-save-status]",
  ) as HTMLElement;
  assert(status, "the stale line is missing without a file state");
  assertEquals(status.getAttribute("data-save-status"), "stale");
  assert(
    status.textContent?.includes("Not connected. Your changes are kept here."),
  );
  assertEquals(
    status.textContent?.includes("Last checked"),
    false,
    "a null confirmed time is shown as a time",
  );
});

Deno.test("shell/editor#R12: core가 살아 있으면 지금 headline만 보인다", () => {
  using view = render(
    <SaveStatus
      facts={factsOf()}
      detailsOpen={false}
      onToggleDetails={() => {}}
      onAction={() => {}}
      connection={{ state: "ready", confirmedAt: 1 }}
    />,
  );
  const status = view.container.querySelector(
    "[data-save-status]",
  ) as HTMLElement;
  assertEquals(status.getAttribute("data-save-status"), "saving");
  assertEquals(status.textContent?.includes("Not connected."), false);
});

// ---- document 탭: core 연결 상태로 저장 gate와 끊김 줄을 함께 본다

const NOTES = "# Release notes\n\nBody.";

const AT = Date.parse("2026-10-08T09:00:00Z");

function documentSource() {
  return {
    document: (id: string) =>
      Promise.resolve({
        ok: true as const,
        value: {
          id,
          title: "Release notes",
          fileName: `${id}.md`,
          path: `docs/${id}.md`,
          version: `ver_${id}`,
          versionNumber: 3,
          savedAt: AT,
        },
      }),
    body: () =>
      Promise.resolve({
        kind: "text" as const,
        text: NOTES,
        complete: true,
      }),
    outline: () => Promise.resolve({ ok: true as const, value: [] }),
    linkTargets: () => Promise.resolve({ ok: true as const, value: [] }),
    resolveLink: () => Promise.resolve({ ok: true as const, value: null }),
  };
}

function settingsPort(): SettingsPort {
  return {
    get: () => Promise.resolve({ value: null, revision: 1 }),
    apply: (_width, revision) =>
      Promise.resolve({ ok: true as const, revision: (revision ?? 1) + 1 }),
  };
}

function sourcesOf(connectionState: "ready" | "stale"): CoreSource {
  const listeners = new Set<(state: ConnectionState) => void>();
  const core: CoreSource = {
    subscribe(listener) {
      listeners.add(listener);
      listener({
        state: connectionState,
        confirmedAt: connectionState === "stale" ? 1_700_000_000_000 : 1,
      });
      return () => listeners.delete(listener);
    },
    call: () => Promise.resolve({ ok: true, value: {} }),
  };
  return core;
}

Deno.test("flow work-offline, shell/editor#R12 shell/desktop#R7: document 탭은 core 끊김에서 저장 gate를 닫고 초안을 유지하며 끊김 줄을 보인다", async () => {
  const core = sourcesOf("stale");
  const source = documentSource();
  const { files, writes } = filesOf();
  using view = render(
    <DocumentView
      documentId="doc_notes"
      projectId="prj_1"
      source={source}
      readingWidth={readingWidthStore(settingsPort())}
      menu={{ open: () => Promise.resolve(null) }}
      now={() => AT}
      core={core}
      files={files}
    />,
  );
  await flushDocument();
  // core 끊김 줄이 메타 자리에 있다.
  const status = view.container.querySelector(
    "[data-save-status='stale']",
  ) as HTMLElement;
  assert(status, `the stale line is missing: ${view.container.textContent}`);
  assert(
    status.textContent?.includes("Not connected. Your changes are kept here."),
  );
  assert(
    status.textContent?.includes("Nov 15, 2023"),
    `the last checked time is missing: ${status.textContent}`,
  );
  // 편집을 시작해 고친다. gate가 닫혀 쓰기가 나가지 않고 초안이 남는다.
  const root = view.container.querySelector(
    "[data-document-view]",
  ) as HTMLElement;
  act(() => {
    root.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "e",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await flushDocument();
  const editor = EditorView.findFromDOM(
    view.container.querySelector(".cm-editor") as HTMLElement,
  )!;
  act(() =>
    editor.dispatch({
      changes: { from: editor.state.doc.length, insert: "More.\n" },
    })
  );
  await flushDocument();
  assertEquals(writes.length, 0, "the closed gate sent a write");
  // 초안은 그래도 편집기에 남는다.
  assert(
    editor.state.doc.toString().endsWith("More.\n"),
    "the draft was not kept",
  );
});

async function flushDocument(): Promise<void> {
  for (let round = 0; round < 4; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const DISK = `${NOTES}\n`;

function filesOf() {
  const writes: { bytes: Uint8Array; end: boolean }[] = [];
  const unavailable = (code: string): Promise<{ ok: false; code: string }> =>
    Promise.resolve({ ok: false, code });
  const api: EditorFilesApi = {
    open: () =>
      Promise.resolve({
        ok: true as const,
        value: {
          session: "es_session1x",
          text: DISK,
          base_hash: "0".repeat(64),
          target: "project_file" as const,
          primary_path: "doc_notes.md",
        },
      }),
    write: (input: { bytes: Uint8Array; end: boolean }) => {
      writes.push({ bytes: input.bytes, end: input.end });
      return Promise.resolve({ ok: true as const, value: saveReport() });
    },
    lookup: () =>
      Promise.resolve({
        ok: true as const,
        value: { state: "unknown", observed_hash: null, observed_at: null },
      }),
    current: () =>
      Promise.resolve({
        ok: true as const,
        value: { text: DISK, hash: "e".repeat(64) },
      }),
    // 바깥 상태는 이 test에서 오지 않는다.
    watch: () => new Promise(() => {}),
    restore: () => unavailable("unavailable"),
    create: () => unavailable("unavailable"),
    place: () => unavailable("unavailable"),
    release: () => Promise.resolve(),
    counts: () => {},
    onCloseRequest: () => () => {},
    answerClose: () => {},
  } as unknown as EditorFilesApi;
  const files = new EditorSessions(api, {
    ask: () => Promise.resolve("keep"),
  });
  return { files, writes };
}

function saveReport(): unknown {
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
  };
}
