// 세 질문
// - contract: boundary `agent-tools`(lophn이 `lophn app create`와 `lophn call send`를 쓴다), `router`(이름으로 앱 workspace의 lophn session을 새로 연다).
// - 현실적 회귀: lophn이 앱을 등록했는데 그 앱 workspace의 lophn을 call로 부르지 못하는 것, 맡긴 글이 받는 session의 입력에
//   닿지 않는 것.
// - 왜 지금 test로 못 잡나: agent runtime child의 tool -> core `app.create` -> Router -> 새 session -> child의 새 turn은
//   process를 건너야 한다.
import assert from "node:assert/strict";
import { test } from "node:test";

import { appList } from "../../packages/protocol/apps/mod.ts";
import {
  lophnIdOf,
  messageBody,
  workspaceSessionList,
  receivedMessageList,
  toolCallList,
} from "../../packages/protocol/lophn-agent/mod.ts";
import {
  connectFakeProvider,
  openLophnSession,
  say,
  waitTurnEnd,
} from "../support/core/human.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import { startFakeServer } from "../support/fake-server/mod.ts";
import { lophnCall } from "../support/fake-server/lophn.ts";

test("E2E lophn이 앱을 등록하고 그 앱 workspace의 lophn session에 맡긴다", async (t) => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  try {
    core = await bootCore(run);
    await connectFakeProvider(core, fake);
    const c = core;

    await t.test("lophn-registers-then-calls", async () => {
      const body = "Build the todo list app.";
      const lophn = await openLophnSession(c);
      fake.script([
        {
          reply: {
            kind: "tool",
            calls: [
              lophnCall("t1", "app create", {
                name: "Todo List",
                purpose: "Keep a short list of todos.",
              }),
              lophnCall("t2", "call send", {
                to: { agent: "lophn", workspace: { app: "Todo List" } },
                reply: "none",
                body,
                refs: [],
              }),
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
      assert.deepStrictEqual(todo.length, 1);
      const { tool_calls: calls } = await c.call(toolCallList, {
        turn: turn.id,
      });
      const outcomes = Object.fromEntries(
        calls.map((call) => [call.response_key, call.outcome?.kind]),
      );
      assert.deepStrictEqual(outcomes, { t1: "success", t2: "success" });
      // 기록 이름은 명령 이름이다.
      assert.deepStrictEqual(
        calls.map((call) => call.tool),
        ["app.create", "call.send"],
      );

      // route: 앱 workspace의 lophn session이 열리고 맡긴 글이 입력에 있다.
      const appAt = { kind: "app", id: todo[0].id } as const;
      const where = { agent: lophnIdOf(appAt), workspace: appAt } as const;
      const deadline = Date.now() + 30_000;
      let sessions = (await c.call(workspaceSessionList, where)).sessions;
      while (sessions.length === 0) {
        assert.ok(
          Date.now() < deadline,
          "앱 workspace의 lophn session이 열리지 않았다",
        );
        await new Promise((resolve) => setTimeout(resolve, 50));
        sessions = (await c.call(workspaceSessionList, where)).sessions;
      }
      assert.deepStrictEqual(sessions.length, 1);
      const engineer = sessions[0].id;
      await waitTurnEnd(c, engineer);
      // 목록에는 그 session 자신의 답도 있어, call로 온 것만 본다.
      const messages = (
        await c.call(receivedMessageList, {
          session: engineer,
        })
      ).messages.filter((message) => message.call !== null);
      assert.deepStrictEqual(messages.length, 1);
      assert.deepStrictEqual(messages[0].from, {
        kind: "agent",
        session: lophn,
      });
      const read = await c.call(messageBody, { message: messages[0].id });
      assert.deepStrictEqual(read.content.parts, [
        {
          kind: "text",
          text: body,
        },
      ]);

      // fake가 받은 요청
      const journal = fake.journal();
      assert.deepStrictEqual(journal.length, 3);
      assert.deepStrictEqual(
        journal.map((entry) => entry.mismatch),
        [null, null, null],
      );
    });
  } finally {
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});
