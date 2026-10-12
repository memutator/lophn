import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { err, ok, type Result } from "../../base/mod.ts";
import type { RequestContext } from "../../protocol/server/mod.ts";
import {
  commands,
  deps,
  fileLedger,
  note,
  NOW,
  user,
} from "../storage/ledger/command-harness.ts";
import { createReaderEventBackend } from "./backend.ts";
import type { EventBatch } from "./list.ts";
import { createReaderPool } from "../storage/ledger/reader-pool.ts";
import {
  createEventDispatcher,
  createEventSession,
  type EventBackend,
  resolveSubscriptionStart,
} from "./subscribe.ts";
import { createSubscriptionStore } from "./subscription-store.ts";

const LEDGER_ID = "ldg_00000000000000000000000000000001";
import { runCommand } from "../storage/ledger/writer.ts";

const start = {
  type: "subscribe" as const,
  from_seq: "0",
  types: [],
  subjects: [],
};
async function turn() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
async function until(test: () => boolean) {
  for (let i = 0; i < 500; i++) {
    if (test()) return;
    await turn();
  }
  throw new Error("condition did not settle");
}
function batch(seq: string, size = 1): EventBatch {
  return {
    events: [{
      seq,
      type: "NoteCreated",
      subject: "note:one",
      actor: "user",
      run: null,
      payload: { name: "é".repeat(size) },
      at: NOW,
    }],
    scanned_through_seq: seq,
    head_seq: seq,
  };
}

Deno.test("platform/ledger#R15: injected periodic catch-up는 유실 wake 뒤 actual WAL reader에서 replay한다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "subscribe-" });
  const { path, connection } = await fileLedger(dir);
  const pool = await createReaderPool(path, [
    new URL("./fixture.ts", import.meta.url),
  ]);
  assert(pool.ok);
  let tick = () => {};
  let cancelled = false;
  const dispatcher = createEventDispatcher((callback) => {
    tick = callback;
    return () => {
      cancelled = true;
    };
  });
  const received: string[] = [];
  const session = await createEventSession(
    user(),
    start,
    createReaderEventBackend(pool.value, () => Promise.resolve(ok(user()))),
    {
      send: (text) => {
        received.push(text);
        return Promise.resolve();
      },
      close() {},
    },
  );
  assert(session.ok);
  dispatcher.add(session.value);
  try {
    await until(() => received.length > 0);
    await runCommand(connection, deps(), commands, user(), note("late"));
    tick();
    await until(() =>
      received.some((text) =>
        JSON.parse(text).events.some((event: { seq: string }) =>
          event.seq === "1"
        )
      )
    );
    assert(
      received.some((text) => JSON.parse(text).scanned_through_seq === "1"),
    );
  } finally {
    dispatcher.close();
    assert(cancelled);
    pool.value.close();
    connection.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/ledger#R16: held sink의 in-flight+queued 실제 bytes 1MiB를 넘으면 1013이며 다른 session은 진행한다", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const codes: number[] = [];
  let reads = 0;
  const backend: EventBackend = {
    current: () => Promise.resolve(ok(user())),
    read: (_ctx, scan) => {
      reads++;
      const value = batch(scan.position === "0" ? "1" : scan.position, 60000);
      value.head_seq = "20";
      return Promise.resolve(ok(value));
    },
  };
  const slow = await createEventSession(user(), start, backend, {
    send: () => held,
    close: (code) => codes.push(code),
  });
  assert(slow.ok);
  let fastDelivered = false;
  const fast = await createEventSession(user(), start, {
    ...backend,
    read: () => Promise.resolve(ok(batch("1"))),
  }, {
    send: () => {
      fastDelivered = true;
      return Promise.resolve();
    },
    close() {},
  });
  assert(fast.ok);
  await until(() => codes.length > 0 && fastDelivered);
  assertEquals(codes, [1013]);
  assert(reads < 20);
  release();
  await turn();
  assertEquals(slow.value.bufferedBytes(), 0);
  fast.value.close();
});

Deno.test("platform/api#R7 platform/identity#R7: buffered send 직전 recheck와 held completion은 revoked session을 되살리지 않는다", async () => {
  let revoked = false;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let sent = 0;
  const codes: number[] = [];
  const backend: EventBackend = {
    current: (): Promise<Result<RequestContext>> =>
      Promise.resolve(
        revoked
          ? err({ code: "unauthorized", message: "revoked" })
          : ok(user()),
      ),
    read: (_ctx, scan) =>
      Promise.resolve(ok(
        scan.position === "0"
          ? batch("1")
          : { events: [], scanned_through_seq: "1", head_seq: "1" },
      )),
  };
  const session = await createEventSession(user(), start, backend, {
    send: () => {
      sent++;
      return held;
    },
    close: (code) => codes.push(code),
  });
  assert(session.ok);
  await until(() => sent === 1);
  revoked = true;
  session.value.catchUp();
  await until(() => codes.length > 0);
  assertEquals(codes, [1008]);
  release();
  await turn();
  session.value.catchUp();
  await turn();
  assertEquals(sent, 1);
  assertEquals(session.value.bufferedBytes(), 0);
});

Deno.test("platform/api#R5 platform/ledger#R15: named ack는 principal/name/credential·sent bound·nondecreasing이며 delivered만으로 저장하지 않는다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ack-" });
  const opened = await createSubscriptionStore(
    `${dir}/derived/api-subscriptions`,
    LEDGER_ID,
  );
  assert(opened.ok);
  const store = opened.value;
  let delivered = false;
  const session = await createEventSession(user(), {
    ...start,
    subscriber: "display",
  }, {
    current: () => Promise.resolve(ok(user())),
    read: () => Promise.resolve(ok(batch("5"))),
  }, {
    send: () => {
      delivered = true;
      return Promise.resolve();
    },
    close() {},
  }, store);
  assert(session.ok);
  try {
    await until(() => delivered && session.value.bufferedBytes() === 0);
    assertEquals(await store.get("user-1", "display"), ok(null));
    const ack = {
      type: "ack" as const,
      subscriber: "display",
      through_seq: "5",
    };
    for (const ctx of [user("other"), { ...user(), credential_ref: "other" }]) {
      assert(!(await session.value.ack(ctx, ack)).ok);
    }
    assert(
      !(await session.value.ack(user(), { ...ack, subscriber: "other" })).ok,
    );
    assert(!(await session.value.ack(user(), { ...ack, through_seq: "6" })).ok);
    assert((await session.value.ack(user(), ack)).ok);
    assert(!(await session.value.ack(user(), { ...ack, through_seq: "4" })).ok);
    assertEquals(
      await resolveSubscriptionStart(user(), {
        ...start,
        from_seq: undefined,
        subscriber: "display",
      }, store),
      ok("6"),
    );
    assertEquals(
      await resolveSubscriptionStart(user(), {
        ...start,
        from_seq: "5",
        subscriber: "display",
      }, store),
      ok("5"),
    );
    assertEquals(
      await resolveSubscriptionStart(user(), {
        ...start,
        from_seq: undefined,
        subscriber: "empty",
      }, store),
      ok("0"),
    );
    assert(
      !(await resolveSubscriptionStart(user(), {
        ...start,
        from_seq: undefined,
      }, store)).ok,
    );
  } finally {
    session.value.close();
    store.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("platform/ledger#R17 platform/ledger#R18: actual derived SQLite ack+provenance failure는 함께 rollback하며 reopen·삭제가 ledger를 바꾸지 않는다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "derived-" });
  const { path, connection } = await fileLedger(dir);
  await runCommand(connection, deps(), commands, user(), note("original"));
  const directory = `${dir}/derived/api-subscriptions`;
  const opened = await createSubscriptionStore(directory, LEDGER_ID);
  assert(opened.ok);
  assert((await opened.value.ack("user-1", "display", "1")).ok);
  const derived = new DatabaseSync(`${directory}/subscriptions.db`);
  derived.exec(
    "create trigger provenance_fail before update on provenance begin select raise(abort,'private fault'); end;",
  );
  const failed = await opened.value.ack("user-1", "display", "2");
  assert(!failed.ok);
  assert(!JSON.stringify(failed).includes("private"));
  assertEquals(await opened.value.get("user-1", "display"), ok("1"));
  assertEquals(
    JSON.parse(
      String(derived.prepare("select value from provenance").get()?.value),
    ).indexed_through_seq,
    "1",
  );
  derived.exec("drop trigger provenance_fail");
  const originalProvenance = String(
    derived.prepare("select value from provenance").get()?.value,
  );
  derived.prepare("update provenance set value=?").run(
    originalProvenance.replace(
      '"indexed_through_seq":"1"',
      '"indexed_through_seq":"2"',
    ),
  );
  assert(!(await opened.value.get("user-1", "display")).ok);
  assert(!(await opened.value.ack("user-1", "display", "2")).ok);
  derived.prepare("update provenance set value=?").run(originalProvenance);
  opened.value.close();
  derived.close();
  const reopened = await createSubscriptionStore(directory, LEDGER_ID);
  assert(reopened.ok);
  assertEquals(await reopened.value.get("user-1", "display"), ok("1"));
  assert(!(await reopened.value.ack("user-1", "display", "0")).ok);
  reopened.value.close();
  await Deno.remove(`${dir}/derived`, { recursive: true });
  const rebuilt = await createSubscriptionStore(directory, LEDGER_ID);
  assert(rebuilt.ok);
  assertEquals(await rebuilt.value.get("user-1", "display"), ok(null));
  assertEquals(
    connection.sql.get("select count(*) as n from events", [])?.n,
    1n,
  );
  assertEquals(
    connection.sql.get("select count(*) as n from command_results", [])?.n,
    1n,
  );
  const original = new DatabaseSync(path, { readOnly: true });
  assertEquals(
    original.prepare("select payload from events").get()?.payload,
    '{"name":"original"}',
  );
  original.close();
  rebuilt.value.close();
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/api#R5 platform/api#R7: explicit future from은 inclusive 위치를 낮추지 않으며 scope 변경 buffer는 송신하지 않는다", async () => {
  const positions: string[] = [];
  let sends = 0;
  const future = await createEventSession(
    user(),
    { ...start, from_seq: "100" },
    {
      current: () => Promise.resolve(ok(user())),
      read: (_ctx, scan) => {
        positions.push(scan.position);
        return Promise.resolve(
          ok({ events: [], scanned_through_seq: "2", head_seq: "2" }),
        );
      },
    },
    {
      send: () => {
        sends++;
        return Promise.resolve();
      },
      close() {},
    },
  );
  assert(future.ok);
  await until(() => positions.length === 1);
  await turn();
  future.value.catchUp();
  await until(() => positions.length === 2);
  assertEquals(positions, ["100", "100"]);
  assertEquals(sends, 0);
  future.value.close();
  let checks = 0;
  const codes: number[] = [];
  const changed = await createEventSession(user(), start, {
    current: () => {
      checks++;
      return Promise.resolve(
        ok(
          checks >= 3
            ? { ...user(), scope: { operations: [], targets: {} } }
            : user(),
        ),
      );
    },
    read: () => Promise.resolve(ok(batch("1"))),
  }, {
    send: () => {
      sends++;
      return Promise.resolve();
    },
    close: (code) => codes.push(code),
  });
  assert(changed.ok);
  await until(() => codes.length > 0);
  assertEquals(codes, [1013]);
  assertEquals(sends, 0);
});

Deno.test("platform/backup-and-migration#R14: 기록한 ledger 식별이 다르면 ack 위치를 버리고 같으면 이어 쓴다", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ack-ledger-id-" });
  try {
    const directory = `${dir}/derived/api-subscriptions`;
    const first = await createSubscriptionStore(directory, LEDGER_ID);
    assert(first.ok);
    assert((await first.value.ack("user-1", "display", "7")).ok);
    first.value.close();
    // 같은 ledger로 다시 열면 위치가 남는다.
    const same = await createSubscriptionStore(directory, LEDGER_ID);
    assert(same.ok);
    assertEquals(await same.value.get("user-1", "display"), ok("7"));
    same.value.close();
    // 복원·새로 만든 ledger는 식별이 다르다. 옛 ledger의 seq 7을 이어 쓰지 않는다.
    const other = await createSubscriptionStore(
      directory,
      "ldg_00000000000000000000000000000002",
    );
    assert(other.ok);
    assertEquals(await other.value.get("user-1", "display"), ok(null));
    // 낮은 seq로도 새 위치를 정할 수 있다: 옛 위치가 감소 거절의 근거로 남지 않는다.
    assert((await other.value.ack("user-1", "display", "2")).ok);
    assertEquals(await other.value.get("user-1", "display"), ok("2"));
    other.value.close();
    const reopened = await createSubscriptionStore(
      directory,
      "ldg_00000000000000000000000000000002",
    );
    assert(reopened.ok);
    assertEquals(await reopened.value.get("user-1", "display"), ok("2"));
    reopened.value.close();
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
