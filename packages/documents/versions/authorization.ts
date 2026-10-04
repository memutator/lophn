// 문서 권한 판정. platform이 주입한 TargetAuthorization port가 domain target을 본다.
// port가 없거나 판정이 Result가 아니면 fail-closed다.

import { err, ERROR_CODES, type Result } from "../../base/mod.ts";
import type { Document } from "../../contracts/documents/mod.ts";
import {
  type AuthorizationTarget,
  type RequestContext,
  TargetAuthorization,
  type TargetAuthorizer,
} from "../../contracts/platform/mod.ts";

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

export function authorizeDocument(
  port: (<T>(key: { readonly name: string }) => T) | undefined,
  ctx: RequestContext,
  operation: string,
  target: DocumentAccessTarget,
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
      (authorize as TargetAuthorizer)(ctx, operation, authorizationTarget(target)),
    );
    return result.ok && result.value !== undefined
      ? dependencyUnavailable()
      : result;
  } catch {
    return dependencyUnavailable();
  }
}

// scope.targets의 document·place key. 판정은 port가 한다.
function authorizationTarget(target: DocumentAccessTarget): AuthorizationTarget {
  const value: Record<string, string> = { document: target.document.id };
  const place = target.document.place;
  if (place !== null) {
    value.place_kind = place.kind;
    value.place = place.id;
  }
  return value;
}
