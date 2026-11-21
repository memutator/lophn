import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { sha256Hex } from "../../../../base/mod.ts";
import type { DataChange } from "../../../../protocol/apps/mod.ts";
import { checkMigration, syncSdkFloorProblem } from "./checks.ts";

const NOTES = "CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)";

// steps는 `<from>-<to>` 이름과 SQL이다.
async function migrationOk(
  steps: Record<string, string>,
  dataSchema: number,
  previousSchema: number | null,
  runsOn: string[] = ["computer"],
  sync?: Record<string, string>,
) {
  // mkdtemp의 prefix는 구분자로 끝나야 임시 폴더가 tmpdir 안에 생긴다(join은 끝 구분자를 지운다).
  const root = await mkdtemp(`${tmpdir()}/`);
  const area = await mkdtemp(`${tmpdir()}/`);
  try {
    await mkdir(`${root}/migrations`);
    await writeFile(
      `${root}/declaration.json`,
      JSON.stringify({
        runs_on: runsOn,
        ...(sync === undefined ? {} : { sync }),
      }),
    );
    const dataChanges: DataChange[] = [];
    for (const [name, sql] of Object.entries(steps)) {
      await writeFile(`${root}/migrations/${name}.sql`, sql);
      const [from, to] = name.split("-").map(Number);
      dataChanges.push({
        from,
        to,
        script_hash: await sha256Hex(sql),
        description: name,
      });
    }
    const outcome = await checkMigration({
      bundleRoot: root,
      dataChanges,
      dataSchema,
      previousSchema,
      area,
    });
    return outcome;
  } finally {
    await rm(root, { recursive: true });
    await rm(area, { recursive: true });
  }
}

test("migration 단계가 실패하거나 schema에 닿지 못하는 bundle은 migration 검사에서 떨어진다", async () => {
  const add = "ALTER TABLE notes ADD COLUMN done INTEGER NOT NULL DEFAULT 0";
  const cases: [
    string,
    Record<string, string>,
    number,
    number | null,
    boolean,
    string[]?,
  ][] = [
    ["맞는 bundle", { "0-1": NOTES, "1-2": add }, 2, 1, true],
    [
      "단계 실패",
      {
        "0-1": NOTES,
        "1-2": "ALTER TABLE missing ADD COLUMN x INTEGER",
      },
      2,
      1,
      false,
      ["1-2", "no such table: missing"],
    ],
    [
      "PRIMARY KEY 없는 표",
      { "0-1": "CREATE TABLE notes (body TEXT)" },
      1,
      null,
      false,
      ["0-1", "notes"],
    ],
    ["빈 DB에서 닿지 못함", { "1-2": add }, 2, null, false],
    ["active release schema가 길 위에 없음", { "0-2": NOTES }, 2, 1, false],
  ];
  for (const [label, steps, dataSchema, previous, expected, reasons] of cases) {
    const outcome = await migrationOk(steps, dataSchema, previous);
    assert.deepStrictEqual(outcome.ok, expected, label);
    if (!outcome.ok) {
      for (const text of reasons ?? []) {
        assert.ok(outcome.reason.includes(text), label);
      }
    }
  }
});

// 폰에서도 도는 앱의 schema는 두 기기가 만든 행이 겹치지 않게 text key만 쓰고 trigger가 없어야 한다. 같은 SQL이 컴퓨터에서만 도는 앱에는 괜찮다.
test("runs_on에 phone이 있거나 sync가 그 표를 보내는 앱은 정수 PK, AUTOINCREMENT, trigger가 있으면 migration 검사에서 떨어지고, phone이 없고 그 표를 보내지 않는 앱은 통과한다", async () => {
  const cases: [string, string, string][] = [
    ["정수 PK", "CREATE TABLE a (id INTEGER PRIMARY KEY, b TEXT)", "INTEGER"],
    [
      "AUTOINCREMENT",
      "CREATE TABLE a (id INTEGER PRIMARY KEY AUTOINCREMENT, b TEXT)",
      "AUTOINCREMENT",
    ],
    [
      "trigger",
      "CREATE TABLE a (id TEXT PRIMARY KEY, b TEXT); CREATE TRIGGER t AFTER INSERT ON a BEGIN UPDATE a SET b = 'x'; END",
      "Triggers are not allowed",
    ],
  ];
  for (const [label, sql, reason] of cases) {
    const phone = await migrationOk({ "0-1": sql }, 1, null, [
      "computer",
      "phone",
    ]);
    assert.ok(!phone.ok && phone.reason.includes(reason), label);
    assert.ok((await migrationOk({ "0-1": sql }, 1, null)).ok, label);
    // sync가 그 표를 보내는 앱도 같은 규칙이다: 두 컴퓨터가 같은 정수 id를 만들면 행을 잃는다.
    const folder = await migrationOk({ "0-1": sql }, 1, null, ["computer"], {
      a: "personal",
    });
    assert.ok(!folder.ok && folder.reason.includes(reason), label);
    // 규칙은 보내는 표에만 건다. 보내지 않는 표 a는 이 컴퓨터를 떠나지 않는다.
    const local = await migrationOk(
      { "0-1": `${sql}; CREATE TABLE c (id TEXT PRIMARY KEY)` },
      1,
      null,
      ["computer"],
      { c: "personal" },
    );
    assert.ok(local.ok, label);
  }
  const missing = await migrationOk(
    { "0-1": "CREATE TABLE a (id TEXT PRIMARY KEY)" },
    1,
    null,
    ["computer"],
    { gone: "personal" },
  );
  assert.ok(!missing.ok && missing.reason.includes("sync lists table gone"));
  const text = "CREATE TABLE a (id TEXT PRIMARY KEY, b TEXT)";
  assert.ok((await migrationOk({ "0-1": text }, 1, null, ["phone"])).ok);
});

test("sync가 표를 보내는 앱(폰 밖)은 cap-store 2.0.0 하한을 걸어야 하고 cap-tool은 요구하지 않는다", () => {
  const pin = (version: string) => ({
    sync: { notes: "personal" },
    sdk_dependencies: [{ name: "@lophn/cap-store", version }],
  });
  assert.ok(syncSdkFloorProblem(pin("1.9.0"))?.includes("sync sends tables"));
  assert.equal(syncSdkFloorProblem(pin("2.0.0")), null);
  assert.equal(syncSdkFloorProblem({ sdk_dependencies: [] }), null);
});
