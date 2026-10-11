// ContextLedgerDeps의 실제 구현: content blob 파일, derived index 읽기, 선언 검색 실행, hash,
// Context Engineer 판별, 위반 넘김 Run. command를 실행하는 writer Worker와 read를 실행하는 reader
// Worker 안에서만 올라온다(contexts-api.ts의 loadContextsRuntime). node:sqlite와 동기 file API를
// 쓰므로 core 본체의 module graph에 들어오면 안 된다(platform/responsiveness#R1).
// 그래서 index 저장소는 packages/documents/contexts/mod.ts barrel이 아니라 index/mod.ts를 직접 연다.
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { canonicalize, err, ok, type Result } from "../../packages/base/mod.ts";
import type {
  BlobFieldDefinition,
  RequestContext,
  Sql,
  SqlRow,
  Tx,
} from "../../packages/contracts/platform/mod.ts";
import {
  type BundleContent,
  bundleContentSchema,
  type StoredViolation,
} from "../../packages/contracts/documents/mod.ts";
import {
  createPreparationRegistry,
  objectPathFor,
  registerBlobRef,
} from "../../packages/platform/blob-store/mod.ts";
import {
  type BlobReference,
  type ContextBlobs,
  type ContextIndexPort,
  type EntityRow,
  runSearch,
  type SearchEntity,
  type SearchExecutor,
} from "../../packages/documents/contexts/mod.ts";
import {
  readEntities,
  readEntitiesOfType,
  readEntityWithLinks,
  readIndexState,
  readViolations,
} from "../../packages/documents/contexts/index/mod.ts";
import {
  contextContentField,
  ContextDepUnavailable,
  type ContextsRuntime,
} from "./contexts-api.ts";

// blob을 올릴 때 준비 주체와 purpose. 준비 중계를 거치지 않고 writer가 직접 쓰는 값이라 이름을
// 고정한다. 등록 함수의 검사(주체 일치, field 정의)는 그대로 지난다.
const BLOB_PRINCIPAL = "documents:contexts";
const BLOB_PURPOSE = "context_content";

type Reader = Pick<Sql, "get" | "all">;

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// ledger 파일이 있는 폴더가 data root다. reader의 dataRootOf와 같은 근원이다.
function dataRootOf(sql: Reader): Result<string> {
  const row = sql.get(
    "SELECT file FROM pragma_database_list WHERE name = 'main'",
    [],
  );
  const file = row?.["file"];
  if (typeof file !== "string" || !file.includes("/")) {
    return err({ code: "unavailable", message: "ledger 위치를 알 수 없다" });
  }
  return ok(file.slice(0, file.lastIndexOf("/")));
}

export function contextsIndexPath(root: string): string {
  return `${root}/derived/contexts.sqlite`;
}

// 완성 blob을 설치한다. 있으면 다시 쓰지 않는다. 임시 파일에 쓰고 fsync한 뒤 rename한다.
function installBlob(root: string, hash: string, bytes: Uint8Array): void {
  const path = objectPathFor(root, hash);
  try {
    Deno.statSync(path);
    return;
  } catch { /* 없으면 설치한다 */ }
  const directory = path.slice(0, path.lastIndexOf("/"));
  Deno.mkdirSync(directory, { recursive: true });
  const temporary = `${root}/blobs/tmp/context-${crypto.randomUUID()}`;
  Deno.mkdirSync(`${root}/blobs/tmp`, { recursive: true });
  const file = Deno.openSync(temporary, {
    write: true,
    createNew: true,
    mode: 0o400,
  });
  try {
    file.writeSync(bytes);
    file.syncSync();
  } finally {
    file.close();
  }
  Deno.renameSync(temporary, path);
}

const FIELDS: readonly BlobFieldDefinition[] = [contextContentField];

// 내용으로 주소를 정한 blob 참조를 이 transaction에 등록한다(platform/blob-store#R4).
function registerContent(tx: Tx, reference: BlobReference): void {
  const owner = {
    owner_kind: contextContentField.owner_kind,
    owner_key: reference.hash,
    field: contextContentField.field,
  };
  const existing = tx.sql.get(
    `SELECT hash FROM blob_refs
     WHERE owner_kind = ? AND owner_key = ? AND field = ? AND hash = ?`,
    [owner.owner_kind, owner.owner_key, owner.field, reference.hash],
  );
  if (existing !== undefined) return;
  const prepared = {
    preparation: reference.hash,
    principal: BLOB_PRINCIPAL,
    purpose: BLOB_PURPOSE,
    hash: reference.hash,
    size_bytes: reference.size_bytes,
  };
  const preparations = createPreparationRegistry();
  const noted = preparations.register(prepared, 0);
  if (!noted.ok) throw new Error(noted.error.message);
  const current: RequestContext = {
    principal: BLOB_PRINCIPAL,
    actor: "machine",
    scope: { operations: [], targets: {} },
    conditions: {},
    credential_ref: BLOB_PRINCIPAL,
  };
  // registered_seq는 genesis event를 가리킨다(documents/versions의 저장과 같은 값이다): 이 blob
  // 참조는 내용 주소라 어느 event가 처음 올렸는지가 뜻이 없다.
  const registered = registerBlobRef(
    tx.sql,
    {
      preparations,
      fields: FIELDS,
      nowMs: () => 0,
      current: () => current,
    },
    {
      ...owner,
      registered_seq: "1",
      source: { kind: "prepared", blob: prepared },
    },
  );
  if (!registered.ok) throw new Error(registered.error.message);
}

function isEntry(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// derived index를 읽기 전용으로 연다. coordinator가 아닌 context worker가 유일한 writer고, 파일이
// 교체되면(재생성) 새 파일을 다시 연다. 파일이 없으면 undefined다: 빈 index로 꾸미지 않는다.
const connections = new Map<
  string,
  { identity: string; db: DatabaseSync; sql: Sql }
>();

function readOnlySql(db: DatabaseSync): Sql {
  const refuse = () => {
    throw new Error("derived index는 core에서 읽기 전용이다");
  };
  return {
    run: refuse,
    get: (text, params) =>
      db.prepare(text).get(...params) as SqlRow | undefined,
    all: (text, params) => db.prepare(text).all(...params) as SqlRow[],
  };
}

function openIndex(root: string): Sql | undefined {
  const path = contextsIndexPath(root);
  let identity: string;
  try {
    const stat = Deno.statSync(path);
    identity = `${stat.dev}:${stat.ino}`;
  } catch {
    return undefined;
  }
  const held = connections.get(path);
  if (held !== undefined && held.identity === identity) return held.sql;
  held?.db.close();
  connections.delete(path);
  try {
    const db = new DatabaseSync(path, { readOnly: true });
    const sql = readOnlySql(db);
    connections.set(path, { identity, db, sql });
    return sql;
  } catch {
    return undefined;
  }
}

function messageOf(violation: {
  kind: string;
  rule: string | null;
  path: string;
  type: string | null;
  target: string | null;
}): string {
  const at = violation.target === null ? "" : ` (${violation.target})`;
  switch (violation.kind) {
    case "rule":
      return `${violation.rule ?? "rule"} is violated${at}`;
    case "unreadable":
      return `${violation.path} cannot be read${at}`;
    case "path_mismatch":
      return `${violation.path} does not match the ${
        violation.type ?? "type"
      } pattern`;
    default:
      return `the link to ${violation.target ?? "its target"} does not resolve`;
  }
}

function parseContent(content: Record<string, unknown>): BundleContent | null {
  const parsed = bundleContentSchema.safeParse(content);
  return parsed.success ? parsed.data : null;
}

// 선언 검색은 순수 함수가 page로 자르므로, 읽기의 page 자르기에 맞게 모든 page를 이어 붙여 전체
// 행을 돌려준다. board는 lane의 행을 lane 순서대로 편다.
const execute: SearchExecutor = (entities, content, search, inputs) => {
  const bundle = parseContent(content);
  if (bundle === null) return [];
  // index는 links도 저장한다. EntityRow는 field만 싣지만 같은 객체가 links를 가진다.
  const searchable = entities as readonly SearchEntity[];
  const rows: ReturnType<typeof flatten> = [];
  let cursor: string | null = null;
  for (;;) {
    const run = runSearch({
      bundle,
      search,
      inputs,
      entities: searchable,
      cursor,
    });
    if (!run.ok) return [];
    if (run.result.kind === "board") {
      for (const lane of run.result.lanes) rows.push(...flatten(lane.rows));
      break;
    }
    rows.push(...flatten(run.result.rows));
    cursor = run.result.next_cursor;
    if (cursor === null) break;
  }
  return rows;
};

function flatten(
  rows: readonly {
    ref: unknown;
    cells: readonly { path: string; value: unknown; ref: unknown }[];
  }[],
) {
  return rows.map((row) => ({
    ref: row.ref,
    cells: row.cells.map((cell) => ({
      path: cell.path,
      value: cell.value,
      ref: cell.ref,
    })),
  })) as ReturnType<SearchExecutor>[number][];
}

export function createContextsRuntime(): ContextsRuntime {
  let current: Reader | undefined;
  const root = (): Result<string> =>
    current === undefined
      ? err({ code: "unavailable", message: "ledger 연결이 없다" })
      : dataRootOf(current);

  const blobs: ContextBlobs = {
    read(reference) {
      const base = root();
      if (!base.ok) return base;
      let bytes: Uint8Array;
      try {
        bytes = Deno.readFileSync(objectPathFor(base.value, reference.hash));
      } catch {
        return err({ code: "internal", message: "context blob을 읽지 못했다" });
      }
      if (
        bytes.length !== reference.size_bytes ||
        sha256(bytes) !== reference.hash
      ) {
        return err({ code: "internal", message: "context blob이 어긋난다" });
      }
      try {
        const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
        if (isEntry(value)) return ok(value);
      } catch { /* 아래 오류 */ }
      return err({ code: "internal", message: "context blob이 JSON이 아니다" });
    },
    put(tx, value) {
      const base = dataRootOf(tx.sql);
      if (!base.ok) throw new ContextDepUnavailable(base.error.message);
      const bytes = new TextEncoder().encode(canonicalize(value));
      const reference = { hash: sha256(bytes), size_bytes: bytes.length };
      installBlob(base.value, reference.hash, bytes);
      registerContent(tx, reference);
      return reference;
    },
  };

  const index: ContextIndexPort = {
    violations(context) {
      const base = root();
      const sql = base.ok ? openIndex(base.value) : undefined;
      if (sql === undefined) return [];
      const state = readIndexState(sql, context);
      if (state === undefined) return [];
      return readViolations(sql, context).map((violation): StoredViolation => ({
        context,
        bundle_hash: state.bundle_hash,
        kind: violation.kind,
        rule: violation.rule,
        path: violation.path,
        section: violation.section,
        type: violation.type,
        target: violation.target,
        message: messageOf(violation),
      }));
    },
    entities(context) {
      const base = root();
      const sql = base.ok ? openIndex(base.value) : undefined;
      if (sql === undefined) return [];
      return readEntities(sql, context) as EntityRow[];
    },
    entity(context, type, key) {
      const base = root();
      const sql = base.ok ? openIndex(base.value) : undefined;
      if (sql === undefined) return [];
      return readEntityWithLinks(sql, context, type, key) as EntityRow[];
    },
    ofType(context, type) {
      const base = root();
      const sql = base.ok ? openIndex(base.value) : undefined;
      if (sql === undefined) return [];
      return readEntitiesOfType(sql, context, type) as EntityRow[];
    },
    // 아직 훑은 적이 없거나 마지막 훑기가 실패한 context는 빈 결과로 꾸미지 않는다.
    failing(context) {
      const base = root();
      const sql = base.ok ? openIndex(base.value) : undefined;
      if (sql === undefined) return true;
      const state = readIndexState(sql, context);
      return state === undefined || state.result === "failed";
    },
  };

  return {
    enter(sql) {
      current = sql;
    },
    deps: {
      blobs,
      index,
      execute,
      hash: (value) => sha256(canonicalize(value)),
      // 위반 넘김 Run을 만드는 port가 lophn-agent에 아직 없다. run-loop의 AcceptRun은 보낸 run과
      // 사람 요청 message가 있는 source만 받고, 위반 근거에서 출발하는 source가 없다. 가짜 run id를
      // 만들지 않고 unavailable로 답한다(context.hand_off_violations만 이 길을 지난다).
      startHandOffRun() {
        throw new ContextDepUnavailable(
          "the hand-off run cannot be started yet",
        );
      },
      isContextEngineer(assignment) {
        if (current === undefined) return false;
        try {
          const row = current.get(
            "SELECT role FROM assignments WHERE id = ?",
            [assignment],
          );
          return row?.["role"] === "context_engineer";
        } catch {
          // assignments 표가 없는 조립에서는 Context Engineer가 없다.
          return false;
        }
      },
      appIds(slugs) {
        if (current === undefined || slugs.length === 0) return [];
        try {
          return current.all(
            `SELECT id FROM apps WHERE slug IN (${
              slugs.map(() => "?").join(", ")
            })`,
            [...slugs],
          ).map((row) => String(row["id"]));
        } catch {
          // apps 표가 없는 조립에서는 앱이 없다.
          return [];
        }
      },
    },
  };
}
