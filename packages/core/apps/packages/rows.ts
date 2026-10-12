import { err, ok, type Result } from "../../../base/mod.ts";
import type { Package, PackageVersion } from "../../../protocol/apps/mod.ts";
import type { SqlRow } from "../../../protocol/platform/mod.ts";

// packages 행 → catalog 값. package_versions의 잡힌 version을 붙여 조립한다.
export function packageFromRow(
  row: SqlRow,
  versions: readonly PackageVersion[],
): Result<Package> {
  const id = row["id"];
  const name = row["name"];
  const description = row["description"];
  const kind = row["kind"];
  if (
    typeof id !== "string" || typeof name !== "string" ||
    typeof description !== "string" || typeof kind !== "string"
  ) {
    return err({ code: "internal", message: "invalid stored package" });
  }
  if (versions.length === 0) {
    return err({ code: "internal", message: "package has no version" });
  }
  return ok({
    id,
    name,
    description,
    kind: kind as Package["kind"],
    versions: [...versions],
  });
}

// package_versions 행 → 공개 version 값.
export function versionFromRow(row: SqlRow): Result<PackageVersion> {
  const version = row["version"];
  const bundleHash = row["bundle_hash"];
  const guideHash = row["guide_hash"];
  if (
    typeof version !== "string" || typeof bundleHash !== "string" ||
    typeof guideHash !== "string"
  ) {
    return err({ code: "internal", message: "invalid stored package version" });
  }
  return ok({ version, bundle_hash: bundleHash, guide_hash: guideHash });
}
