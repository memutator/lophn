import { canonicalize, err, ok, type Result } from "../../base/mod.ts";
import { type AgentAppScope } from "../../contracts/lophn-agent/mod.ts";
import {
  type ActorKind,
  type AuthenticatedContext,
  type CredentialConditions,
  type CredentialScope,
  parseActor,
} from "../../contracts/platform/mod.ts";

// agent credential이 싣는 상한. lophn-agent가 계산한 AgentAppScope이며 platform은
// 내용을 해석하지 않고 발급 뒤 넓히지 못하게만 한다(domain-model platform/identity).
export type AgentCredentialScope = CredentialScope & { agent?: AgentAppScope };

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
  scope: AgentCredentialScope,
  ceiling: AgentCredentialScope,
): boolean {
  // agent 상한은 시작 scope가 정한다. 현재 제한이 그 상한과 다른 scope를 주면 거절한다.
  if (
    ceiling.agent !== undefined &&
    (!scope.agent || !same(scope.agent, ceiling.agent))
  ) return false;
  return scope.operations.every((name) => ceiling.operations.includes(name)) &&
    Object.entries(ceiling.targets).every(([key, limit]) =>
      Object.hasOwn(scope.targets, key) && matches(limit, scope.targets[key])
    );
}

export function intersectScope(
  initial: AgentCredentialScope,
  current: AgentCredentialScope,
): AgentCredentialScope {
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
  const agent = intersectAgent(initial.agent, current.agent);
  // agent 상한이 어긋나면 동작도 없다. 상한을 통째로 버리고 동작만 남기지 않는다.
  if (agent === "disjoint") disjoint = true;
  return {
    operations: disjoint
      ? []
      : initial.operations.filter((name) => current.operations.includes(name)),
    targets,
    ...(agent !== undefined && agent !== "disjoint" ? { agent } : {}),
  };
}

// agent 상한은 시작 scope와 현재 제한의 교집합이다. 넓히지 못하고 좁히기만 한다.
// role·assignment가 다르면 교집합이 없다. app별 command·effect도 겹치는 것만 남긴다.
function intersectAgent(
  initial: AgentAppScope | undefined,
  current: AgentAppScope | undefined,
): AgentAppScope | "disjoint" | undefined {
  if (initial === undefined || current === undefined) return undefined;
  if (
    initial.role !== current.role || initial.assignment !== current.assignment
  ) {
    return "disjoint";
  }
  const apps = [];
  for (const entry of initial.apps) {
    const limit = current.apps.find((other) => other.app === entry.app);
    if (limit === undefined) continue;
    const commands = entry.commands.filter((name) =>
      limit.commands.includes(name)
    );
    const effects = entry.effects.filter((effect) =>
      limit.effects.includes(effect)
    );
    if (commands.length === 0 || effects.length === 0) continue;
    apps.push({
      app: entry.app,
      commands,
      effects,
      // 둘 중 하나라도 요구하면 교집합도 요구한다. 제한을 풀지 않는다.
      revert_required: entry.revert_required || limit.revert_required,
      confirm_allowed: entry.confirm_allowed && limit.confirm_allowed,
    });
  }
  return { role: initial.role, assignment: initial.assignment, apps };
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

// ledger 입구 gate가 판정하는 고정 조건. domain key는 owner가 판정한다.
// port를 주입하지 않은 Tx·snapshot은 owner 판정을 통과시키지 않는다.
export const TARGET_AUTHORIZATION_UNAVAILABLE: Result<never> = err({
  code: "forbidden",
  message: "target authorization unavailable",
});

export const CONDITION_TARGET_KEYS = [
  "app",
  "task",
  "run",
  "assignment",
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
      options?.domain === "skip" && key !== "__proto__" &&
      !(CONDITION_TARGET_KEYS as readonly string[]).includes(key)
    ) continue;
    const limit = ctx.scope.targets[key];
    if (!Object.hasOwn(target, key) || !matches(limit, target[key])) {
      return err({ code: "forbidden", message: "target forbidden" });
    }
  }
  for (const key of CONDITION_TARGET_KEYS) {
    if (
      ctx.conditions[key] !== undefined && target[key] !== undefined &&
      ctx.conditions[key] !== target[key]
    ) {
      return err({ code: "forbidden", message: "condition forbidden" });
    }
  }
  return ok(undefined);
}
