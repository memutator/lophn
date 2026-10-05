// leaf unit fixture. writer Worker·current credential·core API 증거는 아니다.
import { DatabaseSync } from "node:sqlite";
import { openDerivedRead } from "../adapters/store.ts";
import { ok, type Result } from "../../../base/mod.ts";
import type {
  PortKey,
  Sql,
  SqlRow,
  TargetAuthorizer,
  Tx,
} from "../../../contracts/platform/mod.ts";
import { TargetAuthorization } from "../../../contracts/platform/mod.ts";
import { addressingSchemaSteps } from "../../addressing/mod.ts";
import { versionsSchemaSteps } from "../../versions/mod.ts";
import { outlineAndSearchSchemaSteps, savedViewsSchemaSteps } from "../mod.ts";

export type Emitted = {
  type: string;
  subject: string | null;
  payload: unknown;
  seq: string;
};

const allowAll: TargetAuthorizer = () => ok(undefined);

// versions 표가 있어야 open의 문서·판 metadata 검사를 시험한다.
export function viewFixture(authorize: TargetAuthorizer = allowAll) {
  const authorizer = { current: authorize };
  const directory = Deno.makeTempDirSync({ prefix: "views-test-" });
  const db = new DatabaseSync(`${directory}/ledger.sqlite`);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  for (
    const step of [
      ...addressingSchemaSteps,
      ...versionsSchemaSteps,
      ...savedViewsSchemaSteps,
    ]
  ) {
    db.exec(step.sql);
  }
  // open용 query_only derived read. view handler의 deps에 그대로 간다. readOnly
  // open은 파일이 있어야 하므로 derived schema로 file SQLite를 먼저 만든다.
  const derivedDb = new DatabaseSync(`${directory}/documents.sqlite`);
  for (const step of outlineAndSearchSchemaSteps) {
    derivedDb.exec(step.sql);
  }
  derivedDb.close();
  const derived = openDerivedRead(`${directory}/documents.sqlite`);
  if (!derived.ok) throw new Error(derived.error.message);
  let seq = 0n;
  let minted = 0;
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
  return {
    db,
    sql: sqlOf(() => {}),
    emitted,
    path: `${directory}/ledger.sqlite`,
    derivedRead: () => derived.value,
    authorizer,
    useAuthorizer(next: TargetAuthorizer): void {
      authorizer.current = next;
    },
    count(table: string): number {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as
        | { n: number | bigint }
        | undefined;
      return row === undefined ? 0 : Number(row.n);
    },
    transaction<T>(handle: (tx: Tx) => Result<T>): Result<T> {
      let open = true;
      const guard = () => {
        if (!open) throw new Error("transaction is closed");
      };
      db.exec("BEGIN IMMEDIATE");
      const mark = emitted.length;
      const markSeq = seq;
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
        now: () => "2026-10-05T00:00:00.000Z",
        newId: (prefix: string) => {
          guard();
          minted += 1;
          return `${prefix}_${minted.toString(36).padStart(26, "0")}`;
        },
        port<T>(key: PortKey<T>): T {
          guard();
          if (!Object.is(key, TargetAuthorization)) {
            throw new Error("unregistered document port");
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
      } as unknown as Tx;
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
    snapshot(as_of_seq = seq.toString() === "0" ? "1" : seq.toString()) {
      return {
        sql: sqlOf(() => {}),
        as_of_seq,
        port<T>(key: PortKey<T>): T {
          if (!Object.is(key, TargetAuthorization)) {
            throw new Error("unregistered document port");
          }
          return authorizer.current as T;
        },
      };
    },
    // 저장 판이 있는 문서를 심는다. place·format은 시험마다 바꾼다.
    seedDocument(
      id: string,
      place?: { kind: "project" | "app"; id: string; name: string },
      format = "document",
      savedAt = "2026-10-05T00:00:00.000Z",
    ): void {
      // 문서 id에서 version id를 만든다. seed마다 다른 판 id가 필요하다.
      const versionId = `ver_${id.slice("doc_".length)}`;
      db.prepare(
        `INSERT INTO documents
           (id, place_kind, place_id, name, title, source_kind,
            source_instruction_target, source_project, source_path,
            latest_version, revision, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        place?.kind ?? null,
        place?.id ?? null,
        place?.name ?? null,
        "Notes",
        null,
        null,
        null,
        null,
        versionId,
        "1",
        "active",
      );
      db.prepare(
        `INSERT INTO versions
           (id, document, number, files_hash, primary_path, file_count,
            content_hash, format_name, module_hash, format_explicit,
            saved_by, saved_at, run, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        versionId,
        id,
        1,
        "ab".repeat(32),
        "a.md",
        1,
        "ab".repeat(32),
        format,
        "ab".repeat(32),
        0,
        "user",
        savedAt,
        null,
        null,
      );
    },
    archiveDocument(id: string): void {
      db.prepare(`UPDATE documents SET status = 'archived' WHERE id = ?`).run(
        id,
      );
    },
    close() {
      db.close();
      Deno.removeSync(directory, { recursive: true });
    },
  };
}

export function userContext(actor = "user", run?: string) {
  return {
    principal: "person",
    actor,
    scope: { operations: [], targets: {} },
    conditions: {},
    credential_ref: "current",
    ...(run === undefined ? {} : { run }),
  };
}

export const ids = {
  view: "viw_01arz3ndektsv4rrffq69g5fav",
  view2: "viw_01arz3ndektsv4rrffq69g5faw",
  doc: "doc_01arz3ndektsv4rrffq69g5fav",
  doc2: "doc_01arz3ndektsv4rrffq69g5faw",
  doc3: "doc_01arz3ndektsv4rrffq69g5fb0",
  project: "prj_01arz3ndektsv4rrffq69g5fav",
  app: "app_01arz3ndektsv4rrffq69g5fav",
  context: "ctx_01arz3ndektsv4rrffq69g5fav",
  run: "run_01arz3ndektsv4rrffq69g5fav",
};

export function keep<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}
