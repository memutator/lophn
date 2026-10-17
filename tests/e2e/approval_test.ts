// 세 질문(allow-once-consumed와 ask 행은 아래 Deno.test에 따로 있다)
// - contract: boundary `approvals`(묻는 쓰기는 사람의 결정 전에 실행되지 않고, 허락은 그 intent에 한 번, 거절 이유는 agent에게 간다), `agent-tools`.
// - 현실적 회귀: Gate를 건너뛰고 쓰기가 실행되는 수정(허락 전에 file이 생김), 거절했는데 쓰기가 되는 수정, turn이 기다리다가 결정 뒤 이어 가지 못하는 수정.
// - 왜 지금 test로 못 잡나: approvals_test·gate_test는 판정과 request 표만 본다. child process에서 세워진 turn이 core의 결정으로 이어지는 왕복은 process를 건너야만 보인다.
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import {
  askAnswer,
  askRead,
  toolCallList,
} from "../../packages/protocol/lophn-agent/mod.ts";
import { sessionSnapshotsList } from "../../packages/protocol/events/mod.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import {
  connectFakeProvider,
  decide,
  openProject,
  openSession,
  say,
  turnsOf,
  waitPermission,
  waitQuestion,
  waitTurnEnd,
} from "../support/core/human.ts";
import {
  type FakeServer,
  startFakeServer,
} from "../support/fake-server/mod.ts";

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

// 둘째 model 요청의 마지막 user message에서 call id의 tool_result 내용을 글로 돌려준다.
function toolResultOf(fake: FakeServer, id: string): string {
  const body = fake.journal()[1]?.body as {
    messages: { role: string; content: unknown }[];
  };
  const last = body.messages.at(-1)!;
  assertEquals(last.role, "user");
  const block = (last.content as { type: string; tool_use_id?: string }[])
    .find((item) => item.type === "tool_result" && item.tool_use_id === id);
  assert(block, `둘째 요청에 ${id}의 tool_result가 없다`);
  return JSON.stringify((block as { content?: unknown }).content ?? null);
}

// LOPHN.md 쓰기를 한 번 시키고 Gate 앞에서 세워진 것을 확인한 뒤 결정을 내린다.
async function writeAndDecide(
  core: Core,
  fake: FakeServer,
  project: string,
  folder: string,
  sub: string,
  choice: "allow" | "reject",
) {
  fake.reset();
  fake.script([
    {
      reply: {
        kind: "tool",
        calls: [{
          id: "t1",
          name: "file_write",
          arguments: JSON.stringify({
            path: `${sub}/LOPHN.md`,
            content: "rules",
          }),
        }],
      },
    },
    { reply: { kind: "text", text: "done" } },
  ]);
  const file = `${folder}/${sub}/LOPHN.md`;
  const session = await openSession(core, { role: "project_manager", project });
  await say(core, session, "write the rules");
  const { request } = await waitPermission(core, session);
  const before = await exists(file);
  await decide(core, session, request, choice);
  await waitTurnEnd(core, session);
  const { tool_calls } = await core.call(toolCallList, { session });
  return { file, before, calls: tool_calls, result: toolResultOf(fake, "t1") };
}

Deno.test("묻는 쓰기는 허락 전에 실행되지 않고, 거절하면 쓰이지 않으며 거절이 agent에게 간다", async () => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  try {
    core = await bootCore(run);
    await connectFakeProvider(core, fake);
    // 두 행이 같은 project 폴더(proj)를 쓰되 file은 서로 다른 하위 폴더에 둔다(project를 둘 만들면 runtime 재기동이 한 번 더 든다).
    const folder = `${run.work}/proj`;
    await Deno.mkdir(`${folder}/a`, { recursive: true });
    await Deno.mkdir(`${folder}/b`);
    const { project } = await openProject(core, folder);

    const allowed = await writeAndDecide(
      core,
      fake,
      project,
      folder,
      "a",
      "allow",
    );
    assertEquals(allowed.before, false);
    assertEquals(await Deno.readTextFile(allowed.file), "rules");
    assertEquals(allowed.calls.map((c) => c.outcome?.kind), ["success"]);

    const rejected = await writeAndDecide(
      core,
      fake,
      project,
      folder,
      "b",
      "reject",
    );
    assertEquals(rejected.before, false);
    assertEquals(await exists(rejected.file), false);
    assertEquals(rejected.calls.length, 1);
    assertNotEquals(rejected.calls[0].outcome?.kind, "success");
    assertNotEquals(rejected.result, allowed.result);
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
    questions: [{
      question: "Which?",
      header: "Pick",
      options: [
        { label: "A", description: "first" },
        { label: "B", description: "second" },
      ],
      multiSelect: false,
    }],
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
  const session = await openSession(core, { role: "lophn" });
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

Deno.test("ask: 사람의 답과 기다리는 중 보낸 말이 tool 결과로 돌아가고 질문이 닫힌다", async () => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  try {
    core = await bootCore(run);
    await connectFakeProvider(core, fake);

    const answered = await askRow(core, fake, async (session, tool_call) => {
      const read = await core!.call(askRead, { session, tool_call });
      assertEquals(read.questions[0].question, "Which?");
      await core!.call(askAnswer, {
        session,
        tool_call,
        answers: [{ question: "Which?", status: "answered", answer: ["A"] }],
      });
    });
    assert(answered.result.includes("submitted"), answered.result);
    assert(answered.result.includes("A"), answered.result);
    assertEquals(answered.calls.map((c) => c.outcome?.kind), ["success"]);
    assertEquals(answered.questions, []);
    assert(!answered.closed.ok && answered.closed.error.code === "not_found");

    const spoken = await askRow(core, fake, async (session) => {
      await say(core!, session, "take B please");
    });
    assert(spoken.result.includes("human_message"), spoken.result);
    assert(spoken.result.includes("take B please"), spoken.result);
    assertEquals(spoken.calls.map((c) => c.outcome?.kind), ["success"]);
    assertEquals(spoken.questions, []);
    // 그 말은 tool 결과가 됐을 뿐 새 turn을 열지 않는다.
    assertEquals((await turnsOf(core, spoken.session)).length, 1);
    assert(!spoken.closed.ok && spoken.closed.error.code === "not_found");
  } finally {
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});

Deno.test("allow-once-consumed: 한 번 허락은 그 쓰기에만 쓰이고 같은 쓰기를 다시 하면 다시 묻는다", async () => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  try {
    core = await bootCore(run);
    await connectFakeProvider(core, fake);
    const folder = `${run.work}/proj`;
    await Deno.mkdir(folder, { recursive: true });
    const { project } = await openProject(core, folder);
    const write = (id: string, content: string) => ({
      id,
      name: "file_write",
      arguments: JSON.stringify({ path: "LOPHN.md", content }),
    });
    fake.script([
      {
        reply: {
          kind: "tool",
          calls: [write("t1", "rules-1"), write("t2", "rules-2")],
        },
      },
      { reply: { kind: "text", text: "done" } },
    ]);
    const session = await openSession(core, {
      role: "project_manager",
      project,
    });
    await say(core, session, "write the rules twice");
    const first = await waitPermission(core, session);
    await decide(core, session, first.request, "allow");
    const second = await waitPermission(core, session);
    assertNotEquals(second.request, first.request);
    await decide(core, session, second.request, "allow");
    await waitTurnEnd(core, session);

    assertEquals(await Deno.readTextFile(`${folder}/LOPHN.md`), "rules-2");
    assert(toolResultOf(fake, "t1"));
    assert(toolResultOf(fake, "t2"));
  } finally {
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});
