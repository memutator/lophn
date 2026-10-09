// documents slice flow E2E: restore-document(docs/flows/restore-document.md). 실제 shell(headless)·
// core·documents worker·format runner를 임시 LOPHN_HOME과 임시 project 폴더로 띄우고, 사람이 project
// 작업대에서 문서의 이력을 열어 옛 판과 지금 판을 비교하고 되살린다. 원본 연결 문서라 restore는
// 파일 저장 contract(base_hash 대조·원자 교체)를 따르고 그 파일의 관측으로 새 판이 된다.
// - 프로젝트 등록·추적은 같은 사람 command를 core 통로로 낸다(first-project가 화면 조작을 따로 본다).
// - 이력·비교·restore 조작은 모두 정보 패널의 versions 탭과 compare 화면으로 한다.
// - 원본 파일이 없을 때는 아래 갈래가 본다. agent가 쓴 판의 run 근거는 그 다음 테스트가 본다.
//   아직 없는 갈래(옛 이름·자리 참조, 검색 반영 대기 표시)는 documents#T21의 이어보냄 메모에 적었다.
import { assert, assertEquals } from "@std/assert";

import { buildReply } from "../../tools/fake-provider/semantic.ts";
import type { SemanticReply } from "../../tools/fake-provider/types.ts";
import { e2eEnabled } from "../harness.ts";
import {
  commandBody,
  delay,
  documentTitled,
  type FlowShell,
  listDocuments,
  mustCall,
  openFlowShell,
  openProjectWorkspace,
  PROJECT,
  registerTrackedProject,
  removeHome,
  untilDocuments,
  untilFile,
  untilReadable,
  untilVersions,
  versionHistory,
} from "../flow-support.ts";

const ALPHA = "# Plan\n\nAlpha line.\n";
const BETA = "# Plan\n\nBeta line.\n";
const GAMMA = "# Plan\n\nGamma line.\n";
const OUTSIDE = "# Plan\n\nOutside line.\n";
const OUTSIDE_AGAIN = "# Plan\n\nOutside again.\n";

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
        "5: 비교한 뒤 바깥이 파일을 바꿔 관측이 판을 만들었으면 restore는 새 판 위에 쓰지 않고 충돌로 멈추며 바깥 내용의 판이 남는다",
        async () => {
          await flow.click("[data-compare-close]");
          await openVersions(flow);
          await untilReadable(flow, documentId, "판 4의 본문이 읽히지 않는다");
          await flow.click(`[data-compare-newest="2"]`);
          await flow.until(
            `document.querySelector("[data-compare-restore='2']") !== null`,
            "restore 조작이 없다",
          );
          await Deno.writeTextFile(file, OUTSIDE);
          await untilVersions(flow, documentId, 5, "바깥 내용의 판이 없다");
          await flow.click("[data-compare-restore='2']");
          await flow.click("[data-restore-confirm-button]");
          await flow.until(
            `document.querySelector("[data-restore-notice]")?.getAttribute("data-restore-notice") === "conflict"`,
            "restore 결과가 충돌이 아니다",
          );
          // 바깥 내용은 덮이지 않았고 이력도 그대로다.
          assertEquals(await Deno.readTextFile(file), OUTSIDE);
          assertEquals(
            (await versionHistory(flow, documentId)).map((row) => row.number),
            [5, 4, 3, 2, 1],
          );
        },
      );

      await t.step(
        "5: 바깥 변경을 관측이 아직 판으로 만들기 전에 restore를 확인해도 쓰지 않고 충돌로 멈추며, 그 내용도 곧 자기 판으로 남는다",
        async () => {
          await flow.click("[data-compare-close]");
          await openVersions(flow);
          await untilReadable(flow, documentId, "판 5의 본문이 읽히지 않는다");
          await flow.click(`[data-compare-newest="2"]`);
          await flow.until(
            `document.querySelector("[data-compare-restore='2']") !== null`,
            "restore 조작이 없다",
          );
          await flow.click("[data-compare-restore='2']");
          await flow.until(
            `document.querySelector("[data-restore-confirm]") !== null`,
            "restore 확인이 없다",
          );
          // 확인 직전에 바깥이 고친다. 관측이 판을 만들기 전이면 파일 hash가, 만든 뒤면 최신 판이
          // 낡은 기준이다. 어느 쪽이든 쓰지 않는다(main 단위 시험이 앞 갈래를 결정적으로 본다).
          await Deno.writeTextFile(file, OUTSIDE_AGAIN);
          await flow.click("[data-restore-confirm-button]");
          await flow.until(
            `/^(conflict|file-conflict)$/.test(document.querySelector("[data-restore-notice]")?.getAttribute("data-restore-notice") ?? "")`,
            "restore 결과가 충돌이 아니다",
          );
          assertEquals(await Deno.readTextFile(file), OUTSIDE_AGAIN);
          // 바깥 내용은 판 없이 사라지지 않는다. 관측이 자기 판으로 남긴다.
          await untilVersions(flow, documentId, 6, "바깥 내용의 판 6이 없다");
          const rows = await versionHistory(flow, documentId);
          assertEquals(rows.map((row) => row.number), [6, 5, 4, 3, 2, 1]);
          assert(rows[0].content_hash !== rows[1].content_hash);
          assert(rows[0].content_hash !== rows[4].content_hash);
          assertEquals(await Deno.readTextFile(file), OUTSIDE_AGAIN);
        },
      );

      await t.step(
        "5: 충돌 뒤 다시 비교하면 새 최신 판 위에서 restore하고 바깥 내용의 판도 남는다",
        async () => {
          await flow.click("[data-compare-close]");
          await openVersions(flow);
          await untilReadable(flow, documentId, "판 6의 본문이 읽히지 않는다");
          await flow.click(`[data-compare-newest="2"]`);
          await flow.until(
            `document.querySelector("[data-compare-restore='2']") !== null`,
            "restore 조작이 없다",
          );
          await flow.click("[data-compare-restore='2']");
          await flow.click("[data-restore-confirm-button]");
          await flow.until(
            `document.querySelector("[data-restore-notice]")?.getAttribute("data-restore-notice") === "saved"`,
            "restore 결과가 saved가 아니다",
          );
          await untilFile(file, BETA);
          await untilVersions(flow, documentId, 7, "restore한 판 7이 없다");
          const rows = await versionHistory(flow, documentId);
          assertEquals(rows.map((row) => row.number), [7, 6, 5, 4, 3, 2, 1]);
          // 새 판 7은 옛 판 2와 같은 내용이고 바깥이 쓴 판 5·6은 지워지지 않았다.
          assertEquals(rows[0].content_hash, rows[5].content_hash);
          assert(rows[1].content_hash !== rows[0].content_hash);
          assert(rows[2].content_hash !== rows[0].content_hash);
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

async function fileGone(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return false;
  } catch (error) {
    return error instanceof Deno.errors.NotFound;
  }
}

Deno.test({
  name:
    "documents/versions#R11 documents/file-tracking#R9 documents/file-tracking#R15 flow restore-document: 원본 파일이 없으면 옛 판은 읽히고 restore는 파일을 쓴 것처럼 보이지 않는다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const folder = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "lophn-e2e-restore-gone-" }),
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
      await Deno.writeTextFile(file, BETA);
      await untilVersions(flow, documentId, 2, "두 번째 판이 없다");
      await untilReadable(flow, documentId, "지금 판의 본문이 읽히지 않는다");
      await flow.click(`[data-document="${documentId}"]`);
      await flow.until(
        `document.querySelector("[data-document-view]")?.getAttribute("data-document-view") === "read" && document.querySelector("[data-document-body]")?.textContent?.includes("Beta line.")`,
        "지금 판이 읽히지 않았다",
      );
      const before = await versionHistory(flow, documentId);
      assertEquals(before.map((row) => row.number), [2, 1]);

      // 원본 파일을 지운다. 저장된 판은 파일과 따로 남는다.
      await Deno.remove(file);
      assert(await fileGone(file), "원본 파일이 아직 있다");
      await flow.until(
        `document.querySelector("[data-document-view]")?.getAttribute("data-document-view") === "read" && document.querySelector("[data-document-body]")?.textContent?.includes("Beta line.")`,
        "파일이 없어도 고정 판이 읽히지 않는다",
      );

      await openVersions(flow);
      await flow.click(`[data-compare-newest="1"]`);
      await flow.until(
        `document.querySelector("[data-compare-view]") !== null`,
        "비교 화면이 열리지 않았다",
      );
      await flow.until(
        `${DIFF_TEXT("delete")}.includes("\\"Alpha line.\\"") && ${
          DIFF_TEXT("add")
        }.includes("\\"Beta line.\\"")`,
        "파일이 없어도 옛 판과 지금 판의 내용이 읽히지 않는다",
      );

      await flow.click("[data-compare-restore='1']");
      await flow.until(
        `document.querySelector("[data-restore-confirm]") !== null`,
        "restore 확인이 없다",
      );
      assert(await fileGone(file), "확인 전에 파일이 되살아났다");
      await flow.click("[data-restore-confirm-button]");
      await flow.until(
        `document.querySelector("[data-restore-notice]")?.getAttribute("data-restore-notice") === "file-conflict"`,
        "없는 파일의 restore가 파일을 쓴 결과로 보인다",
      );
      // 파일 저장이 끝나지 않았고 판 확정도 없다. 둘을 성공이나 서로 같은 실패로 채우지 않는다.
      assert(
        await fileGone(file),
        "restore가 없는 파일을 쓴 것처럼 파일을 만들었다",
      );
      const after = await versionHistory(flow, documentId);
      assertEquals(after.map((row) => row.number), [2, 1]);
      assertEquals(
        after.map((row) => row.content_hash),
        before.map((row) => row.content_hash),
      );
    } finally {
      const home = flow.home;
      await flow.close();
      await removeHome(home);
      await Deno.remove(folder, { recursive: true });
    }
  },
});

const AGENT_PROVIDER = "pvd_01arz3ndektsv4rrffq69g5fav";
const AGENT_MODEL = "claude-sonnet-4-5";
const AGENT_TITLE = "Agent note";
const COMPOSER = "[data-composer-input]";

type AgentStep = (body: string) => SemanticReply | Promise<SemanticReply>;

type StoredVersion = {
  number: number;
  saved_by: string;
  saved_at: string;
  run: string | null;
};

type RunRow = {
  id: string;
  outcome: { kind: string } | null;
};

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
    calls: () => bodies.length,
    close: () => server.shutdown(),
    url: `http://127.0.0.1:${server.addr.port}`,
  };
}

async function storedHistory(
  flow: FlowShell,
  document: string,
): Promise<StoredVersion[]> {
  const value = await mustCall(flow, {
    kind: "read",
    resource: "documents",
    method: "history",
    body: { document },
  });
  return (value.versions as StoredVersion[]).toSorted((left, right) =>
    right.number - left.number
  );
}

Deno.test({
  name:
    "documents/versions#R6 flow restore-document: agent가 쓴 판의 이력은 그 판에 저장된 run을 근거로 보인다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const folder = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "lophn-e2e-restore-run-" }),
    );
    await Deno.writeTextFile(`${folder}/plan.md`, ALPHA);
    const provider = startAgentProvider([
      () => ({
        text: "",
        toolCalls: [{
          id: "toolu_create",
          name: "document.create",
          arguments: JSON.stringify({
            title: AGENT_TITLE,
            place: { kind: "project", id: PROJECT },
            name: "agent-note",
            text: "# Agent note\n\nKept with the run.\n",
            media_type: "text/markdown",
          }),
        }],
        usage: { input: 30, output: 9 },
        stop: "tool_calls",
      }),
      () => ({
        text: "Written.",
        usage: { input: 40, output: 4 },
        stop: "end",
      }),
    ]);
    const setup = await openFlowShell({ start: "lophn" });
    const home = setup.home;
    let flow: FlowShell | undefined = setup;
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
      await registerTrackedProject(flow, {
        folder,
        name: "plan",
        title: "Plan",
      });
      await untilDocuments(flow, ["plan"], "추적한 파일이 문서가 되지 않았다");
      const plan = await documentTitled(flow, "plan");
      const assignments = await mustCall(flow, {
        kind: "read",
        resource: "assignments",
        method: "list",
        body: {},
      });
      const agent = (assignments.assignments as { id: string; role: string }[])
        .find((entry) => entry.role === "lophn");
      assert(agent !== undefined, "lophn assignment가 없다");
      const runsOf = async (): Promise<RunRow[]> =>
        (await mustCall(flow!, {
          kind: "read",
          resource: "runs",
          method: "list",
          body: { assignment: agent.id },
        })).runs as RunRow[];
      const untilRun = async (): Promise<RunRow> => {
        const deadline = Date.now() + 180_000;
        let rows: RunRow[] = [];
        for (;;) {
          rows = await runsOf();
          if (rows.length === 1 && rows[0]?.outcome !== null) return rows[0];
          const titles = (await listDocuments(flow!)).map((row) => row.title);
          assert(
            Date.now() < deadline,
            `run이 끝나지 않았다: ${JSON.stringify(rows)} titles=${
              titles.join(",")
            } calls=${provider.calls()}`,
          );
          await delay(250);
        }
      };

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
      await flow.type(COMPOSER, "Write a note in this project.");
      await flow.click("[data-send]");
      const run = await untilRun();
      assertEquals(
        run.outcome?.kind,
        "completed",
        `run이 저장으로 끝나지 않았다: ${JSON.stringify(run)} titles=${
          (await listDocuments(flow)).map((row) => row.title).join(",")
        } calls=${provider.calls()}`,
      );
      const note = await documentTitled(flow, AGENT_TITLE);
      const agentHistory = await storedHistory(flow, note.id);
      const saved = agentHistory.find((row) =>
        row.saved_by.startsWith("agent:")
      );
      assert(
        saved !== undefined && saved.run !== null,
        `agent 판의 저장된 run이 없다: ${JSON.stringify(agentHistory)}`,
      );
      assertEquals(saved.run, run.id);
      const planHistory = await storedHistory(flow, plan.id);
      assert(planHistory.length > 0, "파일 문서의 판이 없다");
      assert(
        planHistory.every((row) => row.run === null),
        `파일 관측 판에 run이 저장됐다: ${JSON.stringify(planHistory)}`,
      );

      await flow.close();
      flow = undefined;
      flow = await openFlowShell({ home, start: `project:${PROJECT}` });
      await flow.until(
        `document.querySelector("[data-space]")?.getAttribute("data-space") === "project"`,
        "project 작업대가 서지 않았다",
      );
      await flow.until(
        `document.querySelector('[data-document="${plan.id}"]') !== null && document.querySelector('[data-document="${note.id}"]') !== null`,
        "작업대에 두 문서가 없다",
      );
      await flow.click(`[data-document="${plan.id}"]`);
      await flow.until(
        `document.querySelector("[data-document-body]")?.textContent?.includes("Alpha line.")`,
        "파일 문서가 열리지 않았다",
      );
      await openVersions(flow);
      await flow.until(
        `document.querySelectorAll("[data-version-row]").length === ${planHistory.length} && document.querySelectorAll("[data-version-run]").length === 0`,
        "파일 관측 판의 이력에 run이 보인다",
      );
      const planTab = String(
        await flow.evaluate(
          `document.querySelector("[data-versions-tab]")?.innerText ?? ""`,
        ),
      );
      assert(
        !planTab.includes(saved.run),
        "파일 문서 이력에 agent의 run이 있다",
      );
      assert(planTab.includes("From the file"), planTab);

      await flow.click(`[data-document="${note.id}"]`);
      await openVersions(flow);
      const shown = JSON.stringify(saved.run);
      await flow.until(
        `document.querySelectorAll("[data-version-run]").length === 1 && document.querySelector("[data-version-run]")?.getAttribute("data-version-run") === ${shown} && document.querySelector("[data-version-run]")?.textContent?.trim() === ${shown}`,
        "이력에 그 판의 저장된 run이 없다",
      );
      const rowText = await flow.text("[data-versions-tab] [data-version-row]");
      assert(rowText?.includes("lophn"), rowText ?? "이력 행이 없다");
      assertEquals(await flow.count("[data-versions-tab] time"), 1);
    } finally {
      await provider.close();
      if (flow !== undefined) await flow.close();
      await removeHome(home);
      await Deno.remove(folder, { recursive: true });
    }
  },
});
