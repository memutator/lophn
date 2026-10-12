import { err, ERROR_CODES, type Result } from "../../../base/mod.ts";
import type { App } from "../../../protocol/apps/mod.ts";
import {
  type AuthorizationTarget,
  type RequestContext,
  TargetAuthorization,
  type TargetAuthorizer,
} from "../../../protocol/server/mod.ts";
import type { EventEnvelopeFor } from "../../../protocol/events/mod.ts";
import type {
  appArchived,
  appCreated,
  appSourceConnected,
  appUnarchived,
} from "../../../protocol/apps/mod.ts";

export type AppEvent =
  | EventEnvelopeFor<typeof appCreated>
  | EventEnvelopeFor<typeof appSourceConnected>
  | EventEnvelopeFor<typeof appArchived>
  | EventEnvelopeFor<typeof appUnarchived>;

// command는 현재 App과 변경 후보를 판정한다. read는 App 하나다.
export type AppAccessTarget =
  | { kind: "command"; before: App | null; after: Omit<App, "revision"> }
  | { kind: "app"; app: App };

export type AppAuthorizer = TargetAuthorizer;

export function dependencyUnavailable(): Result<never> {
  return err({
    code: "unavailable",
    message: "app dependency unavailable",
  });
}

// TargetAuthorization이 없으면, Promise거나 반환이 Result가 아니면 fail-closed다.
export function authorizeApp(
  port: (<T>(key: { readonly name: string }) => T) | undefined,
  ctx: RequestContext,
  operation: string,
  target: AppAccessTarget,
): Result<void> {
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
  port: (<T>(key: { readonly name: string }) => T) | undefined,
  ctx: RequestContext,
  operation: string,
  app: string,
): Result<void> {
  return authorizeApp(port, ctx, operation, {
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
  return !result.ok &&
    (result.error.code === "forbidden" || result.error.code === "not_found");
}

export function synchronousResult<T>(value: unknown): Result<T> {
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
      typeof error === "object" && error !== null &&
      "code" in error && ERROR_CODES.some((code) => code === error.code) &&
      "message" in error && typeof error.message === "string"
    ) {
      return value as Result<T>;
    }
  }
  return dependencyUnavailable();
}

const DASH = /[-_]+/g;

// slug의 대시·밑줄을 공백으로 바꾸고 단어 첫 글자를 대문자로 한다.
// 이미 대문자인 토큰(MAHAS)은 그대로 둔다.
export function suggestAppName(slug: string): string {
  return slug
    .split(DASH)
    .filter((word) => word.length > 0)
    .map((word) =>
      // 한 토큰 안에 소문자가 있으면(예: usageReport) 첫 글자만 대문자로 맞춘다.
      // 소문자가 없으면(MAHAS, usage2) 사람이 쓴 대·소문자를 보존한다.
      /[a-z]/.test(word) ? word.charAt(0).toUpperCase() + word.slice(1) : word
    )
    .join(" ")
    .trim();
}
