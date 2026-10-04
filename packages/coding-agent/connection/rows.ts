import { err, ok, type Result } from "../../base/mod.ts";
import {
  type Connection,
  connectionSchema,
} from "../../contracts/coding-agent/mod.ts";
import type { SqlRow } from "../../contracts/platform/mod.ts";

function invalidStored(): Result<never> {
  return err({ code: "internal", message: "invalid stored connection" });
}

export function connectionFromRow(row: SqlRow): Result<Connection> {
  const scope = row.scope_kind === "all"
    ? { kind: "all" as const, app: null }
    : row.scope_kind === "app"
    ? { kind: "app" as const, app: row.scope_app }
    : null;
  if (scope === null) return invalidStored();
  const parsed = connectionSchema.safeParse({
    id: row.id,
    label: row.label,
    scope,
    principal: row.principal,
    state: row.state,
    revision: typeof row.revision === "bigint"
      ? row.revision.toString()
      : row.revision,
  });
  if (!parsed.success) return invalidStored();
  if (
    (parsed.data.scope.kind === "all" && row.scope_app !== null) ||
    (parsed.data.scope.kind === "app" &&
      row.scope_app !== parsed.data.scope.app)
  ) {
    return invalidStored();
  }
  return ok(parsed.data);
}

// 일반 읽기·event에 검증 digest를 싣지 않는지 row에서 공개 값만 고른다.
export function publicConnection(connection: Connection): Connection {
  return {
    id: connection.id,
    label: connection.label,
    scope: connection.scope,
    principal: connection.principal,
    state: connection.state,
    revision: connection.revision,
  };
}
