import { assertEquals } from "@std/assert";
import { envelope } from "../harness/run-loop/testing/mod.ts";
import {
  ASG_LOPHN,
  finishedConversation,
  open,
  openLophn,
  output,
  receive,
  runningRun,
  seed,
  seqOf,
  setAssignmentState,
  SOURCE_ANSWER,
  SOURCE_FIRST,
  SOURCE_SECOND,
  sql,
  userCred,
  value,
} from "./world_test.ts";
import { id } from "./testing/mod.ts";

// Checkpoint는 ReceiveMessage가 request 메시지를 접수하는 같은 transaction에서 만든다
// (lophn-agent/revert R12, domain-model Checkpoint). 실제 등록 executor(harness)와 임시 ledger를 쓴다.
// 먼저 conversation/registration_test.ts가 revertSchemaSteps를 등록해야 한다(agent-RW3a).

async function checkpoints(
  h: Awaited<ReturnType<typeof open>>,
  where = "1 = 1",
  params: readonly (string | number)[] = [],
) {
  return (await sql(
    h,
    `select message, session, files_restorable, files_reason from checkpoints
     where ${where} order by message`,
    params,
  )).map((row) => [
    String(row["message"]),
    String(row["session"]),
    Number(row["files_restorable"]),
    row["files_reason"],
  ]);
}

Deno.test("lophn-agent/revert#R12 [agent-RW3a]: receiving a request creates its checkpoint in the same transaction", async () => {
  const h = await open();
  try {
    await seed(h);
    const session = await openLophn(h);
    value(
      await receive(h, { message: SOURCE_FIRST, session, mode: "request" }),
    );
    assertEquals(await checkpoints(h), [[SOURCE_FIRST, session, 1, null]]);
    // 거절된 접수는 checkpoint를 남기지 않는다: assignment가 멈추면 접수 자체가 거절된다.
    await setAssignmentState(h, ASG_LOPHN, "paused");
    const rejected = await receive(h, {
      message: SOURCE_SECOND,
      session,
      mode: "request",
    });
    assertEquals(rejected.ok, false);
    assertEquals(await checkpoints(h), [[SOURCE_FIRST, session, 1, null]]);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/revert#R12 [agent-RW3a]: a correction is not a checkpoint", async () => {
  const h = await open();
  try {
    await seed(h);
    const session = await openLophn(h);
    const run = await runningRun(h, session, SOURCE_FIRST);
    value(
      await receive(h, {
        message: id("msg", 5),
        session,
        mode: "correction",
        run,
      }),
    );
    assertEquals((await checkpoints(h)).map((row) => row[0]), [SOURCE_FIRST]);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/revert#R12 [agent-RW3a]: agent and machine messages are not checkpoints", async () => {
  const h = await open();
  try {
    await seed(h);
    const session = await finishedConversation(h);
    // 사람 요청 둘만 checkpoint다. 답(agent·machine 메시지)은 아니다.
    assertEquals(
      (await checkpoints(h, "session = ?", [session])).map((row) => row[0]),
      [
        SOURCE_FIRST,
        SOURCE_SECOND,
      ],
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/revert#R20 [agent-RW3a]: a Fork copy has no checkpoint and no rewind record", async () => {
  const h = await open();
  try {
    await seed(h);
    const source = await finishedConversation(h);
    const copy = id("ses", 2);
    output<{ id: string }>(
      await h.command(
        userCred,
        envelope("ForkSession", {
          id: copy,
          source,
          through_seq: await seqOf(h, SOURCE_ANSWER),
        }),
      ),
    );
    assertEquals(await checkpoints(h, "session = ?", [copy]), []);
    const rewound = [
      `select count(*) as n from reverts where session = ?`,
      `select count(*) as n from rewind_files where checkpoint in
         (select message from checkpoints where session = ?)`,
    ];
    for (const query of rewound) {
      assertEquals(Number((await sql(h, query, [copy]))[0]!["n"]), 0);
    }
  } finally {
    await h.close();
  }
});
