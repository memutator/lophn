import { err, ERROR_CODES, type Result } from "../../../base/mod.ts";
import type {
  DocumentRef,
  Project,
  projectArchived,
  projectCreated,
  projectUnarchived,
  projectUpdated,
} from "../../../protocol/projects/mod.ts";
import {
  type AuthorizationTarget,
  type EventEnvelopeFor,
  type RequestContext,
  TargetAuthorization,
  type TargetAuthorizer,
} from "../../../protocol/server/mod.ts";

export type ProjectCandidate = Omit<Project, "revision">;
export type ProjectEvent =
  | EventEnvelopeFor<typeof projectCreated>
  | EventEnvelopeFor<typeof projectUpdated>
  | EventEnvelopeFor<typeof projectArchived>
  | EventEnvelopeFor<typeof projectUnarchived>;

// command는 현재 Project와 전체 변경 후보를, read·event는 Project 또는 고정 DocumentRef를 판정한다.
export type ProjectAccessTarget =
  | { kind: "command"; before: Project | null; after: ProjectCandidate }
  | { kind: "project"; project: Project }
  | {
    kind: "document";
    project: Project;
    document: DocumentRef & { version: NonNullable<DocumentRef["version"]> };
  }
  | { kind: "event"; project: Project; event: ProjectEvent };

export type ProjectAuthorizer = TargetAuthorizer;

export function dependencyUnavailable(): Result<never> {
  return err({
    code: "unavailable",
    message: "project dependency unavailable",
  });
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
  if (target.kind === "document") {
    value.document = target.document.document;
    value.version = target.document.version;
  }
  if (target.kind === "event") value.event_type = target.event.type;
  return value;
}

export function denied(result: Result<unknown>): boolean {
  return !result.ok &&
    (result.error.code === "forbidden" || result.error.code === "not_found");
}
