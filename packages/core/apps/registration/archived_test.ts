import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ok } from "../../../base/mod.ts";
import type { RequestContext } from "../../../protocol/server/mod.ts";
import { TargetAuthorization } from "../../../protocol/server/mod.ts";
import { loadUsages } from "../packages/store.ts";
import { releasesSchemaSteps } from "../releases/schema.ts";
import { createAppsReads } from "./reads.ts";
import { appsSchemaSteps } from "./schema.ts";

const LIVE = "app_01hzzzzzzzzzzzzzzzzzzzzzza";
const OLD = "app_01hzzzzzzzzzzzzzzzzzzzzzzb";

function open() {
  const db = new DatabaseSync(":memory:");
  for (const step of [...appsSchemaSteps, ...releasesSchemaSteps]) {
    db.exec(step.sql);
  }
  for (const [id, slug, status] of [
    [LIVE, "live", "active"],
    [OLD, "old", "archived"],
  ]) {
    db.prepare(
      `INSERT INTO apps (id, slug, name, description, run_enabled, revision, status)
       VALUES (?, ?, ?, 'does things', 0, '1', ?)`,
    ).run(id, slug, slug, status);
  }
  const sql = {
    get: (text: string, params: never[]) =>
      db.prepare(text).get(...params) as never,
    all: (text: string, params: never[]) =>
      db.prepare(text).all(...params) as never,
  };
  return { db, sql };
}

const ctxOf = (actor: string) =>
  ({
    principal: actor,
    actor,
    scope: { operations: [], targets: {} },
    conditions: {},
    credential_ref: "c",
  }) as RequestContext;

// archived 앱을 agent가 보면 되살릴 앱을 agent가 잡게 된다. 되살리기는 사람 화면의 일이라 사람은 계속 본다.
test("archived 앱은 agent의 app read에 not_found이고 목록에서 빠지며 사람은 계속 본다", () => {
  const { sql } = open();
  const reads = createAppsReads();
  const port = (key: unknown) =>
    key === TargetAuthorization ? () => ok(undefined) : undefined;
  const snapshot = { sql, as_of_seq: "1", port } as never;

  const agent = ctxOf("agent:ses_01hzzzzzzzzzzzzzzzzzzzzzza");
  const missing = reads.get.handle(snapshot, agent, { app: OLD });
  assert.ok(!missing.ok);
  assert.deepStrictEqual(missing.error.code, "not_found");
  const live = reads.get.handle(snapshot, agent, { app: LIVE });
  assert.ok(live.ok);
  const agentList = reads.list.handle(snapshot, agent, {});
  assert.ok(agentList.ok);
  assert.deepStrictEqual(
    agentList.value.apps.map((app) => app.id),
    [LIVE],
  );

  const user = ctxOf("user");
  const seen = reads.get.handle(snapshot, user, { app: OLD });
  assert.ok(seen.ok);
  const userList = reads.list.handle(snapshot, user, {});
  assert.ok(userList.ok);
  assert.deepStrictEqual(userList.value.apps.map((app) => app.id).sort(), [
    LIVE,
    OLD,
  ]);
});

test("package 사용처는 active 앱의 켜진 release만 센다", () => {
  const { db, sql } = open();
  const declaration = JSON.stringify({
    sdk_dependencies: [{ name: "@lophn/agent", version: "1.0.0" }],
  });
  let n = 0;
  const release = (app: string, status: string) => {
    n += 1;
    db.prepare(
      `INSERT INTO releases (id, app, number, code_commit, bundle_hash, declaration_hash,
         data_schema, data_changes, created_by, created_at, status, activated_at, declaration, facts)
       VALUES (?, ?, ?, ?, ?, ?, 0, '[]', 'x', ?, ?, '2026-01-01', ?, '{}')`,
    ).run(
      `rel_${n}`,
      app,
      n,
      "c".repeat(40),
      "b".repeat(64),
      "d".repeat(64),
      `2026-01-0${n}`,
      status,
      declaration,
    );
  };
  release(LIVE, "superseded");
  release(LIVE, "active");
  release(OLD, "active");
  assert.deepStrictEqual(loadUsages(sql, "@lophn/agent", "1.0.0"), [
    { app: LIVE, release: "rel_2" },
  ]);
});
