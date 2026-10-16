// ContextLedgerDeps의 실제 구현: content blob 읽기, derived index 읽기, 선언 검색 실행, hash. command를 실행하는 writer Worker와 read를 실행하는 reader
// Worker 안에서만 올라온다(contexts-api.ts의 loadContextsRuntime). node:sqlite와 동기 file API를
// 쓰므로 core 본체의 module graph에 들어오면 안 된다.
// 그래서 index 저장소는 packages/core/projects/contexts/mod.ts barrel이 아니라 index/mod.ts를 직접 연다.
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { canonicalize, err, ok, type Result } from "../../../../base/mod.ts";
import type { Sql, SqlRow } from "../../../../protocol/server/mod.ts";
import {
  type BundleContent,
  bundleContentSchema,
  type StoredViolation,
} from "../../../../protocol/projects/mod.ts";
import { objectPathFor } from "../../../storage/blobs/mod.ts";
import type { ContextFolders } from "../../ports.ts";
import { createContextFolders } from "../folders.ts";
import { createContextFiles } from "./files.ts";
import {
  type ContextBlobs,
  type ContextIndexPort,
  type EntityRow,
  runSearch,
  type SearchEntity,
  type SearchExecutor,
  violationMessage,
} from "../mod.ts";
import {
  readEntities,
  readEntitiesOfType,
  readEntityWithLinks,
  readIndexState,
  readViolations,
} from "../index/mod.ts";
import { loadActiveBlueprint } from "../../../apps/releases/store.ts";
import { ContextDepUnavailable, type ContextsRuntime } from "../register.ts";

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

  // 초안·저장 목차 폴더는 data root 아래다. ledger 연결이 없으면 위치를 알 수 없다.
  const foldersAt = (): ContextFolders => {
    const base = root();
    if (!base.ok) throw new ContextDepUnavailable(base.error.message);
    return createContextFolders(base.value);
  };
  const folders: ContextFolders = {
    draftFolder: (project, context, bundle) =>
      foldersAt().draftFolder(project, context, bundle),
    outlineFolder: (project, context) =>
      foldersAt().outlineFolder(project, context),
  };

  const files = createContextFiles();

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
      folders,
      files,
      execute,
      hash: (value) => sha256(canonicalize(value)),
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
      // 검사 환경의 앱 command 효과: active 앱의 active release에 고정된 blueprint의 command 선언
      // (`app.blueprint`가 읽어 주는 것과 같다). 앱을 부르지 않는다.
      appCommandEffect(app, command) {
        if (current === undefined) return undefined;
        try {
          const row = current.get(
            "SELECT id FROM apps WHERE slug = ? AND status = 'active'",
            [app],
          );
          if (row === undefined) return undefined;
          const stored = loadActiveBlueprint(current, String(row["id"]));
          if (!stored.ok || stored.value === null) return undefined;
          return stored.value.blueprint.app_api.find((declared) =>
            declared.key === command
          )?.effect;
        } catch {
          // apps·releases 표가 없는 조립에서는 앱 선언이 없다.
          return undefined;
        }
      },
    },
  };
}
