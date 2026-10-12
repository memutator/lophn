import { DatabaseSync } from "node:sqlite";
import { err, ok, type Result } from "../../base/mod.ts";
import { appRegistrationLookup } from "../../protocol/apps/mod.ts";
import type {
  ReadSnapshot,
  RequestContext,
  Sql,
  SqlRow,
  Tx,
} from "../../protocol/platform/mod.ts";
import { connectionSchemaSteps } from "./schema.ts";

export const APP = "app_01arz3ndektsv4rrffq69g5fav";
export const OTHER_APP = "app_01arz3ndektsv4rrffq69g5faw";
export const CAC = "cac_01arz3ndektsv4rrffq69g5fav";
export const CAC_B = "cac_01arz3ndektsv4rrffq69g5faw";
export const DIGEST = "a".repeat(64);
export const DIGEST_B = "b".repeat(64);
export const CONFIRMATION = "A".repeat(43);

export function userContext(
  actor = "user",
  principal = "user-1",
): RequestContext {
  return {
    principal,
    actor: actor as RequestContext["actor"],
    scope: { operations: [], targets: {} },
    conditions: {},
    credential_ref: "cred-user",
  };
}

export function connectionLedger(apps: readonly string[] = [APP]) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const step of connectionSchemaSteps) db.exec(step.sql);
  const prepare = (statement: string) => {
    const prepared = db.prepare(statement);
    prepared.setReadBigInts(true);
    return prepared;
  };
  const sql: Sql = {
    run: (statement, params) => prepare(statement).run(...params),
    get: (statement, params) =>
      prepare(statement).get(...params) as SqlRow | undefined,
    all: (statement, params) => prepare(statement).all(...params) as SqlRow[],
  };
  const known = new Set(apps);
  const events: { seq: string; subject: unknown; payload: unknown }[] = [];
  let eventSeq = 0;
  const tx: Tx = {
    sql,
    now: () => "2026-10-04T00:00:00.000Z",
    newId: () => CAC,
    port<T>(key: { name: string }): T {
      if (key.name !== appRegistrationLookup.name) {
        throw new Error("unregistered port");
      }
      const lookup = {
        get: (app: string) =>
          ok(
            known.has(app)
              ? { id: app, slug: "notes", status: "active" as const }
              : null,
          ),
      };
      return lookup as T;
    },
    emit(_event, subject, payload) {
      eventSeq += 1;
      const seq = String(eventSeq);
      events.push({ seq, subject, payload });
      return seq;
    },
    registerBlobRef: () => err({ code: "unavailable", message: "no blob" }),
    advanceSubscriberCursor: () => ok(undefined),
    useApproval: () => err({ code: "unavailable", message: "no approval" }),
    call: () => err({ code: "unavailable", message: "no dispatch" }),
  };
  function transaction<T>(run: (tx: Tx) => Result<T>): Result<T> {
    db.exec("BEGIN IMMEDIATE");
    const mark = events.length;
    const seqMark = eventSeq;
    try {
      const result = run(tx);
      db.exec(result.ok ? "COMMIT" : "ROLLBACK");
      if (!result.ok) {
        events.length = mark;
        eventSeq = seqMark;
      }
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      events.length = mark;
      eventSeq = seqMark;
      throw error;
    }
  }
  const snapshot = (asOf = "0"): ReadSnapshot => ({
    sql,
    as_of_seq: asOf,
    port: tx.port,
  });
  return {
    db,
    sql,
    tx,
    events,
    transaction,
    snapshot,
    close: () => db.close(),
  };
}
