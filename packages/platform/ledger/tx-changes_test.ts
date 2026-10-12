import { assert, assertEquals } from "@std/assert";
import { ok } from "../../base/mod.ts";
import type { Sql, Tx } from "../../protocol/platform/mod.ts";
import { deps, fileLedger, note, user } from "./command-harness.ts";
import { defineSyncCommand } from "./handler.ts";
import type { LedgerConnection } from "./sqlite.ts";
import { recordNote } from "./test-commands.ts";
import { runCommand } from "./writer.ts";

const MUTATING_RETURNING =
  "with recursive n(x) as (values (1) union all select x+1 from n where x<1001) insert into probe select x from n returning x";

async function probeLedger() {
  const dir = await Deno.makeTempDir({ prefix: "lophn-changes-" });
  const { connection } = await fileLedger(dir);
  connection.sql.run("create table probe (x integer)", []);
  connection.sql.run("create table probe_log (x integer)", []);
  return { dir, connection };
}

function count(connection: LedgerConnection, table: string): unknown {
  return connection.sql.get(`select count(*) as n from ${table}`, [])?.["n"];
}

// handler가 거절 throw를 삼키고 ok를 돌려준다. 그래도 commit하면 안 된다.
function swallowing(body: (tx: Tx) => void) {
  return defineSyncCommand(recordNote, (tx, _ctx, input) => {
    try {
      body(tx);
    } catch {
      // 일부러 삼킨다.
    }
    return ok({ name: input.name, seq: "0" });
  });
}

async function expectRolledBack(
  connection: LedgerConnection,
  body: (tx: Tx) => void,
  key: string,
  code: string,
) {
  const result = await runCommand(
    connection,
    deps(),
    [swallowing(body)],
    user(),
    note("a", key),
  );
  assert(!result.ok, key);
  if (!result.ok) assertEquals(result.error.code, code, key);
  assertEquals(count(connection, "probe"), 0n, key);
  assertEquals(count(connection, "probe_log"), 0n, key);
  assertEquals(count(connection, "command_results"), 0n, key);
  assertEquals(count(connection, "events"), 0n, key);
}

Deno.test("platform/ledger#R12: get·all의 WITH·RETURNING 변경은 삼켜도 거절하고 rollback한다", async () => {
  const { dir, connection } = await probeLedger();
  await expectRolledBack(
    connection,
    (tx) => tx.sql.get(MUTATING_RETURNING, []),
    "get-returning",
    "invalid_input",
  );
  await expectRolledBack(
    connection,
    (tx) => tx.sql.all(MUTATING_RETURNING, []),
    "all-returning",
    "invalid_input",
  );
  // 한 행 변경도 읽기 입구로는 못 한다.
  await expectRolledBack(
    connection,
    (tx) => tx.sql.get("insert into probe values (1) returning x", []),
    "get-one",
    "invalid_input",
  );
  await expectRolledBack(
    connection,
    (tx) => tx.sql.all("insert into probe values (1), (2) returning x", []),
    "all-two",
    "invalid_input",
  );
  // CTE로 시작하는 정상 read는 그대로 된다.
  const reading = defineSyncCommand(recordNote, (tx) => {
    const rows = tx.sql.all(
      "with recursive n(x) as (values (1) union all select x+1 from n where x<3) select x from n",
      [],
    );
    const first = tx.sql.get("with a(x) as (select 7) select x from a", []);
    return ok({ name: `${rows.length}:${first?.["x"]}`, seq: "0" });
  });
  const read = await runCommand(
    connection,
    deps(),
    [reading],
    user(),
    note("a", "cte-read"),
  );
  assert(read.ok);
  if (read.ok) assertEquals(read.value.result, { name: "3:7", seq: "0" });
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/ledger#R12: Tx.sql.run 실제 변경 1,000개는 되고 1,001개는 삼켜도 결과 없이 rollback한다", async () => {
  const { dir, connection } = await probeLedger();
  const fill = (rows: number) =>
    `with recursive n(x) as (values (1) union all select x+1 from n where x<${rows}) insert into probe select x from n`;
  await expectRolledBack(
    connection,
    (tx) => tx.sql.run(fill(1001), []),
    "run-1001",
    "invalid_input",
  );
  // 나눠 실행해도 누적한다. 넘친 뒤 삼키고 더 써도 결과가 없다.
  await expectRolledBack(
    connection,
    (tx) => {
      tx.sql.run(fill(1000), []);
      try {
        tx.sql.run("insert into probe values (0)", []);
      } catch {
        tx.sql.run("insert into probe_log values (0)", []);
      }
    },
    "run-split",
    "invalid_input",
  );
  // RETURNING이 여러 행을 돌려줘도 run은 실제 변경 수로 센다.
  await expectRolledBack(
    connection,
    (tx) => tx.sql.run(MUTATING_RETURNING, []),
    "run-returning",
    "invalid_input",
  );
  const exact = swallowing((tx) => tx.sql.run(fill(1000), []));
  const kept = await runCommand(
    connection,
    deps(),
    [exact],
    user(),
    note("a", "run-1000"),
  );
  assert(kept.ok);
  assertEquals(count(connection, "probe"), 1000n);
  assertEquals(count(connection, "command_results"), 1n);
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/ledger#R12: trigger가 만든 행도 변경 행에 센다", async () => {
  const { dir, connection } = await probeLedger();
  connection.exec(
    "create trigger probe_logged after insert on probe begin insert into probe_log values (new.x); end",
  );
  await expectRolledBack(
    connection,
    (tx) =>
      tx.sql.run(
        "with recursive n(x) as (values (1) union all select x+1 from n where x<501) insert into probe select x from n",
        [],
      ),
    "trigger-1002",
    "invalid_input",
  );
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

// 실행기가 쓰는 연결 SQL의 total_changes 응답만 바꾼다.
function withChangeCount(
  connection: LedgerConnection,
  answer: () => unknown,
): LedgerConnection {
  const sql = connection.sql;
  const faked: Sql = {
    run: (text, params) => sql.run(text, params),
    get: (text, params) =>
      text.includes("total_changes()")
        ? { n: answer() } as never
        : sql.get(text, params),
    all: (text, params) => sql.all(text, params),
  };
  return { ...connection, sql: faked };
}

Deno.test("platform/ledger#R12: 변경 수가 정수가 아니거나 조회가 던져도 경계 Result이고 rollback한다", async () => {
  const { dir, connection } = await probeLedger();
  const body = (tx: Tx) => tx.sql.run("insert into probe values (1)", []);
  const answers: [string, () => unknown][] = [
    ["number", () => 1.5],
    ["negative", () => -1n],
    ["text", () => "1"],
    [
      "throw",
      () => {
        throw new Error("boom");
      },
    ],
  ];
  for (const [label, answer] of answers) {
    const result = await runCommand(
      withChangeCount(connection, answer),
      deps(),
      [swallowing(body)],
      user(),
      note("a", `count-${label}`),
    );
    assert(!result.ok, label);
    if (!result.ok) assertEquals(result.error.code, "internal", label);
  }
  assertEquals(count(connection, "probe"), 0n);
  assertEquals(count(connection, "command_results"), 0n);
  connection.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test("platform/ledger#R6: handler 중 연결이 poison되면 삼켜도 unavailable Result다", async () => {
  const { dir, connection } = await probeLedger();
  const poisoning = swallowing((tx) => {
    tx.sql.run("insert into probe values (1)", []);
    connection.fault();
    tx.sql.get("select 1 as x", []);
  });
  const result = await runCommand(
    connection,
    deps(),
    [poisoning],
    user(),
    note("a", "poison"),
  );
  assert(!result.ok);
  if (!result.ok) {
    assertEquals(result.error.code, "unavailable");
    assertEquals(result.error.message, "ledger에 기록할 수 없다");
  }
  await Deno.remove(dir, { recursive: true });
});
