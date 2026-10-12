import { err, ok, type Result } from "../../base/mod.ts";
import { type Release, releaseSchema } from "../../protocol/apps/mod.ts";
import type { ProblemWordingFact } from "../../protocol/problems/mod.ts";
import type { Blueprint } from "../blueprint/mod.ts";
import type { Sql, SqlRow, Tx } from "../../protocol/platform/mod.ts";
import type {
  AppDeclarations,
  CurrentDeclarations,
} from "../permissions/mod.ts";

type Query = Pick<Sql, "get" | "all">;

function invalidStored(): Result<never> {
  return err({ code: "internal", message: "invalid stored release" });
}

function parseJson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  return JSON.parse(String(value));
}

function testsOf(sql: Query, release: string): string[] {
  return sql.all(
    "SELECT verification FROM release_tests WHERE release = ? ORDER BY verification",
    [release],
  ).map((row) => String(row.verification));
}

export function releaseFromRow(sql: Query, row: SqlRow): Result<Release> {
  let parsed;
  try {
    parsed = releaseSchema.safeParse({
      id: row.id,
      app: row.app,
      number: Number(row.number),
      code_commit: row.code_commit,
      bundle_hash: row.bundle_hash,
      blueprint_hash: row.blueprint_hash,
      data_schema: Number(row.data_schema),
      data_changes: parseJson(row.data_changes),
      tests: testsOf(sql, String(row.id)),
      ticket_source: parseJson(row.ticket_source),
      created_by: row.created_by,
      created_at: row.created_at,
      status: row.status,
      activation: parseJson(row.activation),
      failure: parseJson(row.failure),
    });
  } catch {
    return invalidStored();
  }
  return parsed.success ? ok(parsed.data) : invalidStored();
}

export function loadRelease(sql: Query, id: string): Result<Release | null> {
  const row = sql.get("SELECT * FROM releases WHERE id = ?", [id]);
  if (row === undefined) return ok(null);
  return releaseFromRow(sql, row);
}

// 준비 순서(app 안 number)다. 같은 앱의 release만 낸다.
export function loadReleases(
  sql: Query,
  filter: { app?: string; status?: string },
): Result<Release[]> {
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
  const releases: Release[] = [];
  for (const row of rows) {
    const release = releaseFromRow(sql, row);
    if (!release.ok) return release;
    releases.push(release.value);
  }
  return ok(releases);
}

// 앱이 채택한 release의 행이다(status = active는 앱마다 하나다). 없으면 null이다.
export function loadActiveRelease(
  sql: Query,
  app: string,
): Result<Release | null> {
  const row = sql.get(
    "SELECT * FROM releases WHERE app = ? AND status = 'active'",
    [app],
  );
  if (row === undefined) return ok(null);
  return releaseFromRow(sql, row);
}

export type StoredBlueprint = {
  release: Release;
  blueprint: Blueprint;
  declarations: AppDeclarations;
};

function storedOf(sql: Query, row: SqlRow): Result<StoredBlueprint> {
  const release = releaseFromRow(sql, row);
  if (!release.ok) return release;
  try {
    return ok({
      release: release.value,
      blueprint: JSON.parse(String(row.blueprint)) as Blueprint,
      declarations: JSON.parse(String(row.declarations)) as AppDeclarations,
    });
  } catch {
    return invalidStored();
  }
}

// release에 고정한 blueprint와 선언 사실. 준비 뒤 불변이다.
export function loadStoredBlueprint(
  sql: Query,
  release: string,
): Result<StoredBlueprint | null> {
  const row = sql.get("SELECT * FROM releases WHERE id = ?", [release]);
  return row === undefined ? ok(null) : storedOf(sql, row);
}

// 앱이 채택한 release의 고정 blueprint. active release가 없으면 null이다.
export function loadActiveBlueprint(
  sql: Query,
  app: string,
  release?: string,
): Result<StoredBlueprint | null> {
  if (release !== undefined) {
    const found = loadStoredBlueprint(sql, release);
    return !found.ok || found.value === null || found.value.release.app === app
      ? found
      : ok(null);
  }
  const row = sql.get(
    "SELECT * FROM releases WHERE app = ? AND status = 'active'",
    [app],
  );
  return row === undefined ? ok(null) : storedOf(sql, row);
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
  release: Release,
  canonicalBlueprint: string,
  declarations: AppDeclarations,
): void {
  tx.sql.run(
    `INSERT INTO releases
      (id, app, number, code_commit, bundle_hash, blueprint_hash, data_schema,
       data_changes, ticket_source, created_by, created_at, status, activation,
       failure, blueprint, declarations)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
    [
      release.id,
      release.app,
      release.number,
      release.code_commit,
      release.bundle_hash,
      release.blueprint_hash,
      release.data_schema,
      JSON.stringify(release.data_changes),
      release.ticket_source === null
        ? null
        : JSON.stringify(release.ticket_source),
      release.created_by,
      release.created_at,
      release.status,
      canonicalBlueprint,
      JSON.stringify(declarations),
    ],
  );
  for (const verification of release.tests) {
    tx.sql.run(
      "INSERT INTO release_tests (release, verification) VALUES (?, ?)",
      [release.id, verification],
    );
  }
}

// permissions의 `currentDeclarations` port 구현이다. 앱이 채택한 release(status = active)의 선언
// 사실을 부른 쪽의 transaction·snapshot sql로 읽는다. active release가 없으면 null이다.
// App.active_release 참조는 같은 transaction에서 바뀌므로 읽는 쪽이 따로 맞추지 않는다.
export const releaseDeclarations: CurrentDeclarations = {
  get(sql, app) {
    const row = sql.get(
      "SELECT declarations FROM releases WHERE app = ? AND status = 'active'",
      [app],
    );
    if (row === undefined) return ok(null);
    try {
      return ok(JSON.parse(String(row.declarations)) as AppDeclarations);
    } catch {
      return invalidStored();
    }
  },
};

// problems의 `ProblemWording` port 구현이다(problems#T27). 보고 당시 release에 고정한
// blueprint의 선언 문구와 앱 등록 기록의 이름을 부른 쪽의 snapshot sql로 읽는다. 보고 당시
// 문구다: 새 release가 선언을 바꾸거나 지워도 이전 보고의 답은 그 release의 선언이다. 앱
// 이름은 선언이 없어도 부르는 쪽이 fallback에 붙일 수 있게 항상 준다. 그 release가 없거나
// 선언에 그 code가 없으면 declaration이 null이다.
export function releaseWording(
  sql: Query,
  app: string,
  release: string,
  code: string,
): Result<ProblemWordingFact | null> {
  const appRow = sql.get("SELECT name FROM apps WHERE id = ?", [app]);
  const app_name = appRow === undefined ? app : String(appRow.name);
  const stored = loadStoredBlueprint(sql, release);
  if (!stored.ok) return stored;
  if (stored.value === null) return ok({ app_name, declaration: null });
  const declared = stored.value.blueprint.problem_codes.find(
    (entry) => entry.code === code,
  );
  return ok({ app_name, declaration: declared ?? null });
}
