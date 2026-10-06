// documents slice flow E2E: write-series(docs/flows/write-series.md). 실제 shell(headless)·core·
// documents worker·format runner를 임시 LOPHN_HOME으로 띄우고 예시 project 폴더 fixture
// (weekly-report)를 사람이 등록해 추적한다. 화면은 lophn 공간의 documents 화면(Series 탭)이다.
// - 1·4·6·7과 다른 갈래(해석할 수 없는 규칙, 이미 쓴 key, 제안은 문서를 만들지 않음)를 이 화면으로 본다.
// - 2·5는 이미 추적 중인 문서를 key를 정해 멤버로 더하는 길과, 제안한 key로 새 문서를 같은
//   편집기에서 쓰는 길(가족 draft → 편집 종료의 첫 판이 멤버 가입과 draft 비움, shell#T17)을 본다.
// - 프로젝트 등록·추적 켜기는 launcher 화면(shell#T15)이 아직 없어 같은 사람 command를 core 통로로 낸다.
import { assert, assertEquals, assertStringIncludes } from "@std/assert";

import { copyFixture } from "../../fixtures/projects/scenarios.ts";
import { e2eEnabled } from "../harness.ts";
import {
  documentTitled,
  type FlowShell,
  listDocuments,
  mustCall,
  openFlowShell,
  registerTrackedProject,
  removeHome,
  untilDocuments,
} from "../flow-support.ts";

const MEMBER_KEYS =
  `JSON.stringify([...document.querySelectorAll("[data-member]")].map((el) => el.getAttribute("data-member")))`;

async function seriesCount(flow: FlowShell): Promise<number> {
  const value = await mustCall(flow, {
    kind: "read",
    resource: "series",
    method: "list",
    body: { status: "all" },
  });
  return (value.series as unknown[]).length;
}

// LOPHN_SHELL_SHOT_DIR을 주면 지금 화면을 그 폴더에 이름 붙여 남긴다. settled 그림은 paint가 멈춘 뒤
// 쓰이므로 편집기 focus를 잠시 빼고 새로 쓰인 그림을 복사한다.
async function shot(flow: FlowShell, name: string): Promise<void> {
  const dir = Deno.env.get("LOPHN_SHELL_SHOT_DIR");
  if (!dir) return;
  const settled = `${dir}/window-1-settled.png`;
  const stamp = () =>
    Deno.stat(settled).then((info) => info.mtime?.getTime() ?? 0, () => 0);
  const before = await stamp();
  await flow.evaluate(
    `(() => { document.activeElement?.blur?.(); return true; })()`,
  );
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && await stamp() <= before) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await Deno.copyFile(settled, `${dir}/${name}.png`);
}

async function addMember(
  flow: FlowShell,
  key: string,
  document: string,
): Promise<void> {
  await flow.type("[data-member-key]", key);
  await flow.choose("[data-add-member] button[role=combobox]", document);
  await flow.click("[data-add-member-submit]");
}

Deno.test({
  name:
    "documents/series#R1 documents/series#R2 documents/series#R4 documents/series#R6 documents/series#R13 flow write-series: 등록 → 멤버 → 다음 key 제안 → 순서 → 보관",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const folder = await Deno.realPath(await copyFixture("weekly-report"));
    const flow = await openFlowShell({ start: "lophn" });
    try {
      await registerTrackedProject(flow, { folder });
      await untilDocuments(
        flow,
        ["P001", "P002"],
        "추적한 파일이 문서가 되지 않았다",
      );
      // 멤버는 같은 자리의 문서다. 관측한 두 문서는 이미 그 프로젝트에 이름이 있다.
      assertEquals((await documentTitled(flow, "P001")).name, "p001");
      assertEquals((await documentTitled(flow, "P002")).name, "p002");
      // 자리 선택지는 화면이 처음 읽는다. 등록한 프로젝트가 보이게 창을 다시 읽는다.
      await flow.reload();
      await flow.mouseClickText("[role=tab]", "Series");

      await t.step(
        "documents/series#R1 documents/series#R8: 1 해석할 수 없는 규칙과 5자리 이상 0 채움은 등록하지 않고 다시 고르게 한다",
        async () => {
          await flow.click("[data-register-series]");
          await flow.until(
            `document.querySelector("[data-register-form]") !== null`,
            "등록 양식이 열리지 않았다",
          );
          await flow.choose(
            "[data-register-form] button[role=combobox]",
            "Alpha",
          );
          await flow.type("[data-series-name]", "weekly");
          await flow.type("[data-series-title]", "Weekly report");
          await flow.type("[data-next-rule]", "P{n+1:05}");
          await flow.click("[data-register-submit]");
          await flow.until(
            `document.body.innerText.includes("lophn can't use this rule")`,
            "규칙 거절 안내가 없다",
          );
          assertEquals(await flow.count("[data-series-head]"), 0);
          assertEquals(await seriesCount(flow), 0);
        },
      );

      await t.step(
        "documents/series#R1 documents/series#R7: 1 규칙을 고쳐 등록하면 빈 가족이고 첫 key는 사람이 정한다",
        async () => {
          await flow.type("[data-next-rule]", "P{n+1:03}");
          await flow.click("[data-register-submit]");
          await flow.until(
            `document.querySelector("[data-series-head]") !== null`,
            "등록한 series가 열리지 않았다",
          );
          assertEquals(await seriesCount(flow), 1);
          assertEquals(await flow.count("[data-member]"), 0);
          // 빈 가족에서는 다음 이름을 꾸미지 않는다.
          assertEquals(
            await flow.evaluate(
              `document.querySelector("[data-next-key]").getAttribute("data-next-key")`,
            ),
            "",
          );
        },
      );

      await t.step(
        "documents/series#R2 documents/series#R3: 2 첫 멤버는 key를 정해 더하고 이미 쓴 key는 저장하지 않는다",
        async () => {
          await addMember(flow, "P001", "P001");
          await flow.until(
            `${MEMBER_KEYS} === '["P001"]'`,
            "첫 멤버가 목록에 없다",
          );
          // 같은 key를 다른 문서에 다시 쓰면 거절하고 멤버는 그대로다.
          await addMember(flow, "P001", "P002");
          await flow.until(
            `document.body.innerText.includes("already used in this series")`,
            "key 중복 안내가 없다",
          );
          assertEquals(await flow.evaluate(MEMBER_KEYS), '["P001"]');
        },
      );

      await t.step(
        "documents/series#R6 documents/series#R14: 4 다음 key는 마지막 key와 규칙으로 제안하고 제안을 여러 번 읽어도 문서가 늘지 않는다",
        async () => {
          assertEquals(
            await flow.evaluate(
              `document.querySelector("[data-next-key]").getAttribute("data-next-key")`,
            ),
            "P002",
          );
          assertStringIncludes(
            (await flow.text("[data-next] [data-next-key]"))!,
            "P001",
          );
          const before = (await listDocuments(flow)).length;
          for (let again = 0; again < 3; again++) {
            await flow.click("[data-series]");
            await flow.until(
              `document.querySelector("[data-next-key]") !== null`,
              "다시 연 series에 제안이 없다",
            );
          }
          assertEquals((await listDocuments(flow)).length, before);
        },
      );

      await t.step(
        "documents/series#R2 documents/series#R4 documents/series#R5: 5·6 제안한 key로 다음 멤버를 더하면 가족 목록이 같은 순서의 key·제목으로 보인다",
        async () => {
          await addMember(flow, "P002", "P002");
          await flow.until(
            `${MEMBER_KEYS} === '["P001","P002"]'`,
            "두 번째 멤버가 순서대로 없다",
          );
          const rows = await flow.texts("[data-member]");
          assertStringIncludes(rows[0], "P001");
          assertStringIncludes(rows[1], "P002");
          // 목록의 가족 줄은 멤버 수를 보인다.
          assertStringIncludes(
            (await flow.text("[data-series]"))!,
            "2 documents",
          );
          // 멤버를 열면 순서대로 앞뒤로 읽는다.
          await flow.click("[data-member=P001]");
          await flow.until(
            `document.querySelector("[data-sequence]") !== null && document.querySelector("[data-reader-meta]") !== null`,
            "멤버를 읽지 못했다",
          );
          await flow.click("[data-next]");
          await flow.until(
            `document.querySelector("[data-sequence]")?.textContent.includes("P002")`,
            "다음 멤버로 가지 못했다",
          );
          await flow.click("[data-back-to-series]");
          await flow.until(
            `document.querySelector("[data-members]") !== null`,
            "series로 돌아가지 못했다",
          );
        },
      );

      await t.step(
        "documents/series#R10 documents/series#R13 documents/versions#R12: 7 가족을 보관해도 멤버 문서와 구성은 남고 해제하면 다시 더할 수 있다",
        async () => {
          await flow.click("[data-archive-series=archive]");
          await flow.until(
            `document.querySelector("[data-series-archived]") !== null`,
            "보관 안내가 없다",
          );
          // 보관은 멤버 문서의 보관이 아니다. 구성과 key를 그대로 읽는다.
          assertEquals(await flow.evaluate(MEMBER_KEYS), '["P001","P002"]');
          assertEquals(await flow.count("[data-add-member]"), 0);
          const documents = await listDocuments(flow);
          for (const title of ["P001", "P002"]) {
            assertEquals(
              documents.find((row) => row.title === title)?.status,
              "active",
            );
          }
          await flow.click("[data-archive-series=unarchive]");
          await flow.until(
            `document.querySelector("[data-add-member]") !== null`,
            "보관을 풀어도 멤버를 더할 수 없다",
          );
          assertEquals(await flow.count("[data-series-archived]"), 0);
        },
      );

      await t.step(
        "documents/series#R2 documents/series#R11 shell/editor#R1 shell/editor#R2: 2·5 제안한 key로 새 문서를 쓰면 첫 판 전에는 가족 draft이고, 편집 종료가 첫 판을 저장해 같은 자리의 멤버가 된다",
        async () => {
          await flow.until(
            `document.querySelector("[data-member-key]")?.value === "P003"`,
            "다음 제안 P003이 key 칸에 없다",
          );
          const before = (await listDocuments(flow)).length;
          await flow.click("[data-write-member]");
          await flow.until(
            `document.querySelector("[data-member-writer='P003'] .cm-content") !== null`,
            "새 문서 편집기가 열리지 않았다",
          );
          // 첫 판 전에는 가족 draft(key·예정 문서)만 있고 문서는 없다.
          assertEquals(
            await flow.evaluate(
              `document.querySelector("[data-new-document]").getAttribute("data-new-document")`,
            ),
            "draft",
          );
          const drafted = await mustCall(flow, {
            kind: "read",
            resource: "series",
            method: "list",
            body: { status: "all" },
          });
          const family = (drafted.series as {
            draft: { key: string; document: string } | null;
          }[])[0]!;
          assertEquals(family.draft?.key, "P003");
          assertEquals((await listDocuments(flow)).length, before);
          // 사람 입력처럼 편집기 끝에 글을 넣고 CommandOrControl+S로 편집을 끝낸다.
          assertEquals(
            await flow.evaluate(`(() => {
              const content = document.querySelector("[data-member-writer] .cm-content");
              content.focus();
              const range = document.createRange();
              range.selectNodeContents(content);
              range.collapse(false);
              const selection = getSelection();
              selection.removeAllRanges();
              selection.addRange(range);
              return document.execCommand("insertText", false, "Third week.");
            })()`),
            true,
          );
          await shot(flow, "series-writer");
          await flow.evaluate(
            `(() => { document.querySelector("[data-member-writer]").dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true })); return true; })()`,
          );
          await flow.until(
            `${MEMBER_KEYS} === '["P001","P002","P003"]'`,
            "새 멤버가 순서대로 없다",
          );
          const created = await documentTitled(flow, "P003");
          assertEquals(created.id, family.draft!.document);
          assertEquals(created.name, "p003");
          assertEquals(created.format, "document");
          const after = await mustCall(flow, {
            kind: "read",
            resource: "series",
            method: "list",
            body: { status: "all" },
          });
          assertEquals((after.series as { draft: unknown }[])[0]!.draft, null);
          // 같은 자리(첫 멤버와 같은 프로젝트)의 문서다.
          const placeOf = async (id: string) =>
            ((await mustCall(flow, {
              kind: "read",
              resource: "documents",
              method: "get",
              body: { document: id },
            })).document as { place: unknown }).place;
          assertEquals(
            await placeOf(created.id),
            await placeOf((await documentTitled(flow, "P001")).id),
          );
          await shot(flow, "series-written");
        },
      );
    } finally {
      await flow.close();
      await removeHome(flow.home);
      await Deno.remove(folder, { recursive: true });
    }
    assert(true);
  },
});
