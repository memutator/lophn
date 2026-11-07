// 세 질문
// - contract: boundary `router`(result call의 답), `agent-sessions`(bare runtime session). bare가 `call.reply`를 부르지
//   않아도 turn이 끝나면 마지막 응답 글이 보낸 session의 답으로 한 번 간다(`architecture/agent-call.md`).
// - 현실적 회귀: bare-reply wiring의 machine scope나 route가 어긋나 `reply_failed` 로그만 남기고 call이 영영 accepted로
//   남는 것, bare의 system에 제품 규칙이나 workspace 지침이 새는 것, 고르지 않은 tool(`lophn`)이 실리는 것.
// - 왜 지금 test로 못 잡나: bare-reply_test는 가짜 port만 본다. 진짜 core의 scope·route·Router 왕복은 process를 건너야 한다.
//
// 줄(lane): home은 `app create`를 부르는 lophn, bare는 `lophn` tool이 없고 `file_read`가 있는 요청이다.
// lophn runtime이 자동 답을 받지 않는 것은 bare-reply_test(가짜 port)가 본다.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  agentCallRead,
  agentCreate,
  LOPHN_AGENT_ID,
  workspaceSessionList,
  receivedMessageList,
} from "../../packages/protocol/lophn-agent/mod.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import {
  connectFakeProvider,
  openWorkspaceSession,
  say,
  until,
  waitTurnEnd,
} from "../support/core/human.ts";
import {
  type FakeServer,
  type JournalEntry,
  type Lane,
  startFakeServer,
  type Step,
} from "../support/fake-server/mod.ts";
import { lophnCall, lophnCommands } from "../support/fake-server/lophn.ts";
import { systemText, toolNames } from "../support/fake-server/probe.ts";

const HOME: Lane = {
  name: "home",
  match: (r) => lophnCommands(r).includes("app create"),
};
const BARE: Lane = {
  name: "bare",
  match: (r) =>
    toolNames(r).includes("file_read") && !toolNames(r).includes("lophn"),
};

const text = (value: string): Step => ({
  reply: { kind: "text", text: value },
});

const send = (to: unknown): Step => ({
  reply: {
    kind: "tool",
    calls: [
      lophnCall("c1", "call send", {
        to,
        reply: "result",
        body: "q",
        refs: [],
      }),
    ],
  },
});

const lane = (fake: FakeServer, name: string): JournalEntry[] =>
  fake.journal().filter((entry) => entry.lane === name);

function assertNoMismatch(fake: FakeServer) {
  assert.deepStrictEqual(
    fake
      .journal()
      .filter((entry) => entry.mismatch !== null)
      .map((entry) => `#${entry.n} ${entry.lane}: ${entry.mismatch}`),
    [],
  );
}

async function opened(core: Core, agent: string) {
  return await until("새 session이 열림", async () => {
    const { sessions } = await core.call(workspaceSessionList, {
      agent,
      workspace: null,
    });
    return sessions[0]?.id;
  });
}

// 받은 session이 이 call로 받은 message에서 call id를 읽는다.
async function callOf(core: Core, receiver: string): Promise<string> {
  return await until("받은 call이 기록됨", async () => {
    const { messages } = await core.call(receivedMessageList, {
      session: receiver,
    });
    return messages.find((m) => m.call !== null)?.call ?? undefined;
  });
}

test("E2E result call을 받은 bare turn의 마지막 응답이 답으로 한 번 돌아간다", async () => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  try {
    core = await bootCore(run);
    const c = core;
    await connectFakeProvider(c, fake);
    const bare = c.ids.newId("agt");
    await c.call(agentCreate, {
      id: bare,
      definition: {
        handle: "echo-bare",
        name: "echo-bare",
        runtime: "bare",
        tools: ["file.read"],
        body: "BARE-BODY only.",
      },
    });

    // bare가 글만 답하고 끝나면 그 글이 call의 답이 된다.
    fake.script(
      [send({ agent: "echo-bare" }), text("sent"), text("got it")],
      HOME,
    );
    fake.script([text("the answer is 42")], BARE);
    const a = await openWorkspaceSession(c, LOPHN_AGENT_ID);
    await say(c, a, "ask the bare agent");
    const b = await opened(c, bare);
    await waitTurnEnd(c, b);
    await waitTurnEnd(c, a, 1);
    assertNoMismatch(fake);

    // ledger: call은 done이고 보낸 session은 그 call의 답을 하나만 받았다.
    const call = await callOf(c, b);
    assert.deepStrictEqual(
      (await c.call(agentCallRead, { call })).call.state,
      "done",
    );
    const { messages } = await c.call(receivedMessageList, { session: a });
    assert.deepStrictEqual(
      messages.filter((m) => m.reply_to === call).length,
      1,
    );
    // fake: 답 글이 보낸 쪽 셋째 요청에 있다.
    assert.ok(
      JSON.stringify(lane(fake, "home")[2].body).includes("the answer is 42"),
    );
    // fake: bare 요청의 system은 정의 본문뿐이고 tool은 고른 것뿐이다.
    const [request] = lane(fake, "bare");
    assert.deepStrictEqual(systemText(request), "BARE-BODY only.");
    assert.deepStrictEqual(toolNames(request), ["file_read"]);
  } finally {
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});
