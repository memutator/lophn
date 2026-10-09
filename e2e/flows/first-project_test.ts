// documents slice flow E2E: first-project(docs/flows/first-project.md). 실제 shell(headless)·core·
// documents worker·I/O worker·format runner를 임시 LOPHN_HOME으로 띄우고 예시 project 폴더
// fixture(notes-basic, multi-folder, mixed-formats)를 사람이 등록한 프로젝트로 쓴다.
// - 3·5·6·7·8과 다른 갈래(등록만으로는 추적하지 않음, 겹침 거절, 미지원 형식, 추적을 꺼도 판은 남음)
//   를 실제 core 경로로 본다. 8의 "준비된 문서를 열어 읽는다"는 lophn 공간 documents 화면에서 본다.
// - 1·2·4는 실제 화면으로 돈다: launcher의 [프로젝트 등록] dialog(이름·목적·OS 폴더 선택기, headless는
//   `LOPHN_SHELL_PICK_FOLDER`가 고른 폴더를 돌려준다) → 그 프로젝트 작업대의 추적 꺼짐 안내 →
//   [Turn on tracking] dialog의 기본 규칙(Markdown, .gitignore)과 포함·제외 미리보기 → 그만두기와 켜기.
//   다른 시험은 같은 사람 command를 core 통로로 내 준비한다(registerProject·setTracking).
import { assert, assertEquals } from "@std/assert";

import {
  copyFixture,
  editExternally,
} from "../../fixtures/projects/scenarios.ts";
import { e2eEnabled } from "../harness.ts";
import {
  delay,
  documentTitled,
  listDocuments,
  mustCall,
  openFlowShell,
  registerProject,
  registerTrackedProject,
  removeHome,
  searchOnce,
  setTracking,
  untilDocuments,
  untilSearch,
} from "../flow-support.ts";

const OTHER_PROJECT = "prj_01arz3ndektsv4rrffq69g5fb0";

type ProjectRow = {
  id: string;
  title: string;
  purpose: string;
  folders: { path: string }[];
  tracking: { enabled: boolean };
};

async function projectRows(
  flow: Awaited<ReturnType<typeof openFlowShell>>,
): Promise<ProjectRow[]> {
  const listed = await mustCall(flow, {
    kind: "read",
    resource: "projects",
    method: "list",
    body: {},
  });
  return (listed.projects as { project: ProjectRow }[] | ProjectRow[]).map((
    row,
  ) => ("project" in row ? row.project : row));
}

Deno.test({
  name:
    "documents/projects#R1 documents/projects#R2 documents/projects#R3 documents/projects#R6 shell/desktop#R25 shell/desktop#R28 flow first-project: 1·2·4 launcher에서 폴더를 골라 등록하고 작업대에서 미리본 범위로 추적을 켠다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const folder = await Deno.realPath(await copyFixture("notes-basic"));
    const flow = await openFlowShell({ pickFolder: folder });
    try {
      await t.step(
        "documents/projects#R1 documents/projects#R2 shell/desktop#R25: 1 기본 프로젝트 없이 launcher에서 이름·목적·폴더를 정해 등록한다",
        async () => {
          await flow.until(
            `document.querySelector('[data-space="launcher"] [data-section="projects"] [data-cards="empty"] button') !== null`,
            "launcher가 서지 않았다",
          );
          // lophn은 기본 프로젝트를 만들지 않는다. 빈 카드 자리의 등록 단추로 시작한다.
          assertEquals(await flow.count("[data-card=project]"), 0);
          assertEquals(await projectRows(flow), []);
          await flow.click(
            '[data-section="projects"] [data-cards="empty"] button',
          );
          await flow.until(
            `document.querySelector("[data-register-form]") !== null`,
            "등록 dialog가 열리지 않았다",
          );
          await flow.type("[data-field=name]", "Field Notes");
          await flow.type("[data-field=purpose]", "Notes from the field.");
          await flow.click("[data-add-folder]");
          await flow.until(
            `document.querySelector(${
              JSON.stringify(`[data-folder="${folder}"]`)
            }) !== null`,
            "고른 폴더가 등록 dialog에 오르지 않았다",
          );
          await flow.click("[data-register]");
          // 등록 다음 단계(추적을 켤지)는 그 프로젝트의 작업대에서 정한다.
          await flow.until(
            `document.querySelector('[data-space="project"]') !== null`,
            "등록한 프로젝트의 작업대로 가지 않았다",
          );
          const rows = await projectRows(flow);
          assertEquals(rows.length, 1);
          assertEquals(rows[0]!.title, "Field Notes");
          assertEquals(rows[0]!.purpose, "Notes from the field.");
          assertEquals(rows[0]!.folders.map((row) => row.path), [folder]);
          assertEquals(rows[0]!.tracking.enabled, false);
        },
      );

      await t.step(
        "documents/projects#R3 documents/projects#R8 shell/desktop#R28: 2 등록 직후에는 추적하지 않고 처음 켤 때 Markdown과 .gitignore를 기본으로 제안한다",
        async () => {
          await flow.until(
            `document.querySelector("[data-tracking=off] [data-turn-on-tracking]") !== null`,
            "추적 꺼짐 안내가 없다",
          );
          await delay(3_000);
          assertEquals(await listDocuments(flow), []);
          await flow.click("[data-turn-on-tracking]");
          await flow.until(
            `document.querySelector("[data-tracking-dialog] [data-preview=ready]") !== null`,
            "추적 미리보기가 준비되지 않았다",
          );
          const rules = await flow.text("[data-rules]") ?? "";
          assert(rules.includes("*.md"), rules);
          assert(/gitignore/i.test(rules), rules);
        },
      );

      await t.step(
        "documents/projects#R6 documents/projects#R3: 4 포함·제외 파일과 이유를 미리보고, 그만두면 켜지 않으며 켜면 그 범위만 판이 된다",
        async () => {
          const tracked = await flow.evaluate(`JSON.stringify(
            [...document.querySelectorAll("[data-group=tracked] [data-entry]")]
              .map((el) => el.getAttribute("data-entry")))`);
          const leftOut = await flow.evaluate(`JSON.stringify(
            [...document.querySelectorAll("[data-group=left-out] [data-entry]")]
              .map((el) => el.getAttribute("data-entry")))`);
          const include = JSON.parse(String(tracked)) as string[];
          const exclude = JSON.parse(String(leftOut)) as string[];
          assert(include.includes("index.md"), String(tracked));
          assert(include.includes("deep/sub/inner.md"), String(tracked));
          assert(exclude.includes("notes.txt"), String(leftOut));
          assert(exclude.includes("private.secret.md"), String(leftOut));
          assertEquals(include.includes("private.secret.md"), false);
          assert(
            (await flow.text("[data-count=tracked]"))?.includes("9"),
            await flow.text("[data-count=tracked]") ?? "",
          );

          // 미리보기를 그만두면 추적을 켜지 않는다.
          const cancelled = await flow.evaluate(`(() => {
            const button = [...document.querySelectorAll("[role=dialog] button")]
              .find((el) => el.textContent?.trim() === "Cancel");
            if (!button) return false;
            button.click();
            return true;
          })()`);
          assertEquals(cancelled, true);
          await flow.until(
            `document.querySelector("[data-tracking-dialog]") === null`,
            "추적 dialog가 닫히지 않았다",
          );
          await delay(2_000);
          assertEquals((await projectRows(flow))[0]!.tracking.enabled, false);
          assertEquals(await listDocuments(flow), []);

          // 다시 열어 같은 범위로 켠다.
          await flow.click("[data-turn-on-tracking]");
          await flow.until(
            `document.querySelector("[data-tracking-dialog] [data-preview=ready]") !== null && !document.querySelector("[data-apply-tracking]").disabled`,
            "추적 미리보기가 다시 준비되지 않았다",
          );
          await flow.click("[data-apply-tracking]");
          await flow.until(
            `document.querySelector("[data-tracking-dialog]") === null && document.querySelector("[data-tracking=off]") === null`,
            "추적을 켠 뒤에도 꺼짐 안내가 남았다",
          );
          assertEquals((await projectRows(flow))[0]!.tracking.enabled, true);
          await untilDocuments(
            flow,
            ["index", "outer", "inner", "setext", "fenced"],
            "켠 범위의 파일이 문서가 되지 않았다",
          );
          await delay(3_000);
          const titles = (await listDocuments(flow)).map((row) => row.title);
          for (const excluded of ["hidden", "private.secret", "notes"]) {
            assertEquals(titles.includes(excluded), false, excluded);
          }
          assertEquals(titles.length, include.length, titles.join(","));
        },
      );
    } finally {
      await flow.close();
      await removeHome(flow.home);
      await Deno.remove(folder, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "documents/projects#R3 documents/file-tracking#R9 documents/projects#R6 flow first-project: 등록만으로는 추적하지 않고 켠 범위의 파일만 판이 되어 읽는다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const folder = await Deno.realPath(await copyFixture("notes-basic"));
    const flow = await openFlowShell({ start: "lophn" });
    try {
      const registered = await registerProject(flow, { folder });

      await t.step(
        "documents/projects#R3 documents/file-tracking#R9: 1·2 등록 직후에는 추적하지 않아 파일이 문서가 되지 않는다",
        async () => {
          // 폴더에 Markdown 파일이 있어도 추적을 켜기 전에는 문서가 없다.
          await delay(4_000);
          assertEquals(await listDocuments(flow), []);
          const found = await searchOnce(flow, "문서");
          assertEquals(found.results, []);
        },
      );

      await t.step(
        "documents/projects#R4 documents/file-tracking#R1 documents/versions#R5: 3·5·6 추적을 켜면 규칙에 든 파일만 고정 판이 되고 .gitignore에 걸리거나 규칙 밖인 파일은 제외한다",
        async () => {
          const applied = await setTracking(
            flow,
            registered.project,
            registered.revision,
            { folder, globs: ["**/*.md"], useGitignore: true },
          );
          assert(applied.ok, JSON.stringify(applied));
          await untilDocuments(
            flow,
            ["index", "outer", "inner", "setext", "fenced"],
            "추적한 파일이 문서가 되지 않았다",
          );
          // 파일 관측이 한 번 훑는 동안을 기다린 뒤 전체를 본다.
          await delay(3_000);
          const titles = (await listDocuments(flow)).map((row) => row.title)
            .sort();
          // 제외: ignored/ 폴더, *.secret.md(.gitignore), 규칙 밖의 notes.txt.
          for (const excluded of ["hidden", "private.secret", "notes"]) {
            assertEquals(
              titles.includes(excluded),
              false,
              `제외한 파일이 문서가 되었다: ${excluded}`,
            );
          }
          assertEquals(titles.length, 9, titles.join(","));
          // 각 문서의 첫 판은 새 판 하나다.
          const index = await documentTitled(flow, "index");
          assertEquals(index.format, "document");
        },
      );

      await t.step(
        "documents/outline-and-search#R13 documents/outline-and-search#R15 documents/file-tracking#R9: 7·8 목차·검색은 판을 뒤따라 반영되고 사람은 준비된 문서부터 열어 읽는다",
        async () => {
          const index = await documentTitled(flow, "index");
          const page = await untilSearch(
            flow,
            "index",
            () => true,
            "index가 따라오지 않았다",
          );
          assertEquals(page.coverage.rebuilding, false);
          // 본문은 문서 화면에서 연다(링크로 고르지 않고 목록의 문서 id로).
          const outline = await mustCall(flow, {
            kind: "worker",
            resource: "outline",
            method: "document",
            body: {
              reference: { document: index.id, version: null, section: null },
            },
          });
          assertEquals(outline.document, index.id);
          assert((outline.entries as unknown[]).length > 0);
          // 파일을 밖에서 고치면 같은 문서의 다음 판이 되고 옛 판은 그대로 읽힌다.
          await editExternally(
            folder,
            "index.md",
            "# 색인\n\n밖에서 고친 내용이다.\n",
          );
          const deadline = Date.now() + 60_000;
          for (;;) {
            const now = await documentTitled(flow, "index");
            if (now.latest_version !== index.latest_version) break;
            assert(Date.now() < deadline, "고친 파일이 새 판이 되지 않았다");
            await delay(250);
          }
          const first = await mustCall(flow, {
            kind: "worker",
            resource: "documents",
            method: "read",
            body: {
              reference: {
                document: index.id,
                version: index.latest_version,
                section: null,
              },
            },
          });
          assertEquals(first.version, index.latest_version);
          assertEquals(
            String(first.text).includes("밖에서 고친 내용"),
            false,
            "옛 판에 새 내용이 섞였다",
          );
        },
      );

      await t.step(
        "documents/projects#R11 documents/file-tracking#R8 documents/versions#R11: 추적을 꺼도 이미 확정한 판은 그대로 읽는다",
        async () => {
          const before = await listDocuments(flow);
          const current = await mustCall(flow, {
            kind: "read",
            resource: "projects",
            method: "get",
            body: { project: registered.project },
          });
          const turnedOff = await setTracking(
            flow,
            registered.project,
            String((current.project as { revision: string }).revision),
            { folder, globs: [], enabled: false },
          );
          assert(turnedOff.ok, JSON.stringify(turnedOff));
          const after = await listDocuments(flow);
          assertEquals(after.length, before.length);
          const index = after.find((row) => row.title === "index");
          assert(index !== undefined);
          const outline = await mustCall(flow, {
            kind: "worker",
            resource: "outline",
            method: "document",
            body: {
              reference: { document: index.id, version: null, section: null },
            },
          });
          assertEquals(outline.document, index.id);
        },
      );
    } finally {
      await flow.close();
      await removeHome(flow.home);
      await Deno.remove(folder, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "documents/projects#R6 documents/projects#R7 flow first-project: 다른 켜진 추적 폴더와 범위가 겹치면 적용을 거절하고 현재 범위를 그대로 둔다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const root = await Deno.realPath(await copyFixture("multi-folder"));
    const outer = `${root}/root-a`;
    const inner = `${root}/root-a/nested/inner-root`;
    const flow = await openFlowShell({ start: "lophn" });
    try {
      await registerTrackedProject(flow, { folder: outer });
      await untilDocuments(flow, ["plan", "readme"], "문서가 되지 않았다");
      const before = (await listDocuments(flow)).length;
      // 바깥 폴더 안의 중첩 폴더를 다른 프로젝트로 등록해 추적을 켜려 하면 거절한다.
      const second = await registerProject(flow, {
        folder: inner,
        id: OTHER_PROJECT,
        name: "inner",
        title: "Inner",
      });
      const refused = await setTracking(
        flow,
        second.project,
        second.revision,
        { folder: inner },
      );
      assertEquals(refused.ok, false, JSON.stringify(refused));
      assertEquals(refused.error?.code, "conflict");
      // 첫 프로젝트의 추적은 그대로고 문서도 늘지 않는다.
      await delay(2_000);
      assertEquals((await listDocuments(flow)).length, before);
      assert(
        (await mustCall(flow, {
          kind: "read",
          resource: "projects",
          method: "list",
          body: {},
        })).projects !== undefined,
      );
    } finally {
      await flow.close();
      await removeHome(flow.home);
      await Deno.remove(root, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "documents/formats#R3 documents/formats#R20 documents/outline-and-search#R22 flow first-project: 지원하지 않는 형식도 원문 판은 보존하고 검색 구조 미지원으로 구별한다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const folder = await Deno.realPath(await copyFixture("mixed-formats"));
    const flow = await openFlowShell({ start: "lophn" });
    try {
      await registerTrackedProject(flow, { folder, globs: ["**/*"] });
      await untilDocuments(
        flow,
        ["sample", "pixel", "blob", "plain"],
        "파일이 문서가 되지 않았다",
      );
      // 판은 확정되고 format은 추론한다(PDF·image·data).
      const formats = new Map(
        (await listDocuments(flow)).map((row) => [row.title, row.format]),
      );
      assertEquals(formats.get("sample"), "pdf");
      assertEquals(formats.get("pixel"), "image");
      // 구조를 읽지 못하는 판은 검색 누락으로 알리고, 빈 검색을 원문 부재로 말하지 않는다.
      const page = await untilSearch(
        flow,
        "plain",
        (found) => found.coverage.omissions.length >= 3,
        "미지원 판이 누락으로 오르지 않았다",
      );
      assert(page.coverage.omissions.length >= 3);
      for (const title of ["sample", "pixel"]) {
        const row = await documentTitled(flow, title);
        const outline = await mustCall(flow, {
          kind: "worker",
          resource: "outline",
          method: "document",
          body: {
            reference: { document: row.id, version: null, section: null },
          },
        });
        assertEquals(outline.section_status, "unsupported");
      }
    } finally {
      await flow.close();
      await removeHome(flow.home);
      await Deno.remove(folder, { recursive: true });
    }
  },
});
