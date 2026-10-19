import { assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import type { RequestContext, Tx } from "../../../protocol/server/mod.ts";
import { ticketSchemaSteps } from "../../apps/tickets/schema.ts";
import { appsSchemaSteps } from "../../apps/registration/schema.ts";
import { canonicalHash } from "./canonical.ts";
import { requestTestCommand } from "./commands.ts";
import { testAdmissionPort } from "./ports.ts";
import { loadRecords } from "./records.ts";
import { TEST_SCHEMA_STEPS } from "./schema.ts";
import { admission } from "./request-ports.ts";

const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzza";
const TKT = "tkt_01hzzzzzzzzzzzzzzzzzzzzzza";
const REL = "rel_01hzzzzzzzzzzzzzzzzzzzzzza";
const BUNDLE = "b".repeat(64);
const CHECK = {
  kind: "examples",
  steps: [{ tool: "add", input: { a: 1 }, expect: { sum: 1 } }],
};

function open() {
  const db = new DatabaseSync(":memory:");
  for (
    const step of [
      ...TEST_SCHEMA_STEPS,
      ...ticketSchemaSteps,
      ...appsSchemaSteps,
    ]
  ) db.exec(step.sql);
  db.exec(`create table releases (id text, app text, bundle_hash text)`);
  db.prepare(
    `insert into apps (id, slug, name, description, run_enabled, revision, status)
     values (?, 'a', 'a', 'a', 1, '1', 'active')`,
  ).run(APP);
  db.prepare(`insert into releases values (?, ?, ?)`).run(REL, APP, BUNDLE);
  db.prepare(
    `insert into tickets (id, app, state, goal, acceptance_check, completion_seq, revision)
     values (?, ?, 'reported', 'g', ?, '5', '1')`,
  ).run(TKT, APP, JSON.stringify(CHECK));
  db.prepare(
    `insert into ticket_completions
       (ticket, seq, session, claim_seq, release, summary_hash, verifications)
     values (?, '5', 's', '1', ?, ?, '[]')`,
  ).run(TKT, REL, "a".repeat(64));
  const sql = {
    run: (text: string, params: never[]) => {
      const done = db.prepare(text).run(...params);
      return { changes: done.changes, lastInsertRowid: done.lastInsertRowid };
    },
    get: (text: string, params: never[]) =>
      db.prepare(text).get(...params) as Record<string, never> | undefined,
    all: (text: string, params: never[]) =>
      db.prepare(text).all(...params) as Record<string, never>[],
  };
  const tx = {
    sql,
    now: () => "2026-10-18T00:00:00.000Z",
    port: (key: unknown) => key === testAdmissionPort ? admission(tx) : null,
  } as unknown as Tx;
  return { db, tx };
}

const ctx = (actor: string): RequestContext => ({
  principal: actor,
  actor: actor as never,
  scope: { operations: ["RequestTest"], targets: { app: APP } },
  conditions: {},
  credential_ref: actor,
});

const input = (change: { check_hash?: string; bundle?: string } = {}) => ({
  request_key: "examples:k",
  kind: "examples" as const,
  app: APP,
  target: { bundle_hash: change.bundle ?? BUNDLE, release: REL },
  ticket: {
    ticket: TKT,
    check_index: 0,
    check_hash: change.check_hash ?? canonicalHash(CHECK),
    completion_seq: "5",
  },
  test: "c".repeat(64),
});

Deno.test("examples 요청은 machine만 내고 ticket의 현재 check·보고·bundle과 맞을 때만 접수되며 예시는 core가 싣는다", () => {
  const code = (
    tx: Tx,
    actor: string,
    change?: Parameters<typeof input>[0],
  ) => {
    const done = requestTestCommand.handle(
      tx,
      ctx(actor),
      input(change) as never,
      (() => {}) as never,
    );
    return done.ok ? "ok" : done.error.code;
  };

  const good = open();
  assertEquals(code(good.tx, "user"), "forbidden");
  assertEquals(code(good.tx, "machine"), "ok");
  const accepted = loadRecords(good.tx.sql, "machine", "examples:k")[0];
  assertEquals(accepted.payload.examples, CHECK.steps);

  const edited = open();
  edited.db.prepare(`update tickets set acceptance_check = ?`).run(
    JSON.stringify({ ...CHECK, steps: [{ ...CHECK.steps[0], expect: 2 }] }),
  );
  assertEquals(code(edited.tx, "machine"), "not_found");

  const stale = open();
  stale.db.prepare(`update tickets set completion_seq = '6'`).run();
  assertEquals(code(stale.tx, "machine"), "not_found");

  const unreported = open();
  unreported.db.prepare(
    `update tickets set state = 'open', completion_seq = null`,
  )
    .run();
  assertEquals(code(unreported.tx, "machine"), "not_found");

  assertEquals(
    code(open().tx, "machine", { bundle: "d".repeat(64) }),
    "not_found",
  );
  assertEquals(
    code(open().tx, "machine", { check_hash: "e".repeat(64) }),
    "not_found",
  );
});
