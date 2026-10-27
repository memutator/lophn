import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { DomainOwner } from "../../protocol/domains/mod.ts";
import type { RequestContext, Tx } from "../../protocol/server/mod.ts";
import { createDomainCommands } from "./commands.ts";
import { ownerLookupPort } from "./ports.ts";
import { domainsSchemaSteps } from "./schema.ts";

const PROJECT = "prj_01hzzzzzzzzzzzzzzzzzzzzzza";
const OTHER = "prj_01hzzzzzzzzzzzzzzzzzzzzzzb";
const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzza";
const AGENT = "agent:ses_01hzzzzzzzzzzzzzzzzzzzzzza";

function context(actor: string, conditions: RequestContext["conditions"]) {
  return {
    principal: actor,
    actor,
    scope: { operations: [], targets: {} },
    conditions,
    credential_ref: actor,
  } as RequestContext;
}
const USER = context("user", {});

type Out = {
  ok: boolean;
  value?: { id: string; revision: string };
  error?: { code: string };
};

function open() {
  const db = new DatabaseSync(":memory:");
  for (const step of domainsSchemaSteps) db.exec(step.sql);
  let count = 0;
  const ports = new Map<unknown, unknown>([
    [ownerLookupPort, { get: () => ({ status: "active" }) }],
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
  const commands = createDomainCommands();
  const call = (
    handle: unknown,
    ctx: RequestContext,
    input: unknown,
    compare: unknown = {},
  ) => (handle as (...a: unknown[]) => Out)(tx, ctx, input, compare);
  return {
    create: (ctx: RequestContext, name: string, owner: DomainOwner) =>
      call(commands.create.handle, ctx, {
        name,
        title: name,
        purpose: "",
        owner,
      }),
    archive: (id: string, revision: string) =>
      call(commands.archive.handle, USER, { domain: id }, {
        base_revision: revision,
      }),
  };
}

test("앱의 마지막 active domain은 보관되지 않고 project의 마지막 domain은 보관된다", () => {
  const { create, archive } = open();
  const project: DomainOwner = { kind: "project", id: PROJECT as never };
  const app: DomainOwner = { kind: "app", id: APP as never };
  const only = create(USER, "only", project).value!;
  assert.deepStrictEqual(archive(only.id, only.revision).ok, true);

  const first = create(USER, "first", app).value!;
  assert.deepStrictEqual(
    archive(first.id, first.revision).error?.code,
    "conflict",
  );
  const second = create(USER, "second", app).value!;
  assert.deepStrictEqual(archive(first.id, first.revision).ok, true);
  assert.deepStrictEqual(
    archive(second.id, second.revision).error?.code,
    "conflict",
  );
});

test("agent는 자기 그릇이 아닌 owner에 domain을 못 만들고 이름이 겹쳐도 못 만든다", () => {
  const { create } = open();
  const mine: DomainOwner = { kind: "project", id: PROJECT as never };
  const other: DomainOwner = { kind: "project", id: OTHER as never };
  const agent = context(AGENT, { project: PROJECT as never });
  assert.deepStrictEqual(create(agent, "mine", mine).ok, true);
  assert.deepStrictEqual(
    create(agent, "elsewhere", other).error?.code,
    "forbidden",
  );
  assert.deepStrictEqual(
    create(context(AGENT, {}), "free", mine).error?.code,
    "forbidden",
  );
  // 이름은 그릇과 상관없이 전 domain에서 하나다.
  assert.deepStrictEqual(create(USER, "mine", other).error?.code, "conflict");
});
