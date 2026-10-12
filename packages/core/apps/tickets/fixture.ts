// ticket ledger fixture(worker-common leaf unit). 실제 사람 데이터 root는
// 열지 않고 in-memory DB만 쓴다. 문제·질문 read는 소유 구현이 아직 없어
// port로 대체 주입한다.
import { DatabaseSync } from "node:sqlite";
import { err, ok, type Result } from "../../../base/mod.ts";
import { appRegistrationLookup } from "../../../protocol/apps/mod.ts";
import type { CodingAgentConnectionAuthResult } from "../../../protocol/coding-agent/mod.ts";
import { connectionAuthSyncPort } from "../../server/identity/connection/mod.ts";
import type {
  ReadSnapshot,
  RequestContext,
  Sql,
  SqlRow,
  Tx,
} from "../../../protocol/server/mod.ts";
import { PROBLEM_STATUSES_PORT, QUESTION_ADOPTIONS_PORT } from "./commands.ts";
import { ticketSchemaSteps } from "./schema.ts";

export const APP = "app_01arz3ndektsv4rrffq69g5fav";
export const OTHER_APP = "app_01arz3ndektsv4rrffq69g5faw";
export const QUESTION = "qst_01arz3ndektsv4rrffq69g5fav";
export const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
export const VER = "ver_01arz3ndektsv4rrffq69g5fav";
export const PRB = "prb_01arz3ndektsv4rrffq69g5fav";
export const PRB_B = "prb_01arz3ndektsv4rrffq69g5faw";

export type Adoption = { document: string; version: string };
export type ProblemRecord = { id: string; status: string };

export type Emitted = {
  type: string;
  subject: string | null;
  payload: unknown;
  seq: string;
};

export function userContext(actor = "user"): RequestContext {
  return {
    principal: actor.startsWith("coding_agent:") ? actor : "user-1",
    actor: actor as RequestContext["actor"],
    scope: { operations: [], targets: {} },
    conditions: {},
    credential_ref: "cred-user",
  };
}

export type ConnectionRecord = CodingAgentConnectionAuthResult;

export type FixtureDeps = {
  apps?: readonly string[];
  problems?: ProblemRecord[];
  adoptions?: ReadonlyMap<string, Adoption>;
  connections?: ReadonlyMap<string, ConnectionRecord>;
  nowMs?: number;
  // 살아 있는 blob 준비 참조. registerBlobRef는 이 목록만 본다(테스트의
  // core 준비 메모리 자리). 없으면 등록은 unavailable이다.
  preparedBlobs?: readonly {
    preparation: string;
    principal: string;
    purpose: string;
    hash: string;
    size_bytes: number;
  }[];
};

export function ticketFixture(deps: FixtureDeps = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const step of ticketSchemaSteps) db.exec(step.sql);
  // report 역조회가 읽는 표들(report 참조 검사가 보는 열만 같은 이름으로 둔다).
  db.exec(`
    CREATE TABLE releases (
      id TEXT PRIMARY KEY,
      app TEXT NOT NULL,
      ticket_source TEXT,
      bundle_hash TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'prepared',
      failure TEXT
    ) STRICT;
    CREATE TABLE apps (
      id TEXT PRIMARY KEY,
      revision TEXT NOT NULL DEFAULT '1',
      active_release TEXT
    ) STRICT;
    CREATE TABLE versions (
      id TEXT PRIMARY KEY,
      document TEXT NOT NULL,
      number INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE verifications (
      id TEXT PRIMARY KEY,
      app TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'app_test',
      result TEXT NOT NULL DEFAULT 'pass',
      reason TEXT NOT NULL DEFAULT '',
      target_bundle_hash TEXT NOT NULL DEFAULT '',
      ticket TEXT,
      ticket_check_index INTEGER,
      ticket_check_hash TEXT,
      ticket_completion_seq TEXT,
      recorded_seq TEXT NOT NULL DEFAULT '1',
      problem TEXT,
      test TEXT,
      after_release TEXT
    ) STRICT;
    -- problems/grouping이 소유한 표의 checker가 읽는 열. closure는 problems/closing이 쓴 JSON.
    CREATE TABLE problems (
      id TEXT PRIMARY KEY,
      app TEXT NOT NULL,
      status TEXT NOT NULL,
      closure TEXT
    ) STRICT;
    CREATE TABLE blob_refs (
      owner_kind TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      field TEXT NOT NULL,
      hash TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      registered_seq INTEGER NOT NULL,
      PRIMARY KEY (owner_kind, owner_key, field, hash)
    ) STRICT;
    CREATE TRIGGER blob_refs_no_delete BEFORE DELETE ON blob_refs
    BEGIN
      SELECT RAISE(ABORT, 'immutable');
    END;`);
  // claim은 이번 TicketClaimed의 seq를 미리 알아야 한다. 실제 ledger의 events 표와
  // 같은 autoincrement를 두고, emit은 그 seq를 쓴다. 삭제는 막는다.
  db.exec(`
    CREATE TABLE events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      subject TEXT,
      actor TEXT NOT NULL,
      run TEXT,
      payload TEXT NOT NULL,
      at TEXT NOT NULL
    ) STRICT;
    CREATE TRIGGER events_no_delete BEFORE DELETE ON events
    BEGIN
      SELECT RAISE(ABORT, 'immutable');
    END;`);
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
  const known = new Set(deps.apps ?? [APP]);
  const problems = new Map(
    (deps.problems ?? []).map((problem) => [problem.id, problem.status]),
  );
  const adoptions = new Map(deps.adoptions ?? []);
  const connections = new Map(deps.connections ?? []);
  let nowMs = deps.nowMs ?? Date.parse("2026-10-05T00:00:00.000Z");
  const emitted: Emitted[] = [];
  let eventSeq = 0;
  let idSeq = 0;
  const tx: Tx = {
    sql,
    now: () => new Date(nowMs).toISOString(),
    newId: (prefix: string) => {
      idSeq += 1;
      return `${prefix}_${String(idSeq).padStart(26, "0")}`;
    },
    port<T>(key: { name: string }): T {
      if (key.name === appRegistrationLookup.name) {
        const lookup = {
          get: (app: string) =>
            ok(
              known.has(app)
                ? { id: app, slug: "notes", status: "active" as const }
                : null,
            ),
        };
        return lookup as T;
      }
      if (key.name === QUESTION_ADOPTIONS_PORT.name) {
        const read = {
          adoptions: (questions: readonly string[]) =>
            ok(
              new Map(questions.map((question) => {
                const found = adoptions.get(question);
                return [
                  question,
                  found ?? { document: "", version: "" },
                ] as [string, Adoption];
              })),
            ),
        };
        return read as T;
      }
      if (key.name === connectionAuthSyncPort.name) {
        const read = (principal: string) => connections.get(principal);
        return read as T;
      }
      if (key.name === PROBLEM_STATUSES_PORT.name) {
        const read = {
          problems: (ids: readonly string[]) =>
            ok(ids.map((id) => ({
              id,
              status: problems.get(id) ?? "open",
            }))),
        };
        return read as T;
      }
      throw new Error("unregistered port");
    },
    emit(_event, subject, payload) {
      const inserted = sql.run(
        "INSERT INTO events (type, subject, actor, payload, at) VALUES (?, ?, 'test', ?, ?)",
        [
          _event.type,
          subject,
          JSON.stringify(payload),
          new Date(nowMs).toISOString(),
        ],
      );
      const seq = String(inserted.lastInsertRowid);
      eventSeq = Number(seq);
      emitted.push({ type: _event.type, subject, payload, seq });
      return seq;
    },
    registerBlobRef(reference) {
      // 준비되지 않은 hash는 영구 참조가 되지 못한다(blob-flow와 같은 guard).
      if (
        reference.source.kind !== "prepared" ||
        reference.source.blob === undefined
      ) {
        return err({ code: "forbidden", message: "prepared blob만 등록한다" });
      }
      const blob = reference.source.blob;
      const prepared = deps.preparedBlobs?.find((entry) =>
        entry.hash === blob.hash && entry.principal === blob.principal &&
        entry.purpose === blob.purpose
      );
      if (prepared === undefined) {
        return err({ code: "invalid_input", message: "살아 있는 준비가 없다" });
      }
      const inserted = sql.run(
        `INSERT INTO blob_refs (
           owner_kind, owner_key, field, hash, size_bytes, registered_seq
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          reference.owner_kind,
          reference.owner_key,
          reference.field,
          prepared.hash,
          prepared.size_bytes,
          BigInt(reference.registered_seq),
        ],
      );
      return ok({
        owner_kind: reference.owner_kind,
        owner_key: reference.owner_key,
        field: reference.field,
        hash: prepared.hash,
        registered_seq: String(inserted.lastInsertRowid),
      });
    },
    advanceSubscriberCursor: () => ok(undefined),
    useApproval: () => err({ code: "unavailable", message: "no approval" }),
    call: () => err({ code: "unavailable", message: "no dispatch" }),
  };
  function transaction<T>(run: (tx: Tx) => Result<T>): Result<T> {
    db.exec("BEGIN IMMEDIATE");
    const mark = emitted.length;
    const seqMark = eventSeq;
    try {
      const result = run(tx);
      db.exec(result.ok ? "COMMIT" : "ROLLBACK");
      if (!result.ok) {
        emitted.length = mark;
        eventSeq = seqMark;
      }
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      emitted.length = mark;
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
    emitted,
    transaction,
    snapshot,
    setNow(ms: number) {
      nowMs = ms;
    },
    connections,
    close: () => db.close(),
  };
}
