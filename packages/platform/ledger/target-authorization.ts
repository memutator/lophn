import { err } from "../../base/mod.ts";
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
    if (outsideBoundApp(ctx, target)) {
      return err({ code: "not_found", message: "target not found" });
    }
    return authorize(ctx, operation, mergeTarget(ctx, target));
  };
}

// 앱 하나에 묶인 agent(App Engineer의 `conditions.app`)의 target이 그 앱의 것이 아니면 범위 밖이다.
// 앱 조건은 target에 채워지므로(mergeTarget) 앱을 말하지 않은 target이 자기 앱으로 통과하지 않게
// owner가 준 사실로 먼저 닫는다. 범위 밖은 없는 대상과 같은 답이다.
// - 문서·자리: owner는 문서 자리가 앱일 때만 target의 앱을 준다. 앱을 말하지 않은 문서는 범위 밖이다.
//   예외는 handoff 고정 근거다. owner가 판 주소(`version`)를 준 읽기에서 (문서, 판)이
//   `conditions.evidence`에 있을 때만 열린다.
// - context: owner가 context의 항목이 가리키는 앱 목록(`context_apps`)을 준다. 담당 앱이 없으면 범위 밖이다.
function outsideBoundApp(
  ctx: RequestContext,
  target: AuthorizationTarget,
): boolean {
  if (parseActor(ctx.actor)?.kind !== "agent") return false;
  const bound = ctx.conditions.app;
  if (bound === undefined) return false;
  if (target["context"] !== undefined) {
    const apps = target["context_apps"];
    return !(Array.isArray(apps) && apps.includes(bound));
  }
  const addressed = target["document"] !== undefined ||
    target["place_kind"] !== undefined;
  if (!addressed || target["app"] !== undefined) return false;
  return !pinnedEvidence(ctx, target);
}

function pinnedEvidence(
  ctx: RequestContext,
  target: AuthorizationTarget,
): boolean {
  const { document, version } = target;
  // 판을 주소로 준 문서 읽기만 근거다. 자리 목록·최신 판·다른 판은 근거가 아니다.
  if (typeof document !== "string" || typeof version !== "string") return false;
  return ctx.conditions.evidence?.some((entry) =>
    entry.document === document && entry.version === version
  ) === true;
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
