import { canonicalize, err, ok, type Result } from "../../../base/mod.ts";
import type {
  AuthenticatedContext,
  CredentialConditions,
  CredentialScope,
} from "../../../protocol/server/mod.ts";
import { type ActorKind, parseActor } from "../../../protocol/base/mod.ts";

export type OperationPolicy = {
  name: string;
  actors: readonly ActorKind[];
  kind: "read" | "command";
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
  return (
    scope.operations.every((name) => ceiling.operations.includes(name)) &&
    Object.entries(ceiling.targets).every(
      ([key, limit]) =>
        Object.hasOwn(scope.targets, key) && matches(limit, scope.targets[key]),
    )
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
        right.some((other) => same(item, other)),
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
): string[] {
  const parts = parseActor(actor);
  if (!parts) return [];
  return policies
    .filter(
      (policy) =>
        policy.actors.includes(parts.kind) &&
        (parts.kind !== "machine" || policy.kind === "command"),
    )
    .map((policy) => policy.name);
}

export function conditionsMatch(
  initial: CredentialConditions,
  current: CredentialConditions,
): boolean {
  return Object.entries(current).every(
    ([key, value]) => initial[key as keyof CredentialConditions] === value,
  );
}

// ledger 입구 gate가 판정하는 고정 조건. domain key는 owner가 판정한다.
// port를 주입하지 않은 Tx·snapshot은 owner 판정을 통과시키지 않는다.
export const TARGET_AUTHORIZATION_UNAVAILABLE: Result<never> = err({
  code: "forbidden",
  message: "target authorization unavailable",
});

export const CONDITION_TARGET_KEYS = [
  "app",
  "task",
  "turn",
  "session",
  "release",
  "process",
  "mode",
] as const;

export function authorizeConditions(
  ctx: AuthenticatedContext,
  operation: string,
  target: CredentialTarget = {},
): Result<void> {
  return authorize(ctx, operation, target, { domain: "skip" });
}

export function authorize(
  ctx: AuthenticatedContext,
  operation: string,
  target: CredentialTarget = {},
  options?: { domain?: "strict" | "skip" },
): Result<void> {
  const parts = parseActor(ctx.actor);
  const app = parts?.kind === "app" ? parts.id : ctx.conditions.app;
  if (app !== undefined && target.app !== undefined && target.app !== app) {
    return err({ code: "not_found", message: "target not found" });
  }
  if (!ctx.scope.operations.includes(operation)) {
    return err({ code: "forbidden", message: "operation forbidden" });
  }
  for (const key of Object.keys(ctx.scope.targets)) {
    // 고정 조건이 아닌 domain key는 owner가 판정한다. __proto__ own key는 gate가 거절한다.
    if (
      options?.domain === "skip" &&
      key !== "__proto__" &&
      !(CONDITION_TARGET_KEYS as readonly string[]).includes(key)
    )
      continue;
    const limit = ctx.scope.targets[key];
    if (!Object.hasOwn(target, key) || !matches(limit, target[key])) {
      return err({ code: "forbidden", message: "target forbidden" });
    }
  }
  for (const key of CONDITION_TARGET_KEYS) {
    if (
      ctx.conditions[key] !== undefined &&
      target[key] !== undefined &&
      ctx.conditions[key] !== target[key]
    ) {
      return err({ code: "forbidden", message: "condition forbidden" });
    }
  }
  return ok(undefined);
}
