import { err, ERROR_CODES, type Result } from "../../../base/mod.ts";
import {
  type AuthorizationTarget,
  type RequestContext,
  TargetAuthorization,
  type TargetAuthorizer,
} from "../../../protocol/server/mod.ts";
import type { Project, ProjectCandidate } from "./model.ts";

// command는 현재 Project와 전체 변경 후보를, read는 Project를 판정한다.
type ProjectAccessTarget =
  | { kind: "command"; before: Project | null; after: ProjectCandidate }
  | { kind: "project"; project: Project };

function dependencyUnavailable(): Result<never> {
  return err({
    code: "unavailable",
    message: "project dependency unavailable",
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

// TargetAuthorization이 없으면, Promise거나 반환이 Result가 아니면 fail-closed다.
export function authorizeProject(
  port: (<T>(key: { readonly name: string }) => T) | undefined,
  ctx: RequestContext,
  operation: string,
  target: ProjectAccessTarget,
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

// scope.targets key. command는 현재 Project와 변경 후보의 project를 모두 포함한다.
function authorizationTarget(target: ProjectAccessTarget): AuthorizationTarget {
  const value: Record<string, string> = {
    project: target.kind === "command" ? target.after.id : target.project.id,
  };
  if (target.kind === "command" && target.before !== null) {
    value.before_project = target.before.id;
  }
  return value;
}

export function denied(result: Result<unknown>): boolean {
  return !result.ok &&
    (result.error.code === "forbidden" || result.error.code === "not_found");
}
