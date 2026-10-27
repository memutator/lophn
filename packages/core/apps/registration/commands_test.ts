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
  return {
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
