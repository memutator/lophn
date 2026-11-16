import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { ok } from "../../../base/mod.ts";
import {
  type RequestContext,
  TargetAuthorization,
  type Tx,
} from "../../../protocol/server/mod.ts";
import { createAppCommands } from "./commands.ts";
import { FOLDER_APPS_CONTEXT } from "./folder-take-in.ts";
import { appsSchemaSteps } from "./schema.ts";
import { loadAppIcon } from "./store.ts";

const USER: RequestContext = {
  principal: "user",
  actor: "user",
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: "user",
};

function open() {
  const db = new DatabaseSync(":memory:");
  for (const step of appsSchemaSteps) db.exec(step.sql);
  let count = 0;
  const ports = new Map<unknown, unknown>([
    [TargetAuthorization, () => ok(undefined)],
  ]);
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
    port: (key: unknown) => ports.get(key),
  } as unknown as Tx;
  const create = createAppCommands().create;
  const setIcon = createAppCommands().setIcon;
  return {
    sql: tx.sql,
    setIcon: (app: string, icon: unknown) =>
      (setIcon.handle as (...a: unknown[]) => unknown)(
        tx,
        USER,
        { app, icon },
        {},
      ) as { ok: boolean; error?: { code: string } },
    apps: () => db.prepare("SELECT slug FROM apps").all().length,
    create: (slug: string, ctx = USER, id?: string) =>
      (create.handle as (...a: unknown[]) => unknown)(
        tx,
        ctx,
        {
          slug,
          name: `App ${slug}`,
          description: "does things",
          ...(id === undefined ? {} : { id }),
        },
        {},
      ) as { ok: boolean; value?: { id: string }; error?: { code: string } },
  };
}

test("app.create는 이미 있는 slug면 conflict이고 앱이 늘지 않는다", () => {
  const { create, apps } = open();
  assert.deepStrictEqual(create("first").ok, true);
  assert.deepStrictEqual(create("first").error?.code, "conflict");
  assert.deepStrictEqual(apps(), 1);
});

// 내장 명령 이름과 같은 slug는 `lophn <slug> <command>`가 내장 명령인지 앱 command인지 가를 수 없게 만든다.
test("예약어 slug의 app.create는 invalid_input이고 앱이 남지 않는다", () => {
  const { create, apps } = open();
  assert.deepStrictEqual(create("run").error?.code, "invalid_input");
  assert.deepStrictEqual(apps(), 0);
});

test("app.set_icon은 큰 파일과 이미지 아닌 것을 invalid_input으로 거절하고, 없는 앱은 not_found다", () => {
  const { create, setIcon, sql } = open();
  const app = create("first").value!.id;
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
  const big = Buffer.concat([png, Buffer.alloc(64 * 1024)]);
  const bad = (icon: unknown) => setIcon(app, icon).error?.code;
  assert.strictEqual(
    bad({ content_type: "image/png", data: big.toString("base64") }),
    "invalid_input",
  );
  assert.strictEqual(
    bad({ content_type: "text/html", data: png.toString("base64") }),
    "invalid_input",
  );
  // 선언한 type과 바이트가 다르면 거절한다.
  assert.strictEqual(
    bad({ content_type: "image/webp", data: png.toString("base64") }),
    "invalid_input",
  );
  assert.strictEqual(loadAppIcon(sql, app), null);

  const icon = { content_type: "image/png", data: png.toString("base64") };
  assert.strictEqual(setIcon(app, icon).ok, true);
  assert.deepStrictEqual(loadAppIcon(sql, app), icon);
  assert.strictEqual(setIcon(app, null).ok, true);
  assert.strictEqual(loadAppIcon(sql, app), null);
  assert.strictEqual(setIcon("app_none", icon).error?.code, "not_found");
});

// 앱 id는 기계 사이 같은 앱의 신분이다. 다른 기계의 앱을 들이는 폴더 take-in 말고 누가 id를 정하면 남의 앱 자리를 차지한다.
test("app.create의 id는 폴더 take-in 자격만 정하고 사람, agent, 다른 machine 자격은 거절된다", () => {
  const { create, apps } = open();
  const id = "app_01hzzzzzzzzzzzzzzzzzzzzzzz";
  const agent = {
    ...USER,
    principal: "agent:ses_01hzzzzzzzzzzzzzzzzzzzzzzz",
    actor: "agent:ses_01hzzzzzzzzzzzzzzzzzzzzzzz",
  };
  const otherMachine = {
    ...FOLDER_APPS_CONTEXT,
    principal: "machine:apps-source",
    credential_ref: "machine:apps-source",
  };
  for (const ctx of [USER, agent, otherMachine]) {
    assert.deepStrictEqual(
      create("taken", ctx, id).error?.code,
      "forbidden",
      ctx.principal,
    );
  }
  // take-in 자격도 id 없이 만들지 못한다.
  assert.deepStrictEqual(
    create("taken", FOLDER_APPS_CONTEXT).error?.code,
    "forbidden",
  );
  assert.deepStrictEqual(apps(), 0);
  const taken = create("taken", FOLDER_APPS_CONTEXT, id);
  assert.deepStrictEqual(taken.value?.id, id);
});
