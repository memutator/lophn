import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import type { RequestContext } from "../../protocol/platform/mod.ts";
import {
  createReaderPool,
  type ReaderPool,
  type ReaderPoolOptions,
} from "./reader-pool.ts";
import { fixtureRead, storageRegression } from "./read-fixture.ts";
import { READ_TIMEOUT_MS } from "./reads.ts";

const ctx: RequestContext = {
  principal: "user",
  actor: "user",
  credential_ref: "fixture",
  scope: { operations: [], targets: {} },
  conditions: {},
};
const modules = [new URL("./read-fixture.ts", import.meta.url)];

type Fixture = {
  writer: DatabaseSync;
  pool: ReaderPool;
  close(): Promise<void>;
};

// 격리만 보는 시험은 다시 띄우지 않게(한도 0) 연다.
const ISOLATE_ONLY = { respawnLimit: 0, onExhausted: () => {} };

async function fixture(options?: ReaderPoolOptions): Promise<Fixture> {
  const dir = await Deno.makeTempDir({ prefix: "ledger-reads-" });
  const path = `${dir}/ledger.db`;
  const writer = new DatabaseSync(path);
  writer.exec(`
    pragma journal_mode=WAL;
    create table events(seq integer primary key, type text);
    create table items(id integer primary key, value text);
    insert into events values(1, 'fixture');
    insert into items values(1, 'before');
  `);
  const opened = await createReaderPool(path, modules, options);
  if (!opened.ok) {
    writer.close();
    await Deno.remove(dir, { recursive: true });
    throw new Error(opened.error.message);
  }
  return {
    writer,
    pool: opened.value,
    async close() {
      opened.value.close();
      writer.close();
      await Deno.remove(dir, { recursive: true });
    },
  };
}

async function entered(gate: SharedArrayBuffer) {
  const signal = new Int32Array(gate);
  const deadline = performance.now() + 1000;
  while (Atomics.load(signal, 0) === 0) {
    assert(performance.now() < deadline, "Worker did not enter handler");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

Deno.test("platform/ledger#R14: 두 실제 Worker는 readOnly·query_only 연결과 독립 queue를 쓴다", async () => {
  const f = await fixture();
  try {
    const replies = await Promise.all([
      f.pool.read(fixtureRead, ctx, { action: "probe" }),
      f.pool.read(fixtureRead, ctx, { action: "probe" }),
    ]);
    const ids = new Set();
    for (const result of replies) {
      assert(result.ok);
      const value = result.value as {
        data: Record<string, unknown>;
        as_of_seq: string;
      };
      assertEquals(value.data.writeBlocked, true);
      assertEquals(value.data.queryOnly, "1");
      assertEquals(value.data.transactionBlocked, true);
      assertEquals(value.as_of_seq, "1");
      ids.add(value.data.workerId);
    }
    assertEquals(ids.size, 2);
    assertEquals(f.pool.health(), ["healthy", "healthy"]);
    assertEquals(
      f.writer.prepare("select count(*) as count from items").get()?.count,
      1,
    );
  } finally {
    await f.close();
  }
});

Deno.test("platform/ledger#R14: 자료·관계·as_of_seq는 동시 commit 중에도 같은 snapshot이다", async () => {
  const f = await fixture();
  try {
    const gate = new SharedArrayBuffer(8);
    const pending = f.pool.read(fixtureRead, ctx, { action: "snapshot", gate });
    await entered(gate);
    f.writer.exec(
      "begin immediate; update items set value='after' where id=1; insert into events values(2, 'changed'); commit",
    );
    Atomics.store(new Int32Array(gate), 1, 1);
    Atomics.notify(new Int32Array(gate), 1);
    const result = await pending;
    assert(result.ok);
    assertEquals(result.value, {
      data: { first: "before", second: "before", head: "1" },
      as_of_seq: "1",
      next_cursor: null,
    });
    const next = await f.pool.read(fixtureRead, ctx, { action: "snapshot" });
    assert(next.ok);
    assertEquals(next.value, {
      data: { first: "after", second: "after", head: "2" },
      as_of_seq: "2",
      next_cursor: null,
    });
  } finally {
    await f.close();
  }
});

Deno.test("platform/ledger#R14: 긴 writer transaction이 열려 있어도 read는 먼저 응답한다", async () => {
  const f = await fixture();
  try {
    f.writer.exec(
      "begin immediate; update items set value='uncommitted' where id=1",
    );
    const result = await f.pool.read(fixtureRead, ctx, { action: "snapshot" });
    assert(result.ok);
    assertEquals(
      (result.value as { data: { first: string } }).data.first,
      "before",
    );
    assertEquals(f.writer.isTransaction, true);
    f.writer.exec("rollback");
  } finally {
    if (f.writer.isTransaction) f.writer.exec("rollback");
    await f.close();
  }
});

Deno.test("platform/ledger#R14: 500행·1MiB를 넘으면 page 또는 명시 한도 오류다", async () => {
  const f = await fixture();
  try {
    f.writer.exec(
      "with recursive n(x) as (values(2) union all select x+1 from n where x<501) insert into items select x, 'row' from n",
    );
    const page = await f.pool.read(fixtureRead, ctx, {
      action: "page",
      count: 500,
    });
    assert(page.ok);
    assertEquals((page.value as { next_cursor: string }).next_cursor, "next");
    assert(
      (await f.pool.read(fixtureRead, ctx, { action: "page_meta", count: 500 }))
        .ok,
    );
    const exact = await f.pool.read(fixtureRead, ctx, {
      action: "rows",
      count: 500,
    });
    assert(exact.ok);
    for (
      const input of [
        { action: "sql_limit", count: 501 },
        { action: "rows", count: 501 },
        { action: "bytes", count: 524288 },
      ]
    ) {
      const result = await f.pool.read(fixtureRead, ctx, input);
      assert(!result.ok);
      assertEquals(result.error.code, "invalid_input");
      assert(result.error.details);
    }
    const within = await f.pool.read(fixtureRead, ctx, {
      action: "bytes",
      count: 524200,
    });
    assert(within.ok);
  } finally {
    await f.close();
  }
});

Deno.test("platform/ledger#R14: parent wall-clock timeout이 native SQL reader를 unhealthy로 격리한다(다시 띄우지 않으면 그대로 남는다)", async () => {
  const f = await fixture(ISOLATE_ONLY);
  try {
    const gate = new SharedArrayBuffer(8);
    const started = performance.now();
    const slow = f.pool.read(fixtureRead, ctx, { action: "slow", gate });
    await entered(gate);
    const fast = await f.pool.read(fixtureRead, ctx, { action: "probe" });
    assert(fast.ok, "second Worker must not wait for first reader");
    const result = await slow;
    assert(!result.ok);
    assertEquals(result.error.code, "unavailable");
    assert(performance.now() - started >= READ_TIMEOUT_MS);
    assert(performance.now() - started < READ_TIMEOUT_MS + 1000);
    assertEquals(f.pool.health(), ["unhealthy", "healthy"]);
    const next = await f.pool.read(fixtureRead, ctx, { action: "probe" });
    assert(next.ok);
    assertEquals(f.pool.health(), ["unhealthy", "healthy"]);
  } finally {
    await f.close();
  }
});

Deno.test("platform/ledger#R14: registry·input·output 경계를 지키고 실패한 transaction도 닫는다", async () => {
  const f = await fixture();
  try {
    for (
      const [input, code] of [
        [{ action: "unknown" }, "invalid_input"],
        [{ action: "invalid_output" }, "internal"],
        [{ action: "failure" }, "invalid_input"],
      ] as const
    ) {
      const result = await f.pool.read(fixtureRead, ctx, input);
      assert(!result.ok);
      assertEquals(result.error.code, code);
    }
    const unknown = await f.pool.read(
      { resource: "file:///unregistered.ts", method: "read" },
      ctx,
      {},
    );
    assert(!unknown.ok);
    assertEquals(unknown.error.code, "not_found");
    const forbidden = await f.pool.read(fixtureRead, {
      ...ctx,
      actor: "machine",
    }, { action: "probe" });
    assert(!forbidden.ok);
    assertEquals(forbidden.error.code, "forbidden");
    const unsafe = await f.pool.read(fixtureRead, ctx, {
      action: "unsafe",
      query: "select 1; commit",
    });
    assert(!unsafe.ok);
    assert((await f.pool.read(fixtureRead, ctx, { action: "probe" })).ok);
    f.pool.close();
    const closed = await f.pool.read(fixtureRead, ctx, { action: "probe" });
    assert(!closed.ok);
    assertEquals(closed.error.code, "unavailable");
  } finally {
    await f.close();
  }
});

Deno.test("platform/ledger#R14: snapshot은 handler 종료 뒤 쓸 수 없고 Worker별 port identity를 보존한다", async () => {
  const f = await fixture();
  try {
    assert((await f.pool.read(fixtureRead, ctx, { action: "expired" })).ok);
    const expired = await f.pool.read(fixtureRead, ctx, { action: "expired" });
    assert(expired.ok);
    assertEquals((expired.value as { data: unknown }).data, { blocked: true });
    const port = await f.pool.read(fixtureRead, ctx, { action: "port" });
    const probe = await f.pool.read(fixtureRead, ctx, { action: "probe" });
    assert(port.ok && probe.ok);
    assertEquals(
      (port.value as { data: string }).data,
      (probe.value as { data: { workerId: string } }).data.workerId,
    );
    f.writer.prepare("insert into events values(?, 'large')").run(
      9007199254740993n,
    );
    const seq = await f.pool.read(fixtureRead, ctx, { action: "large_seq" });
    assert(seq.ok);
    assertEquals(seq.value, {
      data: "9007199254740993",
      as_of_seq: "9007199254740993",
      next_cursor: null,
    });
  } finally {
    await f.close();
  }
});

Deno.test("platform/ledger#R14: read 대기는 64개·principal당 8개이고 principal 사이 round-robin이다", async () => {
  const f = await fixture();
  const gates = [new SharedArrayBuffer(8), new SharedArrayBuffer(8)];
  try {
    const held = gates.map((gate) =>
      f.pool.read(fixtureRead, ctx, { action: "hold", gate })
    );
    await Promise.all(gates.map(entered));
    const order: string[] = [];
    const request = (principal: string, index: number) =>
      f.pool.read(fixtureRead, { ...ctx, principal }, { action: "probe" }).then(
        (result) => {
          order.push(`${principal}:${index}`);
          return result;
        },
      );
    const queued = Array.from({ length: 8 }, (_, i) => request("a", i));
    const ninth = await request("a", 8);
    assert(!ninth.ok);
    assertEquals(ninth.error.code, "unavailable");
    queued.push(request("b", 0));
    for (let principal = 0; principal < 7; principal++) {
      const count = principal === 6 ? 7 : 8;
      for (let i = 0; i < count; i++) {
        queued.push(request(`other-${principal}`, i));
      }
    }
    const overflow = await request("overflow", 0);
    assert(!overflow.ok);
    assertEquals(overflow.error.code, "unavailable");
    order.length = 0;
    Atomics.store(new Int32Array(gates[0]), 1, 1);
    Atomics.notify(new Int32Array(gates[0]), 1);
    assert((await held[0]).ok);
    const results = await Promise.all(queued);
    assert(results.every((result) => result.ok));
    assertEquals(order.slice(0, 2), ["a:0", "b:0"]);
    Atomics.store(new Int32Array(gates[1]), 1, 1);
    Atomics.notify(new Int32Array(gates[1]), 1);
    assert((await held[1]).ok);
  } finally {
    for (const gate of gates) {
      Atomics.store(new Int32Array(gate), 1, 1);
      Atomics.notify(new Int32Array(gate), 1);
    }
    await f.close();
  }
});

Deno.test("platform/ledger#R14: 두 reader가 unhealthy면 실행·대기·새 입장을 unavailable로 닫는다(다시 띄우지 않으면 그대로 남는다)", async () => {
  const f = await fixture(ISOLATE_ONLY);
  try {
    const gates = [new SharedArrayBuffer(8), new SharedArrayBuffer(8)];
    const running = gates.map((gate) =>
      f.pool.read(fixtureRead, ctx, { action: "slow", gate })
    );
    await Promise.all(gates.map(entered));
    const waiting = f.pool.read(fixtureRead, ctx, { action: "probe" });
    const results = await Promise.all([...running, waiting]);
    for (const result of results) {
      assert(!result.ok);
      assertEquals(result.error.code, "unavailable");
    }
    assertEquals(f.pool.health(), ["unhealthy", "unhealthy"]);
    const next = await f.pool.read(fixtureRead, ctx, { action: "probe" });
    assert(!next.ok);
    assertEquals(next.error.code, "unavailable");
  } finally {
    await f.close();
  }
});

Deno.test("platform/ledger#R14: 중복 registry와 WAL 아닌 database는 Worker 기동을 거절한다", async () => {
  for (
    const [path, registration] of [["unused", [...modules, ...modules]], [
      ":memory:",
      modules,
    ]] as const
  ) {
    const result = await createReaderPool(path, registration);
    assert(!result.ok);
    assertEquals(result.error.code, "unavailable");
  }
});

Deno.test("platform/ledger#R14: 비동기·invalid Result는 internal이고 같은 Worker의 다음 read는 성공한다", async () => {
  const f = await fixture();
  try {
    for (let count = 0; count < 11; count++) {
      const before = await f.pool.read(fixtureRead, ctx, { action: "port" });
      const invalid = await f.pool.read(fixtureRead, ctx, {
        action: "invalid_result",
        count,
      });
      assert(!invalid.ok);
      assertEquals(invalid.error.code, "internal");
      assertEquals(f.pool.health(), ["healthy", "healthy"]);
      assertEquals(
        await f.pool.read(fixtureRead, ctx, { action: "port" }),
        before,
      );
    }
    const comment = await f.pool.read(fixtureRead, ctx, { action: "comment" });
    assert(comment.ok);
    assertEquals((comment.value as { data: unknown }).data, [{
      value: "before",
    }]);
  } finally {
    await f.close();
  }
});

Deno.test("platform/ledger#R14: storage·snapshot 종료 오류는 safe unavailable이고 다음 read는 안전하다", () => {
  for (const [index, result] of storageRegression(ctx).entries()) {
    if (index < 40 && index % 4 === 1) {
      assert(result.ok);
      continue;
    }
    assert(!result.ok);
    assertEquals(result.error.code, "unavailable");
    assert(!JSON.stringify(result).includes("private"));
  }
});

async function untilHealthy(
  pool: ReaderPool,
  want: readonly string[],
  ms = 20_000,
) {
  const deadline = performance.now() + ms;
  while (performance.now() < deadline) {
    if (JSON.stringify(pool.health()) === JSON.stringify(want)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`reader health stayed ${JSON.stringify(pool.health())}`);
}

Deno.test("platform/ledger#R14: 격리된 두 reader를 한 번에 하나씩 다시 띄워 read가 돌아온다", async () => {
  let respawned = 0;
  const f = await fixture({
    backoffMs: [10],
    onRespawn: () => {
      respawned++;
    },
  });
  try {
    const gates = [new SharedArrayBuffer(8), new SharedArrayBuffer(8)];
    const running = gates.map((gate) =>
      f.pool.read(fixtureRead, ctx, { action: "slow", gate })
    );
    await Promise.all(gates.map(entered));
    for (const result of await Promise.all(running)) {
      assert(!result.ok);
      assertEquals(result.error.code, "unavailable");
    }
    // 둘 다 시간을 넘겨 격리된 직후에는 읽을 수 없다.
    assertEquals(f.pool.health(), ["unhealthy", "unhealthy"]);
    const during = await f.pool.read(fixtureRead, ctx, { action: "probe" });
    assert(!during.ok);
    // 다시 뜬 뒤에는 읽힌다.
    await untilHealthy(f.pool, ["healthy", "healthy"]);
    const after = await f.pool.read(fixtureRead, ctx, { action: "probe" });
    assert(after.ok, "reads must recover after the respawn");
    assertEquals(respawned, 2);
    // 다시 뜬 reader도 읽기 전용 연결이다.
    const value = after.value as { data: Record<string, unknown> };
    assertEquals(value.data.writeBlocked, true);
  } finally {
    await f.close();
  }
});

Deno.test("platform/ledger#R14: 다시 띄우는 횟수에 한도가 있고 넘으면 격리된 채 한 번만 알린다", async () => {
  const exhausted: number[] = [];
  const f = await fixture({
    respawnLimit: 1,
    backoffMs: [10],
    onExhausted: (limit) => exhausted.push(limit),
  });
  try {
    const slowOnce = async () => {
      const gate = new SharedArrayBuffer(8);
      const slow = f.pool.read(fixtureRead, ctx, { action: "slow", gate });
      await entered(gate);
      return await slow;
    };
    // 첫 격리는 다시 뜬다.
    assert(!(await slowOnce()).ok);
    await untilHealthy(f.pool, ["healthy", "healthy"]);
    // 둘째 격리는 한도를 넘어 그대로 남는다. 다른 slot은 계속 읽는다.
    const results = await Promise.all([slowOnce(), slowOnce()]);
    for (const result of results) assert(!result.ok);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert(f.pool.health().includes("unhealthy"));
    assertEquals(exhausted, [1]);
  } finally {
    await f.close();
  }
});
