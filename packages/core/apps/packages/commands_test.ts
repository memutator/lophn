import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { RequestContext, Tx } from "../../../protocol/server/mod.ts";
import { createSdkCommands } from "./commands.ts";
import { sdkSchemaSteps } from "./schema.ts";

const APP_A = "app_01hzzzzzzzzzzzzzzzzzzzzzza";
const APP_B = "app_01hzzzzzzzzzzzzzzzzzzzzzzb";
const HASH = "a".repeat(64);
const MACHINE = { actor: "machine:install" } as RequestContext;

type Out = {
  ok: boolean;
  value?: { package: { owner_app: string | null } };
  error?: { code: string };
};

function open() {
  const db = new DatabaseSync(":memory:");
  for (const step of sdkSchemaSteps) db.exec(step.sql);
  let count = 0;
  const tx = {
    sql: {
      run: (text: string, params: never[]) => {
        const done = db.prepare(text).run(...params);
        return { changes: done.changes, lastInsertRowid: done.lastInsertRowid };
      },
      get: (text: string, params: never[]) =>
        db.prepare(text).get(...params) as Record<string, never> | undefined,
      all: (text: string, params: never[]) =>
        db.prepare(text).all(...params) as Record<string, never>[],
    },
    newId: (prefix: string) =>
      `${prefix}_01h${String(++count).padStart(23, "z")}`,
    emit: () => String(++count),
  } as unknown as Tx;
  const handle = createSdkCommands().registerVersion.handle as unknown as (
    ...a: unknown[]
  ) => Out;
  return {
    db,
    register: (app: string, version: string) =>
      handle(tx, MACHINE, {
        name: "@me/shared",
        description: "Shared code.",
        version,
        owner_app: app,
        bundle_hash: HASH,
        guide_hash: HASH,
      }),
  };
}

test("package는 처음 publish한 앱이 주인이고 다른 앱의 새 version은 forbidden이다", () => {
  const { register } = open();
  assert.deepStrictEqual(
    register(APP_A, "1.0.0").value?.package.owner_app,
    APP_A,
  );
  const other = register(APP_B, "1.1.0");
  assert.deepStrictEqual(other.ok, false);
  assert.deepStrictEqual(other.error?.code, "forbidden");
  assert.deepStrictEqual(register(APP_A, "1.1.0").ok, true);
});

test("주인이 없는 package는 다음에 publish한 앱이 주인이 된다", () => {
  const { db, register } = open();
  register(APP_A, "1.0.0");
  db.exec("UPDATE packages SET owner_app = NULL");
  assert.deepStrictEqual(
    register(APP_B, "1.1.0").value?.package.owner_app,
    APP_B,
  );
});
