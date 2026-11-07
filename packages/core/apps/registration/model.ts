import { err, ERROR_CODES, type Result } from "../../../base/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import type { App } from "../../../protocol/apps/mod.ts";
import {
  type AuthorizationTarget,
  type RequestContext,
  type Sql,
  TargetAuthorization,
  type TargetAuthorizer,
} from "../../../protocol/server/mod.ts";

// command는 현재 App과 변경 후보를 판정한다. read는 App 하나다.
export type AppAccessTarget =
  | { kind: "command"; before: App | null; after: Omit<App, "revision"> }
  | { kind: "app"; app: App };

function dependencyUnavailable(): Result<never> {
  return err({
    code: "unavailable",
    message: "app dependency unavailable",
  });
}

// ReadSnapshot과 Tx가 이 모양이다.
type AppAccessSource = {
  port: (<T>(key: { readonly name: string }) => T) | undefined;
  sql: Pick<Sql, "get">;
};

// archived 앱은 agent에게 없는 앱과 같다. 앱을 다루는 agent 쪽 길(read, command)이 모두 authorizeApp을 거치므로
// 필터는 여기 하나다. 사람(user)의 화면은 거르지 않는다: 되살리기가 그 화면에서 일어난다.
export function archivedToAgent(
  sql: Pick<Sql, "get">,
  ctx: RequestContext,
  app: string,
): boolean {
  if (parseActor(ctx.actor)?.kind !== "agent") return false;
  return (
    sql.get(
      "select 1 as found from apps where id = ? and status = 'archived'",
      [app],
    ) !== undefined
  );
}

// TargetAuthorization이 없으면, Promise거나 반환이 Result가 아니면 fail-closed다.
export function authorizeApp(
  { port, sql }: AppAccessSource,
  ctx: RequestContext,
  operation: string,
  target: AppAccessTarget,
): Result<void> {
  const app = target.kind === "command" ? target.after.id : target.app.id;
  if (archivedToAgent(sql, ctx, app)) {
    return err({ code: "not_found", message: "app not found" });
  }
  let authorize: unknown;
  try {
    authorize = port?.(TargetAuthorization);
  } catch {
    return dependencyUnavailable();
  }
  if (typeof authorize !== "function") return dependencyUnavailable();
  try {
    const result = synchronousResult<void>(
      (authorize as TargetAuthorizer)(
        ctx,
        operation,
        authorizationTarget(target),
      ),
    );
    return result.ok && result.value !== undefined
      ? dependencyUnavailable()
      : result;
  } catch {
    return dependencyUnavailable();
  }
}

// App row 없이 ID만으로 범위를 판정한다. 다른 앱의 기록(invocation 등)을 읽는 곳이 쓴다.
export function authorizeAppId(
  source: AppAccessSource,
  ctx: RequestContext,
  operation: string,
  app: string,
): Result<void> {
  return authorizeApp(source, ctx, operation, {
    kind: "app",
    app: { id: app } as unknown as App,
  });
}

function authorizationTarget(target: AppAccessTarget): AuthorizationTarget {
  const value: Record<string, string> = {
    app: target.kind === "command" ? target.after.id : target.app.id,
  };
  if (target.kind === "command" && target.before !== null) {
    value.before_app = target.before.id;
  }
  return value;
}

// 읽기·보관 경계가 same-owner 거절인 forbidden·not_found를 한 방식으로 건너뛴다.
export function denied(result: Result<unknown>): boolean {
  return (
    !result.ok &&
    (result.error.code === "forbidden" || result.error.code === "not_found")
  );
}

function synchronousResult<T>(value: unknown): Result<T> {
  if (value instanceof Promise) {
    void value.catch(() => {});
    return dependencyUnavailable();
  }
  if (typeof value !== "object" || value === null || "then" in value) {
    return dependencyUnavailable();
  }
  if ("ok" in value && value.ok === true && "value" in value) {
    return value as Result<T>;
  }
  if ("ok" in value && value.ok === false && "error" in value) {
    const error = value.error;
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      ERROR_CODES.some((code) => code === error.code) &&
      "message" in error &&
      typeof error.message === "string"
    ) {
      return value as Result<T>;
    }
  }
  return dependencyUnavailable();
}

// slug의 대시·밑줄을 공백으로 바꾸고 단어 첫 글자를 대문자로 한다.
// 이미 대문자인 토큰(MAHAS)은 그대로 둔다.
