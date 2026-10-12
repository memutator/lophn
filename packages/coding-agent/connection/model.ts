import { err, ok, type Result } from "../../base/mod.ts";
import {
  type Connection,
  type ConnectionId,
  connectionPrincipal,
  connectionSchema,
  type ConnectionScope,
  type ConnectionState,
} from "../../protocol/coding-agent/mod.ts";

// scope는 생성 뒤 불변이다. all이면 앱이 없고 app이면 앱 하나가 필수다.
export function scopeColumns(
  scope: ConnectionScope,
): Result<{ scope_kind: "all" | "app"; scope_app: string | null }> {
  if (scope.kind === "all") {
    if (scope.app !== null) {
      return err({ code: "invalid_input", message: "all scope has no app" });
    }
    return ok({ scope_kind: "all", scope_app: null });
  }
  if (scope.app === null || scope.app === undefined) {
    return err({ code: "invalid_input", message: "app scope requires an app" });
  }
  return ok({ scope_kind: "app", scope_app: scope.app });
}

export function principalFor(id: ConnectionId): string {
  return connectionPrincipal(id);
}

// active에서 revoked로만 간다. 재활성화는 없다.
export function nextState(
  current: ConnectionState,
): Result<"revoked"> {
  if (current !== "active") {
    return err({
      code: "conflict",
      message: "revoked connection cannot be reactivated",
    });
  }
  return ok("revoked");
}

export function assertConnection(value: Connection): Result<Connection> {
  const parsed = connectionSchema.safeParse(value);
  if (!parsed.success) {
    return err({ code: "invalid_input", message: "invalid connection" });
  }
  if (parsed.data.principal !== principalFor(parsed.data.id)) {
    return err({
      code: "invalid_input",
      message: "principal must be coding_agent:<id>",
    });
  }
  return ok(parsed.data);
}
