import { assertEquals } from "@std/assert";
import { createCheckpoint } from "./checkpoints.ts";
import { MSG, must, openWorld, SES } from "./testing/mod.ts";

// Checkpoint 규칙(agent-RW3a). 메시지를 접수하는 transaction 안에서 만드는 쪽은
// conversation/checkpoint_test.ts가 실제 ReceiveMessage로 본다.

function rows(world: ReturnType<typeof openWorld>) {
  return world.query(
    "select message, session, files_restorable, files_reason from checkpoints order by message",
  ).map((row) => [
    row["message"],
    row["session"],
    Number(row["files_restorable"]),
    row["files_reason"],
  ]);
}

Deno.test("lophn-agent/revert#R12 [agent-RW3a]: a request message is a checkpoint with restorable files", () => {
  const world = openWorld();
  world.addSession();
  world.rawMessage({ id: MSG(1), actor: "user", mode: "request" });
  const made = must(
    createCheckpoint(world.tx, {
      id: MSG(1),
      session: SES,
      actor: "user",
      mode: "request",
      copied_from: null,
    }),
  );
  assertEquals(made, {
    message: MSG(1),
    session: SES,
    files_restorable: true,
    files_reason: null,
  });
  assertEquals(rows(world), [[MSG(1), SES, 1, null]]);
});

Deno.test("lophn-agent/revert#R12 [agent-RW3a]: correction, agent, machine and Fork-copied messages are not checkpoints", () => {
  const world = openWorld();
  world.addSession();
  const cases = [
    { actor: "user", mode: "correction" as const, copied_from: null },
    { actor: "agent:asg_x", mode: null, copied_from: null },
    { actor: "machine", mode: null, copied_from: null },
    // Fork가 복사한 사람 메시지는 mode가 없고 copied_from이 있다(conversation#R9).
    { actor: "user", mode: null, copied_from: MSG(99) },
  ];
  for (const [index, message] of cases.entries()) {
    world.rawMessage({
      id: MSG(10 + index),
      actor: message.actor,
      mode: message.mode,
      copied_from: message.copied_from,
    });
    const made = must(
      createCheckpoint(world.tx, {
        id: MSG(10 + index),
        session: SES,
        ...message,
      }),
    );
    assertEquals(made, null);
  }
  assertEquals(rows(world), []);
});

Deno.test("lophn-agent/revert#R12 [agent-RW3a]: asking twice for the same message keeps one checkpoint", () => {
  const world = openWorld();
  world.addSession();
  world.rawMessage({ id: MSG(1), actor: "user", mode: "request" });
  const message = {
    id: MSG(1),
    session: SES,
    actor: "user",
    mode: "request" as const,
    copied_from: null,
  };
  must(createCheckpoint(world.tx, message));
  must(createCheckpoint(world.tx, message));
  assertEquals(rows(world).length, 1);
});
