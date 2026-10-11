import { assert, assertEquals } from "@std/assert";
import type { LedgerHarness } from "../../../apps/core/testing/ledger.ts";
import { envelope } from "../harness/run-loop/testing/mod.ts";
import { id } from "./testing/mod.ts";
import {
  ASG_LOPHN,
  code,
  count,
  DONE,
  eventsOf,
  finishCall,
  finishedConversation,
  finishRun,
  machineCred,
  open,
  openLophn,
  output,
  PVDR,
  receive,
  runningRun,
  runOf,
  seed,
  seedProvider,
  seqOf,
  sessionSeq,
  SOURCE_LAST,
  SOURCE_SECOND,
  sql,
  startCall,
  userCred,
  value,
} from "./world_test.ts";

// Compact(conversation#R10, R24): 사람이 부를 때만 같은 session의 앞 구간을 요약한 call을 이후 call의
// 조립에 쓰게 정한다. 요약 call 자체(organizing, Workspace의 Model for summaries)는 prompt-assemble의
// 요약 규칙이 만들고, 이 command는 끝까지 성공한 call 하나를 구간과 함께 session에 연결한다. 원문은 지우지 않는다.

type Compacted = {
  id: string;
  compaction: { through_seq: string; summary_call: string };
  state_seq: string;
};

const CALL = id("mcl", 1);
const LATER_CALL = id("mcl", 2);

async function compact(
  h: LedgerHarness,
  session: string,
  options: { seq?: string; ctx?: typeof userCred } = {},
) {
  return h.command(
    options.ctx ?? userCred,
    envelope("CompactSession", { session }, {
      state: "open",
      state_seq: options.seq ?? await sessionSeq(h, session),
    }),
  );
}

async function readSession(h: LedgerHarness, session: string) {
  return (value(
    await h.read({ resource: "sessions", method: "read" }, userCred, {
      session,
    }),
  ) as { session: Record<string, unknown> }).session;
}

// 요약 call 하나를 시작해 끝낸다. 끝까지 성공한 call만 Compact가 쓴다.
async function summarize(
  h: LedgerHarness,
  call: string,
  run: string,
  session: string,
  attempt: number,
  options: { model_name?: string; outcome?: { kind: string; code?: string } } =
    {},
) {
  value(
    await startCall(h, call, run, session, attempt, {
      kind: "summary",
      model_name: options.model_name,
    }),
  );
  value(await finishCall(h, call, options.outcome));
}

// 대화 하나가 끝나 있고 마지막 run이 요약 call의 소속 run이 되는 세계다.
async function world(h: LedgerHarness) {
  await seed(h);
  await seedProvider(h);
  const session = await finishedConversation(h);
  return { session, run: await runOf(h, SOURCE_SECOND) };
}

async function sessionRow(h: LedgerHarness, session: string) {
  return (await sql(h, "select * from sessions where id = ?", [session]))[0];
}

Deno.test("lophn-agent/conversation#R10 [agent-I16]: Compact ties the summary call and the span it covers to the session and keeps every original message", async () => {
  const h = await open();
  try {
    const { session, run } = await world(h);
    await summarize(h, CALL, run, session, 1);
    // 요약 call이 있어도 사람이 Compact를 부르기 전에는 session이 바뀌지 않는다.
    assertEquals((await readSession(h, session))["compaction"], null);
    const messagesBefore = await sql(
      h,
      "select * from messages where session = ? order by created_seq",
      [session],
    );

    const compacted = output<Compacted>(await compact(h, session));
    assertEquals(compacted.id, session);
    assertEquals(compacted.compaction, {
      through_seq: await seqOf(h, SOURCE_LAST),
      summary_call: CALL,
    });
    const record = await readSession(h, session);
    assertEquals(record["compaction"], compacted.compaction);
    assertEquals(record["state"], "open");
    assertEquals(record["state_seq"], compacted.state_seq);

    // 원문 메시지는 한 줄도 바뀌거나 사라지지 않고 새 메시지나 run도 생기지 않는다.
    assertEquals(
      await sql(
        h,
        "select * from messages where session = ? order by created_seq",
        [session],
      ),
      messagesBefore,
    );
    assertEquals(await count(h, "runs"), 2);
    assertEquals(await count(h, "model_calls"), 1);

    const events = await eventsOf(h, "SessionCompacted", session);
    assertEquals(events.length, 1);
    assertEquals(JSON.parse(String(events[0]!["payload"])), {
      before: null,
      after: compacted.compaction,
    });
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R10 [agent-I16]: the span stops at the messages that existed when the summary call started", async () => {
  const h = await open();
  try {
    const { session, run } = await world(h);
    await summarize(h, CALL, run, session, 1);
    // 요약을 시작한 뒤에 온 메시지는 요약에 들지 않고 원문 그대로 이후 call에 붙는다.
    const late = id("msg", 9);
    const lateRun = await runningRun(h, session, late, ASG_LOPHN, "after");
    value(await finishRun(h, lateRun, DONE));
    const compacted = output<Compacted>(await compact(h, session));
    assertEquals(compacted.compaction.through_seq, await seqOf(h, SOURCE_LAST));
    assert(
      BigInt(compacted.compaction.through_seq) < BigInt(await seqOf(h, late)),
    );
    assertEquals(await count(h, "messages", `session = '${session}'`), 5);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R10 [agent-I16]: only a person compacts", async () => {
  const h = await open();
  try {
    const { session, run } = await world(h);
    await summarize(h, CALL, run, session, 1);
    code(await compact(h, session, { ctx: machineCred }), "forbidden");
    assertEquals((await readSession(h, session))["compaction"], null);
    assertEquals((await eventsOf(h, "SessionCompacted")).length, 0);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R10 [agent-I16]: without a call that finished well the session, its messages and its input stay as they were", async () => {
  const h = await open();
  try {
    const { session, run } = await world(h);
    const other = await openLophn(h, id("ses", 5));
    const otherRun = await runningRun(h, other, id("msg", 20));
    value(await finishRun(h, otherRun, DONE));

    const attempts: [string, () => Promise<unknown>][] = [
      ["no summary call", () => Promise.resolve()],
      [
        "a call that is still running",
        async () => {
          value(
            await startCall(h, id("mcl", 11), run, session, 1, {
              kind: "summary",
            }),
          );
        },
      ],
      [
        "a failed call",
        () =>
          summarize(h, id("mcl", 12), run, session, 2, {
            outcome: { kind: "failed", code: "temporary" },
          }),
      ],
      [
        "a cancelled call",
        () =>
          summarize(h, id("mcl", 13), run, session, 3, {
            outcome: { kind: "cancelled" },
          }),
      ],
      [
        "a decision call instead of a summary",
        async () => {
          value(await startCall(h, id("mcl", 14), run, session, 4));
          value(await finishCall(h, id("mcl", 14)));
        },
      ],
      [
        "a summary of another session",
        () => summarize(h, id("mcl", 15), otherRun, other, 5),
      ],
    ];
    const before = await sessionRow(h, session);
    for (const [label, prepare] of attempts) {
      await prepare();
      const failed = await compact(h, session);
      assert(!failed.ok, label);
      assertEquals(failed.error.code, "unavailable", label);
      assertEquals(await sessionRow(h, session), before, label);
    }
    assertEquals((await eventsOf(h, "SessionCompacted")).length, 0);
    assertEquals(await count(h, "messages", `session = '${session}'`), 4);

    // 실패한 Compact 뒤에도 입력은 그대로 접수된다.
    value(
      await receive(h, {
        message: id("msg", 30),
        session,
        mode: "request",
      }),
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R10 [agent-I16]: a session with an unfinished run is not compacted", async () => {
  const h = await open();
  try {
    const { session, run } = await world(h);
    await summarize(h, CALL, run, session, 1);
    value(
      await receive(h, { message: id("msg", 30), session, mode: "request" }),
    );
    code(await compact(h, session), "conflict");
    assertEquals((await readSession(h, session))["compaction"], null);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R10 [agent-I16]: a stale state or a missing session is refused", async () => {
  const h = await open();
  try {
    const { session, run } = await world(h);
    await summarize(h, CALL, run, session, 1);
    code(await compact(h, session, { seq: "1" }), "conflict");
    code(await compact(h, id("ses", 40)), "not_found");
    assertEquals((await readSession(h, session))["compaction"], null);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R10 [agent-I16]: a summary needs the Model for summaries when one is set and any model when it is empty", async () => {
  const h = await open();
  try {
    const { session, run } = await world(h);
    value(
      await h.probeWrite(
        `insert into agent_model_defaults
           (slot, provider, model_name, option_values, settings_seq)
         values ('summaries', ?, 'summary-model', '{}', '1')`,
        [PVDR],
      ),
    );
    await summarize(h, CALL, run, session, 1);
    // 다른 model이 만든 요약은 Model for summaries로 만든 것이 아니다.
    code(await compact(h, session), "conflict");
    assertEquals((await readSession(h, session))["compaction"], null);

    await summarize(h, LATER_CALL, run, session, 2, {
      model_name: "summary-model",
    });
    const compacted = output<Compacted>(await compact(h, session));
    assertEquals(compacted.compaction.summary_call, LATER_CALL);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R10 [agent-I16]: a second Compact replaces the span and keeps the earlier summary call, and the same call twice is one result", async () => {
  const h = await open();
  try {
    const { session, run } = await world(h);
    await summarize(h, CALL, run, session, 1);
    const first = output<Compacted>(await compact(h, session));

    // 새 call이 없으면 같은 결과를 돌려주고 새 event를 만들지 않는다.
    const again = output<Compacted>(await compact(h, session));
    assertEquals(again.compaction, first.compaction);
    assertEquals(again.state_seq, first.state_seq);
    assertEquals((await eventsOf(h, "SessionCompacted", session)).length, 1);

    const late = id("msg", 9);
    const lateRun = await runningRun(h, session, late, ASG_LOPHN, "after");
    value(await finishRun(h, lateRun, DONE));
    await summarize(h, LATER_CALL, lateRun, session, 2);
    const second = output<Compacted>(await compact(h, session));
    assertEquals(second.compaction, {
      through_seq: await seqOf(h, late),
      summary_call: LATER_CALL,
    });
    assert(
      BigInt(second.compaction.through_seq) >
        BigInt(first.compaction.through_seq),
    );
    const events = await eventsOf(h, "SessionCompacted", session);
    assertEquals(events.length, 2);
    assertEquals(JSON.parse(String(events[1]!["payload"])), {
      before: first.compaction,
      after: second.compaction,
    });
    // 앞의 요약 call 기록도 남는다.
    assertEquals(await count(h, "model_calls", `id = '${CALL}'`), 1);
    assertEquals(await count(h, "messages", `session = '${session}'`), 5);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R10 [agent-I16]: a Fork of a compacted session starts without the summary and cannot use the source's call", async () => {
  const h = await open();
  try {
    const { session, run } = await world(h);
    await summarize(h, CALL, run, session, 1);
    value(await compact(h, session));
    const copy = id("ses", 2);
    value(
      await h.command(
        userCred,
        envelope("ForkSession", {
          id: copy,
          source: session,
          through_seq: await seqOf(h, SOURCE_LAST),
        }),
      ),
    );
    assertEquals((await readSession(h, copy))["compaction"], null);
    // 복사본에는 자기 요약 call이 없으므로 출처의 call로 요약했다고 하지 않는다.
    const refused = await compact(h, copy);
    assert(!refused.ok);
    assertEquals(refused.error.code, "unavailable");
    assertEquals(
      (await readSession(h, session))["compaction"] !== null,
      true,
    );
  } finally {
    await h.close();
  }
});
