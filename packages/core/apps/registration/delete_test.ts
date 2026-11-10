import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { ok } from "../../../base/mod.ts";
import { appRemnantsEraser } from "../../../protocol/apps/mod.ts";
import {
  type RequestContext,
  TargetAuthorization,
  type Tx,
} from "../../../protocol/server/mod.ts";
import { afterCommit } from "../../storage/ledger/after-commit.ts";
import { LEDGER_SCHEMA_STEPS } from "../../storage/ledger/schema.ts";
import { annotationSchemaSteps } from "../annotations/schema.ts";
import { dataSchemaSteps } from "../data/schema.ts";
import { eventPublicationSchemaSteps } from "../events/schema.ts";
import {
  invocationEventCallerSchemaSteps,
  invocationsSchemaSteps,
} from "../invocations/schema.ts";
import {
  noticeSchemaSteps,
  noticeUnifiedSchemaSteps,
} from "../notices/schema.ts";
import { sdkSchemaSteps } from "../packages/schema.ts";
import { sdkReviewSchemaSteps } from "../sdk-status/schema.ts";
import { permissionsSchemaSteps } from "../permissions/schema.ts";
import { releasesSchemaSteps } from "../releases/schema.ts";
import { rewindSchemaSteps } from "../rewind/schema.ts";
import { createAppCommands } from "./commands.ts";
import { appDeleteSchemaSteps, appsSchemaSteps } from "./schema.ts";

const USER = ctxOf("user");
const AGENT = ctxOf("agent:ses_01hzzzzzzzzzzzzzzzzzzzzzza");
const GONE = "app_01hzzzzzzzzzzzzzzzzzzzzzza";
const KEPT = "app_01hzzzzzzzzzzzzzzzzzzzzzzb";

function ctxOf(actor: string): RequestContext {
  return {
    principal: actor,
    actor,
    scope: { operations: [], targets: {} },
    conditions: {},
    credential_ref: actor,
  };
}

// 실제 ledger와 같은 순서로 step을 적용한 DB에 두 앱의 기록을 넣는다.
function open(status: "active" | "archived") {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("create table schema_migrations (version integer primary key)");
  // annotation의 옛 step이 읽는 옛 표다.
  db.exec("create table domains (id text, owner_kind text, owner_id text)");
  for (const step of [
    ...LEDGER_SCHEMA_STEPS,
    ...appsSchemaSteps,
    ...releasesSchemaSteps,
    ...permissionsSchemaSteps,
    ...invocationsSchemaSteps,
    ...rewindSchemaSteps,
    ...dataSchemaSteps,
    ...noticeSchemaSteps,
    ...annotationSchemaSteps,
    ...noticeUnifiedSchemaSteps,
    ...appDeleteSchemaSteps,
    ...sdkSchemaSteps,
    ...sdkReviewSchemaSteps,
    ...invocationEventCallerSchemaSteps,
    ...eventPublicationSchemaSteps,
  ]) {
    db.exec(step.sql);
  }
  for (const [id, slug, appStatus] of [
    [GONE, "gone", status],
    [KEPT, "kept", "active"],
  ]) {
    db.prepare(
      `INSERT INTO apps (id, slug, name, description, run_enabled, revision, status)
       VALUES (?, ?, ?, 'does things', 0, '1', ?)`,
    ).run(id, slug, slug, appStatus);
    db.prepare(
      `INSERT INTO releases (id, app, number, code_commit, bundle_hash, declaration_hash,
         data_schema, data_changes, created_by, created_at, status, declaration, facts)
       VALUES (?, ?, 1, ?, ?, ?, 0, '[]', 'x', '2026-01-01', 'prepared', '{}', '{}')`,
    ).run(`rel_${slug}`, id, "c".repeat(40), "b".repeat(64), "d".repeat(64));
    db.prepare(
      `INSERT INTO activation_requests (release, requested_at) VALUES (?, '2026-01-01')`,
    ).run(`rel_${slug}`);
    db.prepare(
      `INSERT INTO grants (id, app, kind, scope, status, created_at)
       VALUES (?, ?, 'net.fetch', 'x', 'active', '2026-01-01')`,
    ).run(`grt_${slug}`, id);
    db.prepare(
      `INSERT INTO invocations (id, app, release, mode, operation, effect, status, summary)
       VALUES (?, ?, ?, 'live', '{}', 'write', 'running', 's')`,
    ).run(`inv_${slug}`, id, `rel_${slug}`);
    db.prepare(
      `INSERT INTO blob_refs (owner_kind, owner_key, field, hash, size_bytes, registered_seq)
       VALUES ('invocation', ?, 'changeset', ?, 1, 1)`,
    ).run(`inv_${slug}`, slug.padEnd(64, "0"));
    db.prepare(
      `INSERT INTO notices (id, source, app, kind, title, body, persistent, created_at)
       VALUES (?, 'app', ?, 'app', 't', 'b', 1, '2026-01-01')`,
    ).run(`ntc_${slug}`, id);
    db.prepare(
      `INSERT INTO sdk_reviews (id, app, session, decision, through, created_at)
       VALUES (?, ?, 'ses_x', 'leave', '{}', '2026-01-01')`,
    ).run(`sdr_${slug}`, id);
    db.prepare(
      `INSERT INTO sdk_features (id, review, app, title, proposal, note_file, state, state_at)
       VALUES (?, ?, ?, 't', 'p', 'n.md', 'open', '2026-01-01')`,
    ).run(`sdf_${slug}`, `sdr_${slug}`, id);
  }
  // program 줄은 기록이라 지우는 길이 없다.
  db.prepare(
    `INSERT INTO notices (id, source, app, kind, title, body, persistent, created_at)
     VALUES ('ntc_program', 'program', ?, 'release_activated', 't', 'b', 1, '2026-01-01')`,
  ).run(GONE);
  for (const [id, owner] of [
    ["pkg_gone", GONE],
    ["pkg_kept", KEPT],
  ]) {
    db.prepare(
      `INSERT INTO packages (id, name, description, owner_app) VALUES (?, ?, 'd', ?)`,
    ).run(id, `@me/${id}`, owner);
    db.prepare(
      `INSERT INTO package_versions (package, version, bundle_hash, guide_hash) VALUES (?, '1.0.0', ?, ?)`,
    ).run(id, "a".repeat(64), "b".repeat(64));
  }

  let count = 0;
  const erased: string[] = [];
  const ports = new Map<unknown, unknown>([
    [TargetAuthorization, () => ok(undefined)],
    [afterCommit, { push: () => {} }],
    [
      appRemnantsEraser,
      {
        erase: (app: { id: string }) => {
          erased.push(app.id);
          return ok({ sessions: [] });
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
    now: () => "2026-02-01T00:00:00.000Z",
    emit: () => String(++count),
    port: (key: unknown) => ports.get(key),
  } as unknown as Tx;
  const remove = createAppCommands().delete;
  return {
    db,
    erased,
    remove: (ctx: RequestContext) =>
      (remove.handle as (...a: unknown[]) => unknown)(
        tx,
        ctx,
        { app: GONE },
        { base_revision: "1" },
      ) as { ok: boolean; error?: { code: string } },
    rows: (table: string, app: string, column = "app") =>
      db
        .prepare(`SELECT count(*) AS n FROM ${table} WHERE ${column} = ?`)
        .get(app)!.n as number,
  };
}

const OWNED = [
  ["releases", "app"],
  ["grants", "app"],
  ["invocations", "app"],
  ["notices", "app"],
  ["sdk_reviews", "app"],
  ["sdk_features", "app"],
  ["apps", "id"],
] as const;

test("활성 앱의 app.delete는 conflict이고 아무것도 지우지 않는다", () => {
  const t = open("active");
  assert.strictEqual(t.remove(USER).error?.code, "conflict");
  for (const [table, column] of OWNED) {
    assert.ok(t.rows(table, GONE, column) > 0, table);
  }
  assert.deepStrictEqual(t.erased, []);
});

test("agent는 app.delete로 앱을 지우지 못한다", () => {
  const t = open("archived");
  assert.strictEqual(t.remove(AGENT).error?.code, "forbidden");
  assert.strictEqual(t.rows("apps", GONE, "id"), 1);
  assert.deepStrictEqual(t.erased, []);
});

// core가 꺼질 때는 AppStopped를 남기지 않아 보관한 앱에 옛 AppStarted가 남을 수 있다. 살아 있는 process만 막는다.
test("마지막 ledger 사실이 AppStarted여도 지금 process가 없으면 보관한 앱을 지운다", () => {
  const t = open("archived");
  t.db
    .prepare(
      `INSERT INTO events (type, subject, actor, payload, at)
       VALUES ('AppStarted', ?, 'machine', '{"release":"rel_gone","process_nonce":"n1"}', '2026-01-01')`,
    )
    .run(GONE);
  assert.strictEqual(t.remove(USER).ok, true);
  assert.strictEqual(t.rows("apps", GONE, "id"), 0);
});

test("보관한 앱을 지우면 그 앱의 기록만 지우고 다른 앱과 program 기록은 남는다", () => {
  const t = open("archived");
  assert.strictEqual(t.remove(USER).ok, true);
  assert.deepStrictEqual(t.erased, [GONE]);
  for (const [table, column] of OWNED) {
    // program 줄 하나는 기록이라 남는다.
    const left = table === "notices" ? 1 : 0;
    assert.strictEqual(t.rows(table, GONE, column), left, table);
    assert.strictEqual(
      t.rows(table, KEPT, column),
      1,
      `${table} of the other app`,
    );
  }
  assert.strictEqual(t.rows("activation_requests", "rel_gone", "release"), 0);
  assert.strictEqual(t.rows("blob_refs", "inv_gone", "owner_key"), 0);
  assert.strictEqual(t.rows("blob_refs", "inv_kept", "owner_key"), 1);
  // 공개한 package와 판은 남고, 지운 앱이 주인이던 package는 다음에 publish한 앱이 이어받도록 주인이 빈다.
  const owners = t.db
    .prepare("SELECT id, owner_app FROM packages ORDER BY id")
    .all()
    .map((row) => [row["id"], row["owner_app"]]);
  assert.deepStrictEqual(owners, [
    ["pkg_gone", null],
    ["pkg_kept", KEPT],
  ]);
  assert.strictEqual(t.rows("package_versions", "pkg_gone", "package"), 1);
  // erase 창은 닫혀 있다: 평소의 DELETE는 여전히 막힌다.
  assert.throws(() => t.db.exec("DELETE FROM apps WHERE id = '" + KEPT + "'"));
  assert.throws(() => t.db.exec("DELETE FROM releases"));
  assert.throws(() => t.db.exec("DELETE FROM invocations"));
});
