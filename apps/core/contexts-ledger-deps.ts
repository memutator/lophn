// ContextLedgerDeps의 실제 구현: content blob 읽기, derived index 읽기, 선언 검색 실행, hash,
// Context Engineer 판별, 위반 넘김 Run. command를 실행하는 writer Worker와 read를 실행하는 reader
// Worker 안에서만 올라온다(contexts-api.ts의 loadContextsRuntime). node:sqlite와 동기 file API를
// 쓰므로 core 본체의 module graph에 들어오면 안 된다(platform/responsiveness#R1).
// 그래서 index 저장소는 packages/documents/contexts/mod.ts barrel이 아니라 index/mod.ts를 직접 연다.
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { canonicalize, err, ok, type Result } from "../../packages/base/mod.ts";
import type { Sql, SqlRow } from "../../packages/contracts/platform/mod.ts";
import {
  type BundleContent,
  bundleContentSchema,
  type StoredViolation,
} from "../../packages/contracts/documents/mod.ts";
import { objectPathFor } from "../../packages/platform/blob-store/mod.ts";
import {
  type ContextBlobs,
  type ContextIndexPort,
  type EntityRow,
  runSearch,
  type SearchEntity,
  type SearchExecutor,
  violationMessage,
} from "../../packages/documents/contexts/mod.ts";
import {
  readEntities,
  readEntitiesOfType,
  readEntityWithLinks,
  readIndexState,
  readViolations,
} from "../../packages/documents/contexts/index/mod.ts";
import {
  type ConversationDeps,
  startRequest,
} from "../../packages/lophn-agent/conversation/mod.ts";
import { createRunCommands } from "../../packages/lophn-agent/harness/run-loop/mod.ts";
import {
  ContextDepRefused,
  type ContextsRuntime,
} from "./contexts-api.ts";
import { handOffContent } from "./contexts-handoff.ts";

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

// 요청 접수는 run-loop의 AcceptRun을 같은 transaction에서 부른다. AcceptRun은 machine 전용 기록이라
// 이 접수에 한해 machine 자격으로 바꿔 넘긴다(apps/core/lophn-agent.ts의 조립과 같다).
const runCommands = createRunCommands();
const conversationDeps: ConversationDeps = {
  acceptRun: (tx, ctx, input, compare) =>
    runCommands.accept.handle(tx, { ...ctx, actor: "machine" }, input, compare),
};

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
        message: violationMessage(violation),
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
      // 위반 넘김은 사람 한 번의 요청이다: 그 context의 project를 작업 자리로 하는 Context Engineer의
      // 새 세션에 서버가 붙인 근거를 글로 옮긴 사람 요청 message를 두고, 담당 Run 하나를 접수한다
      // (lophn-agent/conversation의 startRequest). 세션·message·Run이 이 transaction 안이라 enabled
      // Context Engineer가 없으면 unavailable로 전부 되돌아간다.
      startHandOffRun(tx, request) {
        const owner = tx.sql.get("SELECT project FROM contexts WHERE id = ?", [
          request.context,
        ]);
        if (owner === undefined) {
          throw new ContextDepRefused("not_found", "context not found");
        }
        // 요청 글은 근거 값에서 만든다. 그 blob은 호출 경계가 같은 값으로 미리 준비했고 여기서는
        // 요청 자격의 준비 참조로 등록만 한다(파일을 쓰지 않는다).
        const content = handOffContent(request.evidenceValue);
        const body = request.registerContent(content);
        if (!body.ok) {
          throw new ContextDepRefused(body.error.code, body.error.message);
        }
        const started = startRequest(conversationDeps, tx, {
          role: "context_engineer",
          work_place: { kind: "project", id: String(owner["project"]) },
          content,
          body: body.value,
        });
        if (started.ok) return started.value.run;
        // 세션·Run 접수가 거절한 코드 그대로 답한다(없는 project는 not_found, 받을 assignment가 없으면
        // unavailable). 접수 쪽은 internal 말고 문서가 정한 코드만 낸다.
        throw new ContextDepRefused(started.error.code, started.error.message);
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
