import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type ReadSnapshot,
  type RequestContext,
  TargetAuthorization,
} from "../../../protocol/server/mod.ts";
import type { JsonValue } from "../../../protocol/base/mod.ts";

// 존재를 새지 않는 문구다. 범위 밖과 없는 대상은 같은 말로 답한다.
export const NOT_FOUND = "대상을 찾을 수 없다";
const FORBIDDEN = "이 credential로는 할 수 없다";
const CURSOR_INVALID = "cursor가 올바르지 않다";

// 문제 read는 pool에서 도므로 api 경계가 operation을 보지 않는다. 호출한 credential에
// 이 read가 있어야 한다. 수리 조회(GetReport·GetSnapshot)도 같은 방식으로 권한이 나뉜다.
export function requireOperation(
  ctx: RequestContext,
  operation: string,
): Result<void> {
  return ctx.scope.operations.includes(operation)
    ? ok(undefined)
    : err({ code: "forbidden", message: FORBIDDEN });
}

// owner가 판정하는 대상 사실. mode·diagnostic_scope는 credential 고정 조건과도 맞아야 한다.
type ReadFacts = {
  app: string;
  problem: string | null;
  mode?: string;
  diagnostic_scope?: string | null;
};

// 범위 밖(forbidden·not_found)은 false다. 호출한 쪽이 목록에서는 건너뛰고 상세에서는
// not_found로 답해 없는 대상과 구별되지 않게 한다. 그 밖의 오류는 그대로 올린다.
export function targetVisible(
  snapshot: ReadSnapshot,
  ctx: RequestContext,
  operation: string,
  facts: ReadFacts,
): Result<boolean> {
  // platform의 TargetAuthorization은 credential 고정 조건을 target에 덮어 쓴다. 그래서
  // 행의 앱·모드·진단 범위가 그 고정 조건과 맞는지는 owner인 여기서 따로 본다.
  const conditions = ctx.conditions;
  if (
    conditions.app !== undefined && conditions.app !== facts.app ||
    facts.mode !== undefined && conditions.mode !== undefined &&
      conditions.mode !== facts.mode ||
    facts.diagnostic_scope !== undefined &&
      conditions.diagnostic_scope !== undefined &&
      conditions.diagnostic_scope !== facts.diagnostic_scope
  ) return ok(false);
  const target: Record<string, JsonValue> = {
    app: facts.app,
    problem: facts.problem,
  };
  if (facts.mode !== undefined) target["mode"] = facts.mode;
  if (facts.diagnostic_scope !== undefined) {
    target["diagnostic_scope"] = facts.diagnostic_scope;
  }
  const decision = snapshot.port(TargetAuthorization)(ctx, operation, target);
  if (decision.ok) return ok(true);
  return decision.error.code === "forbidden" ||
      decision.error.code === "not_found"
    ? ok(false)
    : decision;
}

export function invalidCursor(): Result<never> {
  return err({ code: "invalid_input", message: CURSOR_INVALID });
}

// 한 호출이 훑는 행의 상한. 범위 밖 행이 많으면 짧은 page와 cursor를 돌려주고 다음 호출이 잇는다.

// seq 내림차순으로 훑으며 보이는 행만 limit개 모은다. 다음 page는 마지막 행의 seq 아래다.
