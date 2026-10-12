// 조회는 이름·설정 여부만 돌려준다. sealed_ref는 나가지 않는다.

import { err, ok, type Result } from "../../base/mod.ts";
import type { ReadDefinition, Sql } from "../../protocol/server/mod.ts";
import { listSecrets, type SecretStatus } from "../../protocol/secrets/mod.ts";
import { toStatus } from "./model.ts";

type NameRow = { name: string; revision: number | bigint };

export type SecretView = {
  // 이 caller가 볼 수 있는 이름. 권한 밖 이름은 여기 없다.
  allowed(name: string): boolean;
  status(name: string): SecretStatus | undefined;
};

export function readSecretStatuses(
  sql: Pick<Sql, "all">,
  allowed: readonly string[],
  requested: readonly string[] | undefined,
): Result<{ secrets: SecretStatus[] }> {
  const visible = requested === undefined
    ? [...allowed]
    : requested.filter((name) => allowed.includes(name));
  if (requested !== undefined && visible.length !== requested.length) {
    // 권한 없는 이름과 없는 이름을 구별하지 않는다.
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

// `/v1/secrets/list` handler. 사람은 설정된 이름을 모두 본다. 다른 actor의 이름 허용은 소유
// concern의 grant 검사가 맡으므로(apps/permissions) 이 read는 그들에게 이름을 열지 않는다.
// 권한 없는 이름과 없는 이름은 같은 거절이다. sealed_ref는 나가지 않는다.
export function secretsListRead(): ReadDefinition<typeof listSecrets> {
  return {
    route: listSecrets,
    handle(snapshot, ctx, input) {
      const allowed = ctx.actor === "user"
        ? snapshot.sql.all("select name from secrets order by name", [])
          .map((row) => String(row["name"]))
        : [];
      const read = readSecretStatuses(snapshot.sql, allowed, input.names);
      if (!read.ok) return read;
      return ok({
        ...read.value,
        as_of_seq: snapshot.as_of_seq,
        next_cursor: null,
      });
    },
  };
}
