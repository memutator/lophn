import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { err, ok } from "../../../base/mod.ts";
import {
  appSdkFeature,
  appSdkReviewRecord,
} from "../../../protocol/apps/sdk-status.ts";
import type { FollowUpWorkspace } from "../../../protocol/base/mod.ts";
import { DEFAULT_CALL_POLICY } from "../../../protocol/lophn-agent/call-policy.ts";
import type { AgentCallRow } from "../../../protocol/lophn-agent/calls.ts";
import {
  followUpList,
  followUpReport,
} from "../../../protocol/lophn-agent/follow-ups.ts";
import {
  type CommandDefinition,
  type ReadDefinition,
  TargetAuthorization,
  type Tx,
} from "../../../protocol/server/mod.ts";
import {
  followUpCommands,
  followUpPorts,
  followUpReads,
  insertFlowSdkReview,
  insertFollowUp,
  insertPlatformReview,
  loadLastFlowSdkReview,
  loadLastPlatformReview,
  WORKSPACE_LIFECYCLE_SCHEMA_STEP,
} from "../../follow-ups/mod.ts";
import { installRouterEnvironment } from "../../router/environment.ts";
import type { TargetSession } from "../../router/ports.ts";
import { createTargetAuthorizer } from "../../storage/ledger/target-authorization.ts";
import { appsSchemaSteps } from "../registration/schema.ts";
import { sdkReviewCommands } from "./commands.ts";
import { loadLastReview } from "./review-store.ts";
import { sdkReviewSchemaSteps } from "./schema.ts";

const id = (prefix: string, n: number) =>
  `${prefix}_${String(n).padStart(26, "0")}`;
const APP = id("app", 1);
const OTHER = id("app", 2);
const PROJECT = id("prj", 1);
const SESSION = id("ses", 1);
const HOME_SESSION = id("ses", 10);
const PROJECT_SESSION = id("ses", 11);
const APP_SESSION = id("ses", 12);
const TURN = id("trn", 1);

function world(refuse: boolean) {
  const db = new DatabaseSync(":memory:");
  for (const step of [
    ...appsSchemaSteps,
    ...sdkReviewSchemaSteps,
    WORKSPACE_LIFECYCLE_SCHEMA_STEP,
  ]) {
    db.exec(step.sql);
  }
  for (const [app, slug] of [
    [APP, "masup"],
    [OTHER, "mahas"],
  ]) {
    db.prepare(
      `insert into apps (id, slug, name, description, run_enabled, revision, status)
       values (?, ?, ?, 'an app', 1, '1', 'active')`,
    ).run(app, slug, slug);
  }
  const rows = new Map<string, AgentCallRow>();
  const target: TargetSession = {
    session: id("ses", 2) as TargetSession["session"],
    transport: "lophn",
    agent: { agent: "lophn_app", workspace: null },
    accepting: true,
    open: true,
    spawned_by: null,
    opened_by_machine: null,
    runs_on: null,
  };
  installRouterEnvironment({
    unattendedTurn: () => false,
    deps: () => ({
      callPolicy: () => DEFAULT_CALL_POLICY,
      announce: () => {},
      directory: {
        find: () => target,
        // 거절은 call 정책(private)이나 없는 곳이 router 안에서 내는 오류와 같은 길로 돌아온다.
        resolveAddress: () =>
          refuse
            ? err({ code: "forbidden" as const, message: "private" })
            : ok({ agent: "lophn_app", workspace: null }),
        archive: () => ok(false),
        membersOn: () => [],
        membersFrom: () => [],
        membersUnder: () => [],
        setWorkflowOrigin: () => {},
        openMember: () =>
          err({ code: "forbidden", message: "not in this test" }),
        open: () => ok(target),
        accepts: () => null,
        listOpen: () => [],
        app: () => null,
        projectOfIdentity: () => null,
        identityOfProject: () => ok("pri_test"),
        appIdOf: () => err({ code: "not_found", message: "app not found" }),
      },
      outbox: {} as never,
      seen: {} as never,
      self: () => "mch_self",
      steps: {} as never,
      transport: {
        deliver: () => ok(undefined),
        cancel: () => ok(undefined),
        withdraw: () => ok(undefined),
      },
      store: {
        insert: (_tx, record) => {
          rows.set(record.call, record);
          return ok(undefined);
        },
        byDedup: () => null,
        read: (_tx, call) => rows.get(call) ?? null,
        memberCall: () => null,
        move: (_tx, call, to, reason) => {
          const moved = { ...rows.get(call)!, state: to, fail_reason: reason };
          rows.set(call, moved);
          return ok(moved);
        },
        consumed: () => true,
        markConsumed: () => ok(undefined),
        setDelivery: () => ok(undefined),
        lost: () => [],
        openReceivedBy: () => [],
        openAsksSentBy: () => [],
        openSentFromRemote: () => [],
      },
    }),
  });
  let counter = 100;
  const sql = {
    run: (text: string, params: never[]) => db.prepare(text).run(...params),
    get: (text: string, params: never[]) =>
      db.prepare(text).get(...params) as Record<string, never> | undefined,
    all: (text: string, params: never[]) =>
      db.prepare(text).all(...params) as Record<string, never>[],
  };
  const portOf = (ctx: unknown) => (key: unknown) =>
    key === TargetAuthorization
      ? createTargetAuthorizer(ctx as never)
      : { principal: () => "machine:sdk-review" };
  const txFor = (ctx: unknown) =>
    ({
      sql,
      now: () => "2026-11-11T00:00:00.000Z",
      newId: (prefix: string) => id(prefix, ++counter),
      port: portOf(ctx),
    }) as unknown as Tx;
  const count = (table: string) =>
    Number(db.prepare(`select count(*) as n from ${table}`).get()!["n"]);
  return { sql, txFor, count };
}

const machine = {
  principal: "machine:sdk-review",
  actor: "machine",
  scope: { operations: [appSdkReviewRecord.name], targets: {} },
  conditions: {},
  credential_ref: "machine:sdk-review",
} as never;

const update = (featureId: string) => ({
  app: APP,
  session: SESSION,
  turn: TURN,
  decision: "update" as const,
  through: { "@lophn/app-ui": "2.13.0" },
  features: [
    {
      id: featureId,
      title: "Tray popup",
      proposal: "Show the daily total from the tray.",
      note: "app-ui-2.11.0.md",
    },
  ],
  body: [{ type: "text" as const, text: "handoff" }],
});

const record = sdkReviewCommands.recordReview as unknown as CommandDefinition<
  typeof appSdkReviewRecord
>;
const feature = sdkReviewCommands.recordFeature as unknown as CommandDefinition<
  typeof appSdkFeature
>;

// 기록과 handoff는 한 동작이다. 거절된 handoff 뒤에 결정이 남으면 다음 round가 맡긴 일이 있다고 믿는다.
test("an update whose handoff call is refused leaves no review and no feature", () => {
  const refused = world(true);
  const done = record.handle(
    refused.txFor(machine),
    machine,
    update(id("sdf", 1)),
    {} as never,
  );
  assert.deepStrictEqual(done.ok, false);
  assert.deepStrictEqual(
    [refused.count("sdk_reviews"), refused.count("follow_up_items")],
    [0, 0],
  );

  const accepted = world(false);
  const ok2 = record.handle(
    accepted.txFor(machine),
    machine,
    update(id("sdf", 1)),
    {} as never,
  );
  assert.ok(ok2.ok);
  assert.deepStrictEqual(
    [accepted.count("sdk_reviews"), accepted.count("follow_up_items")],
    [1, 1],
  );
  const stored = accepted.sql.get(
    "select state, outcome, origin, workspace_kind, workspace_id from follow_up_items",
    [],
  );
  assert.deepStrictEqual(
    {
      state: stored?.["state"],
      outcome: stored?.["outcome"],
      origin: stored?.["origin"],
      workspace_kind: stored?.["workspace_kind"],
      workspace_id: stored?.["workspace_id"],
    },
    {
      state: "open",
      outcome: null,
      origin: "app_sdk",
      workspace_kind: "app",
      workspace_id: APP,
    },
  );
  const last = loadLastReview(accepted.sql, APP);
  assert.ok(last !== null);
  assert.strictEqual(last.features.length, 1);
  assert.strictEqual(last.features[0]?.id, id("sdf", 1));
});

// 앱 lophn은 자기 앱의 기능만 고친다. 다른 앱의 기능 결과를 쓰면 그 앱의 끝난 일이 바뀐다.
test("lophn at one app cannot report the result of another app's feature", () => {
  const w = world(false);
  const made = record.handle(
    w.txFor(machine),
    machine,
    { ...update(id("sdf", 1)), app: OTHER },
    {} as never,
  );
  assert.ok(made.ok);
  const as = (app: string) =>
    ({
      principal: "agent",
      actor: `agent:${SESSION}`,
      scope: { operations: [appSdkFeature.name], targets: {} },
      conditions: { session: SESSION, turn: TURN, app },
      credential_ref: "agent",
    }) as never;
  const input = { feature: id("sdf", 1), state: "done" as const };
  const wrong = feature.handle(w.txFor(as(APP)), as(APP), input, {} as never);
  assert.ok(!wrong.ok);
  assert.ok(["forbidden", "not_found"].includes(wrong.error.code));
  assert.strictEqual(
    w.sql.get("select state from follow_up_items", [])?.["state"],
    "open",
  );
  const right = feature.handle(
    w.txFor(as(OTHER)),
    as(OTHER),
    input,
    {} as never,
  );
  assert.ok(right.ok);
  assert.strictEqual(
    w.sql.get("select state from follow_up_items", [])?.["state"],
    "done",
  );
});

test("WORKSPACE_LIFECYCLE_SCHEMA_STEP migrates sdk_features into follow_up_items and drops sdk_features", () => {
  const db = new DatabaseSync(":memory:");
  for (const step of [...appsSchemaSteps, ...sdkReviewSchemaSteps]) {
    db.exec(step.sql);
  }
  db.prepare(
    `INSERT INTO sdk_reviews (id, app, session, decision, through, call, created_at)
     VALUES (?, ?, ?, 'update', '{"@lophn/ui":"2.0.0"}', NULL, '2026-11-01T00:00:00.000Z')`,
  ).run(id("sdr", 1), APP, SESSION);
  db.prepare(
    `INSERT INTO sdk_features (id, review, app, title, proposal, note_file, state, outcome, state_at)
     VALUES (?, ?, ?, 'Tray icon', 'Add tray popup', 'ui-2.0.0.md', 'done', 'Added tray', '2026-11-02T00:00:00.000Z')`,
  ).run(id("sdf", 7), id("sdr", 1), APP);

  db.exec(WORKSPACE_LIFECYCLE_SCHEMA_STEP.sql);

  const oldTable = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sdk_features'",
    )
    .get();
  assert.strictEqual(oldTable, undefined);

  const migrated = db.prepare("SELECT * FROM follow_up_items").all() as Record<
    string,
    unknown
  >[];
  assert.strictEqual(migrated.length, 1);
  assert.deepStrictEqual(
    { ...migrated[0] },
    {
      id: id("fup", 7),
      workspace_kind: "app",
      workspace_id: APP,
      origin: "app_sdk",
      source_ref: "ui-2.0.0.md",
      title: "Tray icon",
      body: "Add tray popup",
      state: "done",
      created_at: "2026-11-01T00:00:00.000Z",
      updated_at: "2026-11-02T00:00:00.000Z",
      outcome: "Added tray",
    },
  );
});

test("follow_up.list and follow_up.report enforce P12 workspace scoping and review tables round-trip", () => {
  const db = new DatabaseSync(":memory:");
  for (const step of [
    ...sdkReviewSchemaSteps,
    WORKSPACE_LIFECYCLE_SCHEMA_STEP,
  ]) {
    db.exec(step.sql);
  }
  let counter = 1;
  let now = "2026-11-20T00:00:00.000Z";
  const sql = {
    run: (text: string, params: never[]) => db.prepare(text).run(...params),
    get: (text: string, params: never[]) =>
      db.prepare(text).get(...params) as Record<string, never> | undefined,
    all: (text: string, params: never[]) =>
      db.prepare(text).all(...params) as Record<string, never>[],
  };
  const sessions: Record<string, { workspace: FollowUpWorkspace | null }> = {
    [HOME_SESSION]: { workspace: null },
    [PROJECT_SESSION]: { workspace: { kind: "project", id: PROJECT as never } },
    [APP_SESSION]: { workspace: { kind: "app", id: APP as never } },
  };
  const port = (key: unknown) =>
    key === followUpPorts
      ? {
          sessionWorkspace: (session: string) => sessions[session] ?? null,
        }
      : undefined;
  const tx = {
    sql,
    now: () => now,
    newId: (prefix: string) => id(prefix, counter++),
    port,
  } as unknown as Tx;
  const snapshot = {
    sql,
    as_of_seq: "1",
    port,
  } as unknown as Parameters<ReadDefinition<typeof followUpList>["handle"]>[0];

  const homeItem = insertFollowUp(tx, {
    workspace: null,
    origin: "platform_note",
    source_ref: "flow-2.0",
    title: "Home note",
    body: "Review Home",
  });
  const prjItem = insertFollowUp(tx, {
    workspace: { kind: "project", id: PROJECT as never },
    origin: "flow_sdk",
    source_ref: "flow-2.0.0.md",
    title: "Fix flow",
    body: "Upgrade flow",
  });
  const appItem = insertFollowUp(tx, {
    workspace: { kind: "app", id: APP as never },
    origin: "cascade",
    source_ref: null,
    title: "Update connection",
    body: "App changed",
  });

  const ctx = (actor: string, conditions: Record<string, unknown> = {}) =>
    ({
      principal: actor,
      actor,
      scope: {
        operations: [followUpList.name, followUpReport.name],
        targets: {},
      },
      conditions,
      credential_ref: actor,
    }) as never;

  const listRead = followUpReads.list as unknown as ReadDefinition<
    typeof followUpList
  >;
  const reportCmd = followUpCommands.report as unknown as CommandDefinition<
    typeof followUpReport
  >;

  // user and Home agent see all items
  const allUser = listRead.handle(snapshot, ctx("user"), {});
  assert.ok(allUser.ok);
  assert.strictEqual(allUser.value.items.length, 3);

  const allHome = listRead.handle(snapshot, ctx(`agent:${HOME_SESSION}`), {});
  assert.ok(allHome.ok);
  assert.strictEqual(allHome.value.items.length, 3);

  // project agent sees only own project items and gets forbidden for other workspaces or home
  const prjOwn = listRead.handle(snapshot, ctx(`agent:${PROJECT_SESSION}`), {});
  assert.ok(prjOwn.ok);
  assert.deepStrictEqual(
    prjOwn.value.items.map((i) => i.id),
    [prjItem.id],
  );
  const prjCrossApp = listRead.handle(
    snapshot,
    ctx(`agent:${PROJECT_SESSION}`),
    { workspace: { kind: "app", id: APP as never } },
  );
  assert.ok(!prjCrossApp.ok);
  assert.strictEqual(prjCrossApp.error.code, "forbidden");
  const prjCrossHome = listRead.handle(
    snapshot,
    ctx(`agent:${PROJECT_SESSION}`),
    { workspace: "home" },
  );
  assert.ok(!prjCrossHome.ok);
  assert.strictEqual(prjCrossHome.error.code, "forbidden");

  // app agent cannot report project or home item (not_found per P12), can report own
  const crossReport = reportCmd.handle(
    tx,
    ctx(`agent:${APP_SESSION}`),
    { item: prjItem.id, state: "done", outcome: "sneaky" },
    {} as never,
  );
  assert.ok(!crossReport.ok);
  assert.strictEqual(crossReport.error.code, "not_found");

  now = "2026-11-20T01:00:00.000Z";
  const ownReport = reportCmd.handle(
    tx,
    ctx(`agent:${APP_SESSION}`),
    { item: appItem.id, state: "changed", outcome: "Updated command call" },
    {} as never,
  );
  assert.ok(ownReport.ok);
  assert.strictEqual(ownReport.value.item.state, "changed");
  assert.strictEqual(ownReport.value.item.outcome, "Updated command call");

  // Home agent can report any item
  const homeReport = reportCmd.handle(
    tx,
    ctx(`agent:${HOME_SESSION}`),
    { item: homeItem.id, state: "done", outcome: "Checked" },
    {} as never,
  );
  assert.ok(homeReport.ok);
  assert.strictEqual(homeReport.value.item.state, "done");

  // flow_sdk_reviews & platform_reviews round-trip
  assert.strictEqual(loadLastFlowSdkReview(sql, PROJECT, "daily"), null);
  insertFlowSdkReview(tx, {
    project: PROJECT,
    workflow: "daily",
    session: HOME_SESSION,
    decision: "leave",
    through: "1.0.0",
    call: null,
  });
  now = "2026-11-20T02:00:00.000Z";
  const flowReviewId = insertFlowSdkReview(tx, {
    project: PROJECT,
    workflow: "daily",
    session: HOME_SESSION,
    decision: "update",
    through: "2.0.0",
    call: id("cal", 1),
  });
  assert.deepStrictEqual(loadLastFlowSdkReview(sql, PROJECT, "daily"), {
    id: flowReviewId,
    project: PROJECT,
    workflow: "daily",
    decision: "update",
    through: "2.0.0",
    at: "2026-11-20T02:00:00.000Z",
  });

  assert.strictEqual(loadLastPlatformReview(sql), null);
  insertPlatformReview(tx, { through: "note-1", session: HOME_SESSION });
  now = "2026-11-20T03:00:00.000Z";
  const platReviewId = insertPlatformReview(tx, {
    through: "note-2",
    session: HOME_SESSION,
  });
  assert.deepStrictEqual(loadLastPlatformReview(sql), {
    id: platReviewId,
    through: "note-2",
    at: "2026-11-20T03:00:00.000Z",
  });
});
