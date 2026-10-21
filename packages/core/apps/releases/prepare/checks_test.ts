import { assertEquals, assertStringIncludes } from "@std/assert";
import { sha256Hex } from "../../../../base/mod.ts";
import type {
  BundleManifest,
  DataChange,
} from "../../../../protocol/apps/mod.ts";
import { checkDependencies, checkMigration } from "./checks.ts";

const NOTES = "CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)";

// steps는 `<from>-<to>` 이름과 SQL이다.
async function migrationOk(
  steps: Record<string, string>,
  dataSchema: number,
  previousSchema: number | null,
) {
  const root = await Deno.makeTempDir();
  const area = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${root}/migrations`);
    const dataChanges: DataChange[] = [];
    for (const [name, sql] of Object.entries(steps)) {
      await Deno.writeTextFile(`${root}/migrations/${name}.sql`, sql);
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
    await Deno.remove(root, { recursive: true });
    await Deno.remove(area, { recursive: true });
  }
}

Deno.test("migration 단계가 실패하거나 schema에 닿지 못하는 bundle은 migration 검사에서 떨어진다", async () => {
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
    assertEquals(outcome.ok, expected, label);
    if (!outcome.ok) {
      for (const text of reasons ?? []) {
        assertStringIncludes(outcome.reason, text, label);
      }
    }
  }
});

Deno.test("선언한 @me package와 내장 SDK의 import는 의존성 검사를 통과하고 선언하지 않은 @me import는 떨어진다", () => {
  const declared: BundleManifest["dependencies"] = [
    { name: "@me/date-range", version: "1.0.0", source: "package" },
    { name: "@lophn/ui", version: "0.3.0", source: "sdk" },
  ];
  const cases: [string, Record<string, string>, boolean][] = [
    ["@me", { "@me/date-range": "./sdk/@me/date-range/1.0.0/mod.ts" }, true],
    ["내장", { "@lophn/ui": "./sdk/ui/0.3.0/mod.ts" }, true],
    ["선언 안 한 @me", { "@me/other": "./sdk/@me/other/1.0.0/mod.ts" }, false],
  ];
  for (const [label, imports, expected] of cases) {
    assertEquals(
      checkDependencies({ dependencies: declared, imports }).ok,
      expected,
      label,
    );
  }
});
