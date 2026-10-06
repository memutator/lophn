// flow define-terms: 실제 headless shell·core·documents worker를 임시 LOPHN_HOME으로 연다.
// 1의 context 선택과 3·6의 사람 직접 정의 화면, 미루기·전제 변경·같은 이름·보관 갈래를 본다.
// 후보는 사람 command의 고정 본문 근거로 준비한다. 2의 CE model 후보 수집을 대신하지 않는다.
// 4~5의 term.define question option adapter는 T29에 아직 없어 사람 직접 정의와 구별한다.
import { assertEquals } from "@std/assert";

import { copyFixture } from "../../fixtures/projects/scenarios.ts";
import { e2eEnabled } from "../harness.ts";
import {
  commandBody,
  documentTitled,
  type FlowShell,
  mustCall,
  openFlowShell,
  registerTrackedProject,
  removeHome,
  untilDocuments,
  untilSearch,
} from "../flow-support.ts";

const FOCUS = "ctx_01arz3ndektsv4rrffq69g5fav";
const OTHER = "ctx_01arz3ndektsv4rrffq69g5fb0";
const CANDIDATE = "trm_01arz3ndektsv4rrffq69g5fav";

async function meanings(flow: FlowShell, context = FOCUS): Promise<void> {
  await flow.click('[data-screen="documents"]');
  await flow.click('[data-screen="contexts"]');
  await flow.until(
    `document.querySelector('[data-focus="${context}"]') !== null`,
    "Focus 목록 대기",
  );
  await flow.click(`[data-focus="${context}"]`);
  await flow.until(
    `document.querySelector('[data-focus-head="${context}"]') !== null`,
    "Focus 상세 대기",
  );
  await flow.mouseClickText("[role=tab]", "Meanings");
  await flow.until(
    `document.querySelector("[data-meanings]") !== null`,
    "Meanings 대기",
  );
}

async function term(flow: FlowShell) {
  const got = await mustCall(flow, {
    kind: "read",
    resource: "terms",
    method: "get",
    body: { term: CANDIDATE },
  });
  return got.term as {
    name: string;
    definition: string | null;
    revision: string;
    evidence: unknown[];
  };
}

Deno.test({
  name:
    "documents/terms#R2 documents/terms#R3 documents/terms#R4 flow define-terms: context 선택 → 후보·미루기 → 사람 뜻 → 전제 변경·다른 context·보관",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const folder = await Deno.realPath(await copyFixture("korean-search"));
    const flow = await openFlowShell({ start: "lophn" });
    try {
      await registerTrackedProject(flow, { folder });
      await untilDocuments(flow, ["glossary", "migration"], "문서 관측 대기");
      await untilSearch(
        flow,
        "용어",
        (page) => page.results.length > 0,
        "본문 반영 대기",
      );
      const glossary = await documentTitled(flow, "glossary");
      for (
        const [id, title, purpose] of [[
          FOCUS,
          "Reading terms",
          "읽을 때 쓰는 뜻",
        ], [OTHER, "Writing terms", "쓸 때 쓰는 뜻"]]
      ) {
        await mustCall(flow, {
          kind: "command",
          resource: "contexts",
          method: "create",
          body: commandBody({
            id,
            title,
            purpose,
            items: [{
              target: {
                kind: "document",
                document: glossary.id,
                section: null,
              },
              perspective: "basis",
              reason: "말의 본문 근거",
            }],
          }),
        });
      }
      const evidence = [{
        document: glossary.id,
        version: glossary.latest_version,
        section: null,
        start_line: 11,
        end_line: 11,
      }];
      await mustCall(flow, {
        kind: "command",
        resource: "terms",
        method: "propose",
        body: commandBody({
          id: CANDIDATE,
          context: FOCUS,
          name: "용어",
          evidence,
        }),
      });
      await mustCall(flow, {
        kind: "command",
        resource: "terms",
        method: "define",
        body: commandBody({
          id: "trm_01arz3ndektsv4rrffq69g5fb0",
          context: OTHER,
          name: "용어",
          definition: "글을 쓸 때 정한 별도 뜻",
        }),
      });

      await t.step(
        "documents/terms#R1 documents/terms#R3 documents/terms#R4: 1·3 선택한 목적에서 후보와 정의를 구별하고 다른 context의 뜻을 가져오지 않는다",
        async () => {
          await meanings(flow);
          assertEquals(
            await flow.text("[data-focus-purpose]"),
            "읽을 때 쓰는 뜻",
          );
          assertEquals(await flow.count("[data-definitions] [data-term]"), 0);
          assertEquals(
            await flow.count("[data-candidates] [data-candidate]"),
            1,
          );
          assertEquals(
            await flow.count(`[data-evidence-row="${glossary.id}"]`),
            1,
          );
          await flow.click(`[data-evidence-row="${glossary.id}"]`);
          await flow.until(
            `document.querySelector("[data-body]")?.textContent.includes("뜻이 고정된 말")`,
            "출현 고정 판 본문 대기",
          );
          assertEquals((await term(flow)).evidence, evidence);
        },
      );

      await t.step(
        "documents/terms#R2: 3 미루기는 후보를 정의하지 않고 뜻 칸은 사람 입력 전 비어 있다",
        async () => {
          await meanings(flow);
          await flow.click("[data-later]");
          assertEquals(await flow.count("[data-deferred]"), 1);
          assertEquals((await term(flow)).definition, null);
          await flow.click("[data-decide]");
          assertEquals(
            await flow.evaluate(
              'document.querySelector("[data-meaning-definition]").value',
            ),
            "",
          );
          assertEquals(
            await flow.evaluate(
              'document.querySelector("[data-save-meaning]").disabled',
            ),
            true,
          );
        },
      );

      await t.step(
        "documents/terms#R2 documents/terms#R4: 6 사람이 직접 쓴 뜻이 실제 정의로 반영되고 고정 근거가 남는다",
        async () => {
          await flow.type("[data-meaning-definition]", "사람이 뜻을 정한 말");
          await flow.click("[data-save-meaning]");
          await flow.until(
            `document.querySelector("[data-definition]")?.textContent === "사람이 뜻을 정한 말"`,
            "사람 정의 반영 대기",
          );
          assertEquals(
            await flow.count("[data-candidates] [data-candidate]"),
            0,
          );
          const defined = await term(flow);
          assertEquals(defined.definition, "사람이 뜻을 정한 말");
          assertEquals(defined.evidence, evidence);
          await meanings(flow, OTHER);
          assertEquals(
            await flow.text("[data-definition]"),
            "글을 쓸 때 정한 별도 뜻",
          );
          assertEquals((await term(flow)).definition, "사람이 뜻을 정한 말");
        },
      );

      await t.step(
        "documents/terms#R2: 전제가 바뀌면 옛 화면의 수정은 conflict이며 최신 사람 정의를 덮지 않는다",
        async () => {
          await meanings(flow);
          await flow.click("[data-change-meaning]");
          const before = await term(flow);
          await mustCall(flow, {
            kind: "command",
            resource: "terms",
            method: "update",
            body: commandBody({
              term: CANDIDATE,
              definition: "다른 창에서 정한 뜻",
            }, { base_revision: before.revision }),
          });
          await flow.type("[data-meaning-definition]", "낡은 화면의 뜻");
          await flow.click("[data-save-meaning]");
          await flow.until(
            `document.querySelector("[data-meaning-changed]") !== null`,
            "충돌 안내 대기",
          );
          assertEquals((await term(flow)).definition, "다른 창에서 정한 뜻");
          await flow.until(
            `document.querySelector("[data-definition]")?.textContent === "다른 창에서 정한 뜻"`,
            "최신 뜻 다시 읽기 대기",
          );
        },
      );

      await t.step(
        "documents/terms#R5: context·용어를 보관해도 사람 정의·출현 근거를 지우지 않는다",
        async () => {
          await flow.click('[data-archive-focus="archive"]');
          await flow.until(
            `document.querySelector("[data-focus-archived]") !== null`,
            "context 보관 대기",
          );
          const before = await term(flow);
          await mustCall(flow, {
            kind: "command",
            resource: "terms",
            method: "archive",
            body: commandBody({ term: CANDIDATE }, {
              base_revision: before.revision,
            }),
          });
          const archived = await term(flow);
          assertEquals(archived.definition, before.definition);
          assertEquals(archived.evidence, evidence);
          const got = await mustCall(flow, {
            kind: "read",
            resource: "documents",
            method: "get",
            body: { document: glossary.id },
          });
          assertEquals((got.document as { status: string }).status, "active");
          assertEquals(
            (await documentTitled(flow, "glossary")).latest_version,
            glossary.latest_version,
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
