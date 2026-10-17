// 세 질문
// - contract: boundary `agent-sessions`(compact는 원문을 대체하지 않는 derived이고 어느 쪽이든 원문과 session의 나머지는 바뀌지 않는다), `run-loop`(요청 event를 runtime이 집어 가는 왕복), `models`(요약 call).
// - 현실적 회귀: 요약 실패가 이력을 지우거나 session을 망가뜨리는 것, 요약이 만들어졌는데 다음 요청이 옛 원문을 쓰는 것, 요청을 runtime이 집어 가지 못해 영영 열려 있는 것.
// - 왜 지금 test로 못 잡나: compactor의 경우의 수는 harness가 맡지만 core의 요청 event를 child가 읽어 가고 `compactSession`/`failSessionCompact`로 돌아오는 왕복은 process를 건너야 한다.
import { assert, assertEquals } from "@std/assert";
import {
  agentSessionRead,
  modelCallList,
  receivedMessageList,
  requestSessionCompact,
  sessionSummary,
} from "../../packages/protocol/lophn-agent/mod.ts";
import { bootCore, type Core, createRun } from "../support/core/mod.ts";
import { runtimePids } from "../support/core/process.ts";
import {
  connectFakeProvider,
  openSession,
  say,
  turnsOf,
  waitTurnEnd,
} from "../support/core/human.ts";
import {
  type FakeServer,
  type Reply,
  startFakeServer,
} from "../support/fake-server/mod.ts";

const WAIT_MS = 30_000;

// 읽은 값이 undefined가 아닐 때까지 기다린다.
async function waitFor<T>(
  what: string,
  read: () => Promise<T | undefined>,
): Promise<T> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) {
      throw new Error(`${WAIT_MS}ms 안에 ${what}이(가) 되지 않았다`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

type Row = {
  name: string;
  summary: Reply;
  // 요약 요청이 처리된 것을 사람이 볼 수 있는 신호.
  settled(core: Core, session: string): Promise<true | undefined>;
  check(
    core: Core,
    fake: FakeServer,
    session: string,
    first: { message: string },
    before: { messages: string[]; pids: number[] },
  ): Promise<void>;
};

const bodyOf = (fake: FakeServer, n: number) =>
  JSON.stringify(fake.journal()[n - 1]?.body);

const rows: Row[] = [
  {
    name: "compact-ok",
    summary: { kind: "text", text: "SUMMARY-MARK" },
    async settled(core, session) {
      const { session: read } = await core.call(agentSessionRead, { session });
      return read.compaction === null ? undefined : true;
    },
    async check(core, fake, session, first) {
      // ledger: 요약이 session에 이어지고 원문은 그대로다.
      const { session: read } = await core.call(agentSessionRead, { session });
      assert(read.compaction, "compaction이 있어야 한다");
      const summary = await core.call(sessionSummary, { session });
      assert(summary.text.includes("SUMMARY-MARK"));
      const { messages } = await core.call(receivedMessageList, { session });
      assert(messages.some((message) => message.id === first.message));
      // fake: 다음 요청은 요약을 쓰고 옛 원문은 쓰지 않는다.
      assert(bodyOf(fake, 3).includes("SUMMARY-MARK"));
      assert(!bodyOf(fake, 3).includes("FIRST-MARK"));
      // blob: 요약 call이 기록된다(turn 둘 + 요약 하나).
      const { calls } = await core.call(modelCallList, { session });
      assertEquals(calls.length, 3);
      assert(calls.some((call) => call.purpose === "conversation_compression"));
    },
  },
  {
    name: "compact-fails",
    summary: { kind: "error", status: 400, body: "{}" },
    // 실패는 session에 흔적이 없어 요약 call이 끝난 것으로 본다.
    async settled(core, session) {
      const { calls } = await core.call(modelCallList, { session });
      return calls.some((call) =>
          call.purpose === "conversation_compression" &&
          call.state === "finished"
        )
        ? true
        : undefined;
    },
    async check(core, fake, session, _first, before) {
      // ledger: 요약이 없고 첫 turn의 메시지는 그대로다.
      const { session: read } = await core.call(agentSessionRead, { session });
      assertEquals(read.compaction, null);
      const { messages } = await core.call(receivedMessageList, { session });
      assertEquals(
        messages.slice(0, before.messages.length).map((message) => message.id),
        before.messages,
      );
      // fake: 다음 요청은 원문을 그대로 쓴다.
      assert(bodyOf(fake, 3).includes("FIRST-MARK"));
      // process: runtime child는 그대로고 둘째 turn은 정상으로 끝났다.
      assertEquals(await runtimePids(core.run.home), before.pids);
      const second = (await turnsOf(core, session))[1];
      assertEquals(second?.outcome?.kind, "completed");
    },
  },
];

Deno.test("E2E compact는 성공하면 다음 요청이 요약을 쓰고 실패해도 원문과 대화가 그대로다", async () => {
  const run = await createRun();
  const fake = await startFakeServer();
  let core: Core | undefined;
  try {
    const live = core = await bootCore(run);
    await connectFakeProvider(live, fake);
    for (const row of rows) {
      fake.reset();
      fake.script([
        { reply: { kind: "text", text: "first answer" } },
        { reply: row.summary },
        { reply: { kind: "text", text: "second answer" } },
      ]);
      const session = await openSession(live, { role: "lophn" });
      const first = await say(live, session, `FIRST-MARK-${row.name}`);
      await waitTurnEnd(live, session);
      const { session: read } = await live.call(agentSessionRead, { session });
      const { messages } = await live.call(receivedMessageList, { session });
      const before = {
        messages: messages.map((message) => message.id),
        pids: await runtimePids(live.run.home),
      };

      await live.call(requestSessionCompact, { session }, {
        state: "open",
        state_seq: read.state_seq,
      });
      await waitFor("요약 요청이 처리됨", () => row.settled(live, session));

      await say(live, session, `SECOND-${row.name}`);
      await waitTurnEnd(live, session, 1);
      await row.check(live, fake, session, first, before);
    }
  } finally {
    await core?.kill().catch(() => {});
    await fake.close();
    await run.remove();
  }
});
