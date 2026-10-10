// documents slice flow E2E: organize-documents(docs/flows/organize-documents.md). 실제 shell
// (headless)·core·documents worker·format runner를 임시 LOPHN_HOME으로 띄우고 예시 project
// 폴더 fixture(korean-search)를 사람이 등록한 프로젝트로 추적한다.
// - 4(자리를 옮기고 이름을 바꿔도 같은 문서와 옛 참조, 원본 파일은 그대로)와 5(보관한 뒤에도
//   고정 판 읽기)와 다른 갈래(이름 충돌, 옛 예약 이름)를 사람 command와 documents 화면으로 본다.
// - 사람 직접 이동은 문서 이동·이름 변경 command를 core 통로로 낸다. 이를 부르는 화면(projects
//   화면의 이름 변경·보관·export, documents 화면의 이동) 중 이름 변경·export는 아래 1·6·7 시험이
//   실제 projects 화면으로 본다. 2·3(lophn 역할 추천과 question)은 agent slice E2E 몫이다(documents plan Q4).
import { assert, assertEquals, assertStringIncludes } from "@std/assert";

import { buildReply } from "../../tools/fake-provider/semantic.ts";
import type { SemanticReply } from "../../tools/fake-provider/types.ts";
import { copyFixture } from "../../fixtures/projects/scenarios.ts";
import { e2eEnabled } from "../harness.ts";
import {
  commandBody,
  delay,
  documentTitled,
  type FlowShell,
  listDocuments,
  mustCall,
  openFlowShell,
  registerProject,
  registerTrackedProject,
  removeHome,
  untilDocuments,
  untilSearch,
} from "../flow-support.ts";

const SECOND_PROJECT = "prj_01arz3ndektsv4rrffq69g5fb0";

async function fileSource(flow: FlowShell, document: string): Promise<unknown> {
  const got = await mustCall(flow, {
    kind: "read",
    resource: "documents",
    method: "get",
    body: { document },
  });
  return (got.document as { file_source: unknown }).file_source;
}

/** 링크 입력으로 문서를 연다. */
async function openLink(flow: FlowShell, link: string): Promise<void> {
  if (await flow.count("[data-link-form]") === 0) {
    await flow.click("[data-open-link]");
    await flow.until(
      `document.querySelector("[data-link-input]") !== null`,
      "링크 입력칸이 열리지 않았다",
    );
  }
  await flow.type("[data-link-input]", link);
  await flow.click("[data-link-submit]");
}

Deno.test({
  name:
    "documents/addressing#R6 documents/addressing#R7 documents/addressing#R8 flow organize-documents: 자리 이동·이름 변경 뒤에도 같은 문서·옛 참조·원본 파일, 보관 뒤에도 고정 판",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const folder = await Deno.realPath(await copyFixture("korean-search"));
    const other = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "lophn-e2e-organize-" }),
    );
    const flow = await openFlowShell({ start: "lophn" });
    try {
      await registerTrackedProject(flow, { folder });
      await untilDocuments(
        flow,
        ["glossary", "migration"],
        "문서가 되지 않았다",
      );
      // 목차·검색이 판을 뒤따라 반영된 뒤에 연다(반영 전에는 구조를 아직 읽지 못한 판이다).
      await untilSearch(
        flow,
        "문서",
        (page) => new Set(page.results.map((row) => row.document)).size >= 2,
        "index가 따라오지 않았다",
      );
      await registerProject(flow, {
        folder: other,
        id: SECOND_PROJECT,
        name: "beta",
        title: "Beta",
      });
      const glossary = await documentTitled(flow, "glossary");
      assertEquals(glossary.name, "glossary");
      const placed = glossary;
      const sourceBefore = await fileSource(flow, glossary.id);
      const bytesBefore = await Deno.readTextFile(`${folder}/glossary.md`);
      assert(sourceBefore !== null, "원본 연결 문서여야 한다");

      await t.step(
        "documents/addressing#R6 documents/addressing#R7 documents/addressing#R8: 4 다른 프로젝트로 옮기고 이름을 바꿔도 같은 문서·고정 판이고 옛 참조는 현재 참조로 안내하며 원본 파일은 그대로다",
        async () => {
          await mustCall(flow, {
            kind: "command",
            resource: "documents",
            method: "move",
            body: commandBody(
              {
                document: glossary.id,
                place: { kind: "project", id: SECOND_PROJECT },
                name: "terms",
              },
              { base_revision: placed.revision },
            ),
          });
          const moved = await documentTitled(flow, "glossary");
          // 같은 문서이고 고정 판 이력은 그대로다.
          assertEquals(moved.id, glossary.id);
          assertEquals(moved.latest_version, glossary.latest_version);
          // 자리 변경만으로 원본 파일의 경로·내용·연결은 바뀌지 않는다.
          assertEquals(await fileSource(flow, glossary.id), sourceBefore);
          assertEquals(
            await Deno.readTextFile(`${folder}/glossary.md`),
            bytesBefore,
          );
          // 옛 참조(alpha/glossary)는 같은 문서의 현재 참조(beta/terms)로 안내한다.
          await openLink(flow, "alpha/glossary");
          await flow.until(
            `document.querySelector("[data-link-moved]") !== null`,
            "옮겨졌다는 안내가 없다",
          );
          assertStringIncludes(
            (await flow.text("[data-link-moved]"))!,
            "beta/terms",
          );
          await flow.until(
            `document.querySelector('[data-reader="${glossary.id}"] [data-body]') !== null`,
            "같은 문서를 열지 못했다",
          );
          // 이름을 바꿔도 마찬가지다. 새 주소와 옛 주소가 모두 같은 문서를 연다.
          await mustCall(flow, {
            kind: "command",
            resource: "documents",
            method: "rename",
            body: commandBody(
              { document: glossary.id, name: "words" },
              { base_revision: moved.revision },
            ),
          });
          await openLink(flow, "beta/terms");
          await flow.until(
            `document.querySelector("[data-link-moved]")?.textContent.includes("beta/words")`,
            "옛 이름의 안내가 없다",
          );
          await openLink(flow, "beta/words");
          await flow.until(
            `document.querySelector('[data-reader="${glossary.id}"] [data-body]') !== null && document.querySelector("[data-link-moved]") === null`,
            "새 이름으로 같은 문서를 열지 못했다",
          );
        },
      );

      await t.step(
        "documents/addressing#R2: 현재 이름이나 옛 예약 이름과 겹치면 변경하지 않는다",
        async () => {
          const migration = await documentTitled(flow, "migration");
          // 현재 이름(beta/words)과 겹침.
          const taken = await flow.call({
            kind: "command",
            resource: "documents",
            method: "move",
            body: commandBody(
              {
                document: migration.id,
                place: { kind: "project", id: SECOND_PROJECT },
                name: "words",
              },
              { base_revision: migration.revision },
            ),
          });
          assertEquals(taken.ok, false);
          assertEquals(taken.error?.code, "conflict");
          // 옛 예약 이름(beta/terms)도 다른 문서에 쓰지 못한다.
          const reserved = await flow.call({
            kind: "command",
            resource: "documents",
            method: "move",
            body: commandBody(
              {
                document: migration.id,
                place: { kind: "project", id: SECOND_PROJECT },
                name: "terms",
              },
              { base_revision: migration.revision },
            ),
          });
          assertEquals(reserved.ok, false);
          assertEquals(reserved.error?.code, "conflict");
          // 거절된 문서는 자리와 이름이 그대로다(관측할 때 놓인 프로젝트의 이름).
          assertEquals(
            (await documentTitled(flow, "migration")).name,
            "migration",
          );
        },
      );

      await t.step(
        "documents/versions#R11 documents/versions#R12 documents/projects#R11: 5 문서와 프로젝트를 보관해도 소속 문서를 일괄 보관·삭제하지 않고 고정 판은 읽는다",
        async () => {
          const project = await mustCall(flow, {
            kind: "read",
            resource: "projects",
            method: "get",
            body: { project: SECOND_PROJECT },
          });
          await mustCall(flow, {
            kind: "command",
            resource: "projects",
            method: "archive",
            body: commandBody(
              { project: SECOND_PROJECT },
              {
                base_revision: String(
                  (project.project as { revision: string }).revision,
                ),
              },
            ),
          });
          // 보관한 프로젝트에 있는 문서도 보관되지 않았고 삭제되지도 않았다.
          const words = (await listDocuments(flow)).find((row) =>
            row.id === glossary.id
          );
          assertEquals(words?.status, "active");
          // 문서를 보관한 뒤에도 고정 판을 읽는다.
          const current = await documentTitled(flow, "glossary");
          await mustCall(flow, {
            kind: "command",
            resource: "documents",
            method: "archive",
            body: commandBody(
              { document: glossary.id },
              { base_revision: current.revision },
            ),
          });
          const archived = await documentTitled(flow, "glossary", "archived");
          assertEquals(archived.latest_version, glossary.latest_version);
          const outline = await mustCall(flow, {
            kind: "worker",
            resource: "outline",
            method: "document",
            body: {
              reference: {
                document: glossary.id,
                version: glossary.latest_version,
                section: null,
              },
            },
          });
          assertEquals(outline.document, glossary.id);
          // 원본 파일은 여전히 그대로다.
          assertEquals(
            await Deno.readTextFile(`${folder}/glossary.md`),
            bytesBefore,
          );
        },
      );
    } finally {
      await flow.close();
      await removeHome(flow.home);
      await Deno.remove(folder, { recursive: true });
      await Deno.remove(other, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "documents/projects#R8 documents/projects#R11 documents/versions#R16 flow organize-documents: 1·6·7 projects 화면에서 프로젝트와 문서 이름을 바꾸고 고른 판을 export해 포함·제외를 구별한다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const folder = await Deno.realPath(await copyFixture("korean-search"));
    const flow = await openFlowShell({ start: "lophn" });
    try {
      const { project } = await registerTrackedProject(flow, { folder });
      await untilDocuments(
        flow,
        ["glossary", "migration"],
        "문서가 되지 않았다",
      );
      const glossary = await documentTitled(flow, "glossary");
      const migration = await documentTitled(flow, "migration");
      const bytesBefore = await Deno.readTextFile(`${folder}/glossary.md`);
      await flow.click('[data-screen="projects"]');
      await flow.until(
        `document.querySelector('[data-screen-body="projects"] [data-project="${project}"]') !== null`,
        "projects 화면에 프로젝트가 없다",
      );
      await flow.click(
        `[data-screen-body="projects"] [data-project="${project}"]`,
      );
      await flow.until(
        `document.querySelector('[data-project-head="${project}"]') !== null && document.querySelector('[data-project-document="${glossary.id}"]') !== null`,
        "프로젝트 상세와 문서 목록이 열리지 않았다",
      );

      await t.step(
        "documents/projects#R8 documents/projects#R11 documents/versions#R9: 1 projects 화면에서 프로젝트 제목과 문서 이름을 바꾼다",
        async () => {
          await flow.type("[data-project-title]", "Alpha Notes");
          await flow.click("[data-project-save]");
          await flow.until(
            `document.querySelector("[data-project-saved]") !== null`,
            "프로젝트 저장이 끝나지 않았다",
          );
          const read = await mustCall(flow, {
            kind: "read",
            resource: "projects",
            method: "get",
            body: { project },
          });
          assertEquals(
            (read.project as { title: string }).title,
            "Alpha Notes",
          );
          assertStringIncludes(
            (await flow.text(`[data-project-head="${project}"]`))!,
            "Alpha Notes",
          );

          await flow.click(`[data-project-document="${glossary.id}"]`);
          await flow.until(
            `document.querySelector('[data-organize="${glossary.id}"] [data-document-name]') !== null`,
            "문서 정리 칸이 열리지 않았다",
          );
          await flow.type("[data-document-name]", "terms");
          await flow.click("[data-rename]");
          await flow.until(
            `document.querySelector('[data-renamed]') !== null`,
            "이름 변경 결과가 보이지 않는다",
          );
          const renamed = await documentTitled(flow, "glossary");
          // 같은 문서·같은 고정 판이고 원본 파일은 그대로다.
          assertEquals(renamed.id, glossary.id);
          assertEquals(renamed.name, "terms");
          assertEquals(renamed.latest_version, glossary.latest_version);
          assertEquals(
            await Deno.readTextFile(`${folder}/glossary.md`),
            bytesBefore,
          );
          await flow.click("[data-organize-back]");
          await flow.until(
            `document.querySelector('[data-export-document="${glossary.id}"]') !== null`,
            "프로젝트 상세로 돌아가지 않았다",
          );
        },
      );

      await t.step(
        "documents/versions#R16 documents/versions#R8: 6·7 고른 문서의 판을 export하고 포함한 문서·원래 파일과 고르지 않은 문서를 구별한다",
        async () => {
          await flow.click(
            `[data-export-document="${glossary.id}"] button[role="checkbox"]`,
          );
          await flow.until(
            `!document.querySelector("[data-export-run]").disabled`,
            "export 단추가 켜지지 않았다",
          );
          await flow.click("[data-export-run]");
          await flow.until(
            `document.querySelector('[data-export-result="markdown"]') !== null`,
            "export 결과가 보이지 않는다",
          );
          assertEquals(await flow.count("[data-export-failed]"), 0);
          assertEquals(
            await flow.count(`[data-export-included="${glossary.id}"]`),
            1,
          );
          // 원래 파일을 돌려줄 수 있는 판은 빈 내용으로 보이지 않는다.
          assertEquals(
            await flow.count(
              `[data-export-included="${glossary.id}"] [data-export-no-files]`,
            ),
            0,
          );
          const files = await flow.texts(
            `[data-export-included="${glossary.id}"] [data-export-file]`,
          );
          assert(
            files.some((file) => file.includes("glossary.md")),
            `원래 파일이 없다: ${JSON.stringify(files)}`,
          );
          // 고르지 않은 문서는 포함하지 않고 따로 보인다.
          assertEquals(
            await flow.count(`[data-export-included="${migration.id}"]`),
            0,
          );
          assertEquals(
            await flow.count(`[data-export-left-out="${migration.id}"]`),
            1,
          );
          // export는 원본 파일을 바꾸지 않는다.
          assertEquals(
            await Deno.readTextFile(`${folder}/glossary.md`),
            bytesBefore,
          );
        },
      );
    } finally {
      await flow.close();
      await removeHome(flow.home);
      await Deno.remove(folder, { recursive: true });
    }
  },
});

/** 문서 정리 칸을 연다(projects 화면 → 프로젝트 → 문서). */
async function openOrganize(
  flow: FlowShell,
  project: string,
  document: string,
): Promise<void> {
  if (await flow.count(`[data-project-head="${project}"]`) === 0) {
    await flow.click('[data-screen="projects"]');
    await flow.until(
      `document.querySelector('[data-screen-body="projects"] [data-project="${project}"]') !== null`,
      "projects 화면에 프로젝트가 없다",
    );
    await flow.click(
      `[data-screen-body="projects"] [data-project="${project}"]`,
    );
  }
  await flow.until(
    `document.querySelector('[data-project-document="${document}"]') !== null`,
    "프로젝트 상세와 문서 목록이 열리지 않았다",
  );
  await flow.click(`[data-project-document="${document}"]`);
  await flow.until(
    `document.querySelector('[data-organize="${document}"] [data-file-section]') !== null`,
    "문서 정리 칸이 열리지 않았다",
  );
}

/** shell preload의 편집 통로(`window.lophnEditor`)로 자리가 있고 파일은 없는 새 문서를 만든다. */
async function createLoose(
  flow: FlowShell,
  input: { document: string; title: string; name: string; project: string },
  text: string,
): Promise<void> {
  const reply = await flow.evaluate(
    `(async () => {
      const answer = await window.lophnEditor.create({
        document: ${JSON.stringify(input.document)},
        request_key: ${JSON.stringify(`loose-${input.name}-create`)},
        title: ${JSON.stringify(input.title)},
        place: { kind: "project", id: ${JSON.stringify(input.project)} },
        name: ${JSON.stringify(input.name)},
        bytes: new TextEncoder().encode(${JSON.stringify(text)}),
      });
      return JSON.stringify(answer);
    })()`,
  );
  const parsed = JSON.parse(String(reply)) as {
    ok?: boolean;
    value?: { outcome?: string };
  };
  assertEquals(parsed.value?.outcome, "saved", String(reply));
}

const LOOSE_ONE = "doc_01arz3ndektsv4rrffq69g5fb1";
const LOOSE_TWO = "doc_01arz3ndektsv4rrffq69g5fb2";

Deno.test({
  name:
    "documents/file-tracking#R13 documents/addressing#R8 flow organize-documents: 파일로 두기는 파일 쓰기와 원본 연결·추적·자리 단계를 각각 보이고 이미 있는 파일을 덮지 않는다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const folder = await Deno.realPath(await copyFixture("korean-search"));
    const flow = await openFlowShell({ start: "lophn" });
    try {
      const { project } = await registerTrackedProject(flow, { folder });
      await untilDocuments(
        flow,
        ["glossary", "migration"],
        "문서가 되지 않았다",
      );
      const first = "# Placed note\n\nFirst body.\n";
      const second = "# Other note\n\nSecond body.\n";
      await createLoose(flow, {
        document: LOOSE_ONE,
        title: "Placed note",
        name: "placed",
        project,
      }, first);
      await createLoose(flow, {
        document: LOOSE_TWO,
        title: "Other note",
        name: "other",
        project,
      }, second);
      await untilDocuments(
        flow,
        ["Placed note", "Other note"],
        "새 문서가 목록에 없다",
      );
      const placed = await documentTitled(flow, "Placed note");
      assertEquals(placed.id, LOOSE_ONE);
      assertEquals(await fileSource(flow, LOOSE_ONE), null);

      await t.step(
        "documents/file-tracking#R13: 파일이 없는 문서를 파일로 두면 파일을 쓰고 원본 연결·추적 규칙·자리를 각각 확정해 단계별로 보인다",
        async () => {
          await openOrganize(flow, project, LOOSE_ONE);
          assertEquals(await flow.count("[data-file-none]"), 1);
          assertEquals(await flow.count("[data-place-form]"), 1);
          await flow.type("[data-file-name]", "placed.md");
          assertStringIncludes(
            (await flow.text("[data-place-target]"))!,
            "placed.md",
          );
          await flow.click("[data-place]");
          await flow.until(
            `document.querySelector("[data-place-result]") !== null`,
            "파일로 두기 결과가 보이지 않는다",
          );
          assertEquals(
            await flow.evaluate(
              `document.querySelector("[data-place-result]").getAttribute("data-place-result")`,
            ),
            "written",
          );
          // 추적이 이미 이 파일을 덮고 문서가 이미 이 프로젝트에 있어 추적 규칙과 자리는 더할
          // 것이 없어 건너뛴다. 단계마다 따로 보이고 실패한 단계는 없다.
          for (
            const [step, expected] of [
              ["source", "done"],
              ["tracking", "skipped"],
              ["move", "skipped"],
            ]
          ) {
            assertEquals(
              await flow.evaluate(
                `document.querySelector('[data-place-result] [data-step="${step}"]')?.getAttribute("data-step-state")`,
              ),
              expected,
              `${step} 단계 상태가 다르다`,
            );
          }
          assertEquals(await Deno.readTextFile(`${folder}/placed.md`), first);
          const source = await fileSource(flow, LOOSE_ONE) as {
            kind: string;
            project: string;
            path: string;
          } | null;
          assertEquals(source?.kind, "project_file");
          assertEquals(source?.project, project);
          // 추적이 만든 문서의 연결과 같은 모양(등록 폴더 아래 경로)이다.
          assertEquals(source?.path, `${folder}/placed.md`);
          const tracked = await fileSource(
            flow,
            (await documentTitled(flow, "glossary")).id,
          ) as { path: string };
          assertEquals(tracked.path, `${folder}/glossary.md`);
          // 같은 문서·같은 고정 판이다. 쓴 파일을 관측해도 판이나 문서가 늘지 않는다.
          const after = await documentTitled(flow, "Placed note");
          assertEquals(after.id, LOOSE_ONE);
          assertEquals(after.latest_version, placed.latest_version);
        },
      );

      await t.step(
        "documents/file-tracking#R13: 이미 있는 파일 이름으로 두면 덮지 않고 충돌로 멈추며 문서는 파일 없이 남는다",
        async () => {
          await flow.click("[data-organize-back]");
          await openOrganize(flow, project, LOOSE_TWO);
          await flow.type("[data-file-name]", "placed.md");
          await flow.click("[data-place]");
          await flow.until(
            `document.querySelector("[data-place-result]") !== null`,
            "파일로 두기 결과가 보이지 않는다",
          );
          assertEquals(
            await flow.evaluate(
              `document.querySelector("[data-place-result]").getAttribute("data-place-result")`,
            ),
            "conflict",
          );
          // 앞 문서의 파일은 그대로고, 이 문서는 파일 없이 남는다.
          assertEquals(await Deno.readTextFile(`${folder}/placed.md`), first);
          assertEquals(await fileSource(flow, LOOSE_TWO), null);
          assertEquals(await flow.count("[data-place-result] [data-step]"), 0);
        },
      );

      await t.step(
        "documents/versions#R16: 7 JSON으로도 export하며 포함한 문서의 파일과 판을 구별하고 원본 파일은 바뀌지 않는다",
        async () => {
          await flow.click("[data-organize-back]");
          await flow.until(
            `document.querySelector('[data-export-document="${LOOSE_ONE}"]') !== null`,
            "프로젝트 상세로 돌아가지 않았다",
          );
          await flow.click(
            `[data-export-document="${LOOSE_ONE}"] button[role="checkbox"]`,
          );
          await flow.until(
            `!document.querySelector("[data-export-run]").disabled`,
            "export 단추가 켜지지 않았다",
          );
          // 판 선택은 문서 줄 안에 있고 형식 선택이 마지막이다.
          await flow.evaluate(
            `(() => { const all = document.querySelectorAll("[data-export] button[role=combobox]"); all[all.length - 1].setAttribute("data-flow-format", ""); return true; })()`,
          );
          await flow.choose("[data-flow-format]", "JSON");
          await flow.click("[data-export-run]");
          await flow.until(
            `document.querySelector('[data-export-result="json"]') !== null`,
            "JSON export 결과가 보이지 않는다",
          );
          assertEquals(await flow.count("[data-export-failed]"), 0);
          assertEquals(
            await flow.count(`[data-export-included="${LOOSE_ONE}"]`),
            1,
          );
          assertEquals(
            await flow.count(`[data-export-included="${LOOSE_TWO}"]`),
            0,
          );
          assertEquals(
            await flow.count(`[data-export-left-out="${LOOSE_TWO}"]`),
            1,
          );
          const files = await flow.texts(
            `[data-export-included="${LOOSE_ONE}"] [data-export-file]`,
          );
          assert(
            files.some((file) => file.includes("placed.md")),
            `원래 파일이 없다: ${JSON.stringify(files)}`,
          );
          assertEquals(await Deno.readTextFile(`${folder}/placed.md`), first);
        },
      );

      // 파일에서 빼기의 결정 창은 열리지만 main에 delete_file owner decision의 정본 read·제출이
      // 없다(shell#T29 "남긴 것": 열면 not_found). 창은 "This request changed"만 보이고 결정
      // 단추가 없어 사람이 지울 수 없다. shell main이 붙이면 이 단계를 켠다.
      await t.step({
        name:
          "documents/file-tracking#R14 documents/versions#R12: 파일에서 빼기는 사람이 결정 창에서 확인해야 파일만 지우고 문서와 고정 판은 남는다",
        ignore: true,
        fn: async () => {
          await flow.click("[data-organize-back]");
          await openOrganize(flow, project, LOOSE_ONE);
          await flow.click("[data-remove-file]");
          const page = await flow.shell.connect("lophn-shell://confirmation/");
          await page.evaluate(
            `document.querySelector('[data-decision="confirm"]').click()`,
          );
          const gone = Date.now() + 30_000;
          while (true) {
            try {
              await Deno.stat(`${folder}/placed.md`);
            } catch {
              break;
            }
            assert(Date.now() < gone, "결정했는데 파일이 지워지지 않았다");
            await delay(200);
          }
          assertEquals(await fileSource(flow, LOOSE_ONE), null);
        },
      });
    } finally {
      await flow.close();
      await removeHome(flow.home);
      await Deno.remove(folder, { recursive: true });
    }
  },
});

// lophn-agent slice: organize-documents 2·3(lophn의 자리 추천과 question). 실제 shell(headless)·
// core(제품 runtime child)를 임시 LOPHN_HOME으로 띄우고 model은 이 시험의 loopback 응답 server가
// 낸다. 자리 없는 문서는 사람이 청한 앞 run이 만든다(place null).
// - 2: 사람이 자리를 물으면 lophn은 자리 없는 문서와 프로젝트를 읽기 tool로만 읽고 문서·현재
//   자리·새 자리를 적은 선택지와 추천 이유를 question으로 묻는다. 묻는 것만으로는 옮기지 않는다.
// - 3과 다른 갈래: 고르기만으로는 답도 이동도 아니고, 미루면 답 없음으로 남고 자리는 그대로다.
// 볼 수 없는 것(이어보냄): 3의 답 확정·이동 적용. 제품 `question.submit`은 이제 `document_move`
// 제안(문서·새 자리·이름)을 받아 handler가 읽은 문서 revision으로 document.move action을 고정한다
// (harness/tools/bundles/question-actions.ts, 단위 테스트). 그러나 질문 칸과 shell main이 `term.define`만
// 확인 창 없이 답으로 접수하고 그 밖의 고정 action은 모두 [Review] 확인 창으로 보내며 core의
// AnswerQuestion도 action 선택지를 확인 handle 없이 받지 않는다(shell 결함, 이어보냄). 자리 이동은
// 되돌릴 수 있는 안쪽 동작이라 확인 창 없이 확정돼야 한다(docs/flows/organize-documents.md 3).
// 이 시험의 모델 응답은 아직 `document_move`를 쓰지 않아 선택지 action이 null이다.

const AGENT_PROVIDER = "pvd_01arz3ndektsv4rrffq69g5fav";
const AGENT_MODEL = "claude-sonnet-4-5";
const COMPOSER = "[data-composer-input]";
const SEND_BUTTON = "[data-send]";
const READY_QUESTION = "[data-question-text='ready']";
const LOOSE_TITLE = "Release checklist";
const PLACE_ASK = "Where should the release checklist live?";
const PLACE_PROMPT = "Where should the release checklist go?";
const MOVE_DESCRIPTION =
  "Document: Release checklist. Now: no place. New: project Alpha (alpha).";

type AgentStep = (body: string) => SemanticReply | Promise<SemanticReply>;

function startAgentProvider(steps: AgentStep[]) {
  const bodies: string[] = [];
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    async (request) => {
      const text = await request.text();
      const path = new URL(request.url).pathname;
      if (request.method !== "POST" || !path.endsWith("/messages")) {
        return Response.json({ error: "unexpected" }, { status: 500 });
      }
      const step = steps[bodies.length];
      bodies.push(text);
      if (step === undefined) {
        return Response.json({ error: "exhausted" }, { status: 500 });
      }
      const built = buildReply("messages", await step(text));
      return new Response(built.body ?? "", {
        status: built.status,
        headers: built.headers,
      });
    },
  );
  return {
    url: `http://127.0.0.1:${server.addr.port}`,
    calls: () => bodies.length,
    body: (index: number) => bodies[index] ?? "",
    close: () => server.shutdown(),
  };
}

function agentToolCall(
  id: string,
  name: string,
  args: unknown,
): SemanticReply {
  return {
    text: "",
    toolCalls: [{ id, name, arguments: JSON.stringify(args) }],
    usage: { input: 30, output: 9 },
    stop: "tool_calls",
  };
}

const placeOption = (key: string, label: string, description: string) => ({
  key,
  label,
  description,
  evidence: [],
  adoption: null,
  action: null,
});

const AGENT_STEPS: AgentStep[] = [
  // 앞 run: 사람이 청한 문서를 자리 없이 만든다.
  () =>
    agentToolCall("toolu_create", "document.create", {
      title: LOOSE_TITLE,
      place: null,
      name: null,
      text:
        "# Release checklist\n\n- tag the release\n- update the migration notes\n",
      media_type: "text/markdown",
    }),
  () => ({ text: "Written.", usage: { input: 40, output: 4 }, stop: "end" }),
  // 2: 자리 없는 문서와 프로젝트를 읽고 선택지와 추천을 묻는다.
  () => agentToolCall("toolu_loose", "document.list", { place: null }),
  () => agentToolCall("toolu_projects", "project.list", {}),
  () =>
    agentToolCall("toolu_ask", "question.submit", {
      prompt: PLACE_PROMPT,
      reason: "moving a document changes where everyone finds it",
      options: [
        placeOption("alpha", "Move to Alpha", MOVE_DESCRIPTION),
        placeOption(
          "keep",
          "Leave it without a place",
          "Document: Release checklist. Now: no place. Nothing changes.",
        ),
      ],
      recommendation: {
        option_key: "alpha",
        explanation: "It tracks the migration notes kept in Alpha.",
      },
      expires_at: null,
    }),
  // 질문을 낸 run은 답을 기다리므로 model을 다시 부르지 않는다.
];

Deno.test({
  name:
    "lophn-agent/roles/lophn#R14 lophn-agent/questions#R6 lophn-agent/questions#R8 documents/addressing#R3 flow organize-documents 2·3: lophn이 자리 없는 문서의 자리를 선택지와 추천 이유로 묻고, 고르기·미루기로는 옮기지 않는다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const folder = await Deno.realPath(await copyFixture("korean-search"));
    const provider = startAgentProvider(AGENT_STEPS);
    const flow = await openFlowShell({ start: "lophn" });
    try {
      await mustCall(flow, {
        kind: "command",
        resource: "providers",
        method: "register",
        body: commandBody({
          id: AGENT_PROVIDER,
          name: "fixture",
          definition: {
            key: "anthropic",
            display_name: "Anthropic",
            protocols: ["anthropic-messages"],
            auth_kinds: ["none"],
            models_endpoint: null,
            oauth: null,
            revision: "2026-01-01",
          },
          endpoint: provider.url,
          protocol: "anthropic-messages",
        }),
      });
      const defaults = await mustCall(flow, {
        kind: "read",
        resource: "agent-model-defaults",
        method: "read",
        body: {},
      });
      const seq = (defaults.defaults as { settings_seq: string }).settings_seq;
      await mustCall(flow, {
        kind: "command",
        resource: "agent-model-defaults",
        method: "change",
        body: commandBody(
          {
            judgment: {
              provider: AGENT_PROVIDER,
              credentials: [],
              model_name: AGENT_MODEL,
              reasoning_level: "provider_default",
              options: {},
            },
            organizing: null,
            settings_seq: seq,
          },
          { settings_seq: seq },
        ),
      });
      await registerTrackedProject(flow, { folder });
      await untilDocuments(flow, ["migration"], "문서가 되지 않았다");
      const assignments = await mustCall(flow, {
        kind: "read",
        resource: "assignments",
        method: "list",
        body: {},
      });
      const agent = (assignments.assignments as { id: string; role: string }[])
        .find((entry) => entry.role === "lophn");
      assert(agent !== undefined, "lophn assignment가 없다");
      const runsOf = async () =>
        (await mustCall(flow, {
          kind: "read",
          resource: "runs",
          method: "list",
          body: { assignment: agent.id },
        })).runs as { state: string; outcome: { kind: string } | null }[];
      const untilRuns = async (count: number) => {
        const deadline = Date.now() + 180_000;
        for (;;) {
          const rows = await runsOf();
          if (
            rows.length === count &&
            rows.every((row) =>
              row.outcome !== null || row.state === "waiting_user"
            )
          ) return rows;
          assert(
            Date.now() < deadline,
            `run이 끝나지 않았다: ${
              JSON.stringify(rows)
            } calls=${provider.calls()}`,
          );
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      };
      const questions = async () =>
        (await mustCall(flow, {
          kind: "read",
          resource: "questions",
          method: "list",
          body: {},
        })).questions as {
          id: string;
          status: string;
          answer: unknown;
          closed_reason: string | null;
        }[];
      const placeOf = async (document: string) =>
        ((await mustCall(flow, {
          kind: "read",
          resource: "documents",
          method: "get",
          body: { document },
        })).document as { place: unknown }).place;

      await flow.until(
        `document.querySelector("[data-dock-toggle]") !== null`,
        "도크 토글이 없다",
      );
      await flow.click("[data-dock-toggle]");
      await flow.until(
        `document.querySelector("[data-new-session]") !== null || document.querySelector(${
          JSON.stringify(COMPOSER)
        }) !== null`,
        "새 세션 단추가 서지 않았다",
      );
      if (
        await flow.evaluate(
          `document.querySelector(${JSON.stringify(COMPOSER)}) === null`,
        ) === true
      ) {
        await flow.click("[data-new-session]");
      }
      await flow.until(
        `document.querySelector(${JSON.stringify(COMPOSER)}) !== null`,
        "입력칸이 서지 않았다",
      );
      await flow.type(COMPOSER, "Write a release checklist.");
      await flow.click(SEND_BUTTON);
      await untilRuns(1);
      const loose = await documentTitled(flow, LOOSE_TITLE);
      assertEquals(await placeOf(loose.id), null);

      await t.step(
        "lophn-agent/roles/lophn#R1 lophn-agent/roles/lophn#R14 documents/addressing#R3: 2 자리를 물으면 자리 없는 문서와 프로젝트를 읽고 문서·현재 자리·새 자리를 적은 선택지와 추천 이유를 묻는다",
        async () => {
          await flow.type(COMPOSER, PLACE_ASK);
          await flow.click(SEND_BUTTON);
          const rows = await untilRuns(2);
          // 질문을 낸 run은 답을 기다린다.
          assertEquals(rows[1]?.state, "waiting_user");
          assertEquals(provider.calls(), 5);
          // 자리 없는 문서 목록에 그 문서가 있고, 프로젝트 목록에 Alpha가 있다.
          assert(
            provider.body(3).includes(loose.id),
            "자리 없는 문서 목록에 그 문서가 없다",
          );
          assert(provider.body(4).includes("alpha"), "프로젝트 목록이 없다");
          await flow.until(
            `document.querySelector(${
              JSON.stringify(READY_QUESTION)
            })?.textContent === ${JSON.stringify(PLACE_PROMPT)}`,
            "질문이 칸에 서지 않았다",
            120_000,
          );
          assertEquals(
            await flow.text(
              "[data-option='alpha'] [data-option-description]",
            ),
            MOVE_DESCRIPTION,
          );
          assertEquals(await flow.count("[data-recommended]"), 1);
          assertStringIncludes(
            (await flow.text("[data-recommendation]")) ?? "",
            "It tracks the migration notes kept in Alpha.",
          );
          const [question] = await questions();
          assertEquals(question?.status, "pending");
          // 묻는 것만으로는 옮기지 않는다.
          assertEquals(await placeOf(loose.id), null);
        },
      );

      await t.step(
        "lophn-agent/questions#R6 lophn-agent/questions#R8: 3 고르기만으로는 답도 이동도 아니고 미루면 답 없음으로 남고 자리는 그대로다",
        async () => {
          const [question] = await questions();
          assert(question !== undefined, "질문이 없다");
          await flow.click("[data-option='alpha']");
          await flow.until(
            `document.querySelector("[data-option='alpha']")?.getAttribute("aria-checked") === "true"`,
            "선택지가 골라지지 않았다",
          );
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          const picked = (await questions()).find((row) =>
            row.id === question.id
          );
          assertEquals(picked?.status, "pending");
          assertEquals(picked?.answer, null);
          assertEquals(await placeOf(loose.id), null);

          await flow.click("[data-later]");
          const deadline = Date.now() + 60_000;
          let row = picked;
          while (row?.status !== "cancelled") {
            assert(
              Date.now() < deadline,
              `미루기가 접수되지 않았다: ${JSON.stringify(row)}`,
            );
            await new Promise((resolve) => setTimeout(resolve, 250));
            row = (await questions()).find((item) => item.id === question.id);
          }
          assertEquals(row.closed_reason, "deferred");
          assertEquals(row.answer, null);
          assertEquals(await placeOf(loose.id), null);
          // 미루면 질문을 낸 run은 답 없음으로 끝난다.
          for (;;) {
            const second = (await runsOf())[1];
            if (second?.outcome?.kind === "stopped") break;
            assert(
              Date.now() < deadline + 60_000,
              "run이 답 없음으로 끝나지 않았다",
            );
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
          // 고르지 않은 추천이 나중에 적용되지 않는다: 다른 run도 이동도 없다.
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          assertEquals((await runsOf()).length, 2);
          assertEquals(await placeOf(loose.id), null);
        },
      );
    } finally {
      await flow.close();
      await removeHome(flow.home);
      await provider.close();
      await Deno.remove(folder, { recursive: true });
    }
  },
});
