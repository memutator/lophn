import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { err, ok } from "../../../base/mod.ts";
import {
  appSdkFeature,
  appSdkReviewRecord,
} from "../../../protocol/apps/sdk-status.ts";
import { DEFAULT_CALL_POLICY } from "../../../protocol/lophn-agent/call-policy.ts";
import type { AgentCallRow } from "../../../protocol/lophn-agent/calls.ts";
import {
  type CommandDefinition,
  TargetAuthorization,
  type Tx,
} from "../../../protocol/server/mod.ts";
import { installRouterEnvironment } from "../../router/environment.ts";
import type { TargetSession } from "../../router/ports.ts";
import { createTargetAuthorizer } from "../../storage/ledger/target-authorization.ts";
import { appsSchemaSteps } from "../registration/schema.ts";
import { sdkReviewCommands } from "./commands.ts";
import { sdkReviewSchemaSteps } from "./schema.ts";

const id = (prefix: string, n: number) =>
  `${prefix}_${String(n).padStart(26, "0")}`;
const APP = id("app", 1);
const OTHER = id("app", 2);
const SESSION = id("ses", 1);
const TURN = id("trn", 1);

function world(refuse: boolean) {
  const db = new DatabaseSync(":memory:");
  for (const step of [...appsSchemaSteps, ...sdkReviewSchemaSteps]) {
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
    spawned_by: null,
    opened_by_machine: null,
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
      transport: { deliver: () => ok(undefined), cancel: () => ok(undefined) },
      store: {
        insert: (_tx, record) => {
          rows.set(record.call, record);
          return ok(undefined);
        },
        byDedup: () => null,
        read: (_tx, call) => rows.get(call) ?? null,
        move: (_tx, call, to, reason) => {
          const moved = { ...rows.get(call)!, state: to, fail_reason: reason };
          rows.set(call, moved);
          return ok(moved);
        },
        markConsumed: () => ok(undefined),
        setDelivery: () => ok(undefined),
        lost: () => [],
        openReceivedBy: () => [],
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
    [refused.count("sdk_reviews"), refused.count("sdk_features")],
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
    [accepted.count("sdk_reviews"), accepted.count("sdk_features")],
    [1, 1],
  );
  const stored = accepted.sql.get(
    "select state, outcome from sdk_features",
    [],
  );
  assert.deepStrictEqual(
    { state: stored?.["state"], outcome: stored?.["outcome"] },
    { state: "open", outcome: null },
  );
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
    w.sql.get("select state from sdk_features", [])?.["state"],
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
    w.sql.get("select state from sdk_features", [])?.["state"],
    "done",
  );
});
