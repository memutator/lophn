// documents slice flow E2E: find-documents(docs/flows/find-documents.md). 실제 shell(headless)·core·
// documents worker·I/O worker·format runner를 임시 LOPHN_HOME으로 띄우고, 예시 project 폴더
// fixture(korean-search)를 사람이 등록한 프로젝트로 추적한다. 파일 관측 → 판 → 목차·검색 반영까지
// 실제 경로고, 화면은 lophn 공간의 documents 화면이다.
// - 1·2·3·4·7과 다른 갈래(빈 검색, 보관, section 미지원, 지연·누락)를 이 화면으로 본다.
// - 프로젝트 등록과 추적 켜기는 launcher 화면(shell#T15)이 아직 없어 같은 사람 command를 core
//   통로로 낸다. 5·6(agent·coding agent 읽기)은 agent slice E2E 몫이다(documents plan Q4).
import { assert, assertEquals, assertStringIncludes } from "@std/assert";

import {
  copyFixture,
  editExternally,
  fixturePath,
} from "../../fixtures/projects/scenarios.ts";
import { e2eEnabled } from "../harness.ts";
import {
  commandBody,
  delay,
  documentTitled,
  type FlowShell,
  listDocuments,
  mustCall,
  openFlowShell,
  registerTrackedProject,
  removeHome,
  untilDocuments,
  untilSearch,
  untilSectionStatus,
} from "../flow-support.ts";

const HITS = "[data-hits] [data-hit]";

/** 검색어를 쓰고 검색한다. */
async function search(flow: FlowShell, query: string): Promise<void> {
  await flow.type("[data-search-input]", query);
  await flow.click("[data-search-submit]");
}

/** 문서 링크 입력으로 문서를 연다. */
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

/** 읽는 문서가 바뀔 때까지 기다린 뒤 머리가 그려질 때까지. */
async function untilReading(flow: FlowShell, document: string): Promise<void> {
  await flow.until(
    `document.querySelector('[data-reader="${document}"] [data-reader-meta]') !== null`,
    "문서를 읽지 못했다",
  );
}

Deno.test({
  name:
    "documents/outline-and-search#R1 documents/addressing#R3 flow find-documents: 검색 → 목차 → section → saved view → 지정한 판과 옛 참조",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const folder = await Deno.realPath(await copyFixture("korean-search"));
    // section 추출을 지원하지 않는 PDF 하나도 같은 프로젝트에 둔다(검색 누락 갈래).
    await Deno.mkdir(`${folder}/attachments`);
    await Deno.copyFile(
      `${fixturePath("mixed-formats")}/sample.pdf`,
      `${folder}/attachments/sample.pdf`,
    );
    const flow = await openFlowShell({ start: "lophn" });
    try {
      await registerTrackedProject(flow, {
        folder,
        globs: ["**/*.md", "**/*.pdf"],
      });
      await untilDocuments(
        flow,
        ["glossary", "migration", "sample"],
        "추적한 파일이 문서가 되지 않았다",
      );
      await untilSearch(
        flow,
        "문서",
        (page) =>
          page.results.length >= 2 && page.coverage.omissions.length === 1,
        "index가 따라오지 않았다",
      );
      const glossary = await documentTitled(flow, "glossary");

      await t.step(
        "documents/outline-and-search#R1 documents/outline-and-search#R12 documents/addressing#R3: 1 검색 목록은 제목과 짧은 근거만 보이고 본문은 열기 전까지 읽지 않고 관측한 문서는 그 프로젝트에 놓여 찾는다",
        async () => {
          // 폴더에서 관측해 만든 문서는 그 프로젝트의 문서고 파일 이름이 문서 이름이다(documents Q31).
          assertEquals(glossary.name, "glossary");
          await search(flow, "문서");
          await flow.until(
            `document.querySelectorAll(${JSON.stringify(HITS)}).length >= 2`,
            "검색 결과가 오지 않았다",
          );
          const snippets = await flow.texts("[data-hits] [data-snippet]");
          assert(snippets.length >= 2);
          for (const snippet of snippets) {
            assert(snippet.trim() !== "", "근거가 비었다");
            assert(snippet.length <= 120, `근거가 길다: ${snippet.length}`);
          }
          // 본문은 열기 전까지 읽지 않는다: 읽는 칸도 본문도 없다.
          assertEquals(await flow.count("[data-reader]"), 0);
          assertEquals(await flow.count("[data-body]"), 0);
          assertEquals(
            await flow.count(`[data-hits] [data-hit="${glossary.id}"]`) > 0,
            true,
          );
        },
      );

      await t.step(
        "documents/outline-and-search#R7 documents/outline-and-search#R8: 3 문서를 열어 목차에서 section을 고르면 그 범위만 읽고 같은 고정 최신 판을 유지한다",
        async () => {
          await flow.click(`[data-hits] [data-hit="${glossary.id}"]`);
          await untilReading(flow, glossary.id);
          assertEquals(
            await flow.evaluate(
              `document.querySelector("[data-version-state]").getAttribute("data-version-state")`,
            ),
            "latest",
          );
          const toc = "[data-placement=head] button[role=combobox]";
          await flow.choose(toc, "용어");
          await flow.until(
            `document.querySelector("[data-body]")?.textContent.includes("뜻이 고정된 말")`,
            "section 본문이 오지 않았다",
          );
          const section = await flow.text("[data-body]");
          assertStringIncludes(section!, "용어는 뜻이 고정된 말이다");
          // 고른 section의 범위만이다. 다른 section 본문은 아직 읽지 않았다.
          assertEquals(section!.includes("한 정본을 가지는"), false);
          await flow.choose(toc, "Whole document");
          await flow.until(
            `document.querySelector("[data-body]")?.textContent.includes("한 정본을 가지는")`,
            "전체 본문이 오지 않았다",
          );
          // 이어 읽기가 필요 없는 짧은 문서다. 끝까지 읽었으면 이어 읽기 단추가 없다.
          assertEquals(await flow.count("[data-read-more]"), 0);
        },
      );

      await t.step(
        "documents/outline-and-search#R23 documents/outline-and-search#R24: 2 조건을 saved view로 저장하고 열 때마다 지금 문서를 다시 찾는다",
        async () => {
          await search(flow, "문서");
          await flow.until(
            `document.querySelectorAll(${JSON.stringify(HITS)}).length >= 2`,
            "검색 결과가 오지 않았다",
          );
          await flow.click("[data-save-view]");
          await flow.until(
            `document.querySelector("[data-view-name]") !== null`,
            "view 이름 입력이 열리지 않았다",
          );
          await flow.type("[data-view-name]", "문서 찾기");
          await flow.click("[data-save-view-submit]");
          await flow.until(
            `document.querySelector("[data-view-saved]") !== null`,
            "저장했다는 알림이 없다",
          );
          await flow.mouseClickText("[role=tab]", "Saved views");
          await flow.until(
            `document.querySelectorAll("[data-view]").length === 1`,
            "저장한 view가 목록에 없다",
          );
          await flow.click("[data-view]");
          await flow.until(
            `document.querySelector("[data-opened-view]") !== null`,
            "view가 열리지 않았다",
          );
          const before = await flow.count("[data-opened-view] [data-hit]");
          assert(before >= 2, `view 문서가 모자라다: ${before}`);
          // 조건에 맞는 새 문서가 생기면 같은 view를 다시 열 때 그 문서도 있다. 옛 목록 사본은 없다.
          await Deno.writeTextFile(
            `${folder}/notes.md`,
            "# 메모\n\n새 문서에도 문서라는 말이 나온다.\n",
          );
          await untilDocuments(flow, ["notes"], "새 파일이 문서가 되지 않았다");
          const notes = await documentTitled(flow, "notes");
          await untilSearch(
            flow,
            "문서",
            (page) => page.results.some((row) => row.document === notes.id),
            "새 문서가 index에 오르지 않았다",
          );
          await flow.click("[data-view]");
          await flow.until(
            `document.querySelector('[data-opened-view] [data-hit="${notes.id}"]') !== null`,
            "다시 연 view에 새 문서가 없다",
          );
          assertEquals(
            await flow.count("[data-opened-view] [data-hit]"),
            before + 1,
          );
          await flow.mouseClickText("[role=tab]", "Search");
        },
      );

      await t.step(
        "documents/versions#R6 documents/versions#R8 documents/addressing#R5 documents/addressing#R6 documents/addressing#R7: 4 지정한 판은 당시 내용으로 열고 최신 판을 따로 알리며 이름이 바뀐 옛 참조는 같은 문서로 안내한다",
        async () => {
          // 관측한 문서는 프로젝트와 이름이 있어 주소(alpha/glossary)로 닿는다.
          assertEquals(glossary.name, "glossary");
          // 밖에서 파일을 고쳐 두 번째 판을 만든다.
          await editExternally(
            folder,
            "glossary.md",
            "# 용어집\n\n## 문서\n\n문서는 이제 판으로 남는다.\n\n## 용어\n\n용어는 바뀐 뜻을 가진다.\n",
          );
          const deadline = Date.now() + 60_000;
          for (;;) {
            const now = await documentTitled(flow, "glossary");
            if (now.latest_version !== glossary.latest_version) break;
            assert(Date.now() < deadline, "두 번째 판이 확정되지 않았다");
            await delay(250);
          }
          // 새 판의 목차·검색이 따라온 뒤에 연다(반영 전에는 구조를 아직 읽지 못한 판이다).
          await untilSearch(
            flow,
            "판으로 남는다",
            (page) => page.results.some((row) => row.document === glossary.id),
            "새 판이 index에 오르지 않았다",
          );
          await openLink(flow, "alpha/glossary@1");
          await flow.until(
            `document.querySelector("[data-link-pinned]") !== null`,
            "지정한 판 알림이 없다",
          );
          assertEquals(
            await flow.evaluate(
              `document.querySelector("[data-version-state]").getAttribute("data-version-state")`,
            ),
            "older",
          );
          await flow.until(
            `document.querySelector("[data-body]")?.textContent.includes("정본을 가지는")`,
            "당시 내용이 오지 않았다",
          );
          // 당시 내용만 읽힌다. 최신 판의 내용은 섞이지 않는다.
          assertEquals(
            (await flow.text("[data-body]"))!.includes("판으로 남는다"),
            false,
          );
          await flow.click("[data-open-latest]");
          await flow.until(
            `document.querySelector("[data-body]")?.textContent.includes("판으로 남는다")`,
            "최신 판 내용이 오지 않았다",
          );
          assertEquals(
            await flow.evaluate(
              `document.querySelector("[data-version-state]").getAttribute("data-version-state")`,
            ),
            "latest",
          );

          // 이름이 바뀌어도 옛 참조는 같은 문서로 안내한다.
          const current = await documentTitled(flow, "glossary");
          await mustCall(flow, {
            kind: "command",
            resource: "documents",
            method: "rename",
            body: commandBody(
              { document: current.id, name: "terms" },
              { base_revision: current.revision },
            ),
          });
          await openLink(flow, "alpha/glossary");
          await flow.until(
            `document.querySelector("[data-link-moved]") !== null`,
            "옮겨졌다는 안내가 없다",
          );
          assertStringIncludes(
            (await flow.text("[data-link-moved]"))!,
            "alpha/terms",
          );
          await flow.until(
            `document.querySelector('[data-reader="${glossary.id}"] [data-body]') !== null`,
            "같은 문서를 열지 못했다",
          );
        },
      );

      await t.step(
        "documents/outline-and-search#R14 documents/outline-and-search#R22 documents/formats#R20: 7 지원하지 않는 format은 검색 누락으로 알리고 section 미지원을 문서 없음과 구별한다",
        async () => {
          await search(flow, "문서");
          await flow.until(
            `document.querySelector("[data-coverage-note=omissions]") !== null`,
            "검색 누락 안내가 없다",
          );
          assertStringIncludes(
            (await flow.text("[data-coverage-note=omissions]"))!,
            "1",
          );
          // 결과가 없는 검색도 원본이 없다는 말을 하지 않고 다시 찾기를 권한다.
          await search(flow, "존재하지않는낱말");
          await flow.until(
            `document.querySelector("[data-results]") !== null && document.querySelectorAll(${
              JSON.stringify(HITS)
            }).length === 0`,
            "빈 결과가 오지 않았다",
          );
          assertEquals(
            (await flow.texts("button")).some((text) =>
              text.trim() === "Search again"
            ),
            true,
          );
          // PDF는 원문을 읽을 수 있지만 section 구조는 지원하지 않는다. 문서가 없다는 말이 아니다.
          const pdf = await documentTitled(flow, "sample");
          await untilSectionStatus(
            flow,
            pdf.id,
            "unsupported",
            "PDF의 section 상태가 정해지지 않았다",
          );
          assertEquals(pdf.name, "sample");
          await openLink(flow, "alpha/sample");
          await flow.until(
            `document.querySelector("[data-section-status]") !== null`,
            "section 상태 안내가 없다",
          );
          assertEquals(
            await flow.evaluate(
              `document.querySelector("[data-section-status]").getAttribute("data-section-status")`,
            ),
            "unsupported",
          );
          assertEquals(await flow.count("[data-body-failed]"), 0);
          assertEquals(await flow.count("[data-reader-failed]"), 0);
          assertEquals(
            (await listDocuments(flow)).some((row) => row.id === pdf.id),
            true,
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

Deno.test({
  name:
    "documents/outline-and-search#R17 documents/versions#R11 flow find-documents: 보관한 문서는 기본 검색에서 빠지고 보관 포함으로 다시 찾으면 고정 판을 읽는다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const folder = await Deno.realPath(await copyFixture("korean-search"));
    const flow = await openFlowShell({ start: "lophn" });
    try {
      await registerTrackedProject(flow, { folder });
      await untilDocuments(
        flow,
        ["glossary", "migration"],
        "문서가 되지 않았다",
      );
      const migration = await documentTitled(flow, "migration");
      await untilSearch(
        flow,
        "데이터베이스마이그레이션계획서",
        (page) => page.results.some((row) => row.document === migration.id),
        "index가 따라오지 않았다",
      );
      await mustCall(flow, {
        kind: "command",
        resource: "documents",
        method: "archive",
        body: commandBody(
          { document: migration.id },
          { base_revision: migration.revision },
        ),
      });
      await untilSearch(
        flow,
        "데이터베이스마이그레이션계획서",
        (page) => page.results.length === 0,
        "보관한 문서가 결과에 남았다",
      );
      // 보관 문서는 제목으로 찾는다(문서 제목은 파일 이름 migration이다).
      await search(flow, "migration");
      // 색인 지연이 없으면 빈 결과는 보관 문서 가능성을 알린다. 문서가 없다고 하지 않는다.
      await flow.until(
        `[...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Include archived")`,
        "보관 포함 안내가 없다",
      );
      await flow.mouseClickText("button", "Include archived");
      await flow.until(
        `document.querySelector("[data-archived-hits] [data-hit]") !== null`,
        "보관 문서 결과가 없다",
      );
      await flow.click("[data-archived-hits] [data-hit]");
      await untilReading(flow, migration.id);
      assertEquals(
        await flow.count("[data-archived-document]"),
        1,
        "보관한 문서라는 안내가 없다",
      );
      await flow.until(
        `document.querySelector("[data-body]")?.textContent.includes("데이터베이스마이그레이션계획서")`,
        "고정 판 본문이 읽히지 않는다",
      );
    } finally {
      await flow.close();
      await removeHome(flow.home);
      await Deno.remove(folder, { recursive: true });
    }
  },
});
