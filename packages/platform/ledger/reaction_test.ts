import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../base/mod.ts";
import { deps, fileLedger, note, user } from "./command-harness.ts";
import { defineSyncCommand } from "./handler.ts";
import { reactionIdempotencyKey } from "./reaction.ts";
import {
  createAdvanceSubscriberCursorCommand,
  createSubscriberGate,
} from "./subscriber-registration.ts";
import { recordNote } from "./test-commands.ts";
import { runCommand } from "./writer.ts";

const scratch =
  "/tmp/claude-1000/-home-pyosechang-projects-lophn/68cbca68-64dc-464d-8a08-34f5c09553b9/scratchpad";
Deno.test("platform/ledger#R15: registered subscriber owner gate는 arbitrary name·actor·credential를 거절한다", () => {
  const gate = createSubscriberGate([{
    name: "notes",
    authorize: (ctx) =>
      ok(
        ctx.principal === "user-1" && ctx.actor === "user" &&
          ctx.credential_ref === "cred-1",
      ),
  }]);
  assert(gate.ok);
  assert(gate.value("notes", user()).ok);
  for (
    const [name, ctx] of [["unknown", user()], ["notes", user("other")], [
      "notes",
      { ...user(), credential_ref: "forged" },
    ]] as const
  ) assert(!gate.value(name, ctx).ok);
  assert(
    !createSubscriberGate([{ name: "notes", authorize: () => ok(true) }, {
      name: "notes",
      authorize: () => ok(true),
    }]).ok,
  );
  const command = createAdvanceSubscriberCursorCommand(gate.value);
  let advanced = false;
  const denied = command.handle(
    {
      advanceSubscriberCursor() {
        advanced = true;
        return ok(undefined);
      },
    } as never,
    user(),
    { subscriber: "unknown", scanned_through_seq: "1" },
    { processed_through_seq: "0" },
  );
  assert(!denied.ok);
  assert(!advanced);
});

Deno.test("platform/ledger#R15: actual domain reaction+cursor는 same Tx rollback하며 tuple idempotency로 중복을 막는다", async () => {
  const dir = await Deno.makeTempDir({ dir: scratch, prefix: "reaction-" });
  const { connection } = await fileLedger(dir);
  connection.sql.run("create table reactions(value text)", []);
  const gate = createSubscriberGate([{
    name: "notes",
    authorize: (ctx) => ok(ctx.credential_ref === "cred-1"),
  }]);
  assert(gate.ok);
  const key = await reactionIdempotencyKey({
    subscriber: "notes",
    cause_seq: "1",
    reaction: "record",
  });
  assert(key.ok);
  const other = await reactionIdempotencyKey({
    subscriber: "notes",
    cause_seq: "1",
    reaction: "other",
  });
  assert(other.ok);
  assert(key.value !== other.value);
  const handler = (fail: boolean) =>
    defineSyncCommand(recordNote, (tx, ctx, input) => {
      const allowed = gate.value("notes", ctx);
      if (!allowed.ok) return allowed;
      tx.sql.run("insert into reactions values(?)", [input.name]);
      const advanced = tx.advanceSubscriberCursor("notes", "1");
      if (!advanced.ok) return advanced;
      if (fail) return err({ code: "conflict", message: "reaction failed" });
      return ok({ name: input.name, seq: "0" });
    });
  try {
    const rejected = await runCommand(
      connection,
      deps(),
      [handler(true)],
      user(),
      note("one", key.value),
    );
    assert(!rejected.ok);
    assertEquals(
      connection.sql.get("select count(*) as n from reactions", [])?.n,
      0n,
    );
    assertEquals(
      connection.sql.get("select count(*) as n from subscriber_cursors", [])?.n,
      0n,
    );
    assert(
      (await runCommand(
        connection,
        deps(),
        [handler(false)],
        user(),
        note("one", key.value),
      )).ok,
    );
    const replay = await runCommand(
      connection,
      deps(),
      [handler(false)],
      user(),
      note("one", key.value),
    );
    assert(replay.ok);
    assert(replay.value.replayed);
    assertEquals(
      connection.sql.get("select count(*) as n from reactions", [])?.n,
      1n,
    );
    assertEquals(
      connection.sql.get(
        "select processed_through_seq from subscriber_cursors",
        [],
      )?.processed_through_seq,
      1n,
    );
  } finally {
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});
