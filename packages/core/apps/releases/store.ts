import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type ReleaseRecord,
  releaseRecordSchema,
} from "../../../protocol/apps/mod.ts";
import type { AppDeclaration } from "../declaration/mod.ts";
import type { Sql, SqlRow, Tx } from "../../../protocol/server/mod.ts";
import type { AppFacts, CurrentFacts } from "../permissions/mod.ts";

type Query = Pick<Sql, "get" | "all">;

function invalidStored(): Result<never> {
  return err({ code: "internal", message: "invalid stored release" });
}

function parseJson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  return JSON.parse(String(value));
}

function releaseFromRow(row: SqlRow): Result<ReleaseRecord> {
  let parsed;
  try {
    parsed = releaseRecordSchema.safeParse({
      id: row.id,
      app: row.app,
      number: Number(row.number),
      code_commit: row.code_commit,
      bundle_hash: row.bundle_hash,
      declaration_hash: row.declaration_hash,
      data_schema: Number(row.data_schema),
      data_changes: parseJson(row.data_changes),
      created_by: row.created_by,
      created_at: row.created_at,
      status: row.status,
      activation: parseJson(row.activation),
      activated_at: row.activated_at ?? null,
      failure: parseJson(row.failure),
    });
  } catch {
    return invalidStored();
  }
  return parsed.success ? ok(parsed.data) : invalidStored();
}

export function loadRelease(
  sql: Query,
  id: string,
): Result<ReleaseRecord | null> {
  const row = sql.get("SELECT * FROM releases WHERE id = ?", [id]);
  if (row === undefined) return ok(null);
  return releaseFromRow(row);
}

// 준비 순서(app 안 number)다. 같은 앱의 release만 낸다.
export function loadReleases(
  sql: Query,
  filter: { app?: string; status?: string },
): Result<ReleaseRecord[]> {
  const where: string[] = [];
  const params: string[] = [];
  if (filter.app !== undefined) {
    where.push("app = ?");
    params.push(filter.app);
  }
  if (filter.status !== undefined) {
    where.push("status = ?");
    params.push(filter.status);
  }
  const rows = sql.all(
    `SELECT * FROM releases ${
      where.length === 0 ? "" : `WHERE ${where.join(" AND ")}`
    } ORDER BY app, number`,
    params,
  );
  const releases: ReleaseRecord[] = [];
  for (const row of rows) {
    const release = releaseFromRow(row);
    if (!release.ok) return release;
    releases.push(release.value);
  }
  return ok(releases);
}

// 앱이 채택한 release의 행이다(status = active는 앱마다 하나다). 없으면 null이다.
export function loadActiveRelease(
  sql: Query,
  app: string,
): Result<ReleaseRecord | null> {
  const row = sql.get(
    "SELECT * FROM releases WHERE app = ? AND status = 'active'",
    [app],
  );
  if (row === undefined) return ok(null);
  return releaseFromRow(row);
}

type StoredDeclaration = {
  release: ReleaseRecord;
  declaration: AppDeclaration;
  facts: AppFacts;
};

function storedOf(row: SqlRow): Result<StoredDeclaration> {
  const release = releaseFromRow(row);
  if (!release.ok) return release;
  try {
    return ok({
      release: release.value,
      declaration: JSON.parse(String(row.blueprint)) as AppDeclaration,
      facts: JSON.parse(String(row.declarations)) as AppFacts,
    });
  } catch {
    return invalidStored();
  }
}

// release에 고정한 blueprint와 선언 사실. 준비 뒤 불변이다.
export function loadStoredDeclaration(
  sql: Query,
  release: string,
): Result<StoredDeclaration | null> {
  const row = sql.get("SELECT * FROM releases WHERE id = ?", [release]);
  return row === undefined ? ok(null) : storedOf(row);
}

// 앱이 채택한 release의 고정 blueprint. active release가 없으면 null이다.
export function loadActiveDeclaration(
  sql: Query,
  app: string,
  release?: string,
): Result<StoredDeclaration | null> {
  if (release !== undefined) {
    const found = loadStoredDeclaration(sql, release);
    return !found.ok || found.value === null || found.value.release.app === app
      ? found
      : ok(null);
  }
  const row = sql.get(
    "SELECT * FROM releases WHERE app = ? AND status = 'active'",
    [app],
  );
  return row === undefined ? ok(null) : storedOf(row);
}

// 같은 bundle의 아직 올리지 않은 release. prepared만 다시 준다: `release.activate`는 prepared만 받아
// 다른 상태의 release를 다시 주면 그 commit을 다시 올릴 수 없다(drain·start 같은 일시 실패로 failed가 된 것 포함).
export function findPreparedRelease(
  sql: Query,
  app: string,
  bundleHash: string,
): Result<ReleaseRecord | null> {
  const row = sql.get(
    `SELECT * FROM releases WHERE app = ? AND bundle_hash = ? AND status = 'prepared'
     ORDER BY number DESC LIMIT 1`,
    [app, bundleHash],
  );
  return row === undefined ? ok(null) : releaseFromRow(row);
}

export function nextReleaseNumber(sql: Query, app: string): number {
  const row = sql.get(
    "SELECT COALESCE(MAX(number), 0) + 1 AS next FROM releases WHERE app = ?",
    [app],
  );
  return Number(row?.next ?? 1);
}

export function insertRelease(
  tx: Pick<Tx, "sql">,
  release: ReleaseRecord,
  canonicalDeclaration: string,
  declarations: AppFacts,
): void {
  tx.sql.run(
    `INSERT INTO releases
      (id, app, number, code_commit, bundle_hash, declaration_hash, data_schema,
       data_changes, created_by, created_at, status, activation,
       failure, blueprint, declarations)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
    [
      release.id,
      release.app,
      release.number,
      release.code_commit,
      release.bundle_hash,
      release.declaration_hash,
      release.data_schema,
      JSON.stringify(release.data_changes),
      release.created_by,
      release.created_at,
      release.status,
      canonicalDeclaration,
      JSON.stringify(declarations),
    ],
  );
}

// permissions의 `currentFacts` port 구현이다. 앱이 채택한 release(status = active)의 선언
// 사실을 부른 쪽의 transaction·snapshot sql로 읽는다. active release가 없으면 null이다.
// App.active_release 참조는 같은 transaction에서 바뀌므로 읽는 쪽이 따로 맞추지 않는다.
export const releaseFacts: CurrentFacts = {
  get(sql, app) {
    const row = sql.get(
      "SELECT declarations FROM releases WHERE app = ? AND status = 'active'",
      [app],
    );
    if (row === undefined) return ok(null);
    try {
      return ok(JSON.parse(String(row.declarations)) as AppFacts);
    } catch {
      return invalidStored();
    }
  },
};
