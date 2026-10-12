import { DatabaseSync } from "node:sqlite";
import { ok, type Result } from "../../base/mod.ts";
import {
  type PortKey,
  type Sql,
  type SqlRow,
  TargetAuthorization,
  type TargetAuthorizer,
  type Tx,
} from "../../protocol/platform/mod.ts";
import { addressingSchemaSteps } from "../addressing/mod.ts";
import { projectsSchemaSteps } from "./schema.ts";

export type Emitted = {
  type: string;
  subject: string | null;
  payload: unknown;
  seq: string;
};

// leaf unit fixture. writer Worker·current credential·core API 증거는 아니다.
const allowAll: TargetAuthorizer = () => ok(undefined);

export function projectFixture(
  authorize: TargetAuthorizer = allowAll,
) {
  const authorizer = { current: authorize };
  const directory = Deno.makeTempDirSync({ prefix: "projects-test-" });
  const db = new DatabaseSync(`${directory}/ledger.sqlite`);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON;",
  );
  for (const step of [...addressingSchemaSteps, ...projectsSchemaSteps]) {
    db.exec(step.sql);
  }
  let seq = 0n;
  const emitted: Emitted[] = [];
  const sqlOf = (active: () => void): Sql => ({
    run: (statement, params) => {
      active();
      return db.prepare(statement).run(...params);
    },
    get: (statement, params) => {
      active();
      return db.prepare(statement).get(...params) as SqlRow | undefined;
    },
    all: (statement, params) => {
      active();
      return db.prepare(statement).all(...params) as SqlRow[];
    },
  });
  const base = sqlOf(() => {});
  return {
    db,
    sql: base,
    emitted,
    path: `${directory}/ledger.sqlite`,
    transaction<T>(handle: (tx: Tx) => Result<T>): Result<T> {
      let open = true;
      const guard = () => {
        if (!open) throw new Error("transaction is closed");
      };
      db.exec("BEGIN IMMEDIATE");
      const tx = {
        sql: sqlOf(guard),
        emit(
          _event: { type: string },
          subject: string | null,
          payload: unknown,
        ) {
          guard();
          seq += 1n;
          const value = seq.toString();
          emitted.push({ type: _event.type, subject, payload, seq: value });
          return value;
        },
        now: () => "2026-10-04T00:00:00.000Z",
        newId: () => {
          throw new Error("project commands do not mint ids");
        },
        port<T>(key: PortKey<T>): T {
          guard();
          if (!Object.is(key, TargetAuthorization)) {
            throw new Error("unregistered project port");
          }
          return authorizer.current as T;
        },
        registerBlobRef: () => {
          throw new Error("unused");
        },
        advanceSubscriberCursor: () => {
          throw new Error("unused");
        },
        useApproval: () => {
          throw new Error("unused");
        },
        call: () => {
          throw new Error("unused");
        },
      } as Tx;
      const mark = emitted.length;
      const markSeq = seq;
      try {
        const result = handle(tx);
        db.exec(result.ok ? "COMMIT" : "ROLLBACK");
        if (!result.ok) {
          emitted.splice(mark);
          seq = markSeq;
        }
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        emitted.splice(mark);
        seq = markSeq;
        throw error;
      } finally {
        open = false;
      }
    },
    snapshot(as_of_seq = seq.toString()) {
      return {
        sql: base,
        as_of_seq,
        port<T>(key: PortKey<T>): T {
          if (!Object.is(key, TargetAuthorization)) {
            throw new Error("unregistered project port");
          }
          return authorizer.current as T;
        },
      };
    },
    close() {
      db.close();
      Deno.removeSync(directory, { recursive: true });
    },
    use(next: TargetAuthorizer) {
      authorizer.current = next;
    },
  };
}

export function userContext(actor = "user") {
  return {
    principal: "person",
    actor,
    scope: { operations: [], targets: {} },
    conditions: {},
    credential_ref: "current",
  };
}

export const ids = {
  project: "prj_01arz3ndektsv4rrffq69g5fav",
  other: "prj_01arz3ndektsv4rrffq69g5faw",
  third: "prj_01arz3ndektsv4rrffq69g5fax",
  doc: "doc_01arz3ndektsv4rrffq69g5fav",
  version: "ver_01arz3ndektsv4rrffq69g5fav",
};

export function keep<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
