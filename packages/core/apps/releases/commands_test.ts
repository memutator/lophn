import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import type { Result } from "../../../base/mod.ts";
import type { ReleaseRecord } from "../../../protocol/apps/mod.ts";
import {
  type RequestContext,
  TargetAuthorization,
  type Tx,
} from "../../../protocol/server/mod.ts";
import { afterCommit } from "../../storage/ledger/after-commit.ts";
import {
  noticeSchemaSteps,
  noticeUnifiedSchemaSteps,
} from "../notices/schema.ts";
import { appsSchemaSteps } from "../registration/schema.ts";
import { createReleaseCommands } from "./commands.ts";
import { releasesSchemaSteps } from "./schema.ts";
import { insertRelease } from "./store.ts";

const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzza";
const REL = "rel_01hzzzzzzzzzzzzzzzzzzzzz01";

const machine: RequestContext = {
  principal: "machine",
  actor: "machine",
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: "machine",
};

// activation 실패 한 번이 사람의 기록에 한 줄로 남는다(응답을 잃은 재전송이 줄을 늘리지 않는다).
test("a failed activation records exactly one release_failed row", () => {
  const db = new DatabaseSync(":memory:");
  for (const step of [
    ...appsSchemaSteps,
    ...releasesSchemaSteps,
    ...noticeSchemaSteps,
    ...noticeUnifiedSchemaSteps,
  ]) {
    db.exec(step.sql);
  }
  db.prepare(
    `INSERT INTO apps VALUES (?, 'slug', 'n', 'd', NULL, NULL, NULL, 1, '1', 'active')`,
  ).run(APP);
  const ports = new Map<unknown, unknown>([
    [TargetAuthorization, () => ({ ok: true, value: undefined })],
    [afterCommit, { push: () => {} }],
  ]);
  let count = 0;
  const tx = {
    sql: {
      run: (text: string, params: never[]) => db.prepare(text).run(...params),
      get: (text: string, params: never[]) =>
        db.prepare(text).get(...params) as Record<string, never> | undefined,
      all: (text: string, params: never[]) =>
        db.prepare(text).all(...params) as Record<string, never>[],
    },
    newId: (prefix: string) =>
      `${prefix}_01h${String(++count).padStart(23, "z")}`,
    now: () => "2026-10-16T00:00:00.000Z",
    emit: () => String(++count),
    port: (key: unknown) => ports.get(key),
  } as unknown as Tx;
  insertRelease(
    tx,
    {
      id: REL,
      app: APP,
      number: 3,
      code_commit: "0".repeat(40),
      bundle_hash: "0".repeat(64),
      declaration_hash: "0".repeat(64),
      data_schema: 1,
      data_changes: [],
      created_by: "agent:ses_01hzzzzzzzzzzzzzzzzzzzzzza",
      created_at: "2026-10-16T00:00:00.000Z",
      status: "prepared",
    } as unknown as ReleaseRecord,
    JSON.stringify({ tools: [] }),
    {} as never,
  );
  const commands = createReleaseCommands();
  const call = (
    command: "startActivation" | "failActivation",
    input: unknown,
  ) =>
    (commands[command].handle as (...a: unknown[]) => Result<never>)(
      tx,
      machine,
      input,
      {},
    );

  const started = call("startActivation", { release: REL, key: "k" });
  assert.ok(started.ok);
  const failed = {
    release: REL,
    attempt: (started.value as { attempt: string }).attempt,
    failure: { code: "start_failed", summary: "ready timeout", restored: null },
  };
  assert.ok(call("failActivation", failed).ok);
  assert.ok(call("failActivation", failed).ok);

  const rows = db
    .prepare("select source, app, kind, title, body from notices")
    .all()
    .map((row) => ({ ...row }));
  assert.deepStrictEqual(rows, [
    {
      source: "program",
      app: APP,
      kind: "release_failed",
      title: "Release r3 failed",
      body: "ready timeout",
    },
  ]);
});
