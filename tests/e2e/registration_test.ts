// 세 질문
// - contract: boundary `agent-roles`(Project Manager는 project마다 하나이고 사람이 더하거나
//   지우지 못한다), `agent-tools`(lophn이 `app.create`와 `call`을 쓴다), `router`(이름으로 앱 project의 Project Manager의 새 session을 연다).
// - 현실적 회귀: 등록 때 정의 파일이 안 만들어져 agent 정의가 비는 것, 사람이 built-in 이름의 Operator를 만들 수 있어
//   PM이 둘이 되는 것, lophn이 앱을 등록했는데 그 App Engineer를 call로 부르지 못하는 것.
// - 왜 지금 test로 못 잡나: `ensure`의 unit은 파일 시스템 fake만 본다. 등록 command(storage tx) -> wiring 후속 -> 파일 ->
//   정의 목록 route가 이어지는 것, 그리고 agent runtime child의 tool -> core `app.create` -> Router -> 새 session ->
//   child의 새 turn은 process를 건너야 한다.
import { assert, assertEquals } from "@std/assert";
import { appList } from "../../packages/protocol/apps/mod.ts";
import {
  agentDefinitionList,
  agentSessionList,
  messageBody,
  operatorCreate,
  receivedMessageList,
  toolCallList,
} from "../../packages/protocol/lophn-agent/mod.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import {
  connectFakeProvider,
  openProject,
  openSession,
  say,
  waitTurnEnd,
} from "../support/core/human.ts";
import { startFakeServer } from "../support/fake-server/mod.ts";

type Place = { kind: "project"; id: string };

async function definitionsAt(core: Core, place: Place) {
  const { agents } = await core.call(agentDefinitionList, {
    place: place as never,
  });
  // lophn은 place를 주어도 첫 줄로 늘 있다.
  return agents.filter((row) => row.agent.role !== "lophn");
}

// 사람이 built-in 이름의 Operator를 만들려 하면 거절되고 목록은 그대로 하나다.
async function assertNoSecondBuiltIn(
  core: Core,
  place: Place,
  name: string,
  built: unknown,
) {
  const refused = await core.tryCall(operatorCreate, {
    id: core.ids.newId("agt"),
    place: place as never,
    definition: { name, body: "" },
  });
  assert(!refused.ok);
  assertEquals(refused.error.code, "invalid_input");
  const after = await definitionsAt(core, place);
  assertEquals(after.length, 1);
  assertEquals(after[0].agent, built);
  assertEquals(after[0].kind, "built_in");
}

Deno.test("E2E 등록하면 PM·AE 정의가 하나 생기고 lophn이 앱을 등록해 AE를 부른다", async (t) => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  try {
    core = await bootCore(run);
    await connectFakeProvider(core, fake);
    const c = core;

    await t.step("project-creates-pm", async () => {
      const folder = `${run.work}/pm-proj`;
      await Deno.mkdir(folder);
      const { project } = await openProject(c, folder);
      const place: Place = { kind: "project", id: project };
      const built = { role: "project_manager", project } as const;

      const before = await definitionsAt(c, place);
      assertEquals(before.length, 1);
      assertEquals(before[0].agent, built);
      assertEquals(before[0].kind, "built_in");

      await Deno.stat(
        `${run.home}/projects/${project}/agents/project-manager.md`,
      );
      await assertNoSecondBuiltIn(c, place, "Project Manager", built);
    });

    await t.step("lophn-registers-then-calls", async () => {
      const body = "Build the todo list app.";
      const lophn = await openSession(c, { role: "lophn" });
      fake.script([
        {
          reply: {
            kind: "tool",
            calls: [
              {
                id: "t1",
                name: "app_create",
                arguments: JSON.stringify({
                  name: "Todo List",
                  purpose: "Keep a short list of todos.",
                }),
              },
              {
                id: "t2",
                name: "call",
                arguments: JSON.stringify({
                  to: { role: "app_engineer", place: { app: "Todo List" } },
                  reply: "none",
                  body,
                  refs: [],
                }),
              },
            ],
          },
        },
        { reply: { kind: "text", text: "registered and handed over" } },
        { reply: { kind: "text", text: "on it" } },
      ]);
      await say(c, lophn, "make a todo list app");
      const turn = await waitTurnEnd(c, lophn);

      // ledger
      const { apps } = await c.call(appList, {});
      const todo = apps.filter((app) => app.name === "Todo List");
      assertEquals(todo.length, 1);
      const { tool_calls: calls } = await c.call(toolCallList, {
        turn: turn.id,
      });
      const outcomes = Object.fromEntries(
        calls.map((call) => [call.response_key, call.outcome?.kind]),
      );
      assertEquals(outcomes, { t1: "success", t2: "success" });

      // route: App Engineer session이 열리고 맡긴 글이 입력에 있다.
      const agent = { role: "app_engineer", app: todo[0].id } as const;
      const deadline = Date.now() + 30_000;
      let sessions = (await c.call(agentSessionList, { agent })).sessions;
      while (sessions.length === 0) {
        assert(
          Date.now() < deadline,
          "App Engineer session이 열리지 않았다",
        );
        await new Promise((resolve) => setTimeout(resolve, 50));
        sessions = (await c.call(agentSessionList, { agent })).sessions;
      }
      assertEquals(sessions.length, 1);
      const engineer = sessions[0].id;
      await waitTurnEnd(c, engineer);
      // 목록에는 App Engineer 자신의 답도 있어, call로 온 것만 본다.
      const messages = (await c.call(receivedMessageList, {
        session: engineer,
      })).messages.filter((message) => message.call !== null);
      assertEquals(messages.length, 1);
      assertEquals(messages[0].from, { kind: "agent", session: lophn });
      const read = await c.call(messageBody, { message: messages[0].id });
      assertEquals(read.content.parts, [{ kind: "text", text: body }]);

      // fake가 받은 요청
      const journal = fake.journal();
      assertEquals(journal.length, 3);
      assertEquals(journal.map((entry) => entry.mismatch), [null, null, null]);
    });
  } finally {
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});
