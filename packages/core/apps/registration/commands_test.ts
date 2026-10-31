import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { err, ok } from "../../../base/mod.ts";
import { domainProvisioningPort } from "../../../protocol/domains/mod.ts";
import {
  type RequestContext,
  TargetAuthorization,
  type Tx,
} from "../../../protocol/server/mod.ts";
import { createAppCommands } from "./commands.ts";
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
  const domains: Record<string, unknown>[] = [];
  const ports = new Map<unknown, unknown>([
    [TargetAuthorization, () => ok(undefined)],
    [
      domainProvisioningPort,
      {
        create(input: { name: string }) {
          if (domains.some((d) => d.name === input.name)) {
            return err({
              code: "conflict",
              message: "domain name already exists",
            });
          }
          domains.push(input);
          return ok({ id: `dom_${domains.length}` });
        },
      },
    ],
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
    domains,
    apps: () => db.prepare("SELECT slug FROM apps").all().length,
    create: (slug: string) =>
      (create.handle as (...a: unknown[]) => unknown)(
        tx,
        USER,
        { slug, name: `App ${slug}`, description: "does things" },
        {},
      ) as { ok: boolean; value?: { id: string }; error?: { code: string } },
  };
}

test("app.create는 앱 이름의 domain을 함께 만들고, 이미 그 이름이 있으면 앱도 남지 않는다", () => {
  const { create, domains, apps } = open();
  const first = create("first");
  assert.deepStrictEqual(first.ok, true);
  assert.deepStrictEqual(domains, [
    {
      name: "first",
      title: "App first",
      purpose: "does things",
      owner: { kind: "app", id: first.value!.id },
    },
  ]);
  assert.deepStrictEqual(create("first").error?.code, "conflict");
  assert.deepStrictEqual(apps(), 1);
  assert.deepStrictEqual(domains.length, 1);
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
