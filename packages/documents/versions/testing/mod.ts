// leaf unit fixture. writer Worker·current credential·core API 증거는 아니다.
import { DatabaseSync } from "node:sqlite";
export * from "./guides.ts";
import { ok, type Result } from "../../../base/mod.ts";
import type { ContentFile } from "../../../contracts/documents/mod.ts";
import {
  type PortKey,
  type PreparedBlob,
  type Sql,
  type SqlRow,
  TargetAuthorization,
  type TargetAuthorizer,
  type Tx,
} from "../../../contracts/platform/mod.ts";
import { addressingSchemaSteps } from "../../addressing/mod.ts";
import { versionsSchemaSteps } from "../mod.ts";

export type Emitted = {
  type: string;
  subject: string | null;
  payload: unknown;
  seq: string;
};

const allowAll: TargetAuthorizer = () => ok(undefined);

export function versionFixture(authorize: TargetAuthorizer = allowAll) {
  const authorizer = { current: authorize };
  const directory = Deno.makeTempDirSync({ prefix: "versions-test-" });
  const db = new DatabaseSync(`${directory}/ledger.sqlite`);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  for (const step of [...addressingSchemaSteps, ...versionsSchemaSteps]) {
    db.exec(step.sql);
  }
  let seq = 0n;
  let minted = 0;
  const emitted: Emitted[] = [];
  const blobs: { owner_key: string; field: string; hash: string }[] = [];
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
    blobs,
    path: `${directory}/ledger.sqlite`,
    transaction<T>(handle: (tx: Tx) => Result<T>): Result<T> {
      let open = true;
      const guard = () => {
        if (!open) throw new Error("transaction is closed");
      };
      db.exec("BEGIN IMMEDIATE");
      const mark = emitted.length;
      const markSeq = seq;
      const markBlobs = blobs.length;
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
        registerBlobRef: (reference: {
          owner_key: string;
          field: string;
          source: { kind: string; blob?: PreparedBlob };
        }) => {
          guard();
          const hash = reference.source.blob?.hash ?? "";
          blobs.push({
            owner_key: reference.owner_key,
            field: reference.field,
            hash,
          });
          return ok({
            owner_kind: "document_version",
            owner_key: reference.owner_key,
            field: reference.field,
            hash,
            registered_seq: "1",
          });
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
          blobs.splice(markBlobs);
          seq = markSeq;
        }
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        emitted.splice(mark);
        blobs.splice(markBlobs);
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
    close() {
      db.close();
      Deno.removeSync(directory, { recursive: true });
    },
    use(next: TargetAuthorizer) {
      authorizer.current = next;
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
  doc: "doc_01arz3ndektsv4rrffq69g5fav",
  other: "doc_01arz3ndektsv4rrffq69g5faw",
  project: "prj_01arz3ndektsv4rrffq69g5fav",
  app: "app_01arz3ndektsv4rrffq69g5fav",
  run: "run_01arz3ndektsv4rrffq69g5fav",
};

const HASH = "ab".repeat(32);

export function file(
  path: string,
  primary: boolean,
  bytes = 4,
  media = "text/plain",
): ContentFile & {
  preparation_ref: string;
  content: { kind: "prepared"; blob: PreparedBlob };
} {
  return {
    path,
    blob_hash: HASH,
    bytes,
    media_type: media,
    primary,
    preparation_ref: `prep-${path}`,
    content: {
      kind: "prepared",
      blob: {
        preparation: `prep-${path}`,
        principal: "person",
        purpose: "document_file",
        hash: HASH,
        size_bytes: bytes,
      },
    },
  };
}

export function preparedInput(
  document: string,
  files: ReturnType<typeof file>[],
  extra: Record<string, unknown> = {},
) {
  const primary = files.find((item) => item.primary) ?? files[0];
  return {
    document,
    base_version: null,
    files_hash: HASH,
    file_count: files.length,
    primary_path: primary.path,
    content_hash: HASH,
    preparation_ref: "prep-1",
    idempotency_key: "save-1",
    metadata: { title: "Notes", place: null, name: null },
    format: { name: "document", module_hash: HASH, explicit: false },
    validation: {
      input_hash: HASH,
      module_hash: HASH,
      status: "passed",
      error_count: 0,
      warning_count: 0,
      diagnostics: [],
    },
    source: null,
    // 저장 입력의 파일은 ContentFile과 준비 참조다(준비 입력의 content는 싣지 않는다).
    files: files.map(({ content: _content, ...item }) => item),
    ...extra,
  };
}

export function keep<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}
