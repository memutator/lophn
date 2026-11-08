import { compareVersions, err, ok, type Result } from "../../../base/mod.ts";
import type { Package, PackageVersion } from "../../../protocol/apps/mod.ts";
import type { Sql, SqlRow, Tx } from "../../../protocol/server/mod.ts";
import { packageFromRow, versionFromRow } from "./rows.ts";

type Query = Pick<Sql, "get" | "all">;

// 이름으로 패키지 기본 행을 찾는다. 없는 이름은 null이다.
export function loadPackageRow(sql: Query, name: string): SqlRow | undefined {
  return sql.get("SELECT * FROM packages WHERE name = ?", [name]);
}

// 잡힌 version 값. 등록된 판만 남는다(자동 최신 선택은 없다).
export function loadVersions(sql: Query, packageId: string): PackageVersion[] {
  const rows = sql.all("SELECT * FROM package_versions WHERE package = ?", [
    packageId,
  ]);
  const versions: PackageVersion[] = [];
  for (const row of rows) {
    const version = versionFromRow(row);
    if (!version.ok) continue;
    versions.push(version.value);
  }
  // 문자열 정렬은 0.10.0을 0.9.0 앞에 놓으므로 코드에서 숫자로 정렬한다.
  return versions.sort((a, b) => compareVersions(a.version, b.version));
}

// 이름 → catalog 값(잡힌 version 포함). 없는 이름은 null이다.
export function loadPackage(sql: Query, name: string): Result<Package | null> {
  const row = loadPackageRow(sql, name);
  if (row === undefined) return ok(null);
  const versions = loadVersions(sql, row["id"] as string);
  if (versions.length === 0) {
    return err({ code: "internal", message: "package has no version" });
  }
  return packageFromRow(row, versions);
}

// catalog 전체 행. 페이징은 reads.ts의 cursor가 한다.
export function loadAllPackageRows(sql: Query): SqlRow[] {
  return sql.all("SELECT * FROM packages ORDER BY name", []);
}

// release에 고정된 선언의 sdk_dependencies에서 그 version을 쓰는 release를 찾는다.
// release 내용은 준비 뒤 바뀌지 않으므로 package에 새 version이 나와도 기존 사용처는 그대로다.
// 지금 켜진 release만 센다: archived 앱과 지난 release는 그 version으로 더 돌지 않아 사용처로 보이면
// 고칠 곳을 잘못 짚게 된다.
export function loadUsages(
  sql: Query,
  name: string,
  version: string,
): { app: string; release: string }[] {
  const rows = sql.all(
    `SELECT DISTINCT r.app AS app, r.id AS release, r.created_at AS created_at
     FROM releases r
     JOIN apps a ON a.id = r.app AND a.status = 'active',
       json_each(r.declaration, '$.sdk_dependencies') d
     WHERE r.status = 'active'
       AND json_extract(d.value, '$.name') = ?
       AND json_extract(d.value, '$.version') = ?
     ORDER BY r.created_at, r.id`,
    [name, version],
  );
  return rows.map((row) => ({
    app: row["app"] as string,
    release: row["release"] as string,
  }));
}

// register_version command의 저장. 이미 잡힌 version인지 본다.
export function loadStoredVersion(
  tx: Pick<Tx, "sql">,
  packageId: string,
  version: string,
): SqlRow | undefined {
  return tx.sql.get(
    "SELECT * FROM package_versions WHERE package = ? AND version = ?",
    [packageId, version],
  );
}
