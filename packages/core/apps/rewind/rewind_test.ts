import { assertEquals, assertNotEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { Buffer } from "node:buffer";
import { invertAll, ok, type Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { AppInvocation } from "../../../protocol/apps/calls/mod.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import { createAppRewind, type RewindDeps } from "./run.ts";
import { rewindSchemaSteps } from "./schema.ts";

function dump(db: DatabaseSync): unknown {
  const read = (table: string) =>
    db.prepare(`SELECT * FROM ${table} ORDER BY 1, 2`).all().map((row) =>
      Object.values(row).map((value) =>
        value instanceof Uint8Array ? Array.from(value) : value
      )
    );
  return [read("item"), read("pair")];
}

Deno.test("뒤집은 changeset을 적용하면 DB가 처음 상태로 돌아간다", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE item (id INTEGER PRIMARY KEY, name TEXT, data BLOB, note TEXT, score REAL);
    CREATE TABLE pair (a TEXT, b INTEGER, value TEXT, PRIMARY KEY (a, b));
    INSERT INTO item VALUES (1, 'one', x'0102', NULL, 1.5), (2, 'two', NULL, 'n', 2.5), (3, 'three', x'ff', 'x', 0);
    INSERT INTO pair VALUES ('k', 1, 'v1'), ('k', 2, NULL);
  `);
  const before = dump(db);

  const changesets: Uint8Array[] = [];
  const record = (sql: string) => {
    const session = db.createSession();
    db.exec(sql);
    changesets.push(session.changeset());
    session.close();
  };
  record(`
    INSERT INTO item VALUES (4, 'four', x'00ff00', NULL, -1.25);
    UPDATE item SET name = 'uno', note = 'set' WHERE id = 1;
    DELETE FROM item WHERE id = 3;
    UPDATE pair SET value = 'v2' WHERE a = 'k' AND b = 1;
    DELETE FROM pair WHERE b = 2;
    INSERT INTO pair VALUES ('m', 9, 'new');
  `);
  // 앞 changeset이 넣은 행을 고치고 지운다.
  record(`
    UPDATE item SET data = NULL, score = 9 WHERE id = 4;
    UPDATE item SET note = NULL WHERE id = 1;
    DELETE FROM pair WHERE a = 'm';
  `);
  assertNotEquals(dump(db), before);

  const inverted = invertAll(changesets);
  assertEquals(inverted.ok, true);
  if (!inverted.ok) return;
  for (const changeset of inverted.value) {
    assertEquals(db.applyChangeset(changeset), true);
  }
  assertEquals(dump(db), before);

  // 옛 값이 없는 patchset은 뒤집을 수 없다.
  const session = db.createSession();
  db.exec("UPDATE item SET name = 'p' WHERE id = 2");
  const patchset = session.patchset();
  session.close();
  const rejected = invertAll([patchset]);
  assertEquals(!rejected.ok && rejected.error.code, "invalid_input");
});

// --- 가짜 port ---

const n = (value: number) => String(value).padStart(26, "0");
const APP = `app_${n(1)}` as Id<"app">;
const REL = `rel_${n(1)}` as Id<"rel">;
const inv = (value: number) => `inv_${n(value)}` as Id<"inv">;

function invocation(
  value: number,
  patch: Partial<AppInvocation> = {},
): AppInvocation {
  return {
    id: inv(value),
    app: APP,
    release: REL,
    mode: "live",
    operation: { kind: "tool", tool: "app.save" },
    caller: null,
    effect: "write",
    status: "succeeded",
    started_at: "2026-10-16T00:00:00.000Z",
    finished_at: "2026-10-16T00:00:01.000Z",
    input_hash: null,
    summary: {},
    detail_hash: null,
    changeset: { hash: "a".repeat(64), size_bytes: 1 },
    reverted_by: null,
    ...patch,
  };
}

function setup(
  invocations: AppInvocation[],
  options: {
    apply?: Result<
      { status: "applied"; count: number } | {
        status: "conflict";
        message: string;
      }
    >;
    idle?: { idle: true } | { idle: false; running: Id<"inv">[] };
    changesets?: Map<Id<"inv">, Uint8Array>;
  } = {},
) {
  const db = new DatabaseSync(":memory:");
  for (const step of rewindSchemaSteps) db.exec(step.sql);
  const sql: Sql = {
    run: (text, params) => db.prepare(text).run(...params),
    get: (text, params) => db.prepare(text).get(...params) as never,
    all: (text, params) => db.prepare(text).all(...params) as never,
  };
  const calls = {
    intake: [] as string[],
    applied: [] as string[][],
    marked: [] as Id<"inv">[],
    signals: 0,
  };
  const deps: RewindDeps = {
    ledger: {
      get: (id) => ok(invocations.find((one) => one.id === id) ?? null),
      list: () => ok(invocations.filter((one) => one.reverted_by === null)),
      changesetOf: (id) =>
        Promise.resolve(
          ok(
            options.changesets?.get(id) ??
              (invocations.find((one) => one.id === id)?.changeset
                ? new TextEncoder().encode(id)
                : null),
          ),
        ),
      markReverted: (ids) => {
        calls.marked.push(...ids);
        return ok(undefined);
      },
    },
    link: {
      apply: (_app, request) => {
        calls.applied.push(request.changesets);
        return Promise.resolve(
          options.apply ?? ok({ status: "applied", count: 1 }),
        );
      },
    },
    intake: {
      close: () => void calls.intake.push("close"),
      open: () => void calls.intake.push("open"),
      whenIdle: () => Promise.resolve(options.idle ?? { idle: true }),
    },
    signal: { changed: () => void calls.signals++ },
    sql,
    activeRelease: () => ok(REL),
    now: () => "2026-10-16T00:00:02.000Z",
    newId: () => `rwd_${n(1)}` as Id<"rwd">,
  };
  return { rewind: createAppRewind(deps), calls, db };
}

// 진짜 changeset: 1번이 행을 넣고 2번이 그 행을 고친다.
function sampleChangesets(): Map<Id<"inv">, Uint8Array> {
  const source = new DatabaseSync(":memory:");
  source.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
  const take = (change: string) => {
    const session = source.createSession();
    source.exec(change);
    const changeset = session.changeset();
    session.close();
    return changeset;
  };
  return new Map([
    [inv(1), take("INSERT INTO t VALUES (1, 'a')")],
    [inv(2), take("UPDATE t SET v = 'b' WHERE id = 1")],
  ]);
}

Deno.test("external은 되돌리지 않고 표시하고, 결과 모르는 write가 범위에 있으면 rewind를 시작하지 않는다", async () => {
  const lost = setup([
    invocation(1),
    invocation(2, { effect: "external" }),
    invocation(3, { status: "unknown", changeset: null }),
  ]);
  const plan = lost.rewind.plan(APP, inv(1));
  assertEquals(plan.ok && plan.value.items.map((item) => item.external), [
    false,
    true,
    false,
  ]);
  assertEquals(
    plan.ok && plan.value.blocked,
    { reason: "unrecoverable_write", invocation: inv(3) },
  );
  const started = await lost.rewind.apply(APP, inv(1), "user");
  assertEquals(!started.ok && started.error.code, "conflict");
  assertEquals(lost.calls.intake, []);
  assertEquals(lost.db.prepare("SELECT count(*) AS n FROM app_rewinds").get(), {
    n: 0,
  });

  // 선택할 수 없는 시작점은 거절한다. 더 오래된 것은 범위 밖이다.
  const picked = setup([
    invocation(1, { effect: "read", changeset: null }),
    invocation(2, { reverted_by: `rwd_${n(9)}` as Id<"rwd"> }),
    invocation(3, { mode: "preview" }),
    invocation(4),
  ]);
  for (const bad of [1, 2, 3]) {
    const plan = picked.rewind.plan(APP, inv(bad));
    assertEquals(!plan.ok && plan.error.code, "invalid_input");
  }
  const older = picked.rewind.plan(APP, inv(4));
  assertEquals(older.ok && older.value.items.length, 1);
});

Deno.test("적용이 충돌하면 되돌림 표시를 남기지 않고 접수를 다시 연다", async () => {
  const conflicted = setup([invocation(1)], {
    changesets: sampleChangesets(),
    apply: ok({ status: "conflict", message: "row 1 changed" }),
  });
  const result = await conflicted.rewind.apply(APP, inv(1), "user");
  assertEquals(result.ok && result.value.status, "cancelled");
  assertEquals(result.ok && result.value.reason, {
    code: "conflict",
    message: "row 1 changed",
  });
  assertEquals(conflicted.calls.marked, []);
  assertEquals(conflicted.calls.signals, 0);
  assertEquals(conflicted.calls.intake, ["close", "open"]);

  // 도는 호출이 유예 안에 끝나지 않으면 앱에 보내지 않고 취소한다.
  const busy = setup([invocation(1)], {
    idle: { idle: false, running: [inv(2)] },
  });
  const timedOut = await busy.rewind.apply(APP, inv(1), "user");
  assertEquals(timedOut.ok && timedOut.value.status, "cancelled");
  assertEquals(busy.calls.applied, []);
  assertEquals(busy.calls.intake, ["close", "open"]);

  // 사람만 한다.
  const agent = await busy.rewind.apply(APP, inv(1), `agent:ses_${n(1)}`);
  assertEquals(!agent.ok && agent.error.code, "forbidden");
});

Deno.test("충돌 없이 적용되면 최신부터 뒤집어 보내고 external까지 되돌림 표시를 남긴다", async () => {
  const changesets = sampleChangesets();

  const done = setup(
    [invocation(1), invocation(2, { effect: "external" })],
    { changesets },
  );
  const result = await done.rewind.apply(APP, inv(1), "user");
  assertEquals(result.ok && result.value.status, "applied");
  assertEquals(result.ok && result.value.invocations, [inv(1), inv(2)]);
  assertEquals(done.calls.marked, [inv(1), inv(2)]);
  assertEquals(done.calls.signals, 1);
  assertEquals(done.calls.intake, ["close", "open"]);

  // 보낸 순서대로 적용하면 두 호출이 만든 변경이 모두 사라진다.
  const target = new DatabaseSync(":memory:");
  target.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
  target.exec("INSERT INTO t VALUES (1, 'b')");
  for (const text of done.calls.applied[0]) {
    assertEquals(
      target.applyChangeset(new Uint8Array(Buffer.from(text, "base64"))),
      true,
    );
  }
  assertEquals(target.prepare("SELECT count(*) AS n FROM t").get(), { n: 0 });
});
