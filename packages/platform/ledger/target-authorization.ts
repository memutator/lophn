import {
  type AuthorizationTarget,
  parseActor,
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
// coding agent의 앱 범위(`targets.app`)는 조건에서 채우지 않는다. 채우면 owner가 앱을 말하지
// 않은 target(다른 앱·project 문서, project·context 읽기)이 자기 앱으로 통과한다. owner가 target의
// 앱을 직접 줘야 하고(connection#R5, platform/identity R3) 주지 않으면 forbidden이다.
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
  const codingAgent = parseActor(ctx.actor)?.kind === "coding_agent";
  for (const key of CONDITION_TARGET_KEYS) {
    if (key === "app" && codingAgent) continue;
    const value = key === "run"
      ? ctx.run ?? ctx.conditions.run
      : ctx.conditions[key];
    // owner가 준 값은 덮지 않는다. 고정 조건과 다른 값이면 authorize가 거절해야 하고, 덮어쓰면
    // 범위 밖 target이 조건의 값으로 바뀌어 통과한다.
    if (value !== undefined && merged[key] === undefined) merged[key] = value;
  }
  return merged;
}

export function targetAuthorizationPort(
  ctx: RequestContext | undefined,
): TxPortRegistration {
  const authorizer = createTargetAuthorizer(ctx);
  return defineTxPort(TargetAuthorization, () => authorizer);
}
