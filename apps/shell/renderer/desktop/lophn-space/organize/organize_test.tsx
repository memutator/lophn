import { assert, assertEquals } from "@std/assert";
import {
  click,
  focus,
  pressAsync,
  render,
  unmountSettled,
} from "../../../../../../packages/design/components/testing.ts";

import { DocumentPanel } from "./document-panel.tsx";
import { ExportPanel } from "./export-panel.tsx";
import type { DocumentDetail, ExportFormat } from "./source.ts";
import type { PlaceRef } from "../source.ts";
import {
  DETAIL,
  DOCUMENTS,
  fakeOrganize,
  type OrganizeData,
  PROJECT,
} from "./testdata/fake-organize.ts";
import { CATALOG } from "../testdata/fake-source.ts";
import { find, flush, submit, typeInto } from "../testdata/dom.ts";

const LINKED: DocumentDetail = {
  ...DETAIL,
  file: { project: "prj_1", path: "/work/lophn/notes.md" },
};

async function openPanel(
  data: OrganizeData,
  projects = [PROJECT],
) {
  const fake = fakeOrganize(data);
  let changed = 0;
  const view = render(
    <DocumentPanel
      source={fake.source}
      id="doc_1"
      catalog={CATALOG}
      projects={projects}
      onBack={() => {}}
      onChanged={() => {
        changed += 1;
      }}
    />,
  );
  await flush();
  return { ...fake, view, changed: () => changed };
}

/** Select를 열어 지금 고른 것에서 steps만큼 아래 선택지를 고른다. */
async function choose(trigger: Element, steps: number): Promise<void> {
  focus(trigger);
  await pressAsync(trigger, "ArrowDown");
  for (let step = 0; step < steps; step += 1) {
    await pressAsync(document.activeElement!, "ArrowDown");
  }
  await pressAsync(document.activeElement!, "Enter");
  await flush();
}

function text(root: ParentNode, selector: string): string {
  return find(root, selector).textContent ?? "";
}

Deno.test("shell/desktop#R28 documents/addressing#R6 documents/addressing#R8: 문서 이름 바꾸기와 자리 이동은 묻지 않고 현재 revision으로 보내고 결과와 원본 파일이 그대로라는 것을 보인다", async () => {
  const { view, of, changed } = await openPanel({
    detail: () => LINKED,
    moved: {
      ok: true,
      value: { ...LINKED, place: { kind: "app", id: "app_1" }, revision: "5" },
    },
  });
  typeInto(find(view.container, "[data-document-name]"), "release-2026");
  submit(find(view.container, "[data-rename-form]"));
  await flush();
  const [renamed, name] = of("renameDocument")[0]!.args as [
    DocumentDetail,
    string,
  ];
  assertEquals([renamed.revision, name], ["3", "release-2026"]);
  assertEquals(
    text(view.container, "[data-renamed]"),
    "Renamed to release-2026. Old links still open this document.The file on disk stays where it is.",
  );
  // 자리 이동: 지금 자리(lophn)에서 한 칸 아래인 앱으로 옮긴다.
  await choose(find(view.container, "[data-move-form] button"), 1);
  submit(find(view.container, "[data-move-form]"));
  await flush();
  const [moved, place, linkName] = of("moveDocument")[0]!.args as [
    DocumentDetail,
    PlaceRef | null,
    string | null,
  ];
  assertEquals(moved.revision, "4");
  assertEquals(place, { kind: "app", id: "app_1" });
  assertEquals(linkName, "release-2026");
  assertEquals(
    text(view.container, "[data-moved]"),
    "Moved to Groceries. Old links still open this document.The file on disk stays where it is.",
  );
  assertEquals(changed(), 2);
  // 이름·자리 바꾸기는 파일 쓰기·지우기를 부르지 않는다.
  assertEquals(of("placeFile").length + of("removeFile").length, 0);
  await unmountSettled(view);
});

Deno.test("shell/wording#R10 documents/addressing#R2: 문서 이름이 겹치면 바꾸지 않고 다른 이름을 고르게 하고, 대상이 바뀌었으면 최신으로 가는 길만 남긴다", async () => {
  const taken = await openPanel({ renamed: { ok: false, code: "conflict" } });
  typeInto(find(taken.view.container, "[data-document-name]"), "plan");
  submit(find(taken.view.container, "[data-rename-form]"));
  await flush();
  assert(
    taken.view.container.textContent?.includes(
      "This name is already used in this place, now or before. Choose another.",
    ),
  );
  assertEquals(taken.view.container.querySelector("[data-changed]"), null);
  await unmountSettled(taken.view);

  const changed = await openPanel({
    renamed: { ok: false, code: "conflict" },
    detail: (count) => count === 0 ? DETAIL : { ...DETAIL, revision: "9" },
  });
  typeInto(find(changed.view.container, "[data-document-name]"), "notes");
  submit(find(changed.view.container, "[data-rename-form]"));
  await flush();
  assertEquals(
    text(changed.view.container, "[data-changed]"),
    "This changed since you opened it.",
  );
  click(find(changed.view.container, "[data-show-latest]"));
  await flush();
  assertEquals(changed.of("document").length, 3);
  await unmountSettled(changed.view);
});

Deno.test("documents/file-tracking#R13 documents/projects#R12: 파일로 두기는 최신 판을 추적 중인 프로젝트 폴더의 새 파일로 보내고 파일 결과와 연결 단계를 따로 보인다", async () => {
  const { view, of } = await openPanel({
    placed: {
      ok: true,
      value: {
        file: "written",
        path: "/work/lophn/release-notes.md",
        steps: {
          source: { state: "done" },
          tracking: { state: "failed", code: "forbidden" },
          move: { state: "not_attempted" },
        },
      },
    },
  });
  assertEquals(
    text(view.container, "[data-place-target]"),
    "/work/lophn/release-notes.md",
  );
  submit(find(view.container, "[data-place-form]"));
  await flush();
  const [document, project, path] = of("placeFile")[0]!.args as [
    DocumentDetail,
    string,
    string,
  ];
  assertEquals(
    [document.latestVersion, project, path],
    ["ver_2", "prj_1", "/work/lophn/release-notes.md"],
  );
  const result = find(view.container, "[data-place-result='written']");
  assert(result.textContent?.startsWith("The file was written."));
  const steps = [...result.querySelectorAll("[data-step]")].map((row) =>
    row.textContent
  );
  assertEquals(steps, [
    "Link the document to the fileDone",
    "Track this fileNot allowed",
    "Put in this projectNot tried",
  ]);
  assertEquals(
    text(result, "[data-steps-incomplete]"),
    "Some steps after the file didn't finish. The file stays where it is.",
  );
  await unmountSettled(view);

  // 추적이 켜진 프로젝트가 없으면 두기를 고를 수 없다고 알리고 아무것도 보내지 않는다.
  const none = await openPanel({}, [{ ...PROJECT, tracking: false }]);
  assertEquals(
    text(none.view.container, "[data-place-none]"),
    "Turn on file tracking for a project to put documents in files.",
  );
  assertEquals(none.view.container.querySelector("[data-place-form]"), null);
  await unmountSettled(none.view);
});

Deno.test("documents/file-tracking#R13 shell/wording#R10: 이미 있는 파일·바뀐 문서는 파일을 쓰지 않았다고 알리고 다음 행동을 준다", async () => {
  const { view } = await openPanel({
    placed: {
      ok: true,
      value: { file: "conflict", path: null, steps: null },
    },
  });
  submit(find(view.container, "[data-place-form]"));
  await flush();
  assertEquals(
    text(view.container, "[data-place-result='conflict']"),
    "Nothing was written. A file is already there or the document changed. Choose another name or check the latest.",
  );
  await unmountSettled(view);
});

Deno.test("documents/file-tracking#R14 shell/wording#R10: 파일에서 빼기는 보호 창의 사람 결정으로 보내고, 창을 못 열면 지우지 않았다고 알린다", async () => {
  const opened = await openPanel({ detail: () => LINKED });
  assertEquals(
    text(opened.view.container, "[data-file-path]"),
    "/work/lophn/notes.md",
  );
  click(find(opened.view.container, "[data-remove-file]"));
  await flush();
  assertEquals(
    (opened.of("removeFile")[0]!.args[0] as DocumentDetail).id,
    "doc_1",
  );
  assertEquals(
    text(opened.view.container, "[data-review-opened]"),
    "Review the removal in the window that opened.",
  );
  await unmountSettled(opened.view);

  const closed = await openPanel({
    detail: () => LINKED,
    removed: { ok: false, code: "unavailable" },
  });
  click(find(closed.view.container, "[data-remove-file]"));
  await flush();
  assertEquals(
    text(closed.view.container, "[data-review-unavailable]"),
    "The review window can't open here yet, so the file wasn't removed.",
  );
  await unmountSettled(closed.view);
});

Deno.test("documents/file-tracking#R14: 빼기 결과는 파일 삭제와 연결 해제·자리 되돌리기를 따로 보인다", async () => {
  const { view } = await openPanel({
    detail: (count) => count === 0 ? LINKED : { ...DETAIL, place: null },
    removed: {
      ok: true,
      value: {
        kind: "done",
        outcome: {
          file: "deleted",
          steps: { source: { state: "done" }, move: { state: "done" } },
        },
      },
    },
  });
  click(find(view.container, "[data-remove-file]"));
  await flush();
  const result = find(view.container, "[data-unlink-result='deleted']");
  assertEquals(
    [...result.querySelectorAll("[data-step]")].map((row) => row.textContent),
    ["Unlink the fileDone", "Take out of this projectDone"],
  );
  assert(view.container.querySelector("[data-file-none]"));
  await unmountSettled(view);
});

Deno.test("documents/versions#R16: export는 고른 문서와 고정 판만 보내고 포함한 판·원래 파일로 남는 것·넣지 않은 문서를 나눠 보인다", async () => {
  const fake = fakeOrganize({
    exported: {
      ok: true,
      value: {
        format: "markdown",
        documents: [{
          document: "doc_1",
          title: "Release notes",
          version: "ver_1",
          number: 1,
          files: [
            { path: "notes.md", mediaType: "text/markdown", bytes: 20 },
            { path: "figure.png", mediaType: "image/png", bytes: 900 },
          ],
        }],
      },
    },
  });
  const view = render(
    <ExportPanel
      source={fake.source}
      place={{ kind: "project", id: "prj_1" }}
      documents={DOCUMENTS}
    />,
  );
  await flush();
  const run = find(view.container, "[data-export-run]") as HTMLButtonElement;
  assert(run.disabled);
  click(
    find(view.container, "[data-export-document='doc_1'] [role=checkbox]"),
  );
  await flush();
  assertEquals(fake.of("versions")[0]!.args, ["doc_1"]);
  // 최신 판(2)에서 한 칸 아래 고정 판 1을 고른다.
  await choose(
    find(view.container, "[data-export-document='doc_1'] [role=combobox]"),
    1,
  );
  assertEquals(run.textContent, "Export 1 document");
  click(run);
  await flush();
  const [place, picks, format] = fake.of("exportDocuments")[0]!.args as [
    PlaceRef,
    { document: string; version: string }[],
    ExportFormat,
  ];
  assertEquals(place, { kind: "project", id: "prj_1" });
  assertEquals(picks, [{ document: "doc_1", version: "ver_1" }]);
  assertEquals(format, "markdown");
  const included = find(view.container, "[data-export-included='doc_1']");
  assert(included.textContent?.includes("Version 1"));
  assertEquals(
    [...included.querySelectorAll("[data-export-kept]")].map((item) =>
      item.closest("[data-export-file]")!.getAttribute("data-export-file")
    ),
    ["figure.png"],
  );
  assertEquals(
    text(view.container, "[data-export-left-out='doc_2']"),
    "PlanNot picked",
  );
  await unmountSettled(view);
});

Deno.test("documents/versions#R16 shell/wording#R10: 원래 파일을 돌려줄 수 없는 판은 온전한 export로 보이지 않고, 자리가 바뀌었으면 아무것도 내보내지 않았다고 알린다", async () => {
  const blob = fakeOrganize({
    exported: {
      ok: true,
      value: {
        format: "json",
        documents: [{
          document: "doc_2",
          title: "Plan",
          version: "ver_5",
          number: 5,
          files: null,
        }],
      },
    },
  });
  const view = render(
    <ExportPanel
      source={blob.source}
      place={{ kind: "project", id: "prj_1" }}
      documents={DOCUMENTS}
    />,
  );
  await flush();
  click(
    find(view.container, "[data-export-document='doc_2'] [role=checkbox]"),
  );
  await flush();
  click(find(view.container, "[data-export-run]"));
  await flush();
  assertEquals(
    text(view.container, "[data-export-no-files]"),
    "Original files can't be returned",
  );
  await unmountSettled(view);

  const moved = fakeOrganize({ exported: { ok: false, code: "conflict" } });
  const again = render(
    <ExportPanel
      source={moved.source}
      place={{ kind: "project", id: "prj_1" }}
      documents={DOCUMENTS}
    />,
  );
  await flush();
  click(
    find(again.container, "[data-export-document='doc_1'] [role=checkbox]"),
  );
  await flush();
  click(find(again.container, "[data-export-run]"));
  await flush();
  assertEquals(
    text(again.container, "[data-export-changed]"),
    "This changed since you opened it. Nothing was exported. Check the latest and export again.",
  );
  assertEquals(again.container.querySelector("[data-export-result]"), null);
  await unmountSettled(again);
});
