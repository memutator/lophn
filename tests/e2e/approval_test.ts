// 세 질문(ask 행은 아래 test에 따로 있다)
// - contract: boundary `approvals`(묻는 shell 명령은 사람의 결정 전에 실행되지 않고, `once`는 기다리던 그 호출을 풀고, 거절은 tool 결과로 agent에게 간다), `agent-tools`.
// - 현실적 회귀: Gate를 건너뛰어 결정 전에 명령이 도는 수정, 거절했는데 도는 수정, 결정 뒤 turn이 이어 가지 못하는 수정.
// - 왜 지금 test로 못 잡나: judge_test는 순수 판정만 본다. child의 `tool_gate/check` → core 메모리 request → 사람 route → child가 이어 가는 왕복은 process를 건너야 보인다.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { test } from "node:test";
import { sessionSnapshotsList } from "../../packages/protocol/events/mod.ts";
import {
  askAnswer,
  askRead,
  LOPHN_AGENT_ID,
  toolCallList,
} from "../../packages/protocol/lophn-agent/mod.ts";
import {
  connectFakeProvider,
  decide,
  openPlaceSession,
  openProject,
  say,
  turnsOf,
  waitPermission,
  waitQuestion,
  waitTurnEnd,
} from "../support/core/human.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import { shellAsk } from "../support/core/shell-ask.ts";
import {
  type FakeServer,
  startFakeServer,
} from "../support/fake-server/mod.ts";

// 둘째 model 요청의 마지막 user message에서 call id의 tool_result 내용을 글로 돌려준다.
function toolResultOf(fake: FakeServer, id: string): string {
  const body = fake.journal()[1]?.body as {
    messages: { role: string; content: unknown }[];
  };
  const last = body.messages.at(-1)!;
  assert.deepStrictEqual(last.role, "user");
  const block = (last.content as { type: string; tool_use_id?: string }[]).find(
    (item) => item.type === "tool_result" && item.tool_use_id === id,
  );
  assert.ok(block, `둘째 요청에 ${id}의 tool_result가 없다`);
  return JSON.stringify((block as { content?: unknown }).content ?? null);
}

// 묻는 shell 명령을 한 번 시키고 Gate 앞에서 세워진 것을 확인한 뒤 결정을 내린다.
async function askAndDecide(
  core: Core,
  fake: FakeServer,
  project: string,
  folder: string,
  name: string,
  choice: "once" | "reject",
) {
  const ask = await shellAsk(folder, name);
  fake.reset();
  fake.script([
    { reply: ask.reply("t1") },
    { reply: { kind: "text", text: "done" } },
  ]);
  const session = await openPlaceSession(core, LOPHN_AGENT_ID, {
    kind: "project",
    id: project,
  });
  await say(core, session, "remove it");
  const { request } = await waitPermission(core, session);
  const before = await ask.exists();
  await decide(core, session, request, choice);
  await waitTurnEnd(core, session);
  const { tool_calls } = await core.call(toolCallList, { session });
  return { ask, before, calls: tool_calls, result: toolResultOf(fake, "t1") };
}

test("묻는 shell 명령은 허락 전에 실행되지 않고, once면 실행되며 거절하면 실행되지 않고 거절이 agent에게 간다", async () => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  try {
    core = await bootCore(run);
    await connectFakeProvider(core, fake);
    // 두 행이 같은 project 폴더(proj)를 쓰되 폴더는 서로 다른 하위 폴더에 둔다.
    const folder = `${run.work}/proj`;
    await mkdir(folder);
    const { project } = await openProject(core, folder);

    const once = await askAndDecide(core, fake, project, folder, "a", "once");
    assert.deepStrictEqual(once.before, true);
    assert.deepStrictEqual(await once.ask.exists(), false);
    assert.deepStrictEqual(
      once.calls.map((c) => c.outcome?.kind),
      ["success"],
    );

    const rejected = await askAndDecide(
      core,
      fake,
      project,
      folder,
      "b",
      "reject",
    );
    assert.deepStrictEqual(rejected.before, true);
    assert.deepStrictEqual(await rejected.ask.exists(), true);
    assert.deepStrictEqual(
      rejected.calls.map((c) => c.outcome),
      [{ kind: "not_executed", code: "rejected" }],
    );
    assert.notDeepStrictEqual(rejected.result, once.result);
  } finally {
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});

// ask 행: 두 행이 core 하나를 공유하고 project 없이 lophn session에서 돈다.
// - contract: boundary `agent-tools`(`ask`는 turn을 세우고 사람의 답이나 메시지가 tool 결과로 돌아간다), `agent-sessions`(질문은 core 메모리이고 snapshot이 목록을 낸다).
// - 현실적 회귀: 답이 model 요청에 실리지 않아 turn이 영영 멈추는 것, 기다림이 끝나지 않는 것, 사람이 말하면 질문이 안 닫혀 snapshot에 낡은 질문이 남는 것.
// - 왜 지금 test로 못 잡나: `ask`의 대기는 runtime child의 긴 호출(`ask/wait`)과 core 메모리, 사람 route가 이어져야 보인다.
const ASK_CALL = {
  id: "a1",
  name: "ask",
  arguments: JSON.stringify({
    questions: [
      {
        question: "Which?",
        header: "Pick",
        options: [
          { label: "A", description: "first" },
          { label: "B", description: "second" },
        ],
        multiSelect: false,
      },
    ],
  }),
};

async function askRow(
  core: Core,
  fake: FakeServer,
  answer: (session: string, tool_call: string) => Promise<void>,
) {
  fake.reset();
  fake.script([
    { reply: { kind: "tool", calls: [ASK_CALL] } },
    { reply: { kind: "text", text: "done" } },
  ]);
  const session = await openPlaceSession(core, LOPHN_AGENT_ID);
  await say(core, session, "decide something");
  const question = await waitQuestion(core, session);
  await answer(session, question.tool_call);
  await waitTurnEnd(core, session);
  const { tool_calls } = await core.call(toolCallList, { session });
  const { snapshots } = await core.call(sessionSnapshotsList, {
    sessions: [session],
  });
  const closed = await core.tryCall(askRead, {
    session,
    tool_call: question.tool_call,
  });
  return {
    session,
    result: toolResultOf(fake, "a1"),
    calls: tool_calls,
    questions: snapshots[0].questions,
    closed,
  };
}

test("ask: 사람의 답과 기다리는 중 보낸 말이 tool 결과로 돌아가고 질문이 닫힌다", async () => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  try {
    core = await bootCore(run);
    await connectFakeProvider(core, fake);

    const answered = await askRow(core, fake, async (session, tool_call) => {
      const read = await core!.call(askRead, { session, tool_call });
      assert.deepStrictEqual(read.questions[0].question, "Which?");
      await core!.call(askAnswer, {
        session,
        tool_call,
        answers: [{ question: "Which?", status: "answered", answer: ["A"] }],
      });
    });
    assert.ok(answered.result.includes("submitted"), answered.result);
    assert.ok(answered.result.includes("A"), answered.result);
    assert.deepStrictEqual(
      answered.calls.map((c) => c.outcome?.kind),
      ["success"],
    );
    assert.deepStrictEqual(answered.questions, []);
    assert.ok(
      !answered.closed.ok && answered.closed.error.code === "not_found",
    );

    const spoken = await askRow(core, fake, async (session) => {
      await say(core!, session, "take B please");
    });
    assert.ok(spoken.result.includes("human_message"), spoken.result);
    assert.ok(spoken.result.includes("take B please"), spoken.result);
    assert.deepStrictEqual(
      spoken.calls.map((c) => c.outcome?.kind),
      ["success"],
    );
    assert.deepStrictEqual(spoken.questions, []);
    // 그 말은 tool 결과가 됐을 뿐 새 turn을 열지 않는다.
    assert.deepStrictEqual((await turnsOf(core, spoken.session)).length, 1);
    assert.ok(!spoken.closed.ok && spoken.closed.error.code === "not_found");
  } finally {
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});
