// 세 질문(행을 더하는 task는 자기 행의 질문을 아래에 한 줄씩 더한다)
// - contract: boundary `agent-tools`·`app-runtime`(앱 ∩ release 선언 ∩ agent grant만 tool이 되고 호출은 core를 지나 기록된다), `approvals`(사람이 뺀 것은 요청에 없고 묻기로 한 것은 결정 전에 실행되지 않는다).
// - 현실적 회귀: grant를 풀 때 `excluded`가 무시되어 뺀 app-api가 요청에 남는 것, 할당하지 않은 앱이나 선언에 없는 app-api가 tool이 되는 것, "물음"인데 허락 전에 write가 실행되는 것, 사람이 답하는 동안 앱의 write 줄이 막히는 것.
// - 왜 지금 test로 못 잡나: `app-tools`·`missing`의 unit은 grant와 선언의 조합 함수만 본다. 사람의 `agent_grants/set`이 저장되고, agent runtime child가 읽고, model 요청에 실리고, 호출이 core를 지나 앱 process에서 실행되는 왕복은 process를 건너야 보인다.
//
// 준비: core 하나, 앱 하나, project 하나를 모든 행이 나눠 쓰고 행마다 새 Operator와 새 session을 쓴다. 앱 activation의 fake 대답
// (App Engineer·coding agent 길)은 activation helper가 거는 것이라 행의 fake 대답 상한에 세지 않는다(README 정한 것 11).
import { assert, assertEquals } from "@std/assert";
import {
  appCallApi,
  appInvocations,
} from "../../packages/protocol/apps/mod.ts";
import {
  agentGrantsSet,
  approvalsDecideTurn,
} from "../../packages/protocol/approvals/mod.ts";
import type { AgentGrantEntry } from "../../packages/protocol/approvals/mod.ts";
import {
  operatorCreate,
  toolCallList,
} from "../../packages/protocol/lophn-agent/mod.ts";
import { activateTestApp, type TestApp } from "../support/app/activate.ts";
import { appCoreEnv } from "../support/coding/deps.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import {
  connectFakeProvider,
  decide,
  openProject,
  openSession,
  say,
  waitPermission,
  waitTurnEnd,
} from "../support/core/human.ts";
import {
  type FakeServer,
  type JournalEntry,
  startFakeServer,
} from "../support/fake-server/mod.ts";
import { lastToolResult, toolNames } from "../support/fake-server/probe.ts";

// 행 하나의 준비. 단계 한 개로 센다.
async function operatorWith(
  core: Core,
  project: string,
  name: string,
  entries: AgentGrantEntry[],
): Promise<{ session: string }> {
  const agent = core.ids.newId("agt");
  await core.call(operatorCreate, {
    id: agent,
    place: { kind: "project", id: project },
    definition: { name, body: "use the assigned app" },
  });
  const ref = { role: "operator", agent } as const;
  await core.call(agentGrantsSet, { agent: ref, entries });
  return { session: await openSession(core, ref) };
}

const addItem = (name: string) => (title: string) => ({
  kind: "tool" as const,
  calls: [{
    id: "t1",
    name,
    arguments: JSON.stringify({ title }),
  }],
});

// 요청의 app tool 중 이름이 `__add_item`으로 끝나는 것을 고른다.
const callAddItem = (title: string) => (request: JournalEntry) => {
  const name = toolNames(request).find((item) => item.endsWith("__add_item"));
  if (name === undefined) throw new Error("요청에 add_item tool이 없다");
  return addItem(name)(title);
};

const appToolsOf = (fake: FakeServer, index = 0) =>
  toolNames(fake.journal()[index]).filter((name) => name.startsWith("app__"));

// 앱 화면의 사람이 읽는 list_items 결과를 글로 돌려준다.
async function itemsOf(core: Core, app: string): Promise<string> {
  const called = await core.call(appCallApi, {
    target: { mode: "live", app, release: null },
    api: "list_items",
    caller: { kind: "person", view_session: "e2e" },
  });
  assertEquals(called.outcome.status, "succeeded");
  return JSON.stringify(called.outcome);
}

const text = { reply: { kind: "text" as const, text: "done" } };

async function sessionWrites(core: Core, app: string, session: string) {
  return (await core.call(appInvocations, { app, session })).invocations;
}

Deno.test("E2E Operator: 할당한 app-api만 tool이 되고, 사람이 뺀 것은 요청에 없으며, 묻기로 한 write는 사람의 결정 전에 실행되지 않는다", async () => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  let app: TestApp | undefined;
  try {
    core = await bootCore(run, { env: await appCoreEnv() });
    await connectFakeProvider(core, fake);
    // project 폴더나 앱 source를 더하면 agent runtime child가 다시 뜨므로 앱을 activate하기 전에 연다.
    const folder = `${run.work}/proj`;
    await Deno.mkdir(folder, { recursive: true });
    const { project } = await openProject(core, folder);
    app = await activateTestApp(core, fake, { name: "Notes", slug: "notes" });
    const id = app.app;
    const ask: AgentGrantEntry[] = [{
      kind: "app",
      app: id,
      apis: [{ api: "add_item", setting: "ask" }],
    }];

    // app-api: 앱을 할당하면 선언된 app-api 둘이 tool이 되고, 부르면 core를 지나 앱이 실행하고 기록이 남는다.
    fake.reset();
    fake.script([
      { reply: callAddItem("op-first") },
      text,
    ]);
    const first = await operatorWith(core, project, "Assigned", [
      { kind: "app", app: id, apis: [] },
    ]);
    await say(core, first.session, "add op-first");
    await waitTurnEnd(core, first.session);
    // fake
    assertEquals(
      appToolsOf(fake).map((name) => name.split("__").at(-1)).sort(),
      [
        "add_item",
        "list_items",
      ],
    );
    // ledger
    const written = await sessionWrites(core, id, first.session);

    assertEquals(written.length, 1);
    assertEquals(written[0].effect, "write");
    assertEquals(written[0].status, "succeeded");
    assertEquals(written[0].caller?.kind, "agent");
    assert(written[0].changeset !== null);
    // app state
    assert((await itemsOf(core, id)).includes("op-first"));

    // excluded: 사람이 뺀 app-api는 요청에 없고, model이 그래도 부르면 core에 닿지 않는다.
    fake.reset();
    fake.script([
      {
        reply: addItem(`app__${id}__add_item`)("op-excluded"),
      },
      text,
    ]);
    const excluded = await operatorWith(core, project, "Excluded", [{
      kind: "app",
      app: id,
      apis: [{ api: "add_item", setting: "excluded" }],
    }]);
    await say(core, excluded.session, "add op-excluded");
    await waitTurnEnd(core, excluded.session);
    // fake
    assertEquals(appToolsOf(fake).map((name) => name.split("__").at(-1)), [
      "list_items",
    ]);
    assert(lastToolResult(fake.journal()[1], "t1")?.includes("not_found"));
    // ledger
    assertEquals(await sessionWrites(core, id, excluded.session), []);
    const excludedCalls =
      (await core.call(toolCallList, { session: excluded.session }))
        .tool_calls;
    // 목록에 없는 tool은 core의 tool call 기록까지 가지 못한다. 성공으로 남은 call이 없으면 된다.
    assert(excludedCalls.every((call) => call.outcome?.kind !== "success"));
    // app state
    assert(!(await itemsOf(core, id)).includes("op-excluded"));

    // ask-reject: 묻기로 한 write는 사람이 거절하면 실행되지 않고, 막힌 호출도 기록에 남는다.
    fake.reset();
    fake.script([{ reply: callAddItem("op-held") }, text]);
    const held = await operatorWith(core, project, "AskReject", ask);
    await say(core, held.session, "add op-held");
    const heldAsk = await waitPermission(core, held.session);
    await decide(core, held.session, heldAsk.request, "reject");
    await waitTurnEnd(core, held.session);
    // ledger
    const denied = await sessionWrites(core, id, held.session);
    assertEquals(denied.length, 1);
    assertEquals(denied[0].status, "denied");
    assertEquals(denied[0].changeset, null);
    // app state
    assert(!(await itemsOf(core, id)).includes("op-held"));
    // fake
    assert(!lastToolResult(fake.journal()[1], "t1")?.includes("op-held"));

    // ask-allow: 사람이 답하는 동안 앱의 write는 막히지 않고, 허락하면 agent의 write가 실행된다.
    fake.reset();
    fake.script([{ reply: callAddItem("op-allowed") }, text]);
    const waiting = await operatorWith(core, project, "AskAllow", ask);
    await say(core, waiting.session, "add op-allowed");
    const waitingAsk = await waitPermission(core, waiting.session);
    // app state: 허락 대기 중의 사람 write
    const user = await core.call(appCallApi, {
      target: { mode: "live", app: id, release: null },
      api: "add_item",
      input: { title: "op-user" },
      caller: { kind: "person", view_session: "e2e" },
    });
    assertEquals(user.outcome.status, "succeeded");
    assertEquals(await sessionWrites(core, id, waiting.session), []);
    // app-api 물음의 선택지는 allow가 아니라 once·session·always·reject다.
    await core.call(approvalsDecideTurn, {
      session: waiting.session,
      request: waitingAsk.request,
      choice: { kind: "once" },
    });
    await waitTurnEnd(core, waiting.session);
    const items = await itemsOf(core, id);
    assert(items.includes("op-user") && items.includes("op-allowed"));
    // ledger
    const allowed = await sessionWrites(core, id, waiting.session);
    assertEquals(allowed.length, 1);
    assertEquals(allowed[0].status, "succeeded");
    assert(allowed[0].changeset !== null);
    assertEquals(
      allowed[0].caller?.kind === "agent" && allowed[0].caller.session,
      waiting.session,
    );
    // fake
    assert(lastToolResult(fake.journal()[1], "t1")?.includes("op-allowed"));
  } finally {
    await app?.gateway.close();
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});
