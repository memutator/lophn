import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../../base/mod.ts";
import type { RequestContext } from "../../../protocol/server/mod.ts";
import { deps, fileLedger, note, user } from "./command-harness.ts";
import { openConnection } from "./sqlite.ts";
import { defineSyncCommand } from "./handler.ts";
import { reactionIdempotencyKey } from "./reaction.ts";
import {
  createSubscriberGate,
  type SubscriberBinding,
  type SubscriberGate,
} from "../../events/subscriber-registration.ts";
import { noteCreated, recordNote } from "./test-commands.ts";
import type { TxDeps } from "./tx.ts";
import { openWriter, runCommand } from "./writer.ts";

const cursorFixture = new URL("./writer-cursor-fixture.ts", import.meta.url);

function gate(bindings: readonly SubscriberBinding[]): SubscriberGate {
  const created = createSubscriberGate(bindings);
  if (!created.ok) throw new Error("subscriber gate");
  return created.value;
}

function withGate(subscriberGate: SubscriberGate): TxDeps & {
  checkCredential: ReturnType<typeof deps>["checkCredential"];
} {
  return { ...deps(), subscriberGate };
}

const notesOwner: SubscriberBinding = {
  name: "notes",
  authorize: (ctx) =>
    ok(
      ctx.principal === "user-1" && ctx.actor === "user" &&
        ctx.credential_ref === "cred-1" &&
        ctx.scope.operations.includes("AdvanceSubscriberCursor"),
    ),
};

Deno.test("platform/ledger#R15: registered subscriber owner gate는 arbitrary name·actor·credential를 거절한다", () => {
  const owned = gate([notesOwner]);
  assert(owned("notes", user()).ok);
  for (
    const [name, ctx] of [["unknown", user()], ["notes", user("other")], [
      "notes",
      { ...user(), credential_ref: "forged" },
    ]] as const
  ) assert(!owned(name, ctx).ok);
  assert(
    !createSubscriberGate([{ name: "notes", authorize: () => ok(true) }, {
      name: "notes",
      authorize: () => ok(true),
    }]).ok,
  );
});

Deno.test("platform/ledger#R15: domain command가 cursor 거절을 삼켜도 event·cursor·결과를 commit하지 않는다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "reaction-" });
  const { connection } = await fileLedger(dir);
  const owned = gate([notesOwner]);
  const swallow = defineSyncCommand(recordNote, (tx, ctx, input) => {
    ctx.scope.operations = ["AdvanceSubscriberCursor", "RecordNote"];
    ctx.principal = "machine-1";
    ctx.credential_ref = "cred-m";
    ctx.actor = "machine";
    try {
      tx.advanceSubscriberCursor("notifications", "1");
    } catch {
      // 의도적으로 거절을 삼켜 sticky rollback을 검증한다.
    }
    tx.emit(noteCreated, `note:${input.name}`, { name: input.name });
    return ok({ name: input.name, seq: "1" });
  });
  try {
    const denied = await runCommand(
      connection,
      withGate(owned),
      [swallow],
      user(),
      note("bypass", "bypass"),
    );
    assert(!denied.ok);
    if (!denied.ok) assertEquals(denied.error.code, "forbidden");
    for (const table of ["events", "subscriber_cursors", "command_results"]) {
      assertEquals(
        connection.sql.get(`select count(*) as n from ${table}`, [])?.n,
        0n,
        table,
      );
    }
    const replay = await runCommand(
      connection,
      withGate(owned),
      [swallow],
      user(),
      note("bypass", "bypass-replay"),
    );
    assert(!replay.ok);
    if (!replay.ok) assertEquals(replay.error.code, "forbidden");
    assertEquals(
      connection.sql.get("select count(*) as n from events", [])?.n,
      0n,
    );
  } finally {
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/ledger#R15: cursor는 unknown·다른 owner·없는 gate·좁은 scope·다른 자격을 sticky rollback한다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "reaction-" });
  const { connection } = await fileLedger(dir);
  const cases: {
    key: string;
    gate?: SubscriberGate;
    ctx: RequestContext;
    current?: RequestContext;
    subscriber: string;
  }[] = [
    {
      key: "unknown",
      gate: gate([notesOwner]),
      ctx: user(),
      subscriber: "unknown",
    },
    {
      key: "other-owner",
      gate: gate([notesOwner]),
      ctx: user("other"),
      subscriber: "notes",
    },
    { key: "missing-gate", ctx: user(), subscriber: "notes" },
    {
      key: "narrow-scope",
      gate: gate([notesOwner]),
      ctx: {
        ...user(),
        scope: { operations: ["RecordNote"], targets: {} },
      },
      subscriber: "notes",
    },
    {
      key: "wrong-credential",
      gate: gate([notesOwner]),
      ctx: user(),
      current: { ...user(), credential_ref: "forged" },
      subscriber: "notes",
    },
    {
      key: "wrong-principal",
      gate: gate([notesOwner]),
      ctx: user(),
      current: { ...user(), principal: "user-2" },
      subscriber: "notes",
    },
  ];
  const command = defineSyncCommand(recordNote, (tx, _ctx, input) => {
    tx.advanceSubscriberCursor(input.name, "1");
    return ok({ name: input.name, seq: "0" });
  });
  try {
    for (const item of cases) {
      const { subscriberGate: _defaultGate, ...rest } = deps();
      const bound = {
        ...(item.gate === undefined
          ? rest
          : { ...rest, subscriberGate: item.gate }),
        checkCredential: (ctx: RequestContext) => ok(item.current ?? ctx),
      };
      const result = await runCommand(
        connection,
        bound,
        [command],
        item.ctx,
        note(item.subscriber, item.key),
      );
      assert(!result.ok, item.key);
      if (!result.ok) {
        const expected = item.key === "missing-gate"
          ? "unavailable"
          : "forbidden";
        assertEquals(result.error.code, expected, item.key);
      }
      assertEquals(
        connection.sql.get("select count(*) as n from subscriber_cursors", [])
          ?.n,
        0n,
        item.key,
      );
      assertEquals(
        connection.sql.get("select count(*) as n from command_results", [])?.n,
        0n,
        item.key,
      );
    }
  } finally {
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/ledger#R15: malformed·async·throwing owner hook은 cursor와 domain 변경을 남기지 않는다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "reaction-" });
  const { connection } = await fileLedger(dir);
  const hooks: Record<string, SubscriberBinding["authorize"]> = {
    malformed: () => ({ ok: true, extra: true }) as never,
    async: () => Promise.resolve(ok(true)) as never,
    throwing: () => {
      throw new Error("owner private detail");
    },
  };
  try {
    for (const [key, authorize] of Object.entries(hooks)) {
      const owned = gate([{ name: "notes", authorize }]);
      const reaction = defineSyncCommand(recordNote, (tx, _ctx, input) => {
        const moved = tx.advanceSubscriberCursor("notes", "1");
        if (!moved.ok) return moved;
        tx.emit(noteCreated, `note:${input.name}`, { name: input.name });
        return ok({ name: input.name, seq: "1" });
      });
      const result = await runCommand(
        connection,
        withGate(owned),
        [reaction],
        user(),
        note(key, key),
      );
      assert(!result.ok, key);
      if (!result.ok) {
        assertEquals(result.error.code, "unavailable", key);
        assert(!JSON.stringify(result.error).includes("private"));
      }
    }
    assertEquals(
      connection.sql.get("select count(*) as n from events", [])?.n,
      0n,
    );
    assertEquals(
      connection.sql.get("select count(*) as n from subscriber_cursors", [])
        ?.n,
      0n,
    );
  } finally {
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/ledger#R15: 같은 Tx의 reaction+cursor는 같이 commit하고 실패는 같이 rollback하며 replay는 중복을 만들지 않는다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "reaction-" });
  const { connection } = await fileLedger(dir);
  connection.sql.run("create table reactions(value text)", []);
  const owned = gate([notesOwner]);
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
    defineSyncCommand(recordNote, (tx, _ctx, input) => {
      tx.sql.run("insert into reactions values(?)", [input.name]);
      const advanced = tx.advanceSubscriberCursor("notes", "1");
      if (!advanced.ok) return advanced;
      if (fail) return err({ code: "conflict", message: "reaction failed" });
      tx.emit(noteCreated, `note:${input.name}`, { name: input.name });
      return ok({ name: input.name, seq: "0" });
    });
  try {
    const rejected = await runCommand(
      connection,
      withGate(owned),
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
      connection.sql.get("select count(*) as n from subscriber_cursors", [])
        ?.n,
      0n,
    );
    assertEquals(
      connection.sql.get("select count(*) as n from events", [])?.n,
      0n,
    );
    assert(
      (await runCommand(
        connection,
        withGate(owned),
        [handler(false)],
        user(),
        note("one", key.value),
      )).ok,
    );
    const replay = await runCommand(
      connection,
      withGate(owned),
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

Deno.test("platform/ledger#R15: 실제 writer Worker도 현재 자격 밖 cursor 우회를 rollback한다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "reaction-worker-" });
  const { path, connection } = await fileLedger(dir);
  connection.close();
  const writer = openWriter(path, cursorFixture);
  try {
    const denied = await writer.command(user(), note("bypass", "worker"));
    assert(!denied.ok);
    if (!denied.ok) assertEquals(denied.error.code, "forbidden");
    const again = await writer.command(user(), note("bypass", "worker-2"));
    assert(!again.ok);
  } finally {
    await writer.close();
  }
  const reopened = openConnection(path);
  assert(reopened.ok);
  if (!reopened.ok) return;
  const stored = reopened.value;
  try {
    assertEquals(
      stored.sql.get("select count(*) as n from events", [])?.n,
      0n,
    );
    assertEquals(
      stored.sql.get("select count(*) as n from subscriber_cursors", [])?.n,
      0n,
    );
    assertEquals(
      stored.sql.get("select count(*) as n from command_results", [])?.n,
      0n,
    );
  } finally {
    stored.close();
    await Deno.remove(dir, { recursive: true });
  }
});
