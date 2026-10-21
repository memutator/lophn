import { assert, assertEquals } from "@std/assert";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { canonicalize, ok } from "../../../base/mod.ts";
import { appRegistrationLookup } from "../../../protocol/apps/mod.ts";
import { CodingSessionLookup } from "../../../protocol/coding-agent/token.ts";
import type { RequestContext, Tx } from "../../../protocol/server/mod.ts";
import { createTicketClaimCommands } from "./claims.ts";
import { createTicketCommands } from "./commands.ts";
import { createTicketReads } from "./reads.ts";
import { createTicketReportCommands } from "./report.ts";
import { ticketSchemaSteps } from "./schema.ts";
import { createTicketSessionEnd } from "./session-end.ts";

const APP_A = "app_01hzzzzzzzzzzzzzzzzzzzzzza";
const APP_B = "app_01hzzzzzzzzzzzzzzzzzzzzzzb";
const SES_A = "ses_01hzzzzzzzzzzzzzzzzzzzzzza";
const SES_B = "ses_01hzzzzzzzzzzzzzzzzzzzzzzb";
const ENGINEER = "ses_01hzzzzzzzzzzzzzzzzzzzzzzc";
const TKT_A = "tkt_01hzzzzzzzzzzzzzzzzzzzzzza";
const TKT_B = "tkt_01hzzzzzzzzzzzzzzzzzzzzzzb";
const REL = "rel_01hzzzzzzzzzzzzzzzzzzzzzza";
const HASH = "a".repeat(64);

// session → 앱을 흉내 내는 fake lookup이다.
const lookup = {
  appOf: (session: string) =>
    session === SES_A ? APP_A : session === SES_B ? APP_B : null,
};

function open() {
  const db = new DatabaseSync(":memory:");
  for (const step of ticketSchemaSteps) db.exec(step.sql);
  const events: { type: string; subject: string | null; payload: unknown }[] =
    [];
  const ports = new Map<unknown, unknown>([
    [CodingSessionLookup, lookup],
    [appRegistrationLookup, { get: () => ok({}) }],
  ]);
  const sql = {
    run: (text: string, params: never[]) => {
      const result = db.prepare(text).run(...params);
      return {
        changes: result.changes,
        lastInsertRowid: result.lastInsertRowid,
      };
    },
    get: (text: string, params: never[]) =>
      db.prepare(text).get(...params) as Record<string, never> | undefined,
    all: (text: string, params: never[]) =>
      db.prepare(text).all(...params) as Record<string, never>[],
  };
  const port = (key: unknown) => ports.get(key);
  const tx = {
    sql,
    emit: (
      event: { type: string },
      subject: string | null,
      payload: unknown,
    ) => {
      events.push({ type: event.type, subject, payload });
      return String(events.length);
    },
    now: () => "2026-10-16T00:00:00.000Z",
    newId: () => TKT_A,
    port,
  } as unknown as Tx;
  const snapshot = { sql, as_of_seq: "0", port } as never;
  const insert = (id: string, app: string, state = "open", seq = "1") =>
    db.prepare(
      `INSERT INTO tickets (id, app, state, goal, acceptance_check, completion_seq, revision)
       VALUES (?, ?, ?, 'goal', '{"kind":"app_test"}', ?, '1')`,
    ).run(
      id,
      app,
      state,
      ["reported", "verified", "failed"].includes(state) ? seq : null,
    );
  const reported = (id: string, session: string) =>
    db.prepare(
      `INSERT INTO ticket_completions
         (ticket, seq, session, claim_seq, release, summary_hash, verifications)
       VALUES (?, '1', ?, '2', ?, ?, '[]')`,
    ).run(id, session, REL, HASH);
  const row = (id: string) =>
    db.prepare("SELECT state, revision FROM tickets WHERE id = ?").get(id);
  const claimRow = (id: string) =>
    db.prepare("SELECT session FROM ticket_claims WHERE ticket = ?").get(id);
  return { db, tx, snapshot, events, insert, reported, row, claimRow };
}

const ctx = (actor: string): RequestContext => ({
  principal: actor,
  actor: actor as never,
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: actor,
});
const coding = (session: string) => ctx(`coding_agent:${session}`);
const engineer = ctx(`agent:${ENGINEER}`);

Deno.test("coding token은 앱 하나만 연다", () => {
  const { tx, snapshot, insert, row, claimRow, db } = open();
  insert(TKT_A, APP_A);
  insert(TKT_B, APP_B);
  const claims = createTicketClaimCommands();
  const report = createTicketReportCommands();
  const reads = createTicketReads();

  // 앱 B의 ticket을 앱 A의 session으로 claim하거나 읽는다.
  const claim = claims.claim.handle(
    tx,
    coding(SES_A),
    { ticket: TKT_B, base_revision: "1" },
    { base_revision: "1" },
  );
  assert(!claim.ok && claim.error.code === "forbidden");
  const shown = reads.show.handle(snapshot, coding(SES_A), { ticket: TKT_B });
  assert(!shown.ok && shown.error.code === "forbidden");
  const listed = reads.list.handle(snapshot, coding(SES_A), { app: APP_B });
  assert(!listed.ok && listed.error.code === "forbidden");

  // 앱 B의 session이 쥔 claim을 앱 A의 session이 갱신하거나 보고한다.
  const held = claims.claim.handle(
    tx,
    coding(SES_B),
    { ticket: TKT_B, base_revision: "1" },
    { base_revision: "1" },
  );
  assert(held.ok);
  const heldRow = row(TKT_B);
  const stolen = { ticket: TKT_B, base_revision: "2", claim_seq: "2" };
  const renew = claims.renew_claim.handle(tx, coding(SES_A), stolen, {
    base_revision: "2",
  });
  assert(!renew.ok && renew.error.code === "forbidden");
  const reported = report.report_completion.handle(
    tx,
    coding(SES_A),
    {
      ...stolen,
      completion: {
        release: REL,
        summary_hash: HASH,
        verifications: [],
      },
      summary_blob: { hash: HASH } as never,
    },
    { base_revision: "2" },
  );
  assert(!reported.ok && reported.error.code === "forbidden");

  assertEquals(row(TKT_B), heldRow);
  assertEquals(claimRow(TKT_B)?.session, SES_B);
  db.close();
});

Deno.test("session이 끝나면 claim을 반납하고 보고가 없었으면 event를 낸다", () => {
  const { tx, insert, row, claimRow, events, reported, db } = open();
  insert(TKT_A, APP_A);
  const claims = createTicketClaimCommands();
  const claim = claims.claim.handle(
    tx,
    coding(SES_A),
    { ticket: TKT_A, base_revision: "1" },
    { base_revision: "1" },
  );
  assert(claim.ok);
  const end = createTicketSessionEnd(tx);
  const settled = end.settle(SES_A);
  assert(settled.ok);
  assertEquals(settled.value, { ticket: TKT_A, reported: false });
  assertEquals(row(TKT_A)?.state, "open");
  assertEquals(claimRow(TKT_A), undefined);
  assertEquals(events.map((event) => event.type), [
    "CodingSessionEndedUnreported",
  ]);
  // 이미 정산한 session은 아무것도 하지 않는다.
  const again = end.settle(SES_A);
  assert(again.ok);
  assertEquals(again.value, { ticket: null, reported: false });

  // 보고가 있었으면 ticket은 reported로 남고 event는 없다.
  insert(TKT_B, APP_B, "reported");
  reported(TKT_B, SES_B);
  const done = end.settle(SES_B);
  assert(done.ok);
  assertEquals(done.value, { ticket: TKT_B, reported: true });
  assertEquals(row(TKT_B)?.state, "reported");
  assertEquals(events.length, 1);
  db.close();
});

Deno.test("확인됨은 App Engineer가 정하고 닫힌 ticket은 고칠 수 없다", () => {
  const { tx, insert, row, events, reported, db } = open();
  insert(TKT_A, APP_A, "reported");
  reported(TKT_A, SES_A);
  const commands = createTicketCommands();
  const verify = (actor: RequestContext) =>
    commands.verify.handle(
      tx,
      actor,
      {
        ticket: TKT_A,
        base_revision: "1",
        completion_seq: "1",
        result: "verified",
      },
      { base_revision: "1" },
    );
  // coding agent는 확인하지 못한다.
  const denied = verify(coding(SES_A));
  assert(!denied.ok && denied.error.code === "forbidden");
  assertEquals(row(TKT_A)?.state, "reported");
  const verified = verify(engineer);
  assert(verified.ok);
  assertEquals(row(TKT_A)?.state, "verified");
  assertEquals(events.map((event) => event.type), ["TicketVerified"]);
  const edit = commands.update.handle(
    tx,
    engineer,
    { ticket: TKT_A, goal: "other" },
    {} as never,
  );
  assert(!edit.ok && edit.error.code === "conflict");
  let blocked = false;
  try {
    db.prepare("UPDATE tickets SET goal = 'x' WHERE id = ?").run(TKT_A);
  } catch {
    blocked = true;
  }
  assert(blocked);
  db.close();
});

Deno.test("examples check의 ticket은 예시가 맞지 않으면 verified가 되지 못하고, 맞으면 된다", () => {
  const { tx, insert, row, db } = open();
  // verifications 표의 이 gate가 읽는 칸만 흉내 낸다.
  db.exec(`CREATE TABLE verifications (
    id TEXT PRIMARY KEY, ticket TEXT, ticket_completion_seq TEXT,
    ticket_check_hash TEXT)`);
  const check = {
    kind: "examples",
    steps: [{ tool: "weekly.list", expect: { count: 4 } }],
  };
  const hashOf = (value: unknown) =>
    createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
  // completion seq는 표 전체에서 유일해서 ticket마다 다르다.
  const seqs = new Map<string, string>();
  const report = (
    id: string,
    result: string,
    hash: string,
    vrf: string,
  ) => {
    const seq = String(seqs.size + 1);
    seqs.set(id, seq);
    insert(id, APP_A, "reported", seq);
    db.prepare(
      `INSERT INTO ticket_completions
         (ticket, seq, session, claim_seq, release, summary_hash, verifications)
       VALUES (?, ?, ?, '2', ?, ?, '[]')`,
    ).run(id, seq, SES_A, REL, HASH);
    db.prepare("UPDATE tickets SET acceptance_check = ? WHERE id = ?").run(
      JSON.stringify(check),
      id,
    );
    db.prepare("INSERT INTO verifications VALUES (?, ?, ?, ?)").run(
      vrf,
      id,
      seq,
      hash,
    );
    db.prepare(
      `INSERT INTO ticket_check_results
         (ticket, completion_seq, result, reason, verification)
       VALUES (?, ?, ?, 'r', ?)`,
    ).run(id, seq, result, vrf);
  };
  const verify = (ticket: string, result: "verified" | "failed") =>
    createTicketCommands().verify.handle(
      tx,
      engineer,
      {
        ticket,
        base_revision: "1",
        completion_seq: seqs.get(ticket)!,
        result,
      },
      { base_revision: "1" },
    );
  const TKT_FAIL = "tkt_01hzzzzzzzzzzzzzzzzzzzzzzc";
  const TKT_STALE = "tkt_01hzzzzzzzzzzzzzzzzzzzzzzd";
  report(TKT_FAIL, "fail", hashOf(check), "vrf_01hzzzzzzzzzzzzzzzzzzzzzza");
  // 옛 check로 통과한 결과는 지금 check의 근거가 아니다.
  report(
    TKT_STALE,
    "pass",
    hashOf({ kind: "text", text: "old" }),
    "vrf_01hzzzzzzzzzzzzzzzzzzzzzzb",
  );
  report(TKT_A, "pass", hashOf(check), "vrf_01hzzzzzzzzzzzzzzzzzzzzzzc");
  for (const id of [TKT_FAIL, TKT_STALE]) {
    const blocked = verify(id, "verified");
    assert(!blocked.ok && blocked.error.code === "conflict");
    assertEquals(row(id)?.state, "reported");
  }
  assert(verify(TKT_FAIL, "failed").ok);
  assert(verify(TKT_A, "verified").ok);
  assertEquals(row(TKT_A)?.state, "verified");
  db.close();
});
