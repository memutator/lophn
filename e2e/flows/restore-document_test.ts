// documents slice flow E2E: restore-document(docs/flows/restore-document.md). 실제 shell(headless)·
// core·documents worker·format runner를 임시 LOPHN_HOME과 임시 project 폴더로 띄우고, 사람이 project
// 작업대에서 문서의 이력을 열어 옛 판과 지금 판을 비교하고 되살린다. 원본 연결 문서라 restore는
// 파일 저장 contract(base_hash 대조·원자 교체)를 따르고 그 파일의 관측으로 새 판이 된다.
// - 프로젝트 등록·추적은 같은 사람 command를 core 통로로 낸다(first-project가 화면 조작을 따로 본다).
// - 이력·비교·restore 조작은 모두 정보 패널의 versions 탭과 compare 화면으로 한다.
// - 원본 파일이 없을 때는 아래 갈래가 본다. agent가 쓴 판의 run 근거는 그 다음 테스트가 본다.
//   옛 이름·자리 참조는 그 다음 테스트가 본다. 검색 반영 대기는 그 다음 테스트가 본다.
//   보관·추적 중단 뒤의 옛 판 읽기는 마지막 테스트가 본다.
import { assert, assertEquals, assertStringIncludes } from "@std/assert";

import { buildReply } from "../../tools/fake-provider/semantic.ts";
import type { SemanticReply } from "../../tools/fake-provider/types.ts";
import { e2eEnabled, READY_TIMEOUT_MS } from "../harness.ts";
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
  registerProject,
  registerTrackedProject,
  removeHome,
  searchOnce,
  setTracking,
  untilDocuments,
  untilFile,
  untilReadable,
  untilSearch,
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

const OTHER_PROJECT = "prj_01arz3ndektsv4rrffq69g5fb0";
const FIRST_PLACE = "plan";
const NEXT_PLACE = "beta";
const MOVED_NAME = "notes";
const CURRENT_NAME = "memo";

type AddressResolved = {
  document: string;
  version: string;
  redirected: boolean;
  current_reference: {
    place: string;
    document: string;
    section: null;
    version: number;
  };
};

async function listedById(flow: FlowShell, id: string) {
  const found = (await listDocuments(flow)).find((row) => row.id === id);
  assert(found !== undefined, `문서가 없다: ${id}`);
  return found;
}

async function resolveAddress(
  flow: FlowShell,
  reference: {
    place: string;
    document: string;
    section: null;
    version: number | null;
  },
): Promise<AddressResolved> {
  const value = await mustCall(flow, {
    kind: "read",
    resource: "documents",
    method: "resolve",
    body: { reference },
  });
  return value.resolved as AddressResolved;
}

async function untilVersionText(
  flow: FlowShell,
  document: string,
  version: string,
  text: string,
): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    const read = await flow.call({
      kind: "worker",
      resource: "documents",
      method: "read",
      body: { reference: { document, version, section: null } },
    });
    const page = read.ok
      ? read.value as { text: string | null; section_status: string }
      : null;
    if (
      page !== null && page.text?.includes(text) &&
      page.section_status !== "unverified"
    ) return;
    assert(
      Date.now() < deadline,
      `판 본문이 아직 없다: ${JSON.stringify(read)}`,
    );
    await delay(250);
  }
}

async function openAddress(flow: FlowShell, link: string): Promise<void> {
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
    "documents/addressing#R6 documents/versions#R2 documents/versions#R6 documents/versions#R8 flow restore-document: 옛 이름이나 자리의 참조로 같은 문서의 지정 판과 이력을 읽는다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const folder = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "lophn-e2e-restore-address-" }),
    );
    const other = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "lophn-e2e-restore-place-" }),
    );
    const file = `${folder}/plan.md`;
    await Deno.writeTextFile(file, ALPHA);
    const flow = await openFlowShell({ start: "lophn" });
    try {
      await registerTrackedProject(flow, {
        folder,
        name: FIRST_PLACE,
        title: "Plan",
      });
      await untilDocuments(flow, ["plan"], "추적한 파일이 문서가 되지 않았다");
      const created = await documentTitled(flow, "plan");
      assert(created.name !== null, "문서 address 이름이 없다");
      const documentId = created.id;
      const originalName = created.name;
      await Deno.writeTextFile(file, BETA);
      await untilVersions(flow, documentId, 2, "두 번째 판이 없다");
      const historyBefore = await versionHistory(flow, documentId);
      assertEquals(historyBefore.map((row) => row.number), [2, 1]);
      const version2 = historyBefore[0]!;
      const version1 = historyBefore[1]!;
      assert(
        historyBefore.every((row) => row.saved_by.startsWith("machine")),
        `파일 관측 판의 저장 주체가 아니다: ${JSON.stringify(historyBefore)}`,
      );
      await untilVersionText(flow, documentId, version1.id, "Alpha line.");
      await untilVersionText(flow, documentId, version2.id, "Beta line.");
      const placed = await listedById(flow, documentId);
      assertEquals(placed.name, originalName);
      assertEquals(placed.latest_version, version2.id);

      await registerProject(flow, {
        folder: other,
        id: OTHER_PROJECT,
        name: NEXT_PLACE,
        title: "Beta",
      });
      await mustCall(flow, {
        kind: "command",
        resource: "documents",
        method: "move",
        body: commandBody(
          {
            document: documentId,
            place: { kind: "project", id: OTHER_PROJECT },
            name: MOVED_NAME,
          },
          { base_revision: placed.revision },
        ),
      });
      const moved = await listedById(flow, documentId);
      assertEquals(moved.name, MOVED_NAME);
      assertEquals(moved.latest_version, version2.id);
      await mustCall(flow, {
        kind: "command",
        resource: "documents",
        method: "rename",
        body: commandBody(
          { document: documentId, name: CURRENT_NAME },
          { base_revision: moved.revision },
        ),
      });
      const renamed = await listedById(flow, documentId);
      assertEquals(renamed.id, documentId);
      assertEquals(renamed.name, CURRENT_NAME);
      assertEquals(renamed.latest_version, version2.id);
      assertEquals(await versionHistory(flow, documentId), historyBefore);
      assertEquals(await Deno.readTextFile(file), BETA);

      const first = await resolveAddress(flow, {
        place: FIRST_PLACE,
        document: originalName,
        section: null,
        version: version1.number,
      });
      assertEquals(first.document, documentId);
      assertEquals(first.version, version1.id);
      assertEquals(first.redirected, true);
      assertEquals(first.current_reference, {
        place: NEXT_PLACE,
        document: CURRENT_NAME,
        section: null,
        version: version1.number,
      });
      const intermediate = await resolveAddress(flow, {
        place: NEXT_PLACE,
        document: MOVED_NAME,
        section: null,
        version: version2.number,
      });
      assertEquals(intermediate.document, documentId);
      assertEquals(intermediate.version, version2.id);
      assertEquals(intermediate.redirected, true);
      assertEquals(intermediate.current_reference, {
        place: NEXT_PLACE,
        document: CURRENT_NAME,
        section: null,
        version: version2.number,
      });
      const current = await resolveAddress(flow, {
        place: NEXT_PLACE,
        document: CURRENT_NAME,
        section: null,
        version: null,
      });
      assertEquals(current.document, documentId);
      assertEquals(current.redirected, false);
      assertEquals(current.version, version2.id);

      await flow.until(
        `document.querySelector("[data-open-link]") !== null`,
        "문서 화면이 서지 않았다",
      );
      await openAddress(
        flow,
        `${FIRST_PLACE}/${originalName}@${version1.number}`,
      );
      const readerBody =
        `document.querySelector('[data-reader="${documentId}"] [data-body]')?.textContent`;
      await flow.until(
        `${readerBody}?.includes("Alpha line.") && !${readerBody}?.includes("Beta line.") && document.querySelector("[data-link-moved]") !== null && document.querySelector("[data-link-pinned]") !== null && document.querySelector('[data-reader="${documentId}"] [data-version-state="older"]') !== null`,
        "옛 address가 같은 문서의 지정 판을 열지 않았다",
      );
      assertStringIncludes(
        (await flow.text("[data-link-moved]")) ?? "",
        `${NEXT_PLACE}/${CURRENT_NAME}`,
      );
      assertStringIncludes(
        (await flow.text("[data-link-pinned]")) ?? "",
        `version ${version1.number}`,
      );

      await flow.click("[data-launcher-back]");
      await flow.until(
        `document.querySelector('[data-card="project"][data-project="${OTHER_PROJECT}"] button:not([data-details-toggle])') !== null`,
        "옮긴 프로젝트 카드가 없다",
      );
      await flow.click(
        `[data-card="project"][data-project="${OTHER_PROJECT}"] button:not([data-details-toggle])`,
      );
      await flow.until(
        `document.querySelector("[data-space]")?.getAttribute("data-space") === "project"`,
        "project 작업대가 서지 않았다",
      );
      await flow.until(
        `document.querySelector('[data-document="${documentId}"]') !== null`,
        "옮긴 문서가 작업대에 없다",
      );
      await flow.click(`[data-document="${documentId}"]`);
      await flow.until(
        `document.querySelector('[data-tab="${documentId}"]') !== null && document.querySelector("[data-document-body]")?.textContent?.includes("Beta line.")`,
        "같은 문서의 최신 판이 열리지 않았다",
      );
      await openVersions(flow);
      const historyScreen = JSON.parse(String(
        await flow.evaluate(
          `JSON.stringify({ rows: [...document.querySelectorAll("[data-version-row]")].map((el) => Number(el.getAttribute("data-version-row"))), text: document.querySelector("[data-versions-tab]")?.innerText ?? "" })`,
        ),
      )) as { rows: number[]; text: string };
      assertEquals(historyScreen.rows, historyBefore.map((row) => row.number));
      assertEquals(
        await flow.count("[data-versions-tab] time"),
        historyBefore.length,
      );
      assertEquals(
        await flow.count("[data-versions-tab] [data-version-run]"),
        0,
      );
      assert(
        historyScreen.text.includes("From the file"),
        historyScreen.text,
      );
    } finally {
      await flow.close();
      await removeHome(flow.home);
      await Deno.remove(folder, { recursive: true });
      await Deno.remove(other, { recursive: true });
    }
  },
});

const RESTORED = "zzrestorealpha";
const LATER = "zzrestorebeta";
const RESTORED_TEXT = `# Plan\n\n${RESTORED}\n`;
const LATER_TEXT = `# Plan\n\n${LATER}\n`;

Deno.test({
  name:
    "documents/outline-and-search#R15 documents/file-tracking#R15 documents/versions#R5 documents/versions#R10 shell/editor#R2 flow restore-document: 새 판 뒤 파일 저장·판 확정·검색 반영 대기를 각각 확인한다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const folder = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "lophn-e2e-restore-search-" }),
    );
    const file = `${folder}/plan.md`;
    await Deno.writeTextFile(file, RESTORED_TEXT);
    const { flow, documentId } = await openProjectWorkspace({
      folder,
      name: "plan",
      title: "Plan",
      document: "plan",
    });
    try {
      await Deno.writeTextFile(file, LATER_TEXT);
      await untilVersions(flow, documentId, 2, "두 번째 판이 없다");
      await untilSearch(
        flow,
        LATER,
        (page) => page.results.some((row) => row.document === documentId),
        "나중 판의 검색 반영이 끝나지 않았다",
      );
      const indexed = await searchOnce(flow, RESTORED);
      assertEquals(indexed.coverage.lagging, false);
      assertEquals(indexed.coverage.rebuilding, false);
      assertEquals(
        indexed.results.some((row) => row.document === documentId),
        false,
        "아직 되살리지 않은 옛 내용이 최신 반영으로 남았다",
      );
      await untilReadable(flow, documentId, "지금 판의 본문이 읽히지 않는다");
      await flow.click(`[data-document="${documentId}"]`);
      await flow.until(
        `document.querySelector("[data-document-view]")?.getAttribute("data-document-view") === "read" && document.querySelector("[data-document-body]")?.textContent?.includes(${
          JSON.stringify(LATER)
        })`,
        "지금 판이 읽히지 않았다",
      );
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
      assertEquals(await Deno.readTextFile(file), LATER_TEXT);
      await flow.click("[data-restore-confirm-button]");
      await flow.until(
        `document.querySelector("[data-restore-notice]")?.getAttribute("data-restore-notice") === "saved"`,
        "restore 결과가 saved가 아니다",
      );
      const notice = (await flow.text("[data-restore-notice]")) ?? "";
      assertStringIncludes(notice, "newest version");
      assertEquals(notice.includes("Couldn't restore"), false);
      assertEquals(notice.includes("hasn't caught up"), false);
      assertEquals(await flow.count("[data-restore-notice='failed']"), 0);
      assertEquals(await flow.count("[data-restore-notice='pending']"), 0);
      assertEquals(await Deno.readTextFile(file), RESTORED_TEXT);
      await untilVersions(flow, documentId, 3, "restore한 판 3이 없다");
      const rows = await versionHistory(flow, documentId);
      assertEquals(rows.map((row) => row.number), [3, 2, 1]);
      assertEquals(rows[0].content_hash, rows[2].content_hash);
      assert(rows[1].content_hash !== rows[0].content_hash);
      const confirmed = rows[0].id;

      const searched = await searchOnce(flow, RESTORED);
      if (searched.coverage.lagging || searched.coverage.rebuilding) {
        assertEquals(searched.results.length, 0);
      } else {
        assert(
          searched.results.some((row) => row.document === documentId),
          "반영이 끝났는데 되살린 내용이 검색에 없다",
        );
      }
      const read = await flow.call({
        kind: "worker",
        resource: "documents",
        method: "read",
        body: {
          reference: {
            document: documentId,
            version: confirmed,
            section: null,
          },
        },
      });
      assert(read.ok, `documents/read: ${JSON.stringify(read)}`);
      const page = read.value as {
        text: string | null;
        section_status: string;
        version: string;
      };
      assertEquals(page.version, confirmed);
      if (page.text === null) {
        assertEquals(page.section_status, "unverified");
      } else {
        assert(page.text.includes(RESTORED));
        assertEquals(page.text.includes(LATER), false);
      }
      const outline = await flow.call({
        kind: "worker",
        resource: "outline",
        method: "document",
        body: {
          reference: {
            document: documentId,
            version: confirmed,
            section: null,
          },
        },
      });
      assert(outline.ok, `outline/document: ${JSON.stringify(outline)}`);
      const outlinePage = outline.value as {
        version: string;
        section_status: string;
        entries: unknown[];
      };
      assertEquals(outlinePage.version, confirmed);
      if (outlinePage.section_status === "unverified") {
        assertEquals(outlinePage.entries.length, 0);
      }

      await flow.click("[data-entry=lophn]");
      await flow.until(
        `document.querySelector("[data-space]")?.getAttribute("data-space") === "lophn" && document.querySelector("[data-search-input]") !== null`,
        "documents 화면이 서지 않았다",
      );
      await flow.type("[data-search-input]", RESTORED);
      await flow.click("[data-search-submit]");
      const hit = `[data-hit="${documentId}"]`;
      await flow.until(
        `document.querySelector("[data-coverage-note=lagging]") !== null || document.querySelector("[data-coverage-note=rebuilding]") !== null || document.querySelector(${
          JSON.stringify(hit)
        }) !== null`,
        "검색 반영 대기나 반영된 결과가 없다",
      );
      const waiting = (await flow.count("[data-coverage-note=lagging]")) +
        (await flow.count("[data-coverage-note=rebuilding]"));
      const hits = await flow.count(hit);
      assertEquals(
        waiting > 0 && hits > 0,
        false,
        "검색 반영 대기와 완료한 결과가 함께 보인다",
      );
      if (waiting > 0) {
        assertEquals(hits, 0);
        const note = (await flow.text("[data-coverage-note=lagging]")) ??
          (await flow.text("[data-coverage-note=rebuilding]")) ?? "";
        assert(
          note.includes("hasn't caught up") || note.includes("being rebuilt"),
          note,
        );
        assertEquals(await flow.count("[data-restore-notice='failed']"), 0);
      } else {
        assert(hits > 0);
        assertEquals(await flow.count("[data-coverage-note=lagging]"), 0);
      }
      assertEquals(
        await flow.evaluate(
          `document.querySelector("[data-restore-notice]")?.getAttribute("data-restore-notice") ?? ""`,
        ),
        "",
      );
    } finally {
      await flow.close();
      await removeHome(flow.home);
      await Deno.remove(folder, { recursive: true });
    }
  },
});

const HELD_PROJECT = "prj_01arz3ndektsv4rrffq69g5faw";
const IDLE_PROJECT = "prj_01arz3ndektsv4rrffq69g5fax";
const STALE_TEXT = "# Plan\n\nStale line.\n";
// 관측 loop의 조용함(750ms)보다 길게 본다. 낡은 범위의 loop가 아직 돌면 이 안에 새 판이 된다.
const STALE_QUIET_MS = 10_000;

type FileStatusView = { state?: string; details?: string | null };

type PreparedDoc = {
  id: string;
  file: string;
  folder: string;
  project: string;
  title: string;
};

async function prepareTracked(
  flow: FlowShell,
  options: {
    folder: string;
    id?: string;
    name: string;
    title: string;
    fileName: string;
  },
): Promise<PreparedDoc> {
  const file = `${options.folder}/${options.fileName}`;
  await Deno.writeTextFile(file, ALPHA);
  const registered = await registerTrackedProject(flow, {
    folder: options.folder,
    ...(options.id === undefined ? {} : { id: options.id }),
    name: options.name,
    title: options.title,
  });
  const documentTitle = options.fileName.slice(0, -".md".length);
  await untilDocuments(
    flow,
    [documentTitle],
    `${documentTitle}가 문서가 되지 않았다`,
  );
  return {
    id: "",
    file,
    folder: options.folder,
    project: registered.project,
    title: documentTitle,
  };
}

async function secondVersion(
  flow: FlowShell,
  doc: PreparedDoc,
): Promise<PreparedDoc> {
  await untilDocuments(flow, [doc.title], `${doc.title}가 문서가 되지 않았다`);
  const created = await documentTitled(flow, doc.title);
  await Deno.writeTextFile(doc.file, BETA);
  await untilVersions(flow, created.id, 2, `${doc.title}의 두 번째 판이 없다`);
  await untilReadable(flow, created.id, `${doc.title}의 본문이 읽히지 않는다`);
  assertEquals(
    (await versionHistory(flow, created.id)).map((row) => row.number),
    [2, 1],
  );
  return { ...doc, id: created.id };
}

async function projectRevision(
  flow: FlowShell,
  project: string,
): Promise<string> {
  const got = await mustCall(flow, {
    kind: "read",
    resource: "projects",
    method: "get",
    body: { project },
  });
  return String((got.project as { revision: string }).revision);
}

async function fileStatus(
  flow: FlowShell,
  project: string,
  path: string,
): Promise<FileStatusView | undefined> {
  const reply = await flow.call({
    kind: "read",
    resource: "files",
    method: "status",
    body: { target: { kind: "project_file", project, path } },
  });
  if (!reply.ok) return undefined;
  return (reply.value as { status?: FileStatusView }).status;
}

async function untilFileStatus(
  flow: FlowShell,
  project: string,
  path: string,
  done: (status: FileStatusView) => boolean,
  what: string,
): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let last: FileStatusView | undefined;
  for (;;) {
    last = await fileStatus(flow, project, path);
    if (last !== undefined && done(last)) return;
    assert(Date.now() < deadline, `${what}: ${JSON.stringify(last)}`);
    await delay(250);
  }
}

async function openTrackedDocument(
  flow: FlowShell,
  project: string,
  documentId: string,
): Promise<void> {
  const space = String(
    await flow.evaluate(
      `document.querySelector("[data-space]")?.getAttribute("data-space") ?? ""`,
    ),
  );
  if (space !== "launcher") {
    await flow.click("[data-launcher-back]");
    await flow.until(
      `document.querySelector("[data-space]")?.getAttribute("data-space") === "launcher"`,
      "런처로 돌아오지 않았다",
    );
  }
  const card =
    `[data-card="project"][data-project="${project}"] button:not([data-details-toggle])`;
  await flow.until(
    `document.querySelector(${JSON.stringify(card)}) !== null`,
    "프로젝트 카드가 없다",
  );
  await flow.click(card);
  await flow.until(
    `document.querySelector("[data-space]")?.getAttribute("data-space") === "project" && document.querySelector('[data-document="${documentId}"]') !== null`,
    "작업대에 문서가 없다",
  );
  await flow.click(`[data-document="${documentId}"]`);
  await flow.until(
    `document.querySelector('[data-tab="${documentId}"]') !== null && document.querySelector("[data-document-body]")?.textContent?.includes("Beta line.")`,
    "확정한 지금 판이 읽히지 않았다",
  );
}

async function closeCompare(flow: FlowShell): Promise<void> {
  if (await flow.count("[data-compare-view]") === 0) return;
  await flow.click("[data-compare-close]");
  await flow.until(
    `document.querySelector("[data-compare-view]") === null`,
    "비교 화면이 닫히지 않았다",
  );
}

async function compareOldToNewest(flow: FlowShell): Promise<void> {
  await closeCompare(flow);
  await openVersions(flow);
  await flow.until(
    `${ROW_NUMBERS} === "[2,1]"`,
    "이력에 옛 판과 지금 판이 없다",
  );
  await flow.click(`[data-compare-newest="1"]`);
  await flow.until(
    `document.querySelector("[data-compare-view]") !== null`,
    "비교 화면이 열리지 않았다",
  );
  await flow.until(
    `${DIFF_TEXT("delete")}.includes("\\"Alpha line.\\"") && ${
      DIFF_TEXT("add")
    }.includes("\\"Beta line.\\"")`,
    "옛 판과 지금 판의 내용이 읽히지 않는다",
  );
}

async function unchangedAfterOutsideWrite(
  flow: FlowShell,
  documentId: string,
  file: string,
): Promise<void> {
  const before = await versionHistory(flow, documentId);
  assertEquals(before.map((row) => row.number), [2, 1]);
  await Deno.writeTextFile(file, STALE_TEXT);
  const deadline = Date.now() + STALE_QUIET_MS;
  while (Date.now() < deadline) {
    const rows = await versionHistory(flow, documentId);
    assertEquals(
      rows.map((row) => row.content_hash),
      before.map((row) => row.content_hash),
      "낡은 추적 범위로 새 판이 확정됐다",
    );
    await delay(400);
  }
  assertEquals(await Deno.readTextFile(file), STALE_TEXT);
}

async function confirmedStillReadable(
  flow: FlowShell,
  documentId: string,
): Promise<void> {
  await closeCompare(flow);
  await flow.until(
    `document.querySelector('[data-tab="${documentId}"]') !== null && document.querySelector("[data-document-body]")?.textContent?.includes("Beta line.") && !document.querySelector("[data-document-body]")?.textContent?.includes("Stale line.")`,
    "확정한 판 대신 파일의 새 글이 읽힌다",
  );
  await openVersions(flow);
  await flow.until(
    `${ROW_NUMBERS} === "[2,1]"`,
    "이력이 옛 판을 잃거나 새 판을 보여 준다",
  );
  const rows = await versionHistory(flow, documentId);
  await untilVersionText(flow, documentId, rows[1]!.id, "Alpha line.");
  await untilVersionText(flow, documentId, rows[0]!.id, "Beta line.");
  const old = await mustCall(flow, {
    kind: "worker",
    resource: "documents",
    method: "read",
    body: {
      reference: { document: documentId, version: rows[1]!.id, section: null },
    },
  });
  const text = String(old.text ?? "");
  assert(text.includes("Alpha line."), text);
  assertEquals(text.includes("Beta line."), false);
  assertEquals(text.includes("Stale line."), false);
}

Deno.test({
  name:
    "documents/versions#R11 documents/file-tracking#R8 flow restore-document: 문서나 프로젝트를 보관했거나 추적을 중단해도 옛 판은 읽히고 낡은 추적 범위로 새 판을 확정하지 않는다",
  ignore: !e2eEnabled(),
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const keptFolder = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "lophn-e2e-restore-kept-" }),
    );
    const heldFolder = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "lophn-e2e-restore-held-" }),
    );
    const idleFolder = await Deno.realPath(
      await Deno.makeTempDir({ prefix: "lophn-e2e-restore-idle-" }),
    );
    const flow = await openFlowShell({ start: "lophn" });
    try {
      const keptRegistered = await prepareTracked(flow, {
        folder: keptFolder,
        name: "kept",
        title: "Kept",
        fileName: "kept.md",
      });
      const heldRegistered = await prepareTracked(flow, {
        folder: heldFolder,
        id: HELD_PROJECT,
        name: "held",
        title: "Held",
        fileName: "held.md",
      });
      const idleRegistered = await prepareTracked(flow, {
        folder: idleFolder,
        id: IDLE_PROJECT,
        name: "idle",
        title: "Idle",
        fileName: "idle.md",
      });
      const kept = await secondVersion(flow, keptRegistered);
      const held = await secondVersion(flow, heldRegistered);
      const idle = await secondVersion(flow, idleRegistered);

      await openTrackedDocument(flow, kept.project, kept.id);
      const keptBefore = await documentTitled(flow, "kept");
      await mustCall(flow, {
        kind: "command",
        resource: "documents",
        method: "archive",
        body: commandBody(
          { document: kept.id },
          { base_revision: keptBefore.revision },
        ),
      });
      const archived = await documentTitled(flow, "kept", "archived");
      assertEquals(archived.id, kept.id);
      assertEquals(archived.latest_version, keptBefore.latest_version);
      await untilFileStatus(
        flow,
        kept.project,
        kept.file,
        (status) =>
          status.state === "unverified" &&
          status.details === "document archived",
        "보관된 문서의 관측이 새 판을 만들지 않는 상태로 오지 않았다",
      );
      await compareOldToNewest(flow);
      await flow.click(`[data-info-tab="info"]`);
      await flow.until(
        `document.querySelector("[data-info-facts]")?.textContent?.includes("Archived")`,
        "보관한 문서라는 안내가 없다",
      );
      await unchangedAfterOutsideWrite(flow, kept.id, kept.file);
      await confirmedStillReadable(flow, kept.id);

      await openTrackedDocument(flow, held.project, held.id);
      await mustCall(flow, {
        kind: "command",
        resource: "projects",
        method: "archive",
        body: commandBody(
          { project: held.project },
          { base_revision: await projectRevision(flow, held.project) },
        ),
      });
      const heldStill = await documentTitled(flow, "held");
      assertEquals(heldStill.status, "active");
      assertEquals(heldStill.id, held.id);
      await untilFileStatus(
        flow,
        held.project,
        held.file,
        (status) => status.state === "not_tracked",
        "보관한 프로젝트의 낡은 추적이 멈추지 않았다",
      );
      await compareOldToNewest(flow);
      await unchangedAfterOutsideWrite(flow, held.id, held.file);
      await confirmedStillReadable(flow, held.id);

      await openTrackedDocument(flow, idle.project, idle.id);
      const turnedOff = await setTracking(
        flow,
        idle.project,
        await projectRevision(flow, idle.project),
        { folder: idle.folder, globs: [], enabled: false },
      );
      assert(turnedOff.ok, JSON.stringify(turnedOff));
      const idleStill = await documentTitled(flow, "idle");
      assertEquals(idleStill.status, "active");
      assertEquals(idleStill.id, idle.id);
      await untilFileStatus(
        flow,
        idle.project,
        idle.file,
        (status) => status.state === "not_tracked",
        "추적을 끈 뒤에도 낡은 범위가 추적 중이다",
      );
      await compareOldToNewest(flow);
      await unchangedAfterOutsideWrite(flow, idle.id, idle.file);
      await confirmedStillReadable(flow, idle.id);
    } finally {
      await flow.close();
      await removeHome(flow.home);
      await Deno.remove(keptFolder, { recursive: true });
      await Deno.remove(heldFolder, { recursive: true });
      await Deno.remove(idleFolder, { recursive: true });
    }
  },
});
