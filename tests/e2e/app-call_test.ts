// 세 질문
// - contract: boundary `app-runtime`·`app-spi`(tool 호출은 core를 지나고 invocation과 changeset이 같이 남는다),
//   `child-supervision-protocol`(응답이 control frame 한도를 넘어도 호출은 결과 모름이 되지 않는다), `agent-tools`(tool),
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
// text). 첫 대답은 요청의 tool 목록에서 tool로 끝나는 이름을 골라 부르는 함수 대답이다. tool 이름 규칙
// (`<domain>_<tool>`, 길면 hash)을 test가 되풀이하지 않으려는 것이다. agent는 앱 place의 Operator다(비공개 tool은 그
// domain을 맡은 agent만 본다). 앱 activation helper의 App Engineer 대답은 행 몫에 세지 않는다.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appCallTool,
  appInvocation,
  appInvocations,
  appRewindPlan,
  appRuntime,
} from "../../packages/protocol/apps/mod.ts";
import { agentAssignmentSet } from "../../packages/protocol/approvals/mod.ts";
import {
  operatorCreate,
  toolCallList,
} from "../../packages/protocol/lophn-agent/mod.ts";
import { CALL_BODY_MAX_BYTES } from "../../packages/core/apps/runtime/entrypoint/limits.ts";
import { activateTestApp } from "../support/app/activate.ts";
import { callPatch } from "../support/app/patch-call.ts";
import { netFetchPatch } from "../support/app/patch-net.ts";
import { appCoreEnv } from "../support/app/deps.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import {
  connectFakeProvider,
  openSession,
  say,
  waitTurnEnd,
} from "../support/core/human.ts";
import {
  type JournalEntry,
  startFakeServer,
} from "../support/fake-server/mod.ts";
import { lastToolResult, toolNames } from "../support/fake-server/probe.ts";

const user = { kind: "person", view_session: "e2e" } as const;

// net-fetch-loopback 행의 loopback 상대다. 받은 요청 수와 Authorization을 남기고 JSON을 돌려준다.
function startLoopback() {
  const seen: (string | null)[] = [];
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    (request) => {
      seen.push(request.headers.get("authorization"));
      return Response.json({ hello: "net" });
    },
  );
  return { seen, port: server.addr.port, close: () => server.shutdown() };
}

const NET_SECRET = "e2e.net.token";

// 요청의 tool 목록에서 tool로 끝나는 tool을 골라 부른다.
function callApp(id: string, tool: string, input: unknown) {
  return (request: JournalEntry) => {
    const name = toolNames(request).find((item) => item.endsWith(`_${tool}`));
    if (name === undefined) throw new Error(`${tool} tool이 요청에 없다`);
    return {
      kind: "tool" as const,
      calls: [{ id, name, arguments: JSON.stringify(input) }],
    };
  };
}

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
    tool: "list_items",
    caller: user,
  });
  return JSON.stringify(listed.outcome);
}

test("E2E agent·사람 화면의 tool 호출은 core를 지나 앱 process가 실행하고 기록되며, frame 한도를 넘는 write도 성공으로 닫힌다", async (t) => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  const loopback = startLoopback();
  const token = crypto.randomUUID();
  try {
    core = await bootCore(run, { env: await appCoreEnv() });
    await connectFakeProvider(core, fake);
    const put = await core.upload(NET_SECRET, new TextEncoder().encode(token));
    assert.ok(put.ok, "secrets/put가 거절됐다");
    const app = await activateTestApp(core, fake, {
      name: "Calls",
      slug: "calls",
      patch: async (dir) => {
        await callPatch(dir);
        await netFetchPatch(dir, { port: loopback.port, secret: NET_SECRET });
      },
    });
    const id = app.app;
    const c = core;
    const target = { mode: "live", app: id, release: null } as const;
    // 앱의 비공개 tool은 그 domain을 맡은 agent만 본다. 앱 place의 Operator는 앱의 domain을 모두 맡는다.
    const agent = c.ids.newId("agt");
    await c.call(operatorCreate, {
      id: agent,
      place: { kind: "app", id },
      definition: { name: "Caller", body: "use the app" },
    });
    const operator = { role: "operator", agent } as const;
    await c.call(agentAssignmentSet, {
      agent: operator,
      entries: [{ app: id, removed_tools: [] }],
    }, { revision: 0 });

    await t.test("agent-calls-app", async () => {
      fake.reset();
      fake.script([
        { reply: callApp("t1", "add_item", { title: "first" }) },
        text("done"),
      ]);
      const session = await openSession(c, operator);
      await say(c, session, "add an item");
      const turn = await waitTurnEnd(c, session);
      const { tool_calls } = await c.call(toolCallList, { session });
      // ledger
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
        tool: "big_write",
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
        tool: "add_item",
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

    await t.test("net-fetch-loopback", async () => {
      const called = await c.call(appCallTool, {
        target,
        tool: "fetch_local",
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
        tool: "put_text",
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
