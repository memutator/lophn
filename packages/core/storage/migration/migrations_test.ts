import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { type Logger, manualClock } from "../../../base/mod.ts";
import { applyMigrations, confirmStartup, startFailureReason } from "./mod.ts";

const step1 = { id: "a", sql: "create table a (id text primary key)" };
const step2 = { id: "b", sql: "create table b (id text primary key)" };

const logger: Logger = {
  log: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  flush: () => Promise.resolve(),
};

const names = async (dir: string) => {
  const out: string[] = [];
  try {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      out.push(entry.name);
    }
  } catch {
    // 없는 폴더
  }
  return out.sort();
};

// 복구본은 가장 최근 하나만 남고, 정상 기동이 확인되면 지워진다.
test("복구본은 최근 하나만 두고 정상 기동이 지운다", async () => {
  const root = await mkdtemp(join(tmpdir(), "migration-"));
  const path = `${root}/lophn.db`;
  const clock = manualClock(Date.UTC(2026, 0, 1));
  try {
    const deps = { clock, recovery: { root } };
    assert.deepStrictEqual(await applyMigrations(path, [step1], deps), {
      ok: true,
      value: 1,
    });
    // 새 설치는 복구본이 없다.
    assert.deepStrictEqual(await names(`${root}/recovery`), []);
    clock.advance(1000);
    const second = await applyMigrations(path, [step1, step2], deps);
    assert.deepStrictEqual(second, { ok: true, value: 1 });
    const first = await names(`${root}/recovery`);
    assert.deepStrictEqual(first.length, 1);
    // 새 복구본이 생기면 이전 것은 지워진다.
    clock.advance(1000);
    const step3 = { id: "c", sql: "create table c (id text primary key)" };
    await applyMigrations(path, [step1, step2, step3], deps);
    const latest = await names(`${root}/recovery`);
    assert.deepStrictEqual(latest.length, 1);
    assert.ok(latest[0] !== first[0]);
    // 적용할 step이 없으면 복구본을 새로 만들지 않는다.
    const same = await applyMigrations(path, [step1, step2, step3], deps);
    assert.deepStrictEqual(same, { ok: true, value: 0 });
    await confirmStartup(root, logger);
    assert.deepStrictEqual(await names(`${root}/recovery`), []);
    // 없는 폴더는 오류가 아니다.
    await confirmStartup(root, logger);
  } finally {
    await rm(root, { recursive: true });
  }
});

test("높은 schema, 다른 hash, 손상된 원본을 구별해 알린다", async () => {
  const root = await mkdtemp(join(tmpdir(), "migration-"));
  const path = `${root}/lophn.db`;
  const clock = manualClock(Date.UTC(2026, 0, 1));
  try {
    const deps = { clock };
    assert.ok((await applyMigrations(path, [step1, step2], deps)).ok);
    const newer = await applyMigrations(path, [step1], deps);
    assert.ok(!newer.ok);
    assert.deepStrictEqual(startFailureReason(newer.error), "newer_schema");
    const other = await applyMigrations(
      path,
      [{ id: "a", sql: "create table a (id text)" }, step2],
      deps,
    );
    assert.ok(!other.ok);
    assert.deepStrictEqual(startFailureReason(other.error), "history_mismatch");
    const damaged = `${root}/damaged.db`;
    await writeFile(damaged, "not a database ".repeat(1000));
    const broken = await applyMigrations(damaged, [step1], deps);
    assert.ok(!broken.ok);
    assert.deepStrictEqual(
      startFailureReason(broken.error),
      "damaged_original",
    );
    assert.deepStrictEqual(
      startFailureReason({ code: "internal", message: "x" }),
      "other",
    );
  } finally {
    await rm(root, { recursive: true });
  }
});

// 앞쪽 module에 step을 더해도 이미 적용한 뒤 step은 그대로이고 새 step만 적용된다.
test("목록 중간에 더한 step만 적용하고 기존 data는 남는다", async () => {
  const root = await mkdtemp(join(tmpdir(), "migration-"));
  const path = `${root}/lophn.db`;
  const clock = manualClock(Date.UTC(2026, 0, 1));
  try {
    const deps = { clock, recovery: { root } };
    assert.ok((await applyMigrations(path, [step1, step2], deps)).ok);
    const db = new DatabaseSync(path);
    db.exec("insert into b values ('kept')");
    db.close();
    const middle = { id: "m", sql: "create table m (id text primary key)" };
    assert.deepStrictEqual(
      await applyMigrations(path, [step1, middle, step2], deps),
      { ok: true, value: 1 },
    );
    const after = new DatabaseSync(path);
    assert.deepStrictEqual(
      after
        .prepare("select id from b")
        .all()
        .map((row) => row.id),
      ["kept"],
    );
    assert.deepStrictEqual(
      after
        .prepare("select step_id from schema_migrations order by version")
        .all()
        .map((row) => row.step_id),
      ["a", "b", "m"],
    );
    after.close();
    // 다시 열어도 같은 목록이면 적용할 것이 없다.
    assert.deepStrictEqual(
      await applyMigrations(path, [step1, middle, step2], deps),
      { ok: true, value: 0 },
    );
  } finally {
    await rm(root, { recursive: true });
  }
});
