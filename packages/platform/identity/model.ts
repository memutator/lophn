import { canonicalize, err, ok, type Result } from "../../base/mod.ts";
import {
  type ActorKind,
  type AuthenticatedContext,
  type CredentialConditions,
  type CredentialScope,
  parseActor,
} from "../../contracts/platform/mod.ts";

export type OperationPolicy = {
  name: string;
  actors: readonly ActorKind[];
  kind: "read" | "command";
  test_runner_only?: boolean;
};

export type CredentialTarget = CredentialScope["targets"];

function same(left: unknown, right: unknown): boolean {
  return canonicalize(left) === canonicalize(right);
}

function matches(limit: unknown, value: unknown): boolean {
  if (Array.isArray(limit)) {
    return Array.isArray(value)
      ? value.every((item) => limit.some((allowed) => same(allowed, item)))
      : limit.some((allowed) => same(allowed, value));
  }
  return same(limit, value);
}

export function scopeWithin(
  scope: CredentialScope,
  ceiling: CredentialScope,
): boolean {
  return scope.operations.every((name) => ceiling.operations.includes(name)) &&
    Object.entries(ceiling.targets).every(([key, limit]) =>
      Object.hasOwn(scope.targets, key) && matches(limit, scope.targets[key])
    );
}

export function intersectScope(
  initial: CredentialScope,
  current: CredentialScope,
): CredentialScope {
  const targets = structuredClone(initial.targets);
  let disjoint = false;
  for (const [key, limit] of Object.entries(current.targets)) {
    if (!Object.hasOwn(targets, key)) {
      targets[key] = structuredClone(limit);
    } else if (Array.isArray(targets[key]) || Array.isArray(limit)) {
      const left = Array.isArray(targets[key]) ? targets[key] : [targets[key]];
      const right = Array.isArray(limit) ? limit : [limit];
      const common = left.filter((item) =>
        right.some((other) => same(item, other))
      );
      targets[key] = common;
      disjoint ||= common.length === 0;
    } else {
      disjoint ||= !same(targets[key], limit);
    }
  }
  return {
    operations: disjoint
      ? []
      : initial.operations.filter((name) => current.operations.includes(name)),
    targets,
  };
}

export function operationCeiling(
  actor: string,
  policies: readonly OperationPolicy[],
  testRunner = false,
): string[] {
  const parts = parseActor(actor);
  if (!parts) return [];
  return policies.filter((policy) =>
    policy.actors.includes(parts.kind) &&
    (parts.kind !== "machine" || policy.kind === "command") &&
    (!policy.test_runner_only || (parts.kind === "machine" && testRunner))
  ).map((policy) => policy.name);
}

export function conditionsMatch(
  initial: CredentialConditions,
  current: CredentialConditions,
): boolean {
  return Object.entries(current).every(([key, value]) =>
    initial[key as keyof CredentialConditions] === value
  );
}

export function authorize(
  ctx: AuthenticatedContext,
  operation: string,
  target: CredentialTarget = {},
): Result<void> {
  const parts = parseActor(ctx.actor);
  const app = parts?.kind === "app" ? parts.id : ctx.conditions.app;
  if (app !== undefined && target.app !== undefined && target.app !== app) {
    return err({ code: "not_found", message: "target not found" });
  }
  if (!ctx.scope.operations.includes(operation)) {
    return err({ code: "forbidden", message: "operation forbidden" });
  }
  for (const [key, limit] of Object.entries(ctx.scope.targets)) {
    if (!Object.hasOwn(target, key) || !matches(limit, target[key])) {
      return err({ code: "forbidden", message: "target forbidden" });
    }
  }
  for (
    const key of [
      "app",
      "task",
      "run",
      "assignment",
      "release",
      "process",
      "mode",
    ] as const
  ) {
    if (
      ctx.conditions[key] !== undefined && target[key] !== undefined &&
      ctx.conditions[key] !== target[key]
    ) {
      return err({ code: "forbidden", message: "condition forbidden" });
    }
  }
  return ok(undefined);
}
