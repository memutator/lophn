// documents slice flow E2E: restore-document(docs/flows/restore-document.md). 실제 shell(headless)·
// core·documents worker·format runner를 임시 LOPHN_HOME과 임시 project 폴더로 띄우고, 사람이 project
// 작업대에서 문서의 이력을 열어 옛 판과 지금 판을 비교하고 되살린다. 원본 연결 문서라 restore는
// 파일 저장 contract(base_hash 대조·원자 교체)를 따르고 그 파일의 관측으로 새 판이 된다.
// - 프로젝트 등록·추적은 같은 사람 command를 core 통로로 낸다(first-project가 화면 조작을 따로 본다).
// - 이력·비교·restore 조작은 모두 정보 패널의 versions 탭과 compare 화면으로 한다.
// - 이 파일이 보지 않는 갈래(agent가 쓴 판의 run 근거, 옛 이름·자리 참조, 원본 파일이 없을 때, 검색
//   반영 대기 표시)는 documents#T21의 이어보냄 메모에 적었다.
import { assert, assertEquals } from "@std/assert";

import { e2eEnabled } from "../harness.ts";
import {
  type FlowShell,
  openProjectWorkspace,
  removeHome,
  untilFile,
  untilReadable,
  untilVersions,
  versionHistory,
} from "../flow-support.ts";

const ALPHA = "# Plan\n\nAlpha line.\n";
const BETA = "# Plan\n\nBeta line.\n";
const GAMMA = "# Plan\n\nGamma line.\n";

// 이력 탭을 연다. 정보 패널의 versions 탭이 문서의 고정 판을 새 판부터 보여 준다.
async function openVersions(flow: FlowShell): Promise<void> {
  if ((await flow.count("[data-info-panel]")) === 0) {
    await flow.click("[data-info-toggle]");
    await flow.until(
      `document.querySelector("[data-info-panel]") !== null`,
      "정보 패널이 열리지 않았다",
    );
  }
  await flow.click(`[data-info-tab="versions"]`);
  await flow.until(
    `document.querySelector("[data-versions-tab]") !== null`,
    "이력 탭이 열리지 않았다",
  );
}

const ROW_NUMBERS =
  `JSON.stringify([...document.querySelectorAll("[data-version-row]")].map((el) => Number(el.getAttribute("data-version-row"))))`;

const DIFF_TEXT = (kind: "add" | "delete") =>
  `JSON.stringify([...document.querySelectorAll('tr[data-diff="${kind}"] td:last-child')].map((el) => el.textContent))`;

Deno.test({
  name:
    "documents/versions#R2 documents/versions#R4 documents/versions#R6 documents/versions#R8 documents/versions#R10 documents/versions#R13 documents/file-tracking#R11 documents/file-tracking#R12 shell/editor#R13 shell/editor#R14 shell/editor#R15 flow restore-document: 이력 → 비교 → restore → 같음 → 충돌",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const folder = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "lophn-e2e-restore-" }),
    );
    const file = `${folder}/plan.md`;
    await Deno.writeTextFile(file, ALPHA);
    const { flow, documentId } = await openProjectWorkspace({
      folder,
      name: "plan",
      title: "Plan",
      document: "plan",
    });
    try {
      // 바깥에서 두 번 고쳐 판 셋을 만든다. 파일 관측이 각각 새 판으로 남긴다.
      await Deno.writeTextFile(file, BETA);
      await untilVersions(flow, documentId, 2, "두 번째 판이 없다");
      await Deno.writeTextFile(file, GAMMA);
      await untilVersions(flow, documentId, 3, "세 번째 판이 없다");
      const base = await versionHistory(flow, documentId);
      assertEquals(base.map((row) => row.number), [3, 2, 1]);
      // 최신 판의 본문 추출이 끝나야 읽기 화면이 본문을 보인다.
      await untilReadable(flow, documentId, "지금 판의 본문이 읽히지 않는다");
      await flow.until(
        `document.querySelector('[data-document="${documentId}"]') !== null`,
        "sidebar에 문서가 없다",
      );
      await flow.click(`[data-document="${documentId}"]`);
      await flow.until(
        `document.querySelector("[data-document-view]")?.getAttribute("data-document-view") === "read" && document.querySelector("[data-document-body]")?.textContent?.includes("Gamma line.")`,
        "지금 판이 읽히지 않았다",
      );

      await t.step(
        "1: 이력 탭은 고정 판을 새 판부터 보여 주고 옛 판도 그대로 읽는다",
        async () => {
          await openVersions(flow);
          await flow.until(
            `${ROW_NUMBERS} === "[3,2,1]"`,
            "이력 행이 판 번호 순서가 아니다",
          );
          assertEquals(await flow.count("[data-version-row] time"), 3);
        },
      );

      await t.step(
        "2: 옛 판과 지금 판을 고르면 줄 단위 차이를 보여 주고 파일은 바뀌지 않는다",
        async () => {
          await flow.click(`[data-compare-newest="1"]`);
          await flow.until(
            `document.querySelector("[data-compare-view]") !== null`,
            "비교 화면이 열리지 않았다",
          );
          await flow.until(
            `${DIFF_TEXT("delete")}.includes("\\"Alpha line.\\"") && ${
              DIFF_TEXT("add")
            }.includes("\\"Gamma line.\\"")`,
            "비교 화면의 지운 줄·더한 줄이 판의 내용이 아니다",
          );
          assertEquals(await Deno.readTextFile(file), GAMMA);
        },
      );

      await t.step(
        "다른 갈래: 비교만 하고 닫으면 최신 내용도 이력도 그대로다",
        async () => {
          await flow.click("[data-compare-close]");
          await flow.until(
            `document.querySelector("[data-compare-view]") === null`,
            "비교 화면이 닫히지 않았다",
          );
          assertEquals(await Deno.readTextFile(file), GAMMA);
          assertEquals(
            (await versionHistory(flow, documentId)).map((row) => row.number),
            [3, 2, 1],
          );
        },
      );

      await t.step(
        "3·4·6: restore는 옛 판의 내용을 파일에 쓰고 그 관측이 새 판 4가 되며 옛 판과 이후 이력은 남는다",
        async () => {
          await openVersions(flow);
          await flow.click(`[data-compare-newest="1"]`);
          await flow.until(
            `document.querySelector("[data-compare-restore='1']") !== null`,
            "restore 조작이 없다",
          );
          await flow.click("[data-compare-restore='1']");
          await flow.until(
            `document.querySelector("[data-restore-confirm]") !== null`,
            "restore 확인이 없다",
          );
          // 확인 전에는 파일을 쓰지 않는다.
          assertEquals(await Deno.readTextFile(file), GAMMA);
          await flow.click("[data-restore-confirm-button]");
          await flow.until(
            `document.querySelector("[data-restore-notice]")?.getAttribute("data-restore-notice") === "saved"`,
            "restore 결과가 saved가 아니다",
          );
          assertEquals(await Deno.readTextFile(file), ALPHA);
          await untilVersions(flow, documentId, 4, "restore한 판 4가 없다");
          const rows = await versionHistory(flow, documentId);
          assertEquals(rows.map((row) => row.number), [4, 3, 2, 1]);
          // 새 판 4는 옛 판 1과 같은 내용이고 판 2·3은 지워지지 않았다.
          assertEquals(rows[0].content_hash, rows[3].content_hash);
          assert(rows[1].content_hash !== rows[0].content_hash);
          assert(rows[2].content_hash !== rows[0].content_hash);
        },
      );

      await t.step(
        "다른 갈래: 선택한 판이 지금 내용과 같으면 같다는 결과만 알리고 새 판은 만들지 않는다",
        async () => {
          await flow.click("[data-compare-close]");
          await openVersions(flow);
          await flow.until(
            `${ROW_NUMBERS} === "[4,3,2,1]"`,
            "restore한 판이 이력에 없다",
          );
          // 새 판의 본문 추출이 끝나야 비교가 본문을 읽는다.
          await untilReadable(flow, documentId, "판 4의 본문이 읽히지 않는다");
          await flow.click(`[data-compare-newest="1"]`);
          await flow.until(
            `document.querySelector("[data-compare-state]")?.getAttribute("data-compare-state") === "identical"`,
            "같다는 결과가 아니다",
          );
          assertEquals((await versionHistory(flow, documentId)).length, 4);
        },
      );

      await t.step(
        "5: 비교한 뒤 바깥이 파일을 바꿔 관측이 판을 만들었으면 restore는 그 새 최신 판 위에 쓰고 바깥 내용의 판도 남는다",
        async () => {
          await flow.click("[data-compare-close]");
          await openVersions(flow);
          await untilReadable(flow, documentId, "판 4의 본문이 읽히지 않는다");
          await flow.click(`[data-compare-newest="2"]`);
          await flow.until(
            `document.querySelector("[data-compare-restore='2']") !== null`,
            "restore 조작이 없다",
          );
          const outside = "# Plan\n\nOutside line.\n";
          await Deno.writeTextFile(file, outside);
          await untilVersions(flow, documentId, 5, "바깥 내용의 판이 없다");
          await flow.click("[data-compare-restore='2']");
          await flow.click("[data-restore-confirm-button]");
          await flow.until(
            `document.querySelector("[data-restore-notice]")?.getAttribute("data-restore-notice") === "saved"`,
            "restore 결과가 saved가 아니다",
          );
          await untilFile(file, BETA);
          await untilVersions(flow, documentId, 6, "restore한 판 6이 없다");
          const rows = await versionHistory(flow, documentId);
          assertEquals(rows.map((row) => row.number), [6, 5, 4, 3, 2, 1]);
          // 바깥이 쓴 내용의 판 5는 지워지지 않았고, 새 판 6은 옛 판 2와 같은 내용이다.
          assertEquals(rows[0].content_hash, rows[4].content_hash);
          assert(rows[1].content_hash !== rows[0].content_hash);
        },
      );
    } finally {
      const home = flow.home;
      await flow.close();
      await removeHome(home);
      await Deno.remove(folder, { recursive: true });
    }
  },
});
