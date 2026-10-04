import {
  type AuthorizationTarget,
  type RequestContext,
  TargetAuthorization,
  type TargetAuthorizer,
} from "../../contracts/platform/mod.ts";
import {
  authorize,
  CONDITION_TARGET_KEYS,
  TARGET_AUTHORIZATION_UNAVAILABLE,
} from "../identity/mod.ts";
import { defineTxPort, type TxPortRegistration } from "./tx-ports.ts";

// ctx의 고정 조건 target을 채운 뒤 owner target과 합친다. 고정 조건 key를 다른 값으로
// 주면 strict authorize가 forbidden이다. domain key는 owner가 준 값만 본다.
export function createTargetAuthorizer(
  ctx: RequestContext | undefined,
): TargetAuthorizer {
  return (_ctx, operation, target) => {
    if (ctx === undefined) return TARGET_AUTHORIZATION_UNAVAILABLE;
    return authorize(ctx, operation, mergeTarget(ctx, target));
  };
}

function mergeTarget(
  ctx: RequestContext,
  target: AuthorizationTarget,
): AuthorizationTarget {
  const merged: Record<string, AuthorizationTarget[string]> = { ...target };
  for (const key of CONDITION_TARGET_KEYS) {
    const value = key === "run"
      ? ctx.run ?? ctx.conditions.run
      : ctx.conditions[key];
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

export function targetAuthorizationPort(
  ctx: RequestContext | undefined,
): TxPortRegistration {
  const authorizer = createTargetAuthorizer(ctx);
  return defineTxPort(TargetAuthorization, () => authorizer);
}
