import { assert, assertEquals, assertFalse } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  createIdSource,
  err,
  manualClock,
  ok,
  seededRandom,
} from "../../../base/mod.ts";
import { defineEvent } from "../../../protocol/events/mod.ts";
import { applyMigrations } from "../migration/mod.ts";
import { LEDGER_SCHEMA_STEPS, openLedger } from "./mod.ts";
import { configure, isStorageUnavailable } from "./sqlite.ts";

const START = Date.parse("2026-01-01T00:00:00.000Z");
function deps() {
  const clock = manualClock(START);
  return {
    clock,
    ids: createIdSource({ clock, random: seededRandom(1) }),
    registerBlobRef: () =>
      err({ code: "internal" as const, message: "blob 등록 없음" }),
    call: () => err({ code: "internal" as const, message: "dispatch 없음" }),
  };
}
async function tempDir(): Promise<string> {
  return await Deno.makeTempDir({ prefix: "lophn-ledger-storage-" });
}
async function openedLedger(dir: string) {
  const applied = await applyMigrations(
    `${dir}/ledger.db`,
    LEDGER_SCHEMA_STEPS,
    {
      clock: manualClock(START),
    },
  );
  return applied.ok ? openLedger(`${dir}/ledger.db`, deps()) : applied;
}
const created = defineEvent("ThingCreated", {
  subject: z.string(),
  payload: z.strictObject({ name: z.string() }),
});

Deno.test("platform/ledger#R2: WAL이 아니면 기동을 거절한다", async () => {
  const dir = await tempDir();
  // 메모리 DB는 journal_mode=WAL이 memory로 남는다.
  const memory = new DatabaseSync(":memory:");
  const memoryMode = configure(memory);
  assert(!memoryMode.ok);
  if (!memoryMode.ok) assertEquals(memoryMode.error.code, "unavailable");
  memory.close();

  // 읽기 전용 파일은 WAL 파일을 만들 수 없어 pragma가 실패한다.
  const path = `${dir}/ledger.db`;
  await Deno.writeFile(path, new Uint8Array());
  await Deno.chmod(path, 0o444);
  const denied = openLedger(path, deps());
  assert(!denied.ok);
  if (!denied.ok) assertEquals(denied.error.code, "unavailable");
  await Deno.remove(dir, { recursive: true });
});

Deno.test(
  "platform/ledger#R2: 파일 ledger는 WAL·FULL·외래 키·recursive trigger·5초 대기를 확인하고 연다",
  async () => {
    const dir = await tempDir();
    const path = `${dir}/ledger.db`;
    const db = new DatabaseSync(path);
    const applied = configure(db);
    assert(applied.ok);
    // 설정한 그 연결의 실제 반환을 다시 읽는다.
    const mode = db.prepare("pragma journal_mode").get()?.["journal_mode"];
    const sync = db.prepare("pragma synchronous").get()?.["synchronous"];
    const fk = db.prepare("pragma foreign_keys").get()?.["foreign_keys"];
    const busy = db.prepare("pragma busy_timeout").get()?.["timeout"];
    const recursive = db.prepare("pragma recursive_triggers").get()?.[
      "recursive_triggers"
    ];
    assertEquals(Number(recursive), 1);
    assertEquals(mode, "wal");
    assertEquals(Number(sync), 2);
    assertEquals(Number(fk), 1);
    assertEquals(Number(busy), 5000);
    db.close();
    const opened = openLedger(path, deps());
    assert(opened.ok);
    if (opened.ok) opened.value.close();
    await Deno.remove(dir, { recursive: true });
  },
);

Deno.test("platform/ledger#R23: 별도 SQLite 패키지 없이 내장 SQLite로 연다", async () => {
  const dir = await tempDir();
  const opened = await openedLedger(dir);
  assert(opened.ok);
  if (!opened.ok) return;
  const version = opened.value.transaction(
    { actor: "user" },
    (tx) => ok(tx.sql.get("select sqlite_version() as v", [])),
  );
  assert(version.ok);
  if (version.ok) assertEquals(version.value?.["v"], "3.53.2");
  const fts = opened.value.transaction({ actor: "user" }, (tx) =>
    ok(
      tx.sql.get("select sqlite_compileoption_used('ENABLE_FTS5') as v", []),
    ));
  assert(fts.ok);
  if (fts.ok) assertEquals(fts.value?.["v"], 1n);
  opened.value.close();
  await Deno.remove(dir, { recursive: true });
});

Deno.test(
  "platform/ledger#R1: ledger는 파일 하나이고 transaction 밖의 쓰기 길을 내놓지 않는다",
  async () => {
    const dir = await tempDir();
    const opened = await openedLedger(dir);
    assert(opened.ok);
    if (!opened.ok) return;
    const ledger = opened.value;
    // 쓰기는 transaction 하나로만 들어간다. 다른 SQL·파일 경로를 받는 입구가 없다.
    assertEquals(Object.keys(ledger).sort(), ["close", "transaction"]);
    const written = ledger.transaction(
      { actor: "machine" },
      (tx) => ok(tx.emit(created, "thing:a", { name: "a" })),
    );
    assert(written.ok);
    ledger.close();
    const files = [];
    for await (const entry of Deno.readDir(dir)) files.push(entry.name);
    assertEquals(files.filter((name) => name.endsWith(".db")), ["ledger.db"]);
    await Deno.remove(dir, { recursive: true });
  },
);

// architecture/platform 2.3·platform/ledger#R6: 분류는 primary code 하위 8bit와
// SQLITE_* 이름 둘 다로 한다. 여기 없는 코드·이름은 unavailable이 아니다.
const PRIMARY_NAMES: Record<number, string> = {
  5: "SQLITE_BUSY",
  6: "SQLITE_LOCKED",
  8: "SQLITE_READONLY",
  10: "SQLITE_IOERR",
  11: "SQLITE_CORRUPT",
  13: "SQLITE_FULL",
  14: "SQLITE_CANTOPEN",
  15: "SQLITE_PROTOCOL",
  26: "SQLITE_NOTADB",
};

Deno.test("platform/ledger#R6: primary errcode 표의 각 코드는 unavailable이다", () => {
  for (const code of Object.keys(PRIMARY_NAMES).map(Number)) {
    assert(
      isStorageUnavailable({ errcode: code }),
      `primary errcode ${code}는 unavailable이어야 한다`,
    );
  }
});

Deno.test("platform/ledger#R6: extended errcode(하위 8bit)도 같은 primary로 분류한다", () => {
  for (const code of Object.keys(PRIMARY_NAMES).map(Number)) {
    const extended = code | (3 << 8);
    assert(
      isStorageUnavailable({ errcode: extended }),
      `extended errcode ${extended}도 primary ${code}로 unavailable이어야 한다`,
    );
  }
});

Deno.test("platform/ledger#R6: SQLITE_* 이름(기본·확장 변형)도 unavailable이다", () => {
  for (const name of Object.values(PRIMARY_NAMES)) {
    assert(
      isStorageUnavailable({ code: name }),
      `이름 ${name}은 unavailable이어야 한다`,
    );
    assert(
      isStorageUnavailable({ code: `${name}_VARIANT` }),
      `확장 이름 ${name}_VARIANT도 unavailable이어야 한다`,
    );
  }
});

Deno.test("platform/ledger#R6: 표 밖의 errcode·이름·오류는 unavailable이 아니다", () => {
  const negatives: unknown[] = [
    { errcode: 1 }, // SQLITE_ERROR
    { errcode: 19 }, // SQLITE_CONSTRAINT
    { code: "SQLITE_ERROR" },
    { code: "SQLITE_MISMATCH" },
    { code: "SQLITE_BUSYISH" }, // 접두 일치만으로 속지 않는다
    new Error("some unrelated failure"),
    new TypeError("not storage related"),
    null,
    undefined,
    "plain string",
    42,
  ];
  for (const thrown of negatives) {
    assertFalse(
      isStorageUnavailable(thrown),
      `${JSON.stringify(thrown)}는 unavailable이 아니어야 한다`,
    );
  }
});

Deno.test("platform/ledger#R6: 메시지 marker(disk i/o 등)로도 unavailable을 분류한다", () => {
  const markers = [
    "disk I/O error",
    "database or disk is full",
    "database is locked",
    "unable to open database file",
    "disk image is malformed",
    "attempt to write a readonly database",
  ];
  for (const message of markers) {
    assert(
      isStorageUnavailable(new Error(message)),
      `메시지 "${message}"는 unavailable이어야 한다`,
    );
  }
  assertFalse(isStorageUnavailable(new Error("no marker here")));
});

Deno.test("platform/ledger#R6: errcode·code가 있어도 숫자·문자열이 아니면 분류하지 않는다", () => {
  assertFalse(isStorageUnavailable({ errcode: "5" }));
  assertFalse(isStorageUnavailable({ code: 5 }));
  assertFalse(isStorageUnavailable({ errcode: null, code: null }));
});
