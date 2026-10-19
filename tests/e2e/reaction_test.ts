// 세 질문
// - contract: boundary `events`(새 일 event는 Reactor가 reaction grant대로 session을 연다. 끌 수 있고, 물으면 사람이 허락해야 하고,
//   효과는 한 번이다), `approvals`(보류 request는 재시작에 남고 적용 때 다시 검사한다), `router`(program이 App Engineer session을 연다).
// - 현실적 회귀: 허락 없이 "물음"인데 session이 열리는 것, 끈 뒤에도 보류 request가 적용되는 것, 재시작 뒤 request가 사라지거나
//   두 번 적용되어 session이 둘 열리는 것, 문제가 열렸는데 Reactor가 그 event를 못 받는 것(collector worker -> core -> Reactor가 끊김).
// - 왜 지금 test로 못 잡나: `reactor_test`·`approvals_test`는 handler와 판정을 fake port로 본다. 문제 접수(collector worker child) ->
//   ledger -> Reactor -> Router -> agent runtime child의 turn까지 이어지는 길과 `settings.json`의 key 이름이 grant에 닿는지는
//   process를 건너야 보인다.
//
// 문제는 shell main이 하는 `problems/observe-view-error`를 test가 대신 불러 연다(앱 process 없이 reaction 사슬 전부를 지난다).
// "event가 열릴 때 끔"은 negative를 기다릴 신호가 없어 행으로 두지 않는다. 끔이 grant -> 설정 key -> 판정까지 이어지는 것은
// ask-then-off가 허락 적용 시점에 본다.
import { assert, assertEquals } from "@std/assert";
import {
  appCallTool,
  appCreate,
  appRuntime,
} from "../../packages/protocol/apps/mod.ts";
import {
  approvalsDecide,
  approvalsPending,
} from "../../packages/protocol/approvals/mod.ts";
import { settingsUpdate } from "../../packages/protocol/config/mod.ts";
import {
  agentSessionList,
  receivedMessageList,
} from "../../packages/protocol/lophn-agent/mod.ts";
import {
  observeViewError,
  problemList,
} from "../../packages/protocol/problems/mod.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import {
  connectFakeProvider,
  settle,
  until,
  waitTurnEnd,
} from "../support/core/human.ts";
import {
  activateTestApp,
  aeLane,
  tool,
  waitRunning,
} from "../support/app/activate.ts";
import { crashPatch } from "../support/app/patch-reaction.ts";
import { REPORT_MARKER, reportPatch } from "../support/app/patch-report.ts";
import { appCoreEnv } from "../support/coding/deps.ts";
import { startFakeServer } from "../support/fake-server/mod.ts";
import type { FakeServer } from "../support/fake-server/mod.ts";
import {
  idIn,
  lastToolResult,
  lastUserText,
} from "../support/fake-server/probe.ts";
import { connectGateway, type Gateway } from "../support/gateway/mod.ts";

const SETTING = "reactions.problem_opened";

// 보고마다 새 문제가 열린다(stack 없는 오류는 메시지까지 같아야 묶이니 report id로 메시지를 달리 한다).
// 접수가 알려 주는 문제 id를 돌려준다.
async function reportViewError(core: Core, app: string): Promise<string> {
  const reportId = core.ids.newId("rpt");
  const accepted = await core.call(observeViewError, {
    view: {
      view_session: "e2e-view",
      generation: 0,
      app,
      release: null,
      mode: "live",
      bundle_hash: "0".repeat(64),
    },
    observation: {
      report_id: reportId,
      observed_at: new Date().toISOString(),
      observation: "render_error",
      error: {
        name: "E2eViewError",
        message: `boom ${reportId}`,
        message_missing_reason: null,
        stack: null,
        stack_missing_reason: { reason: "view" },
      },
      error_missing_reason: null,
      invocation: null,
    },
  });
  assert(accepted.problem !== null);
  return accepted.problem;
}

// 그 앱의 App Engineer session 중 program 메시지로 열린 것과 그 메시지가 가리키는 문제들이다.
async function reactionSessions(core: Core, app: string) {
  const { sessions } = await core.call(agentSessionList, {
    agent: { role: "app_engineer", app },
  });
  const found: { session: string; problems: string[] }[] = [];
  for (const { id } of sessions) {
    const { messages } = await core.call(receivedMessageList, { session: id });
    const first = messages[0];
    if (first?.from.kind !== "program") continue;
    found.push({
      session: id,
      problems: first.refs.flatMap((ref) =>
        ref.kind === "problem" ? [ref.problem] : []
      ),
    });
  }
  return found;
}

const setMode = (core: Core, value: "ask" | "off" | "open") =>
  core.call(settingsUpdate, {
    changes: [{ key: SETTING, action: "set", value }],
  });

// 새 reaction session이 하나 더 생길 때까지 기다려 그 session을 돌려준다.
async function newSession(core: Core, app: string, before: string[]) {
  return await until("새 reaction session이 열림", async () => {
    const now = await reactionSessions(core, app);
    const added = now.filter((s) => !before.includes(s.session));
    return added.length > 0 ? added : undefined;
  });
}

async function pendingOne(core: Core) {
  const request = await until("보류 request가 옴", async () => {
    const { requests } = await core.call(approvalsPending, {});
    return requests.find((r) => r.status === "pending");
  });
  assertEquals(request.intent.kind, "reaction");
  return request;
}

Deno.test("E2E program이 agent를 부르는 길은 grant대로만 열린다: 물으면 사람이 허락해야 열리고 끈 뒤에는 허락해도 안 열리며 재시작 뒤에도 한 번만 적용된다", async (t) => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  let gateway: Gateway | undefined;
  try {
    core = await bootCore(run);
    await connectFakeProvider(core, fake);
    const app = (await core.call(appCreate, {
      slug: "reaction-app",
      name: "Reaction App",
      description: "Reacts to problems.",
    })).id;
    await settle(core);
    gateway = await connectGateway(core, {
      conditions: [{ types: ["ApprovalDecided"] }],
    });
    const c = core;
    const g = gateway;
    const text = (fake: FakeServer) => {
      fake.reset();
      fake.script([{ reply: { kind: "text", text: "noted" } }]);
    };
    const decided = (request: string) =>
      g.next(
        "event",
        (frame) =>
          frame.event.type === "ApprovalDecided" &&
          frame.event.subject === request,
      );
    let afterOpen: string[] = [];
    let afterAsk: string[] = [];

    await t.step("open-opens-app-engineer", async () => {
      text(fake);
      const problem = await reportViewError(c, app);
      const [opened] = await newSession(c, app, []);
      await waitTurnEnd(c, opened.session);

      // ledger
      const problems = (await c.call(problemList, { app })).problems;
      assertEquals(problems.map((p) => [p.id, p.state]), [[problem, "open"]]);
      const sessions = await reactionSessions(c, app);
      assertEquals(sessions, [{
        session: opened.session,
        problems: [problem],
      }]);
      afterOpen = sessions.map((s) => s.session);
      // route
      const { messages } = await c.call(receivedMessageList, {
        session: opened.session,
      });
      assertEquals(messages[0]!.from.kind, "program");
      assert(
        messages[0]!.refs.some((r) =>
          r.kind === "problem" && r.problem === problem
        ),
      );
      // fake
      const journal = fake.journal();
      assertEquals(journal.length, 1);
      assert(lastUserText(journal[0]!).includes(problem));
    });

    await t.step("ask-needs-allow", async () => {
      text(fake);
      await setMode(c, "ask");
      const problem = await reportViewError(c, app);
      const request = await pendingOne(c);
      // route: 허락 전에는 보내는 길을 안 탔다.
      assertEquals(
        (await reactionSessions(c, app)).map((s) => s.session),
        afterOpen,
      );
      await c.call(approvalsDecide, {
        request: request.id,
        choice: { kind: "allow" },
      });
      // event
      const frame = await decided(request.id);
      assert(frame.event.type === "ApprovalDecided");
      assertEquals(frame.event.payload.applied, { state: "applied" });
      // ledger
      const added = await newSession(c, app, afterOpen);
      assertEquals(added.length, 1);
      assertEquals(added[0]!.problems, [problem]);
      await waitTurnEnd(c, added[0]!.session);
      afterAsk = (await reactionSessions(c, app)).map((s) => s.session);
      assertEquals(afterAsk.length, afterOpen.length + 1);
    });

    await t.step("ask-then-off", async () => {
      fake.reset();
      await reportViewError(c, app);
      const request = await pendingOne(c);
      await setMode(c, "off");
      await c.call(approvalsDecide, {
        request: request.id,
        choice: { kind: "allow" },
      });
      // event: 적용이 끝난 신호를 받은 뒤라 아래 negative가 deterministic이다.
      const frame = await decided(request.id);
      assert(frame.event.type === "ApprovalDecided");
      const applied = frame.event.payload.applied;
      assert(applied?.state === "failed", JSON.stringify(applied));
      assertEquals(applied.code, "forbidden");
      // ledger
      assertEquals(
        (await reactionSessions(c, app)).map((s) => s.session),
        afterAsk,
      );
      // fake
      assertEquals(fake.journal().length, 0);
    });

    await t.step("ask-survives-restart", async () => {
      text(fake);
      await setMode(c, "ask");
      const problem = await reportViewError(c, app);
      const request = await pendingOne(c);
      await g.close();
      await c.kill();
      core = await bootCore(run);
      await settle(core);
      // route: 재시작 뒤 같은 id로 결정이 된다.
      const decidedRequest = await core.call(approvalsDecide, {
        request: request.id,
        choice: { kind: "allow" },
      });
      assertEquals(decidedRequest.request.id, request.id);
      // ledger
      const added = await newSession(core, app, afterAsk);
      assertEquals(added.length, 1);
      assertEquals(added[0]!.problems, [problem]);
      await waitTurnEnd(core, added[0]!.session);
      // fake
      assertEquals(fake.journal().length, 1);
    });
  } finally {
    await gateway?.close().catch(() => {});
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});

// 세 질문
// - contract: boundary `problems`(앱 process의 처리 안 된 오류는 문제가 되고 한 번만 열린다), `app-runtime`(거듭 죽으면 자동
//   재시작을 멈추고 `AppRestartHalted`를 낸다), `events`(새 일 event는 reaction grant대로 App Engineer를 연다).
// - 현실적 회귀: 앱이 죽는데 문제가 안 열리는 것(보고가 exit에 먼저 잘림), 같은 오류가 보고마다 새 문제를 여는 것, crash 횟수
//   계산이 어긋나 멈추지 않고 영영 되살리거나 너무 일찍 멈추는 것, 멈췄는데 아무도 부르지 않는 것.
// - 왜 지금 test로 못 잡나: 재시작 정책은 순수 규칙 unit이 있어도 실제 process 종료 -> supervisor -> command -> ledger ->
//   Reactor -> Router -> agent runtime의 turn은 이어서 본 적이 없다. SDK 오류 관측이 실제 exit와 경쟁하는 것은 process를
//   건너야 보인다.
//
// 앱을 activate하는 데 core가 앱 test용 env를 필요로 해서 위 test와 core를 같이 쓰지 못한다. App Engineer 줄(앱 activation helper의
// 줄이라 대답 3개 상한의 예외, README 정한 것 11)은 reaction session마다 text 하나다. supervisor가 여는 stack 없는
// `unexpected_exit` 문제는 같은 exit code끼리 한 문제로 묶이지만 넉넉히 건다.
// 문제는 SDK가 보고한 `Error`만 센다.
// 10분 창 안의 예상 밖 종료가 다섯을 넘는 여섯 번째 종료에서 멈춘다(restart-policy의 CRASH_LIMIT 5).
const CRASH_LIMIT_EXIT = 6;

const crash = async (core: Core, app: string) => {
  const called = await core.call(appCallTool, {
    target: { mode: "live", app, release: null },
    tool: "crash",
    caller: { kind: "person", view_session: "e2e" },
  });
  // 응답을 보낸 뒤 죽으므로 결과를 모를 수는 있어도 거절되거나 handler가 실패해서는 안 된다.
  assert(
    called.outcome.status === "succeeded" ||
      called.outcome.status === "unknown",
    JSON.stringify(called.outcome),
  );
};

// process_nonce가 `before`와 다른 process가 ready가 될 때까지 기다린다.
const restarted = (core: Core, app: string, before: string) =>
  until("앱이 다시 running이 됨", async () => {
    const now = await core.call(appRuntime, { app });
    const seen = now.observation;
    return now.state.state === "running" && seen !== null && seen.ready &&
        seen.accepting && seen.process_nonce !== before
      ? seen
      : undefined;
  }, 60_000);

Deno.test("E2E 앱 process가 던진 오류는 문제가 되어 App Engineer를 부르고, 거듭 죽으면 자동 재시작이 멈추며 App Engineer를 다시 부른다", async (t) => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  let app: Awaited<ReturnType<typeof activateTestApp>> | undefined;
  try {
    core = await bootCore(run, { env: await appCoreEnv() });
    await connectFakeProvider(core, fake);
    app = await activateTestApp(core, fake, {
      name: "Crasher",
      slug: "crasher",
      patch: crashPatch,
    });
    const c = core;
    const a = app;
    // activation helper의 줄과 같은 이름이라 그 줄의 남은 대답을 대체한다. reaction session의 요청도 같은 줄로 간다.
    fake.script(
      Array.from({ length: 12 }, () => ({
        reply: { kind: "text" as const, text: "noted" },
      })),
      aeLane(a),
    );
    let nonce = (await waitRunning(c, a)).process_nonce;
    let problem = "";

    const thrown = async () =>
      (await c.call(problemList, { app: a.app })).problems.filter((p) =>
        p.name === "Error"
      );

    await t.step("crash-opens-problem", async () => {
      await crash(c, a.app);
      const [error] = await until("던진 오류의 문제가 열림", async () => {
        const found = await thrown();
        return found.length > 0 ? found : undefined;
      });
      problem = error!.id;
      const opened = await until(
        "그 문제의 reaction session이 열림",
        async () => {
          const found = (await reactionSessions(c, a.app)).filter((s) =>
            s.problems.includes(problem)
          );
          return found.length > 0 ? found : undefined;
        },
      );
      await waitTurnEnd(c, opened[0]!.session);
      // ledger: 문구는 단정하지 않는다.
      assertEquals(error!.state, "open");
      // route: reactionSessions가 첫 메시지의 from을 program으로 가렸다.
      assertEquals(opened.length, 1);
      // process
      nonce = (await restarted(c, a.app, nonce)).process_nonce;
    });

    await t.step("crash-loop-halts", async () => {
      await a.gateway.watch([{ types: ["AppRestartHalted"] }]);
      for (let exit = 2; exit <= CRASH_LIMIT_EXIT; exit++) {
        await crash(c, a.app);
        if (exit < CRASH_LIMIT_EXIT) {
          nonce = (await restarted(c, a.app, nonce)).process_nonce;
        }
      }
      const halted = await a.gateway.next(
        "event",
        (frame) => frame.event.type === "AppRestartHalted",
      );
      assert(halted.event.type === "AppRestartHalted");
      assertEquals(halted.event.subject, a.app);
      const [second] = await until("둘째 reaction session이 열림", async () => {
        const found = (await reactionSessions(c, a.app)).filter((s) =>
          s.problems.length === 0
        );
        return found.length > 0 ? found : undefined;
      });
      await waitTurnEnd(c, second!.session);
      // route
      const state = (await c.call(appRuntime, { app: a.app })).state;
      assertEquals(state.state, "unavailable");
      assertEquals(state.reason?.code, "crash_loop");
      // event
      assertEquals(
        a.gateway.frames().filter((frame) =>
          frame.type === "event" && frame.event.type === "AppRestartHalted"
        ).length,
        1,
      );
      // ledger: 같은 오류는 여섯 번 던져도 문제 하나고, 이 event의 session은 refs가 없는 하나뿐이다.
      assertEquals((await thrown()).map((p) => p.id), [problem]);
      assertEquals(
        (await reactionSessions(c, a.app)).filter((s) =>
          s.problems.length === 0
        ).length,
        1,
      );
    });
  } finally {
    await app?.gateway.close().catch(() => {});
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});

// 세 질문
// - contract: boundary `problems`(agent가 보고 본문을 읽는 좁은 통로 `report_body`), `agent-roles`(App Engineer 자격의 operation 상한과
//   자기 앱 조건), `events`(새 일 event는 App Engineer를 연다).
// - 현실적 회귀: App Engineer가 보고한 앱의 message를 읽지 못하는 것(자격 검사가 process를 건너서 거절하거나 tool이 상한에 안 든다),
//   tool 결과에 본문이 안 실리는 것.
// - 왜 지금 test로 못 잡나: tool 목록·자격 상한·route actor는 unit이 따로 보지만, 앱 process의 보고 -> blob -> agent runtime child의
//   tool -> core loopback의 agent 자격 검사는 process를 건너야 이어서 보인다.
//
// 앱을 activate하는 core라 위 test와 core를 같이 쓰지 못한다. view 오류 보고는 본문 blob이 없어서, 앱의 reportProblem이 message를
// 남긴 문제를 쓴다. reaction session의 요청은 activation의 App Engineer 줄(`App <id>:`)에 걸리지 않아 기본 줄로 가고,
// 그 대답 셋은 problem.get -> problem.body -> text다.
Deno.test("E2E App Engineer는 앱이 보고한 message를 problem.body로 끝까지 읽는다", async (t) => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  let app: Awaited<ReturnType<typeof activateTestApp>> | undefined;
  try {
    core = await bootCore(run, { env: await appCoreEnv() });
    await connectFakeProvider(core, fake);
    app = await activateTestApp(core, fake, {
      name: "Reporter",
      slug: "reporter",
      patch: reportPatch,
    });
    const c = core;
    const a = app;
    await waitRunning(c, a);

    await t.step("ae-reads-report-text", async () => {
      fake.script([
        {
          reply: (request) =>
            tool("tc_get", "problem_get", {
              problem: idIn(lastUserText(request), "prb"),
            }),
        },
        {
          reply: (request) =>
            tool("tc_body", "problem_body", {
              report: idIn(lastToolResult(request, "tc_get") ?? "", "rpt"),
              field: "report_text",
            }),
        },
        { reply: { kind: "text", text: "noted" } },
      ]);
      const called = await c.call(appCallTool, {
        target: { mode: "live", app: a.app, release: null },
        tool: "report",
        caller: { kind: "person", view_session: "e2e" },
      });
      assertEquals(called.outcome.status, "succeeded");
      const [opened] = await until("reaction session이 열림", async () => {
        const found = await reactionSessions(c, a.app);
        return found.length > 0 ? found : undefined;
      });
      await waitTurnEnd(c, opened!.session);
      // ledger
      const problems = (await c.call(problemList, { app: a.app })).problems;
      assertEquals(problems.map((p) => p.name), ["e2e_report"]);
      // fake: 읽은 본문이 다음 요청의 tool 결과에 실렸다.
      const read = fake.journal().map((entry) =>
        lastToolResult(entry, "tc_body")
      ).find((result) => result !== undefined);
      assert(read?.includes(REPORT_MARKER), String(read));
    });
  } finally {
    await app?.gateway.close().catch(() => {});
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});
