import { assert, assertEquals } from "@std/assert";
import type { LedgerHarness } from "../../testing/ledger.ts";
import { envelope } from "../run-loop/testing/mod.ts";
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

// Compact(conversation#R10, R24). 사람이 Compact를 요청하면 runtime이 같은 session의 앞 구간을 요약하는
// model call을 하고, 끝까지 성공한 그 call을 구간과 함께 session에 잇는다. 요약 call은 run이 없는
// session에도 묶인다(run과 agent 대신 session을 가리킨다). 요약이 실패해도 session·원문·입력 접수는
// 그대로다. 원문은 어느 경우에도 지우지 않는다.

type Requested = { id: string; request_seq: string };
type Compacted = {
  id: string;
  compaction: { through_seq: string; summary_call: string };
  state_seq: string;
};

const CALL = id("mcl", 1);
const LATER_CALL = id("mcl", 2);

async function request(
  h: LedgerHarness,
  session: string,
  options: { seq?: string; ctx?: typeof userCred } = {},
) {
  return h.command(
    options.ctx ?? userCred,
    envelope("RequestSessionCompact", { session }, {
      state: "open",
      state_seq: options.seq ?? await sessionSeq(h, session),
    }),
  );
}

async function requested(h: LedgerHarness, session: string) {
  return output<Requested>(await request(h, session));
}

async function pending(h: LedgerHarness) {
  return (value(
    await h.read(
      { resource: "sessions", method: "compact-requests" },
      machineCred,
      {},
    ),
  ) as {
    requests: {
      session: string;
      assignment: string;
      work_place: { kind: string; id: string };
      request_seq: string;
    }[];
  }).requests;
}

function compact(
  h: LedgerHarness,
  session: string,
  input: { request_seq: string; summary_call: string; through_seq: string },
  ctx: typeof userCred = machineCred,
) {
  return h.command(
    ctx,
    envelope("CompactSession", {
      session,
      summary_call: input.summary_call,
      through_seq: input.through_seq,
    }, { state: "open", request_seq: input.request_seq }),
  );
}

function fail(
  h: LedgerHarness,
  session: string,
  request_seq: string,
  reason = "model_failed",
  ctx: typeof userCred = machineCred,
) {
  return h.command(
    ctx,
    envelope("FailSessionCompact", { session, reason }, { request_seq }),
  );
}

async function readSession(h: LedgerHarness, session: string) {
  return (value(
    await h.read({ resource: "sessions", method: "read" }, userCred, {
      session,
    }),
  ) as { session: Record<string, unknown> }).session;
}

// run 없이 session에 묶인 요약 call 하나를 시작해 끝낸다.
async function summarize(
  h: LedgerHarness,
  call: string,
  session: string,
  attempt: number,
  options: { model_name?: string; outcome?: { kind: string; code?: string } } =
    {},
) {
  value(
    await startCall(h, call, null, session, attempt, {
      kind: "session_summary",
      model_name: options.model_name,
    }),
  );
  value(await finishCall(h, call, options.outcome));
}

async function world(h: LedgerHarness) {
  await seed(h);
  await seedProvider(h);
  return await finishedConversation(h);
}

async function sessionRow(h: LedgerHarness, session: string) {
  return (await sql(h, "select * from sessions where id = ?", [session]))[0];
}

async function messageRows(h: LedgerHarness, session: string) {
  return await sql(
    h,
    "select * from messages where session = ? order by created_seq",
    [session],
  );
}

Deno.test("lophn-agent/conversation#R10 [agent-I16b]: a request changes nothing but the runtime's list, and asking twice is one request", async () => {
  const h = await open();
  try {
    const session = await world(h);
    const row = await sessionRow(h, session);
    const messages = await messageRows(h, session);
    assertEquals(await pending(h), []);

    const first = await requested(h, session);
    assertEquals(first.id, session);
    assertEquals(await pending(h), [{
      session,
      assignment: ASG_LOPHN,
      work_place: { kind: "project", id: id("prj", 1) },
      request_seq: first.request_seq,
    }]);
    // session 행(state_seq 포함)·원문·run·model call 어느 것도 바뀌거나 늘지 않는다.
    assertEquals(await sessionRow(h, session), row);
    assertEquals(await messageRows(h, session), messages);
    assertEquals(await count(h, "runs"), 2);
    assertEquals(await count(h, "model_calls"), 0);
    assertEquals((await readSession(h, session))["compaction"], null);

    // 끝나지 않은 같은 요청을 다시 하면 같은 요청이다.
    const again = await requested(h, session);
    assertEquals(again, first);
    assertEquals((await pending(h)).length, 1);
    const events = await eventsOf(h, "SessionCompactRequested", session);
    assertEquals(events.length, 1);
    assertEquals(String(events[0]!["seq"]), first.request_seq);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R10 [agent-I16b]: only a person requests, and a busy, stale, missing or empty session is refused with nothing recorded", async () => {
  const h = await open();
  try {
    const session = await world(h);
    code(await request(h, session, { ctx: machineCred }), "forbidden");
    code(await request(h, session, { seq: "1" }), "conflict");
    code(await request(h, id("ses", 40), { seq: "1" }), "not_found");

    // 비어 있는 session은 요약할 것이 없다.
    const empty = await openLophn(h, id("ses", 5));
    code(await request(h, empty), "conflict");

    // 끝나지 않은 run이 있으면 요청하지 않는다. 일이 끝난 뒤의 한 번은 명령 줄(commands)이 정한다.
    value(
      await receive(h, { message: id("msg", 30), session, mode: "request" }),
    );
    code(await request(h, session), "conflict");

    assertEquals(await pending(h), []);
    assertEquals((await eventsOf(h, "SessionCompactRequested")).length, 0);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R10 [agent-I16b]: a summary call with no run is tied to the session and Compact records its span, keeping every original message", async () => {
  const h = await open();
  try {
    const session = await world(h);
    const asked = await requested(h, session);
    // 이 session의 run은 둘 다 끝났고 요약 call은 어느 run에도 묶이지 않는다.
    await summarize(h, CALL, session, 1);
    const call =
      (await sql(h, "select * from model_calls where id = ?", [CALL]))[0]!;
    assertEquals(call["run"], null);
    assertEquals(call["session"], session);
    assertEquals(call["agent_hash"], null);
    assertEquals(call["model_use"], "organizing");
    assertEquals(call["purpose"], "conversation_compression");
    // call이 있어도 끝내기 전에는 session이 바뀌지 않는다.
    assertEquals((await readSession(h, session))["compaction"], null);
    const messagesBefore = await messageRows(h, session);

    const through = await seqOf(h, SOURCE_LAST);
    const compacted = output<Compacted>(
      await compact(h, session, {
        request_seq: asked.request_seq,
        summary_call: CALL,
        through_seq: through,
      }),
    );
    assertEquals(compacted.id, session);
    assertEquals(compacted.compaction, {
      through_seq: through,
      summary_call: CALL,
    });
    const record = await readSession(h, session);
    assertEquals(record["compaction"], compacted.compaction);
    assertEquals(record["state"], "open");
    assertEquals(record["state_seq"], compacted.state_seq);

    // 원문 메시지는 한 줄도 바뀌거나 사라지지 않고 새 메시지나 run도 생기지 않는다.
    assertEquals(await messageRows(h, session), messagesBefore);
    assertEquals(await count(h, "runs"), 2);
    assertEquals(await count(h, "model_calls"), 1);
    // 요청은 끝났다.
    assertEquals(await pending(h), []);
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

Deno.test("lophn-agent/conversation#R10 [agent-I16b]: only the runtime ends a Compact and a person cannot", async () => {
  const h = await open();
  try {
    const session = await world(h);
    const asked = await requested(h, session);
    await summarize(h, CALL, session, 1);
    const input = {
      request_seq: asked.request_seq,
      summary_call: CALL,
      through_seq: await seqOf(h, SOURCE_LAST),
    };
    code(await compact(h, session, input, userCred), "forbidden");
    code(
      await fail(h, session, asked.request_seq, "model_failed", userCred),
      "forbidden",
    );
    assertEquals((await readSession(h, session))["compaction"], null);
    assertEquals((await eventsOf(h, "SessionCompacted")).length, 0);
    assertEquals((await pending(h)).length, 1);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R10 [agent-I16b]: without a call that finished well, or with a span that is not the session's, Compact leaves the session, its messages and its input as they were", async () => {
  const h = await open();
  try {
    const session = await world(h);
    const other = await openLophn(h, id("ses", 5));
    const otherRun = await runningRun(h, other, id("msg", 20));
    value(await finishRun(h, otherRun, DONE));
    const asked = await requested(h, session);
    const through = await seqOf(h, SOURCE_LAST);
    const run = await runOf(h, SOURCE_SECOND);

    const attempts: [string, string, () => Promise<unknown>][] = [
      ["no such call", id("mcl", 90), () => Promise.resolve()],
      [
        "a call that is still running",
        id("mcl", 11),
        async () => {
          value(
            await startCall(h, id("mcl", 11), null, session, 1, {
              kind: "session_summary",
            }),
          );
        },
      ],
      [
        "a failed call",
        id("mcl", 12),
        () =>
          summarize(h, id("mcl", 12), session, 2, {
            outcome: { kind: "failed", code: "temporary" },
          }),
      ],
      [
        "a cancelled call",
        id("mcl", 13),
        () =>
          summarize(h, id("mcl", 13), session, 3, {
            outcome: { kind: "cancelled" },
          }),
      ],
      [
        "a decision call of a run instead of a summary",
        id("mcl", 14),
        async () => {
          value(await startCall(h, id("mcl", 14), run, session, 4));
          value(await finishCall(h, id("mcl", 14)));
        },
      ],
      [
        "a summary a run made while it was working",
        id("mcl", 16),
        async () => {
          value(
            await startCall(h, id("mcl", 16), run, session, 6, {
              kind: "summary",
            }),
          );
          value(await finishCall(h, id("mcl", 16)));
        },
      ],
      [
        "a summary of another session",
        id("mcl", 15),
        () => summarize(h, id("mcl", 15), other, 5),
      ],
    ];
    const before = await sessionRow(h, session);
    for (const [label, call, prepare] of attempts) {
      await prepare();
      const failed = await compact(h, session, {
        request_seq: asked.request_seq,
        summary_call: call,
        through_seq: through,
      });
      assert(!failed.ok, label);
      assert(
        ["unavailable", "not_found", "conflict"].includes(failed.error.code),
        `${label}: ${failed.error.code}`,
      );
      assertEquals(await sessionRow(h, session), before, label);
    }

    // 구간의 끝이 이 session의 메시지가 아니면 요약이 덮는 곳을 정할 수 없다.
    await summarize(h, CALL, session, 7);
    for (const bad of ["999999", await seqOf(h, id("msg", 20))]) {
      const refused = await compact(h, session, {
        request_seq: asked.request_seq,
        summary_call: CALL,
        through_seq: bad,
      });
      assert(!refused.ok, bad);
      assertEquals(refused.error.code, "invalid_input", bad);
    }
    assertEquals(await sessionRow(h, session), before);
    assertEquals((await eventsOf(h, "SessionCompacted")).length, 0);
    assertEquals(await count(h, "messages", `session = '${session}'`), 4);
    assertEquals((await pending(h)).length, 1);

    // 실패한 Compact 뒤에도 입력은 그대로 접수된다.
    value(
      await receive(h, { message: id("msg", 30), session, mode: "request" }),
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R10 [agent-I16b]: Compact ends only the request that is still open and only while no run is working", async () => {
  const h = await open();
  try {
    const session = await world(h);
    const asked = await requested(h, session);
    await summarize(h, CALL, session, 1);
    const input = {
      request_seq: asked.request_seq,
      summary_call: CALL,
      through_seq: await seqOf(h, SOURCE_LAST),
    };
    // 모르는 요청은 끝낼 수 없다.
    code(
      await compact(h, session, { ...input, request_seq: "999999" }),
      "conflict",
    );
    assertEquals((await readSession(h, session))["compaction"], null);

    // 요약하는 동안 사람이 새 요청을 보내 run이 시작되면 이 요약은 쓰지 않는다.
    value(
      await receive(h, { message: id("msg", 30), session, mode: "request" }),
    );
    code(await compact(h, session, input), "conflict");
    assertEquals((await readSession(h, session))["compaction"], null);
    // 요청은 남아 있지만 일하는 session의 요청은 그 run이 끝날 때까지 runtime에 나오지 않는다.
    assertEquals(
      await count(h, "session_compact_requests", "state = 'requested'"),
      1,
    );
    assertEquals(await pending(h), []);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R10 [agent-I16b]: a summary needs the Model for summaries when one is set and any model when it is empty", async () => {
  const h = await open();
  try {
    const session = await world(h);
    value(
      await h.command(
        machineCred,
        envelope("SeedSummariesModel", {
          provider: PVDR,
          model_name: "summary-model",
        }),
      ),
    );
    const asked = await requested(h, session);
    const through = await seqOf(h, SOURCE_LAST);
    await summarize(h, CALL, session, 1);
    // 다른 model이 만든 요약은 Model for summaries로 만든 것이 아니다.
    code(
      await compact(h, session, {
        request_seq: asked.request_seq,
        summary_call: CALL,
        through_seq: through,
      }),
      "conflict",
    );
    assertEquals((await readSession(h, session))["compaction"], null);

    await summarize(h, LATER_CALL, session, 2, { model_name: "summary-model" });
    const compacted = output<Compacted>(
      await compact(h, session, {
        request_seq: asked.request_seq,
        summary_call: LATER_CALL,
        through_seq: through,
      }),
    );
    assertEquals(compacted.compaction.summary_call, LATER_CALL);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R10 [agent-I16b]: a failed Compact closes the request with its reason and the session, its messages and its input stay as they were", async () => {
  const h = await open();
  try {
    const session = await world(h);
    const asked = await requested(h, session);
    // 실패한 요약 call은 기록으로 남는다.
    await summarize(h, CALL, session, 1, {
      outcome: { kind: "failed", code: "temporary" },
    });
    const row = await sessionRow(h, session);
    const messages = await messageRows(h, session);

    code(await fail(h, session, asked.request_seq, "boom"), "invalid_input");
    const failed = output<{ id: string; request_seq: string; reason: string }>(
      await fail(h, session, asked.request_seq, "model_failed"),
    );
    assertEquals(failed, {
      id: session,
      request_seq: asked.request_seq,
      reason: "model_failed",
    });
    assertEquals(await sessionRow(h, session), row);
    assertEquals(await messageRows(h, session), messages);
    assertEquals((await readSession(h, session))["compaction"], null);
    assertEquals(await pending(h), []);
    const events = await eventsOf(h, "SessionCompactFailed", session);
    assertEquals(events.length, 1);
    assertEquals(JSON.parse(String(events[0]!["payload"])), {
      request: asked.request_seq,
      reason: "model_failed",
    });
    assertEquals((await eventsOf(h, "SessionCompacted")).length, 0);
    assertEquals(await count(h, "model_calls"), 1);

    // 끝난 요청은 다시 실패시킬 수 없고, 입력은 그대로 접수되며, 사람은 다시 요청할 수 있다.
    code(await fail(h, session, asked.request_seq), "conflict");
    value(
      await receive(h, { message: id("msg", 30), session, mode: "request" }),
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R10 [agent-I16b]: a second Compact replaces the span and keeps the earlier summary call, and nothing new to cover is refused", async () => {
  const h = await open();
  try {
    const session = await world(h);
    const first = await requested(h, session);
    await summarize(h, CALL, session, 1);
    const firstDone = output<Compacted>(
      await compact(h, session, {
        request_seq: first.request_seq,
        summary_call: CALL,
        through_seq: await seqOf(h, SOURCE_LAST),
      }),
    );
    // 덮은 구간 뒤에 새 메시지가 없으면 요약할 것이 없다.
    code(await request(h, session), "conflict");

    const late = id("msg", 9);
    const lateRun = await runningRun(h, session, late, ASG_LOPHN, "after");
    value(await finishRun(h, lateRun, DONE));
    const second = await requested(h, session);
    assert(BigInt(second.request_seq) > BigInt(first.request_seq));
    await summarize(h, LATER_CALL, session, 2);
    const secondDone = output<Compacted>(
      await compact(h, session, {
        request_seq: second.request_seq,
        summary_call: LATER_CALL,
        through_seq: await seqOf(h, late),
      }),
    );
    assertEquals(secondDone.compaction, {
      through_seq: await seqOf(h, late),
      summary_call: LATER_CALL,
    });
    const events = await eventsOf(h, "SessionCompacted", session);
    assertEquals(events.length, 2);
    assertEquals(JSON.parse(String(events[1]!["payload"])), {
      before: firstDone.compaction,
      after: secondDone.compaction,
    });
    // 앞의 요약 call 기록도 남는다.
    assertEquals(await count(h, "model_calls", `id = '${CALL}'`), 1);
    assertEquals(await count(h, "messages", `session = '${session}'`), 5);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R10 [agent-I16b]: a Fork of a compacted session starts without the summary and cannot use the source's call", async () => {
  const h = await open();
  try {
    const session = await world(h);
    const asked = await requested(h, session);
    await summarize(h, CALL, session, 1);
    value(
      await compact(h, session, {
        request_seq: asked.request_seq,
        summary_call: CALL,
        through_seq: await seqOf(h, SOURCE_LAST),
      }),
    );
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
    assertEquals(await pending(h), []);
    // 복사본은 자기 요청이 있어야 하고 출처 session의 요약 call로 요약했다고 하지 않는다.
    const copied = await requested(h, copy);
    const refused = await compact(h, copy, {
      request_seq: copied.request_seq,
      summary_call: CALL,
      through_seq: await seqOf(h, SOURCE_LAST),
    });
    assert(!refused.ok);
    assertEquals((await readSession(h, copy))["compaction"], null);
    assertEquals(
      (await readSession(h, session))["compaction"] !== null,
      true,
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/conversation#R20 [agent-I16b]: deleting a session removes its Compact requests", async () => {
  const h = await open();
  try {
    const session = await world(h);
    await requested(h, session);
    assertEquals(await count(h, "session_compact_requests"), 1);
    value(
      await h.command(
        userCred,
        envelope("DeleteSession", { session }, {
          state_seq: await sessionSeq(h, session),
        }),
      ),
    );
    assertEquals(await count(h, "session_compact_requests"), 0);
    assertEquals(await pending(h), []);
  } finally {
    await h.close();
  }
});
