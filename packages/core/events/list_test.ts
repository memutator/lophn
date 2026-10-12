import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import { err, ok } from "../../base/mod.ts";
import {
  eventsList,
  type EventVisibilityDefinition,
  type ReadSnapshot,
} from "../../protocol/platform/mod.ts";
import {
  commands,
  deps,
  fileLedger,
  note,
  NOW,
  user,
} from "../storage/ledger/command-harness.ts";
import { fixtureEvent } from "./fixture.ts";
import { createEventVisibilityRegistry } from "./visibility.ts";
import { createListEventsRead, scanEvents } from "./list.ts";
import { createReaderPool } from "../storage/ledger/reader-pool.ts";
import { openReaderConnection } from "../storage/ledger/reader-connection.ts";
import { executeRead } from "../storage/ledger/reads.ts";
import { runCommand } from "../storage/ledger/writer.ts";

async function ledger() {
  const dir = await Deno.makeTempDir({ prefix: "events-" });
  return { dir, ...await fileLedger(dir) };
}
function registry(
  handle: EventVisibilityDefinition["handle"] = () => ok(true),
) {
  const result = createEventVisibilityRegistry([fixtureEvent], [{
    event: fixtureEvent,
    handle,
  }]);
  assert(result.ok);
  return result.value;
}

Deno.test("platform/ledger#R15 platform/api#R5: WAL reader는 commit만 보고 seq gaps·2^53 너머와 hidden scan을 보존한다", async () => {
  const { dir, path, connection } = await ledger();
  const pool = await createReaderPool(path, [
    new URL("./fixture.ts", import.meta.url),
  ]);
  assert(pool.ok);
  try {
    connection.exec("begin immediate");
    connection.sql.run(
      "insert into events(seq,type,subject,actor,run,payload,at) values(?,?,?,?,?,?,?)",
      [
        9007199254740993n,
        "NoteCreated",
        "note:large",
        "user",
        null,
        '{"name":"hidden"}',
        NOW,
      ],
    );
    const before = await pool.value.read(eventsList, user(), {
      after_seq: "0",
    });
    assert(before.ok);
    assertEquals((before.value as { head_seq: string }).head_seq, "0");
    connection.exec("commit");
    const first = await pool.value.read(eventsList, user(), {
      after_seq: "0",
      limit: 1,
    });
    assert(first.ok);
    assertEquals((first.value as { events: unknown[] }).events, []);
    assertEquals(
      (first.value as { scanned_through_seq: string }).scanned_through_seq,
      "9007199254740993",
    );
    await runCommand(connection, deps(), commands, user(), note("visible"));
    const second = await pool.value.read(eventsList, user(), {
      after_seq: "9007199254740993",
    });
    assert(second.ok);
    assertEquals(
      (second.value as { events: { seq: string }[] }).events[0].seq,
      "9007199254740994",
    );
  } finally {
    pool.value.close();
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/api#R7 platform/identity#R8: exact synchronous owner Result만 허용하며 safe batch failure와 omission을 구별한다", async () => {
  const { dir, path, connection } = await ledger();
  await runCommand(connection, deps(), commands, user(), note("one"));
  const reader = openReaderConnection(path);
  assert(reader.ok);
  try {
    const probes: unknown[] = [
      null,
      { ok: true },
      { ok: true, value: "yes" },
      { ok: true, value: true, extra: 1 },
      Promise.resolve(ok(true)),
      Promise.reject(new Error("private failure")),
      { then() {} },
      err({ code: "unavailable", message: "private" }),
      err({ code: "internal", message: "private" }),
      err({ code: "unauthorized", message: "private" }),
      { ok: false, error: { code: "other", message: "private" } },
    ];
    for (const probe of probes) {
      const read = createListEventsRead({
        registry: registry(() => probe as never),
        current: () => ok(user()),
      });
      const result = executeRead(reader.value, read, new Map(), user(), {
        after_seq: "0",
      });
      assert(!result.ok);
      assertEquals(result.error.code, "unavailable");
      assert(!JSON.stringify(result).includes("private"));
    }
    for (
      const denied of [
        ok(false),
        err({ code: "forbidden", message: "private" }),
        err({ code: "not_found", message: "private" }),
      ]
    ) {
      const result = executeRead(
        reader.value,
        createListEventsRead({
          registry: registry(() => denied as never),
          current: () => ok(user()),
        }),
        new Map(),
        user(),
        { after_seq: "0" },
      );
      assert(result.ok);
      assertEquals((result.value as { events: unknown[] }).events, []);
      assertEquals(
        (result.value as { scanned_through_seq: string }).scanned_through_seq,
        "1",
      );
    }
    const throwing = executeRead(
      reader.value,
      createListEventsRead({
        registry: registry(() => {
          throw new Error("private");
        }),
        current: () => ok(user()),
      }),
      new Map(),
      user(),
      { after_seq: "0" },
    );
    assert(!throwing.ok);
  } finally {
    reader.value.close();
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/api#R5 platform/identity#R8: current scope만 owner와 subject gate에 주며 missing·forged gate 및 미등록 filter는 거절한다", async () => {
  const { dir, path, connection } = await ledger();
  await runCommand(connection, deps(), commands, user(), note("one"));
  const reader = openReaderConnection(path);
  assert(reader.ok);
  try {
    const claimed = {
      ...user(),
      scope: { operations: ["forged"], targets: {} },
    };
    let checked = false;
    const read = createListEventsRead({
      registry: registry((snapshot, ctx) => {
        assertEquals(ctx.scope, user().scope);
        assertEquals(snapshot.as_of_seq, "1");
        checked = true;
        return ok(true);
      }),
      current: (snapshot, ref) => {
        assertEquals(ref, "cred-1");
        assertEquals(snapshot.as_of_seq, "1");
        return ok(user());
      },
      subjects: (_snapshot, ctx, subjects) => {
        assertEquals(ctx.scope, user().scope);
        return ok(subjects[0] === "note:one");
      },
    });
    assert(
      executeRead(reader.value, read, new Map(), claimed, {
        after_seq: "0",
        subjects: ["note:one"],
      }).ok,
    );
    assert(checked);
    assert(
      !executeRead(reader.value, read, new Map(), claimed, {
        after_seq: "0",
        subjects: ["note:outside"],
      }).ok,
    );
    assert(
      !executeRead(reader.value, read, new Map(), claimed, {
        after_seq: "0",
        types: ["UnknownEvent"],
      }).ok,
    );
    for (
      const current of [undefined, () => ok({ ...user(), principal: "other" })]
    ) {
      assert(
        !executeRead(
          reader.value,
          createListEventsRead({ registry: registry(), current }),
          new Map(),
          claimed,
          { after_seq: "0" },
        ).ok,
      );
    }
    assert(!createEventVisibilityRegistry([fixtureEvent, fixtureEvent], []).ok);
    assert(
      !createEventVisibilityRegistry([fixtureEvent], [{
        event: fixtureEvent,
        handle: () => ok(true),
      }, { event: fixtureEvent, handle: () => ok(true) }]).ok,
    );
  } finally {
    reader.value.close();
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/ledger#R16: bounded scan은 hidden 포함 256이고 serialized frame byte cap 전에 멈춘다", async () => {
  const { dir, path, connection } = await ledger();
  const insert = (seq: bigint, type: string, name: string) =>
    connection.sql.run("insert into events values(?,?,?,?,?,?,?)", [
      seq,
      type,
      "note:one",
      "user",
      null,
      JSON.stringify({ name }),
      NOW,
    ]);
  for (let seq = 1n; seq <= 257n; seq++) insert(seq, "UnknownEvent", "hidden");
  const reader = openReaderConnection(path);
  assert(reader.ok);
  try {
    const read = createListEventsRead({
      registry: registry(),
      current: () => ok(user()),
    });
    const result = executeRead(reader.value, read, new Map(), user(), {
      after_seq: "0",
    });
    assert(result.ok);
    assertEquals(
      (result.value as { scanned_through_seq: string }).scanned_through_seq,
      "256",
    );
    insert(258n, "NoteCreated", "é".repeat(70000));
    insert(259n, "NoteCreated", "é".repeat(70000));
    const large = executeRead(reader.value, read, new Map(), user(), {
      after_seq: "257",
    });
    assert(large.ok);
    assertEquals((large.value as { events: unknown[] }).events.length, 1);
    assertEquals(
      (large.value as { scanned_through_seq: string }).scanned_through_seq,
      "258",
    );
  } finally {
    reader.value.close();
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/api#R7: raw unsafe값은 owner schema strip 전에 거절한다", () => {
  const raw = {
    seq: "1",
    type: "NoteCreated",
    subject: "note:one",
    actor: "user",
    run: null,
    payload: { name: "one", unsafe: () => 1 },
    at: NOW,
  };
  const snapshot = {
    as_of_seq: "1",
    sql: { all: () => [], get: () => undefined },
    port: () => "",
  } as unknown as ReadSnapshot;
  assert(!registry().visible(snapshot, user(), raw).ok);
  const unregistered = createEventVisibilityRegistry([fixtureEvent], []);
  assert(unregistered.ok);
  assertEquals(
    unregistered.value.visible(snapshot, user(), {
      ...raw,
      payload: { name: "one" },
    }),
    ok(null),
  );
  const fake = {
    ...snapshot,
    sql: {
      ...snapshot.sql,
      all: () => [{ ...raw, payload: JSON.stringify({ name: "one" }) }],
    },
  } as unknown as ReadSnapshot;
  const result = scanEvents(fake, user(), { position: "1", inclusive: true }, {
    registry: registry(),
    current: () => ok(user()),
  });
  assert(result.ok);
  assertEquals(result.value.events[0].seq, "1");
  assert(z.string().safeParse(result.value.head_seq).success);
});
