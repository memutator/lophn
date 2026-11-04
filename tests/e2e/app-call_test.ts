// 세 질문
// - contract: boundary `app-runtime`·`app-spi`(tool 호출은 core를 지나고 invocation과 changeset이 같이 남는다),
//   `child-supervision-protocol`(응답이 control frame 한도를 넘어도 호출은 결과 모름이 되지 않는다), `agent-tools`(`lophn <slug> <command>`),
//   `app-capability`(broker가 요청마다 선언∩grant를 보고 lophn이 secret을 붙인다. 앱은 값을 모른다),
//   `approvals`(할당이 agent의 앱 호출을 연다).
// - 현실적 회귀: 큰 changeset·결과가 frame 한도에서 거절되어 호출이 "결과 모름"이 되고 rewind가 막히는 것(세 번 난 일),
//   agent tool이 core를 건너뛰는 것, caller 확인이 풀리는 것, net/fetch가 실제 core에서 나가지 못하는 것과
//   secret 사용이 늘 `unavailable`이었던 것.
// - 왜 지금 test로 못 잡나: 한도 관계는 `fit_test`, `supervisor-link_test`가 상수로만 본다. 실제 pipe를 지나는 호출과
//   agent -> core -> 앱 process 왕복은 process를 건너야 한다. net·secret의 unit은 `transport`를 끼워 넣어 supervisor
//   process 경계를 지나지 않는다.
//
// fake 대답: 앱 하나를 activation helper로 한 번 띄우고 행들이 그 앱을 쓴다. 행의 fake 대답은 `agent-calls-app`의 둘뿐이다(호출과
// text). 앱 command는 `lophn <slug> <command 낱말>`로 부르고 기록 이름은 `<slug>.<command>`다. 앱 command는 model의
// tools[]에 없고 부를 때 읽으므로, 무엇이 보이는지는 `lophn help`의 묶음 목록으로 본다. agent는 test가 만든 agent의 앱 place
// session이다(비공개 command는 그 앱 place의 session만 본다). 앱 activation helper의 앱 place lophn session 대답은 행 몫에 세지 않는다.
// 할당 경계 행(removed-tool, no-assignment, assignment-added)
// - contract: boundary `approvals`·`agent-tools`(앱 ∩ release 선언 ∩ 할당만 command가 되고, 뺀 command는 보이지 않고 불러도 core에
//   닿지 않는다), `run-loop`(tools[]는 session을 시작할 때 고정하고 앱 command는 부를 때 읽는다).
// - 현실적 회귀: `removed_tools`가 무시되어 뺀 command가 불리는 것, 할당 없는 agent에 앱 command가 보이는 것, session 도중
//   할당이 바뀌어 `tools[]`가 달라져 prompt cache가 깨지는 것, 할당을 더했는데 새 command가 불리지 않는 것.
// - 왜 지금 test로 못 잡나: `app-tools`·`judge`·`turn-prompt`·`tool-lists`의 unit은 입력으로 받은 할당과 목록만 본다. 사람의
//   `SetAgentAssignment` 저장 → agent runtime child의 읽기 → model 요청의 `tools[]` → 호출이 core를 지나 앱 process에서
//   실행되는 왕복은 process를 건너야 보인다.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CALL_BODY_MAX_BYTES } from "../../packages/core/apps/runtime/entrypoint/limits.ts";
import { serve } from "../../packages/core/server/serve.ts";
import {
  assignmentGet,
  assignmentSet,
  type AssignmentEntry,
} from "../../packages/protocol/approvals/mod.ts";
import {
  appCallTool,
  appInvocation,
  appInvocations,
  appRewindPlan,
  appRuntime,
} from "../../packages/protocol/apps/mod.ts";
import {
  agentCreate,
  type Place,
  toolCallList,
} from "../../packages/protocol/lophn-agent/mod.ts";
import {
  approveActivation,
  deliverRelease,
  startTestApp,
  waitRunning,
} from "../support/app/activate.ts";
import { appCoreEnv } from "../support/app/deps.ts";
import { callPatch } from "../support/app/patch-call.ts";
import { netFetchPatch } from "../support/app/patch-net.ts";
import {
  connectFakeProvider,
  openPlaceSession,
  say,
  waitTurnEnd,
} from "../support/core/human.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import {
  type FakeServer,
  startFakeServer,
} from "../support/fake-server/mod.ts";
import { lophnReply } from "../support/fake-server/lophn.ts";
import {
  lastToolResult,
  lastUserText,
  systemText,
} from "../support/fake-server/probe.ts";

const user = { kind: "person", view_session: "e2e" } as const;

// 행 하나의 준비. entries가 null이면 할당을 한 번도 set하지 않은 agent다.
async function agentWith(
  core: Core,
  place: Place,
  name: string,
  entries: AssignmentEntry[] | null,
): Promise<{ session: string; agent: string }> {
  const agent = core.ids.newId("agt");
  await core.call(agentCreate, {
    id: agent,
    definition: {
      name,
      body: "use the assigned app",
    },
  });
  if (entries !== null) {
    // 새 agent의 할당 revision은 0이다.
    await core.call(assignmentSet, { agent, entries }, { revision: 0 });
  }
  return { session: await openPlaceSession(core, agent, place), agent };
}

// 앱의 `lophn <slug> --help`다. 이 agent가 지금 부를 수 있는 그 앱의 command가 나온다.
// 보이는 command가 없으면 모르는 명령이라는 오류가 나온다.
const helpReply = (slug: string) => ({
  kind: "tool" as const,
  calls: [lophnReply(slug, `${slug} --help`).calls[0]],
});
const helpOf = (fake: FakeServer, slug: string, index = 1) =>
  lastToolResult(fake.journal()[index], slug) ?? "";

const doneText = { reply: { kind: "text" as const, text: "done" } };

// net-fetch-loopback 행의 loopback 상대다. 받은 요청 수와 Authorization을 남기고 JSON을 돌려준다.
async function startLoopback() {
  const seen: (string | null)[] = [];
  const server = await serve({ hostname: "127.0.0.1", port: 0 }, (request) => {
    seen.push(request.headers.get("authorization"));
    return Response.json({ hello: "net" });
  });
  const port = server.addr.transport === "tcp" ? server.addr.port : 0;
  return { seen, port, close: () => server.shutdown() };
}

const NET_SECRET = "e2e.net.token";

// 앱 command 하나를 부르는 대답. words는 `<slug> <command 낱말>`, input은 그 command의 입력이다.
const callApp = (id: string, line: string, input?: unknown) =>
  lophnReply(id, line, input);

const text = (value: string) => ({
  reply: { kind: "text" as const, text: value },
});

async function nonceOf(core: Core, app: string): Promise<string> {
  const { observation } = await core.call(appRuntime, { app });
  assert.ok(observation !== null, "앱 process 관측이 없다");
  return observation.process_nonce;
}

async function items(core: Core, app: string): Promise<string> {
  const listed = await core.call(appCallTool, {
    target: { mode: "live", app, release: null },
    kind: "command",
    name: "list_items",
    caller: user,
  });
  return JSON.stringify(listed.outcome);
}

test("E2E agent·사람 화면의 tool 호출은 core를 지나 앱 process가 실행하고 기록되며, frame 한도를 넘는 write도 성공으로 닫힌다", async (t) => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  const loopback = await startLoopback();
  const token = crypto.randomUUID();
  try {
    core = await bootCore(run, { env: await appCoreEnv() });
    await connectFakeProvider(core, fake);
    const put = await core.upload(NET_SECRET, new TextEncoder().encode(token));
    assert.ok(put.ok, "secrets/put가 거절됐다");
    const app = await startTestApp(core, fake, {
      name: "Calls",
      slug: "calls",
      patch: async (dir) => {
        await callPatch(dir);
        await netFetchPatch(dir, { port: loopback.port, secret: NET_SECRET });
      },
    });
    const id = app.app;
    const { release } = await deliverRelease(core, fake, app, {
      goal: "Make the first release of the app",
    });
    await approveActivation(core, app);
    await waitRunning(core, app, release);
    const c = core;
    const target = { mode: "live", app: id, release: null } as const;
    // 앱의 비공개 tool은 그 앱 place의 session만 본다.
    const place = { kind: "app", id } as const;
    const agent = c.ids.newId("agt");
    await c.call(agentCreate, {
      id: agent,
      definition: { name: "Caller", body: "use the app" },
    });
    await c.call(
      assignmentSet,
      {
        agent,
        entries: [{ app: id, removed_tools: [] }],
      },
      { revision: 0 },
    );

    const assignAll: AssignmentEntry[] = [{ app: id, removed_tools: [] }];

    await t.test("removed-tool", async () => {
      // 할당에서 뺀 command는 model이 그래도 부르면 실행되지 않는다.
      fake.reset();
      fake.script([
        {
          reply: callApp("t1", `${app.slug} add-item`, { title: "op-removed" }),
        },
        doneText,
      ]);
      const removed = await agentWith(c, place, "Removed", [
        { app: id, removed_tools: ["add_item"] },
      ]);
      await say(c, removed.session, "add op-removed");
      await waitTurnEnd(c, removed.session);
      // fake
      assert.ok(
        lastToolResult(fake.journal()[1], "t1")?.includes("unknown command"),
      );
      // ledger
      const writes = await c.call(appInvocations, {
        app: id,
        session: removed.session,
      });
      assert.deepStrictEqual(writes.invocations, []);
      // app state
      assert.ok(!(await items(c, id)).includes("op-removed"));
    });

    await t.test("no-assignment", async () => {
      // 할당 없이 만든 agent에는 활성 앱이 있어도 앱 command가 하나도 보이지 않는다.
      fake.reset();
      fake.script([{ reply: helpReply(app.slug) }, doneText]);
      const bare = await agentWith(c, place, "NoAssignment", null);
      await say(c, bare.session, "hello");
      await waitTurnEnd(c, bare.session);
      // fake
      assert.ok(helpOf(fake, app.slug).includes("unknown command"));
      // 정의 파일에 할당이 없는 것도 빈 할당(revision 0)으로 읽힌다.
      const read = await c.call(assignmentGet, { agent: bare.agent });
      assert.deepStrictEqual(read.assignment.entries, []);
      assert.deepStrictEqual(read.revision, 0);
    });

    await t.test("assignment-added", async () => {
      // session 도중 할당을 더해도 tools[]는 그대로이고 notice도 없지만, 새 command는 바로 불린다.
      fake.reset();
      fake.script([doneText, { reply: helpReply(app.slug) }, doneText]);
      const added = await agentWith(c, place, "AssignmentAdded", null);
      await say(c, added.session, "first");
      await waitTurnEnd(c, added.session, 0);
      await c.call(
        assignmentSet,
        { agent: added.agent, entries: assignAll },
        { revision: 0 },
      );
      await say(c, added.session, "second");
      await waitTurnEnd(c, added.session, 1);
      // fake
      const [before, after] = fake.journal();
      const help = helpOf(fake, app.slug, 2);
      assert.deepStrictEqual(
        JSON.stringify((after!.body as { tools: unknown }).tools),
        JSON.stringify((before!.body as { tools: unknown }).tools),
      );
      assert.ok(!lastUserText(after!).includes("tools_changed"));
      assert.ok(help.includes("list-items") && help.includes("add-item"));
      // ledger
      const read = await c.call(assignmentGet, { agent: added.agent });
      assert.deepStrictEqual(read.assignment.entries, assignAll);
      assert.notEqual(read.revision, 0);
      const writes = await c.call(appInvocations, {
        app: id,
        session: added.session,
      });
      assert.deepStrictEqual(writes.invocations, []);
    });

    await t.test("agent-calls-app", async () => {
      fake.reset();
      fake.script([
        { reply: callApp("t1", `${app.slug} add-item`, { title: "first" }) },
        text("done"),
      ]);
      const session = await openPlaceSession(c, agent, place);
      await say(c, session, "add an item");
      const turn = await waitTurnEnd(c, session);
      const { tool_calls } = await c.call(toolCallList, { session });
      // ledger: 기록 이름은 `<slug>.<command>`다.
      assert.deepStrictEqual(tool_calls[0].tool, `${app.slug}.add_item`);
      const { invocations } = await c.call(appInvocations, {
        app: id,
        session,
      });
      assert.deepStrictEqual(invocations.length, 1);
      assert.deepStrictEqual(invocations[0].status, "succeeded");
      assert.deepStrictEqual(invocations[0].caller, {
        kind: "agent",
        session,
        turn: turn.id,
        tool_call: tool_calls[0].id,
      });
      assert.notDeepStrictEqual(invocations[0].changeset, null);
      // app state
      assert.ok((await items(c, id)).includes("first"));
      // fake: 둘째 요청의 tool_result에 앱의 응답(새 row)이 있다.
      assert.ok(
        (lastToolResult(fake.journal()[1], "t1") ?? "").includes("first"),
      );
    });

    await t.test("big-changeset", async () => {
      const nonce = await nonceOf(c, id);
      const called = await c.call(appCallTool, {
        target,
        kind: "command",
        name: "big_write",
        input: { kb: 300 },
        caller: user,
      });
      assert.deepStrictEqual(called.outcome.status, "succeeded");
      assert.ok(called.invocation !== null);
      // ledger
      const { invocation } = await c.call(appInvocation, {
        invocation: called.invocation,
      });
      assert.deepStrictEqual(invocation?.status, "succeeded");
      assert.deepStrictEqual(
        invocation?.summary.changeset_dropped,
        "too_large",
      );
      assert.deepStrictEqual(invocation?.changeset, null);
      const { plan } = await c.call(appRewindPlan, {
        app: id,
        from_invocation: called.invocation,
      });
      assert.deepStrictEqual(plan.blocked, null);
      assert.deepStrictEqual(
        plan.items.find((item) => item.invocation === called.invocation)
          ?.reverts_db,
        false,
      );
      // app state
      assert.deepStrictEqual(
        JSON.stringify(called.outcome),
        JSON.stringify({ status: "succeeded", result: { rows: 1 } }),
      );
      // process
      assert.deepStrictEqual(await nonceOf(c, id), nonce);
    });

    await t.test("call-from-person", async () => {
      const called = await c.call(appCallTool, {
        target,
        kind: "command",
        name: "add_item",
        input: { title: "by-hand" },
        caller: user,
      });
      assert.deepStrictEqual(called.outcome.status, "succeeded");
      assert.ok(called.invocation !== null);
      // ledger
      const { invocation } = await c.call(appInvocation, {
        invocation: called.invocation,
      });
      assert.deepStrictEqual(invocation?.status, "succeeded");
      assert.deepStrictEqual(invocation?.caller, user);
      assert.notDeepStrictEqual(invocation?.changeset, null);
      // app state
      assert.ok((await items(c, id)).includes("by-hand"));
    });

    await t.test("operation-from-person", async () => {
      // 화면이 부르는 operation도 같은 길(줄, 기록, changeset)을 지나고 기록에 operation으로 남는다.
      const called = await c.call(appCallTool, {
        target,
        kind: "operation",
        name: "save_item",
        input: { title: "from-screen" },
        caller: user,
      });
      assert.deepStrictEqual(called.outcome.status, "succeeded");
      assert.ok(called.invocation !== null);
      const { invocation } = await c.call(appInvocation, {
        invocation: called.invocation,
      });
      assert.deepStrictEqual(invocation?.operation, {
        kind: "operation",
        name: "save_item",
      });
      assert.notDeepStrictEqual(invocation?.changeset, null);
      // 선언에 없는 이름은 kind가 달라도 handler에 닿지 않는다(command 이름을 operation으로 부른다).
      const wrong = await c.call(appCallTool, {
        target,
        kind: "operation",
        name: "add_item",
        input: { title: "wrong" },
        caller: user,
      });
      assert.deepStrictEqual(wrong.outcome.status, "denied");
      assert.ok(!(await items(c, id)).includes("wrong"));
    });

    await t.test("net-fetch-loopback", async () => {
      const called = await c.call(appCallTool, {
        target,
        kind: "command",
        name: "fetch_local",
        caller: user,
      });
      // route: 앱이 secret 값을 모르므로 응답 어디에도 값이 없다.
      assert.deepStrictEqual(called.outcome, {
        status: "succeeded",
        result: { status: 200, body: { hello: "net" } },
      });
      assert.ok(!JSON.stringify(called).includes(token));
      // loopback 서버
      assert.deepStrictEqual(loopback.seen, [`Bearer ${token}`]);
      // ledger
      assert.ok(called.invocation !== null);
      const { invocation } = await c.call(appInvocation, {
        invocation: called.invocation,
      });
      assert.deepStrictEqual(invocation?.status, "succeeded");
    });

    await t.test("input-too-large", async () => {
      const nonce = await nonceOf(c, id);
      const before = (await c.call(appInvocations, { app: id })).invocations
        .length;
      const refused = await c.tryCall(appCallTool, {
        target,
        kind: "command",
        name: "put_text",
        input: { text: "a".repeat(CALL_BODY_MAX_BYTES + 1) },
        caller: user,
      });
      // route
      assert.ok(!refused.ok);
      assert.deepStrictEqual(refused.error.code, "invalid_input");
      // ledger
      assert.deepStrictEqual(
        (await c.call(appInvocations, { app: id })).invocations.length,
        before,
      );
      // process
      assert.deepStrictEqual(await nonceOf(c, id), nonce);
    });
  } finally {
    await core?.kill().catch(() => {});
    await loopback.close();
    await fake.close();
    await run.remove();
  }
});
