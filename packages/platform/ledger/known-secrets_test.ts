// platform/redaction#R1, platform/secrets#R1: reader pool의 알려진 secret 값 등록·회수 통로.
// 값은 요청 message 밖에서 모든 reader Worker의 보호 메모리로만 들어가고 read handler는 일치
// 검사만 한다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import type { RequestContext } from "../../contracts/platform/mod.ts";
import { createReaderPool, type ReaderPool } from "./reader-pool.ts";
import { fixtureRead } from "./read-fixture.ts";

const ctx: RequestContext = {
  principal: "user",
  actor: "user",
  credential_ref: "fixture",
  scope: { operations: [], targets: {} },
  conditions: {},
};

async function open(): Promise<{ pool: ReaderPool; close(): Promise<void> }> {
  const dir = await Deno.makeTempDir({ prefix: "ledger-known-" });
  const path = `${dir}/ledger.db`;
  const writer = new DatabaseSync(path);
  writer.exec(`
    pragma journal_mode=WAL;
    create table events(seq integer primary key, type text);
    create table items(id integer primary key, value text);
    insert into events values(1, 'fixture');
  `);
  const opened = await createReaderPool(path, [
    new URL("./read-fixture.ts", import.meta.url),
  ]);
  assert(opened.ok);
  return {
    pool: opened.value,
    async close() {
      opened.value.close();
      writer.close();
      await Deno.remove(dir, { recursive: true });
    },
  };
}

// 두 Worker가 모두 답하도록 동시에 여러 번 읽는다.
async function matches(
  pool: ReaderPool,
  text: string,
): Promise<{ workers: Set<string>; found: boolean[]; ready: boolean[] }> {
  const workers = new Set<string>();
  const found: boolean[] = [];
  const ready: boolean[] = [];
  for (let round = 0; round < 6; round++) {
    const replies = await Promise.all(
      Array.from(
        { length: 4 },
        () => pool.read(fixtureRead, ctx, { action: "known", query: text }),
      ),
    );
    for (const reply of replies) {
      assert(reply.ok);
      const data = (reply.value as {
        data: { workerId: string; match: unknown; ready: boolean };
      }).data;
      workers.add(data.workerId);
      found.push(data.match !== null);
      ready.push(data.ready);
    }
  }
  return { workers, found, ready };
}

Deno.test("platform/redaction#R1: 등록한 값은 모든 reader Worker가 알고 회수하면 모두 모른다", async () => {
  const f = await open();
  try {
    const text = "log line with sk-live-registered-value inside";
    // 등록 전에는 아무도 모른다.
    const before = await matches(f.pool, text);
    assertEquals(before.workers.size, 2);
    assert(before.found.every((hit) => !hit));
    // 처음에는 준비되지 않았다. core가 알려야 모든 reader가 준비된다(fail-closed).
    assert(before.ready.every((flag) => !flag));
    assert((await f.pool.known.setReady(true)).ok);
    assert((await matches(f.pool, text)).ready.every((flag) => flag));

    const registered = await f.pool.known.register([
      "sk-live-registered-value",
    ]);
    assert(registered.ok);
    // 등록이 끝난 뒤 시작하는 read는 두 Worker 모두에서 값을 안다.
    const during = await matches(f.pool, text);
    assertEquals(during.workers.size, 2);
    assert(during.found.every((hit) => hit));

    const revoked = await f.pool.known.revoke(["sk-live-registered-value"]);
    assert(revoked.ok);
    const after = await matches(f.pool, text);
    assert(after.found.every((hit) => !hit));
    // 준비되지 않음으로 돌리면 모든 reader가 그렇게 답한다.
    assert((await f.pool.known.setReady(false)).ok);
    assert((await matches(f.pool, text)).ready.every((flag) => !flag));
  } finally {
    await f.close();
  }
});

Deno.test("platform/redaction#R1: 값은 read 결과·오류·health에 나오지 않고 matcher는 일치 위치만 낸다", async () => {
  const f = await open();
  try {
    const value = "sk-live-never-leaves-the-worker";
    await f.pool.known.register([value]);
    const reply = await f.pool.read(fixtureRead, ctx, {
      action: "known",
      query: `x ${value} y`,
    });
    assert(reply.ok);
    const body = JSON.stringify(reply.value);
    assert(!body.includes(value));
    const data = (reply.value as {
      data: { match: { index: number; length: number } };
    }).data;
    assertEquals(data.match, { index: 2, length: value.length });
    assertEquals(f.pool.health(), ["healthy", "healthy"]);
  } finally {
    await f.close();
  }
});

Deno.test("platform/redaction#R1: 회수한 값만 알려진 값에서 빠지고 닫힌 pool은 등록을 받지 않는다", async () => {
  const f = await open();
  const first = "first-known-secret-value";
  const second = "second-known-secret-value";
  try {
    assert((await f.pool.known.register([first, second])).ok);
    assert((await f.pool.known.revoke([first])).ok);
    const text = `${first} ${second}`;
    const hits = await Promise.all([
      f.pool.read(fixtureRead, ctx, { action: "known", query: text }),
      f.pool.read(fixtureRead, ctx, { action: "known", query: text }),
    ]);
    for (const hit of hits) {
      assert(hit.ok);
      const data = (hit.value as {
        data: { match: { index: number; length: number } };
      }).data;
      // 회수된 첫 값 자리가 아니라 둘째 값 자리에서 일치한다.
      assertEquals(data.match, {
        index: first.length + 1,
        length: second.length,
      });
    }
    // 빈 목록은 아무 일도 아니다.
    assert((await f.pool.known.register([])).ok);
  } finally {
    await f.close();
  }
  const closed = await f.pool.known.register(["value-after-close"]);
  assert(!closed.ok);
  assertEquals(closed.error.code, "unavailable");
});
