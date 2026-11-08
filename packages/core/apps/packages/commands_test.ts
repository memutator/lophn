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
  value?: { package: { owner_app: string | null; description: string } };
  error?: { code: string };
};

function open() {
  const db = new DatabaseSync(":memory:");
  for (const step of sdkSchemaSteps) db.exec(step.sql);
  db.exec(`CREATE TABLE events (seq INTEGER PRIMARY KEY);
    CREATE TABLE blob_refs (owner_kind TEXT, owner_key TEXT, field TEXT, hash TEXT,
      PRIMARY KEY (owner_kind, owner_key, field, hash))`);
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
    registerBlobRef: (ref: {
      owner_kind: string;
      owner_key: string;
      field: string;
      source: { blob: { hash: string } };
    }) => {
      db.prepare("INSERT INTO blob_refs VALUES (?, ?, ?, ?)").run(
        ref.owner_kind,
        ref.owner_key,
        ref.field,
        ref.source.blob.hash,
      );
      return { ok: true };
    },
  } as unknown as Tx;
  const handle = createSdkCommands().registerVersion.handle as unknown as (
    ...a: unknown[]
  ) => Out;
  return {
    db,
    register: (
      app: string,
      version: string,
      extra: Record<string, unknown> = {},
    ) =>
      handle(tx, MACHINE, {
        name: "@me/shared",
        description: "Shared code.",
        version,
        owner_app: app,
        bundle_hash: HASH,
        guide_hash: HASH,
        ...extra,
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

test("새 version은 설명을 바꾸고 옛 version의 재시도는 되돌리지 않는다", () => {
  const { db, register } = open();
  register(APP_A, "1.0.0", { description: "first" });
  const added = register(APP_A, "1.1.0", { description: "second" });
  assert.deepStrictEqual(added.value?.package.description, "second");
  const retry = register(APP_A, "1.0.0", { description: "first" });
  assert.deepStrictEqual(retry.ok, true);
  assert.deepStrictEqual(retry.value?.package.description, "second");
  assert.deepStrictEqual(
    (
      db.prepare("SELECT description FROM packages").get() as {
        description: string;
      }
    ).description,
    "second",
  );
});

test("version 목록은 숫자 순서로 돌려준다", () => {
  const { register } = open();
  register(APP_A, "0.9.0");
  const out = register(APP_A, "0.10.0") as unknown as {
    value: { package: { versions: { version: string }[] } };
  };
  assert.deepStrictEqual(
    out.value.package.versions.map((item) => item.version),
    ["0.9.0", "0.10.0"],
  );
});

const BUNDLE_BLOB = {
  preparation: "prep",
  principal: "machine:install",
  purpose: "sdk_bundle",
  hash: HASH,
  size_bytes: 1,
};

test("bundle blob은 같은 등록에서 붙고 재시도와 옛 판 재등록도 한 번만 붙는다", () => {
  const { db, register } = open();
  const refs = () =>
    db.prepare("SELECT field FROM blob_refs WHERE field = 'bundle'").all();
  // 옛 판: blob 없이 등록됐다.
  assert.deepStrictEqual(register(APP_A, "1.0.0").ok, true);
  assert.deepStrictEqual(refs().length, 0);
  // 같은 내용을 bundle blob과 함께 다시 내면 붙는다. 다시 내도 ok이고 하나만 있다.
  assert.deepStrictEqual(
    register(APP_A, "1.0.0", { bundle_blob: BUNDLE_BLOB }).ok,
    true,
  );
  assert.deepStrictEqual(
    register(APP_A, "1.0.0", { bundle_blob: BUNDLE_BLOB }).ok,
    true,
  );
  assert.deepStrictEqual(refs().length, 1);
  // 새 판은 등록과 함께 붙고, hash가 다른 blob은 등록 전체를 거절한다.
  assert.deepStrictEqual(
    register(APP_A, "1.1.0", { bundle_blob: BUNDLE_BLOB }).ok,
    true,
  );
  const wrong = register(APP_A, "1.2.0", {
    bundle_blob: { ...BUNDLE_BLOB, hash: "b".repeat(64) },
  });
  assert.deepStrictEqual(wrong.error?.code, "invalid_input");
});
