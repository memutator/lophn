import { err, ERROR_CODES, type Result } from "../../base/mod.ts";
import type {
  DocumentRef,
  Project,
  projectArchived,
  projectCreated,
  projectUnarchived,
  projectUpdated,
} from "../../contracts/documents/mod.ts";
import type {
  EventEnvelopeFor,
  RequestContext,
} from "../../contracts/platform/mod.ts";

export type ProjectCandidate = Omit<Project, "revision">;
export type ProjectEvent =
  | EventEnvelopeFor<typeof projectCreated>
  | EventEnvelopeFor<typeof projectUpdated>
  | EventEnvelopeFor<typeof projectArchived>
  | EventEnvelopeFor<typeof projectUnarchived>;

export type ProjectAccessTarget =
  | { kind: "command"; before: Project | null; after: ProjectCandidate }
  | { kind: "project"; project: Project }
  | {
    kind: "document";
    project: Project;
    document: DocumentRef & { version: NonNullable<DocumentRef["version"]> };
  }
  | { kind: "event"; project: Project; event: ProjectEvent };

// core가 현재 credential을 재검사한다. ctx.scope 자체는 authority가 아니다.
export type ProjectAuthorizer = (
  ctx: RequestContext,
  operation: string,
  target: ProjectAccessTarget,
) => Result<void>;

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

export function authorizeProject(
  authorize: ProjectAuthorizer | undefined,
  ctx: RequestContext,
  operation: string,
  target: ProjectAccessTarget,
): Result<void> {
  if (typeof authorize !== "function") return dependencyUnavailable();
  try {
    const result = synchronousResult<void>(authorize(ctx, operation, target));
    return result.ok && result.value !== undefined
      ? dependencyUnavailable()
      : result;
  } catch {
    return dependencyUnavailable();
  }
}

export function denied(result: Result<unknown>): boolean {
  return !result.ok &&
    (result.error.code === "forbidden" || result.error.code === "not_found");
}
