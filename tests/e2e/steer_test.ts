// 세 질문
// - contract: boundary `router`·`agent-sessions`(steer는 도는 turn의 다음 model 요청에 붙고 새 turn도 checkpoint도 만들지 않는다), `run-loop`.
// - 현실적 회귀: steer가 다음 turn 입력으로 밀려 사람이 도는 turn에 끼어들 수 없는 것, steer로 들어간 message가 checkpoint가 되어 rewind 지점으로 잘못 보이는 것.
// - 왜 지금 test로 못 잡나: steering 목록은 core 메모리(입력함)이고 child가 가져가는 길과 checkpoint 표는 process 둘을 건너야 이어진다. harness loop에 steering 행이 없다.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { test } from "node:test";
import {
  receivedMessageList,
  sendMessage,
  sessionRewindPreview,
} from "../../packages/protocol/lophn-agent/mod.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import {
  connectFakeProvider,
  decide,
  openProject,
  openSession,
  say,
  turnsOf,
  waitPermission,
  waitTurnEnd,
} from "../support/core/human.ts";
import { shellAsk } from "../support/core/shell-ask.ts";
import {
  type FakeServer,
  startFakeServer,
} from "../support/fake-server/mod.ts";

test("turn이 허락을 기다리는 중 보낸 steer는 다음 model 요청에 같이 실리고 새 turn도 checkpoint도 아니다", async () => {
  const run = await createRun();
  let fake: FakeServer | undefined;
  let core: Core | undefined;
  try {
    fake = await startFakeServer();
    core = await bootCore(run);
    await connectFakeProvider(core, fake);
    const folder = `${run.work}/proj`;
    await mkdir(folder);
    const ask = await shellAsk(folder);
    const { project } = await openProject(core, folder);

    fake.script([
      { reply: ask.reply("t1") },
      { reply: { kind: "text", text: "done" } },
    ]);
    const session = await openSession(core, {
      role: "project_manager",
      project,
    });
    const first = (await say(core, session, "write the rules")).message;
    const { request } = await waitPermission(core, session);
    // `say`는 next_turn만 보내므로 steer는 직접 보낸다.
    const second = (
      await core.call(sendMessage, {
        id: core.ids.newId("msg"),
        session,
        content: {
          schema_version: 1,
          parts: [{ kind: "text", text: "steer text" }],
        },
        delivery: "steer",
        refs: [],
      })
    ).message;
    await decide(core, session, request, "once");
    const turn = await waitTurnEnd(core, session);

    // 단정 1: 둘째 요청의 마지막 user message에 tool_result와 steer의 text가 같이 있다.
    const body = fake.journal()[1]?.body as {
      messages: { role: string; content: { type: string; text?: string }[] }[];
    };
    const last = body.messages.at(-1)!;
    assert.deepStrictEqual(last.role, "user");
    assert.ok(last.content.some((block) => block.type === "tool_result"));
    assert.ok(
      last.content.some((block) => block.text?.includes("steer text")),
      "둘째 요청의 마지막 user message에 steer text가 없다",
    );

    // 단정 2: 새 turn이 열리지 않았고 steer는 그 turn에 들어갔다.
    assert.deepStrictEqual(
      (await turnsOf(core, session)).map((item) => item.id),
      [turn.id],
    );
    const { messages } = await core.call(receivedMessageList, { session });
    assert.deepStrictEqual(
      messages.find((item) => item.id === second)?.turn,
      turn.id,
    );

    // 단정 3: steer 메시지는 checkpoint가 아니고 turn을 연 메시지는 checkpoint다.
    const preview = (checkpoint: string) =>
      core!.tryCall(sessionRewindPreview, {
        session,
        checkpoint,
        choice: "messages_only",
      });
    assert.deepStrictEqual((await preview(second)).ok, false);
    assert.deepStrictEqual((await preview(first)).ok, true);
  } finally {
    await core?.kill().catch(() => {});
    await fake?.close();
    await run.remove();
  }
});
