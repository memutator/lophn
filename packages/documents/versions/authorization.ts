// 문서 권한 판정. platform이 주입한 TargetAuthorization port가 domain target을 본다.
// port가 없거나 판정이 Result가 아니면 fail-closed다.

import { err, ERROR_CODES, ok, type Result } from "../../base/mod.ts";
import type { Document } from "../../contracts/documents/mod.ts";
import {
  type AuthorizationTarget,
  type RequestContext,
  TargetAuthorization,
  type TargetAuthorizer,
} from "../../contracts/platform/mod.ts";
import { actingApp, isAppPlace } from "../addressing/mod.ts";

export type DocumentAccessTarget =
  | { kind: "create"; document: Document }
  | { kind: "document"; document: Document };

function dependencyUnavailable(): Result<never> {
  return err({
    code: "unavailable",
    message: "document authorization unavailable",
  });
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
      typeof error === "object" && error !== null &&
      "code" in error && ERROR_CODES.some((code) => code === error.code) &&
      "message" in error && typeof error.message === "string"
    ) {
      return value as Result<T>;
    }
  }
  return dependencyUnavailable();
}

// 앱 자격은 자기 앱 place의 문서에만 닿는다. 앱 credential의 scope target은 place를 담지 않으므로
// (platform/identity 발급은 app·release·process·mode만 고정한다) port 판정 앞에서 documents가 직접
// 판정한다. 다른 place·자리 없음의 기존 문서는 없는 문서와 같은 not_found고, 다른 자리에 새
// 문서를 만드는 것은 forbidden이다.
function appScope(
  ctx: RequestContext,
  target: DocumentAccessTarget,
): Result<void> {
  const app = actingApp(ctx);
  if (app === null || isAppPlace(app, target.document.place)) {
    return ok(undefined);
  }
  return target.kind === "create"
    ? err({ code: "forbidden", message: "app writes only its own app place" })
    : err({ code: "not_found", message: "target not found" });
}

export function authorizeDocument(
  port: (<T>(key: { readonly name: string }) => T) | undefined,
  ctx: RequestContext,
  operation: string,
  target: DocumentAccessTarget,
): Result<void> {
  const scoped = appScope(ctx, target);
  if (!scoped.ok) return scoped;
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

// scope.targets의 document·place key. 판정은 port가 한다.
function authorizationTarget(
  target: DocumentAccessTarget,
): AuthorizationTarget {
  const value: Record<string, string> = { document: target.document.id };
  const place = target.document.place;
  if (place !== null) {
    value.place_kind = place.kind;
    value.place = place.id;
    // 앱 하나 범위 연결의 scope.targets.app은 문서의 자리가 그 앱일 때만 맞는다. project·자리
    // 없음 문서는 app을 주지 않아 앱 범위 연결에서 forbidden(없는 문서와 같은 답)이다.
    if (place.kind === "app") value.app = place.id;
  }
  return value;
}
