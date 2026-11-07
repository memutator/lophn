import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ok, type Result } from "../../../../base/mod.ts";
import type { ReleaseRecord } from "../../../../protocol/apps/mod.ts";
import {
  type RequestContext,
  TargetAuthorization,
  type Tx,
} from "../../../../protocol/server/mod.ts";
import {
  approveShareWithConsent,
  shareLookupPort,
  shareRequestSteps,
} from "../../../approvals/share-requests/mod.ts";
import { assignmentPorts } from "../../../approvals/assignment/mod.ts";
import { appsSchemaSteps } from "../../../apps/registration/schema.ts";
import { bundledShare } from "../../../apps/releases/activation/consents.ts";
import { createReleaseCommands } from "../../../apps/releases/commands.ts";
import { releasesSchemaSteps } from "../../../apps/releases/schema.ts";
import { insertRelease } from "../../../apps/releases/store.ts";
import { afterCommit } from "../../../storage/ledger/after-commit.ts";

const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzza";
const OTHER_APP = "app_01hzzzzzzzzzzzzzzzzzzzzzzb";
const REL = "rel_01hzzzzzzzzzzzzzzzzzzzzz01";
const AGENT = "agt_01hzzzzzzzzzzzzzzzzzzzzzza";
const AT = "2026-11-07T00:00:00.000Z";

const ctxOf = (actor: string): RequestContext => ({
  principal: actor,
  actor,
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: actor,
});

// 사람이 동의 화면에서 본 공유 요청만 동의와 같이 승인된다. 다른 앱의 요청이나 보지 못한 새 요청은 건드리지 않는다.
test("activation consent approves only the share request the person saw for that app", () => {
  const db = new DatabaseSync(":memory:");
  for (const step of [
    ...appsSchemaSteps,
    ...releasesSchemaSteps,
    ...shareRequestSteps,
  ]) {
    db.exec(step.sql);
  }
  for (const id of [APP, OTHER_APP]) {
    db.prepare(
      `INSERT INTO apps VALUES (?, ?, 'n', 'd', NULL, NULL, NULL, 1, '1', 'active')`,
    ).run(id, id.slice(-1));
  }
  const share = (app: string, requestedAt: string) =>
    db
      .prepare(
        `insert into share_requests values (?, ?, 0, '', 'ses_01hzzzzzzzzzzzzzzzzzzzzzza', ?)`,
      )
      .run(app, JSON.stringify([AGENT]), requestedAt);
  const sharing = () =>
    db
      .prepare("select app from share_requests order by app")
      .all()
      .map((row) => row.app);

  const sets: { agent: string; app: string }[] = [];
  const ports = new Map<unknown, unknown>([
    [TargetAuthorization, () => ok(undefined)],
    [afterCommit, { push: () => {} }],
    [
      shareLookupPort,
      {
        app: (id: string) => ({
          name: "n",
          slug: id.slice(-1),
          public_skills: 0,
          public_commands: 0,
        }),
        agent: () => "Reviewer",
      },
    ],
    [
      assignmentPorts,
      {
        get: (agent: string) =>
          ok({ assignment: { agent, entries: [] }, revision: 1 }),
        set: (agent: string, entries: { app: string }[]) => {
          sets.push({ agent, app: entries[0].app });
          return ok({ assignment: { agent, entries }, revision: 2 });
        },
      },
    ],
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
    now: () => AT,
    emit: () => String(++count),
    port: (key: unknown) => ports.get(key),
  } as unknown as Tx;
  // wiring이 꽂는 것과 같은 길이다.
  ports.set(bundledShare, {
    approve: (app: string, requestedAt: string) =>
      approveShareWithConsent(tx, app, requestedAt),
  });

  insertRelease(
    tx,
    {
      id: REL,
      app: APP,
      number: 1,
      code_commit: "0".repeat(40),
      bundle_hash: "0".repeat(64),
      declaration_hash: "0".repeat(64),
      data_schema: 1,
      data_changes: [],
      created_by: "agent:ses_01hzzzzzzzzzzzzzzzzzzzzzza",
      created_at: AT,
      status: "prepared",
    } as unknown as ReleaseRecord,
    JSON.stringify({ tools: [] }),
    {} as never,
  );
  const commands = createReleaseCommands();
  const run = (
    name: "askConsent" | "consent",
    actor: string,
    input: unknown,
    compare: unknown = {},
  ) =>
    (commands[name].handle as (...a: unknown[]) => Result<unknown>)(
      tx,
      ctxOf(actor),
      input,
      compare,
    );
  const ask = () =>
    run("askConsent", "machine", {
      release: REL,
      comparison: {
        previous_release: null,
        first: true,
        added_resources: [],
        added_tools: [],
        loss_steps: [],
      },
    });
  const allow = (share_requested_at?: string) =>
    run(
      "consent",
      "user",
      { release: REL, choice: "allow", share_requested_at },
      { requested_at: AT },
    );
  const waiting = () =>
    Number(
      db
        .prepare(
          "select count(*) as n from activation_consents where allowed_at is null",
        )
        .get()!.n,
    );

  assert.ok(ask().ok);
  share(APP, "2026-11-07T00:00:01.000Z");
  share(OTHER_APP, "2026-11-07T00:00:02.000Z");

  // 새 요청이 대신해 사람이 본 값과 다르면 동의째 conflict이고 아무것도 바뀌지 않는다.
  const stale = allow("2026-11-07T00:00:00.500Z");
  assert.deepStrictEqual(!stale.ok && stale.error.code, "conflict");
  assert.deepStrictEqual(sets, []);
  assert.deepStrictEqual(waiting(), 1);

  // 본 요청이면 같이 승인한다. 다른 앱의 요청은 그대로 남는다.
  assert.ok(allow("2026-11-07T00:00:01.000Z").ok);
  assert.deepStrictEqual(sets, [{ agent: AGENT, app: APP }]);
  assert.deepStrictEqual(sharing(), [OTHER_APP]);
  assert.deepStrictEqual(waiting(), 0);
});
