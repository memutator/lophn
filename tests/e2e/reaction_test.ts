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
import { appCreate } from "../../packages/protocol/apps/mod.ts";
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
import { startFakeServer } from "../support/fake-server/mod.ts";
import type { FakeServer } from "../support/fake-server/mod.ts";
import { lastUserText } from "../support/fake-server/probe.ts";
import { connectGateway, type Gateway } from "../support/gateway/mod.ts";

const SETTING = "reactions.problem_opened";

// 보고마다 새 문제가 열린다(view 오류는 묶는 key가 report_id다). 접수가 알려 주는 문제 id를 돌려준다.
async function reportViewError(core: Core, app: string): Promise<string> {
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
      report_id: core.ids.newId("rpt"),
      observed_at: new Date().toISOString(),
      observation: "render_error",
      error: {
        name: "E2eViewError",
        message: "boom",
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
