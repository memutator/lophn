import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { validateDeclaration } from "../declaration/mod.ts";
import { releasesSchemaSteps } from "./schema.ts";

// 옛 release 행의 선언은 `tools`뿐이고 command마다 `domain`이 있다. 새 판이 그 행을 읽고(다음 release 준비의 비교)
// 고정한 hash가 그대로이고 불변 잠금이 살아 있어야 한다.
test("declaration step들은 옛 선언의 tools를 commands로 옮기고 domain을 지워 새 선언 검사를 통과하게 하며 hash는 그대로다", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(releasesSchemaSteps[0].sql);
  const old = {
    name: "Items",
    description: "Keeps items.",
    screens: [],
    tools: [
      {
        name: "list_items",
        title: "List items",
        description: "Lists the items.",
        inputSchema: null,
        outputSchema: { type: "object" },
        effect: "read",
        domain: "items",
        public: true,
      },
    ],
    permissions: [],
    app_connections: [
      { app: "app_01hzzzzzzzzzzzzzzzzzzzzzzb", tools: ["add"], reason: "r" },
    ],
    sdk_dependencies: [],
  };
  db.prepare(
    `INSERT INTO releases (id, app, number, code_commit, bundle_hash, declaration_hash, data_schema,
       data_changes, created_by, created_at, status, activated_at, declaration, facts)
     VALUES ('rel_1', 'app_1', 1, ?, ?, ?, 0, '[]', 'person', 'at', 'active', 'at', ?, '{}')`,
  ).run("0".repeat(40), "0".repeat(64), "0".repeat(64), JSON.stringify(old));
  db.exec(releasesSchemaSteps[1].sql);
  db.exec(releasesSchemaSteps[2].sql);

  const row = db
    .prepare("SELECT declaration, declaration_hash FROM releases")
    .get() as { declaration: string; declaration_hash: string };
  assert.deepStrictEqual(row.declaration_hash, "0".repeat(64));
  const migrated = JSON.parse(row.declaration);
  assert.ok(!("tools" in migrated));
  const checked = validateDeclaration(migrated);
  assert.ok(checked.ok, checked.ok ? "" : checked.error.message);
  assert.deepStrictEqual(checked.value.commands[0], {
    name: "list_items",
    description: "Lists the items.",
    inputSchema: null,
    effect: "read",
    public: true,
  });
  assert.deepStrictEqual(checked.value.app_connections[0].commands, ["add"]);
  assert.throws(
    () => db.exec("UPDATE releases SET declaration = '{}'"),
    /prepared release content is immutable/,
  );
});
