import { assertEquals } from "@std/assert";
import { envelope } from "../lophn-agent/run-loop/testing/mod.ts";
import { id } from "../lophn-agent/session/testing/mod.ts";
import {
  redoRewind,
  rewindMessagesOnly,
} from "./lophn-agent-rewind-world_test.ts";
import {
  ASG_LOPHN,
  ASG_OP,
  DONE,
  finishedConversation,
  finishRun,
  machineCred,
  open,
  openSession,
  output,
  PLACES,
  runningRun,
  seed,
  seqOf,
  sessionSeq,
  SOURCE_LAST,
  SOURCE_SECOND,
  sql,
  userCred,
  value,
} from "../lophn-agent/session/world_test.ts";

// Fork가 숨긴 구간을 빼고 복사하고(conversation#R25), session을 delete하거나 닫으면 되돌리기 기록이
// 같이 지워진다(lophn-agent/revert R20, conversation#R20). 실제 등록 executor(harness)와 임시
// ledger를 쓴다. 먼저 conversation 시험 등록(packages/core/lophn-agent/session/registration_test.ts)이 revert의 command·읽기·표를 올려야 한다
// (agent-RW3b·RW3d).

const RVT = id("rvt", 1);

function fork(
  h: Awaited<ReturnType<typeof open>>,
  copy: string,
  source: string,
  throughSeq: string,
) {
  return h.command(
    userCred,
    envelope("ForkSession", { id: copy, source, through_seq: throughSeq }),
  );
}

async function copiedFrom(
  h: Awaited<ReturnType<typeof open>>,
  session: string,
): Promise<string[]> {
  return (await sql(
    h,
    "select copied_from from messages where session = ? order by created_seq",
    [session],
  )).map((row) => String(row["copied_from"]));
}

Deno.test("lophn-agent/conversation#R25 [agent-RW3d]: Fork leaves out the messages a rewind hid and copies them again once the redo is used", async () => {
  const h = await open();
  try {
    await seed(h);
    const source = await finishedConversation(h);
    value(
      await rewindMessagesOnly(h, {
        id: RVT,
        session: source,
        checkpoint: SOURCE_SECOND,
      }),
    );
    const through = await seqOf(h, SOURCE_LAST);
    const copy = id("ses", 2);
    const forked = output<{ copied_messages: number }>(
      await fork(h, copy, source, through),
    );
    // 숨긴 두 번째 요청과 그 답은 복사하지 않는다.
    assertEquals(forked.copied_messages, 2);
    assertEquals((await copiedFrom(h, copy)).length, 2);
    assertEquals(
      (await copiedFrom(h, copy)).includes(SOURCE_SECOND),
      false,
    );

    // redo를 쓰면 다시 보이는 메시지라 복사한다.
    value(await redoRewind(h, RVT));
    const second = id("ses", 3);
    const again = output<{ copied_messages: number }>(
      await fork(h, second, source, through),
    );
    assertEquals(again.copied_messages, 4);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/revert#R20 [agent-RW3d]: deleting a session removes its checkpoints and revert records, not another session's", async () => {
  const h = await open();
  try {
    await seed(h);
    const session = await finishedConversation(h);
    value(
      await rewindMessagesOnly(h, {
        id: RVT,
        session,
        checkpoint: SOURCE_SECOND,
      }),
    );
    const other = id("ses", 5);
    value(await openSession(h, other, ASG_LOPHN, PLACES.project));
    const run = await runningRun(h, other, id("msg", 50));
    value(await finishRun(h, run, DONE));
    const counts = async (target: string) => {
      const n = async (query: string) =>
        Number((await sql(h, query, [target]))[0]!["n"]);
      return [
        await n("select count(*) as n from checkpoints where session = ?"),
        await n("select count(*) as n from reverts where session = ?"),
        await n(
          `select count(*) as n from revert_items where revert in
             (select id from reverts where session = ?)`,
        ),
      ];
    };
    assertEquals((await counts(session))[0], 2);
    assertEquals((await counts(session))[1], 1);
    value(
      await h.command(
        userCred,
        envelope("DeleteSession", { session }, {
          state_seq: await sessionSeq(h, session),
        }),
      ),
    );
    assertEquals(await counts(session), [0, 0, 0]);
    assertEquals((await counts(other))[0], 1);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/revert#R20 [agent-RW3d]: closing a session removes its rewind records, so a closed session cannot be rewound", async () => {
  const h = await open();
  try {
    await seed(h);
    const session = id("ses", 7);
    value(await openSession(h, session, ASG_OP, PLACES.project));
    const first = id("msg", 90);
    const run = await runningRun(h, session, first, ASG_OP);
    value(await finishRun(h, run, DONE));
    value(await rewindMessagesOnly(h, { id: RVT, session, checkpoint: first }));
    value(
      await h.command(
        userCred,
        envelope("WithdrawAssignment", { assignment: ASG_OP }, {
          revision: 1,
          state: "enabled",
        }),
      ),
    );
    value(
      await h.command(
        machineCred,
        envelope("CloseSession", { session, reason: "assignment_withdrawn" }, {
          state_seq: await sessionSeq(h, session),
          state: "open",
        }),
      ),
    );
    for (
      const query of [
        "select count(*) as n from checkpoints where session = ?",
        "select count(*) as n from reverts where session = ?",
      ]
    ) {
      assertEquals(Number((await sql(h, query, [session]))[0]!["n"]), 0);
    }
  } finally {
    await h.close();
  }
});
