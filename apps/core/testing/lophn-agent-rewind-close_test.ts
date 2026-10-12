import { assert, assertEquals } from "@std/assert";
import { id } from "../../../packages/lophn-agent/conversation/testing/mod.ts";
import {
  redoOf,
  redoRewind,
  rewindMessagesOnly,
} from "./lophn-agent-rewind-world_test.ts";
import {
  ASG_LOPHN,
  eventsOf,
  finishedConversation,
  open,
  receive,
  seed,
  setAssignmentState,
  SOURCE_SECOND,
  value,
} from "../../../packages/lophn-agent/conversation/world_test.ts";

// 다음 사람 메시지를 접수하면 redo가 끝난다(conversation#R25, lophn-agent/revert R16). 실제 등록
// executor(harness)와 임시 ledger를 쓴다. 먼저 conversation 시험 등록(packages/lophn-agent/conversation/registration_test.ts)이 revert의 command·읽기·표를
// 올려야 한다(agent-RW3b·RW3d).

const RVT = id("rvt", 1);

async function rewound() {
  const h = await open();
  await seed(h);
  const session = await finishedConversation(h);
  value(
    await rewindMessagesOnly(h, {
      id: RVT,
      session,
      checkpoint: SOURCE_SECOND,
    }),
  );
  assertEquals(await redoOf(h, RVT), "available");
  return { h, session };
}

Deno.test("lophn-agent/revert#R16 [agent-RW3d]: receiving the next person message closes the redo in the same transaction and says so", async () => {
  const { h, session } = await rewound();
  try {
    value(
      await receive(h, { message: id("msg", 9), session, mode: "request" }),
    );
    assertEquals(await redoOf(h, RVT), "closed");
    const closed = await eventsOf(h, "RevertClosed", RVT);
    assertEquals(closed.length, 1);
    const payload = JSON.parse(String(closed[0]!["payload"]));
    assertEquals(payload.session, session);
    assertEquals(typeof payload.closed_at, "string");
    // 닫힌 redo는 다시 열리지 않는다.
    const again = await redoRewind(h, RVT);
    assert(!again.ok);
    assertEquals(again.error.code, "conflict");
    // 두 번째 메시지가 또 닫지는 않는다.
    value(
      await receive(h, { message: id("msg", 10), session, mode: "request" }),
    );
    assertEquals((await eventsOf(h, "RevertClosed", RVT)).length, 1);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/revert#R16 [agent-RW3d]: a message that is rejected does not close the redo", async () => {
  const { h, session } = await rewound();
  try {
    await setAssignmentState(h, ASG_LOPHN, "paused");
    const rejected = await receive(h, {
      message: id("msg", 9),
      session,
      mode: "request",
    });
    assertEquals(rejected.ok, false);
    assertEquals(await redoOf(h, RVT), "available");
    assertEquals((await eventsOf(h, "RevertClosed")).length, 0);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/revert#R16 [agent-RW3d]: a redo that was already used is not closed by the next message", async () => {
  const { h, session } = await rewound();
  try {
    value(await redoRewind(h, RVT));
    assertEquals(await redoOf(h, RVT), "done");
    value(
      await receive(h, { message: id("msg", 9), session, mode: "request" }),
    );
    assertEquals(await redoOf(h, RVT), "done");
    assertEquals((await eventsOf(h, "RevertClosed")).length, 0);
  } finally {
    await h.close();
  }
});
