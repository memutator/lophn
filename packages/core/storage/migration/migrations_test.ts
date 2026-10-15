import { assert, assertEquals } from "@std/assert";
import { manualClock } from "../../../base/mod.ts";
import { confirmStartup } from "./mod.ts";
import { applyMigrations, startFailureReason } from "./mod.ts";

const step1 = { id: "a", sql: "create table a (id text primary key)" };
const step2 = { id: "b", sql: "create table b (id text primary key)" };

const names = async (dir: string) => {
  const out: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) out.push(entry.name);
  } catch {
    // 없는 폴더
  }
  return out.sort();
};

// 복구본은 가장 최근 하나만 남고, 정상 기동이 확인되면 지워진다.
Deno.test("복구본은 최근 하나만 두고 정상 기동이 지운다", async () => {
  const root = await Deno.makeTempDir({ prefix: "migration-" });
  const path = `${root}/lophn.db`;
  const clock = manualClock(Date.UTC(2026, 0, 1));
  try {
    const deps = { clock, recovery: { root } };
    assertEquals(await applyMigrations(path, [step1], deps), {
      ok: true,
      value: 1,
    });
    // 새 설치는 복구본이 없다.
    assertEquals(await names(`${root}/recovery`), []);
    clock.advance(1000);
    const second = await applyMigrations(path, [step1, step2], deps);
    assertEquals(second, { ok: true, value: 1 });
    const first = await names(`${root}/recovery`);
    assertEquals(first.length, 1);
    // 새 복구본이 생기면 이전 것은 지워진다.
    clock.advance(1000);
    const step3 = { id: "c", sql: "create table c (id text primary key)" };
    await applyMigrations(path, [step1, step2, step3], deps);
    const latest = await names(`${root}/recovery`);
    assertEquals(latest.length, 1);
    assert(latest[0] !== first[0]);
    // 적용할 step이 없으면 복구본을 새로 만들지 않는다.
    const same = await applyMigrations(path, [step1, step2, step3], deps);
    assertEquals(same, { ok: true, value: 0 });
    await confirmStartup(root);
    assertEquals(await names(`${root}/recovery`), []);
    // 없는 폴더는 오류가 아니다.
    await confirmStartup(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("높은 schema, 다른 hash, 손상된 원본을 구별해 알린다", async () => {
  const root = await Deno.makeTempDir({ prefix: "migration-" });
  const path = `${root}/lophn.db`;
  const clock = manualClock(Date.UTC(2026, 0, 1));
  try {
    const deps = { clock };
    assert((await applyMigrations(path, [step1, step2], deps)).ok);
    const newer = await applyMigrations(path, [step1], deps);
    assert(!newer.ok);
    assertEquals(startFailureReason(newer.error), "newer_schema");
    const other = await applyMigrations(path, [
      { id: "a", sql: "create table a (id text)" },
      step2,
    ], deps);
    assert(!other.ok);
    assertEquals(startFailureReason(other.error), "history_mismatch");
    const damaged = `${root}/damaged.db`;
    await Deno.writeTextFile(damaged, "not a database ".repeat(1000));
    const broken = await applyMigrations(damaged, [step1], deps);
    assert(!broken.ok);
    assertEquals(startFailureReason(broken.error), "damaged_original");
    assertEquals(
      startFailureReason({ code: "internal", message: "x" }),
      "other",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
