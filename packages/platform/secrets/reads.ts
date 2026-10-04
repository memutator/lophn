// 조회는 이름·설정 여부만 돌려준다(platform/secrets#R4). sealed_ref는 나가지 않는다.

import { err, ok, type Result } from "../../base/mod.ts";
import type { SecretStatus, Sql } from "../../contracts/platform/mod.ts";
import { toStatus } from "./model.ts";

type NameRow = { name: string; revision: number | bigint };

export type SecretView = {
  // 이 caller가 볼 수 있는 이름. 권한 밖 이름은 여기 없다.
  allowed(name: string): boolean;
  status(name: string): SecretStatus | undefined;
};

export function readSecretStatuses(
  sql: Sql,
  allowed: readonly string[],
  requested: readonly string[] | undefined,
): Result<{ secrets: SecretStatus[] }> {
  const visible = requested === undefined
    ? [...allowed]
    : requested.filter((name) => allowed.includes(name));
  if (requested !== undefined && visible.length !== requested.length) {
    // 권한 없는 이름과 없는 이름을 구별하지 않는다(R4).
    return err({ code: "forbidden", message: "secret을 볼 수 없다" });
  }
  const rows: NameRow[] = visible.length === 0 ? [] : sql.all(
    `select name, revision from secrets where name in (${
      visible.map(() => "?").join(", ")
    })`,
    [...visible],
  ) as NameRow[];
  const byName = new Map(
    rows.map((row) => [String(row.name), Number(row.revision)]),
  );
  return ok({
    secrets: visible.map((name) => {
      const revision = byName.get(name);
      return toStatus(
        revision === undefined ? undefined : { name, sealedRef: "", revision },
        name,
      );
    }),
  });
}
