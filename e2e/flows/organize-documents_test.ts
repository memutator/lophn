// documents slice flow E2E: organize-documents(docs/flows/organize-documents.md). 실제 shell
// (headless)·core·documents worker·format runner를 임시 LOPHN_HOME으로 띄우고 예시 project
// 폴더 fixture(korean-search)를 사람이 등록한 프로젝트로 추적한다.
// - 4(자리를 옮기고 이름을 바꿔도 같은 문서와 옛 참조, 원본 파일은 그대로)와 5(보관한 뒤에도
//   고정 판 읽기)와 다른 갈래(이름 충돌, 옛 예약 이름)를 사람 command와 documents 화면으로 본다.
// - 사람 직접 이동은 문서 이동·이름 변경 command를 core 통로로 낸다. 이를 부르는 화면(projects
//   화면의 이름 변경·보관·export, documents 화면의 이동) 중 이름 변경·export는 아래 1·6·7 시험이
//   실제 projects 화면으로 본다. 2·3(lophn 역할 추천과 question)은 agent slice E2E 몫이다(documents plan Q4).
import { assert, assertEquals, assertStringIncludes } from "@std/assert";

import { copyFixture } from "../../fixtures/projects/scenarios.ts";
import { e2eEnabled } from "../harness.ts";
import {
  commandBody,
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
