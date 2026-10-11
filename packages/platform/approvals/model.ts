// approval request의 순수 규칙(platform/approvals#R1, R2, R6, R12, R13).
// IO가 없다. blob 본문·시각·id는 인자로 받는다.

import { err, ok, type Result } from "../../base/mod.ts";
import type { Actor } from "../../contracts/platform/mod.ts";
import {
  type ApprovalAction,
  approvalActionSchema,
  type ApprovalEffect,
  approvalEffectSchema,
  type ApprovalGrantScope,
  type ApprovalStatus,
  approvalStatusSchema,
} from "../../contracts/platform/mod.ts";
import { CONFIRM_COMMAND, CONFIRM_CONCERN } from "./confirm.ts";

// 종료 상태는 불변이다. 다시 열기·결정 수정은 없다(domain model 불변 조건).
const CLOSED: readonly ApprovalStatus[] = [
  "granted",
  "rejected",
  "expired",
  "cancelled",
];

export function isClosed(status: ApprovalStatus): boolean {
  return CLOSED.includes(status);
}

// 설명 blob은 비어 있거나 공백뿐이면 안 된다(R1, R2).
export function descriptionPresent(text: string): boolean {
  return /\S/.test(text);
}

// 외부 전송이 있으면 수신처·전송 정보가 있어야 한다(R1). 없으면 그 설명이 없다.
export function externalDescribed(
  effect: ApprovalEffect,
  externalText: string | undefined,
): boolean {
  if (effect.external_blob === null) return externalText === undefined;
  return externalText !== undefined && descriptionPresent(externalText);
}

// 수리 동작은 보존 데이터와 검증 기준을 함께 제시한다(R2).
// 수리 여부는 요청자가 선언한다. 소유 concern의 판정은 그 concern이 한다.
export function repairDescribed(
  repair: { preserved: string; verification: string } | undefined,
): boolean {
  if (repair === undefined) return true;
  return descriptionPresent(repair.preserved) &&
    descriptionPresent(repair.verification);
}

// 기한은 없거나 생성 시각보다 뒤다(domain model expires_at).
export function deadlineValid(
  expiresAt: string | null,
  now: string,
): boolean {
  if (expiresAt === null) return true;
  const deadline = Date.parse(expiresAt);
  const created = Date.parse(now);
  return Number.isFinite(deadline) && Number.isFinite(created) &&
    deadline > created;
}

// 기한 경계부터 결정과 새 사용을 거절한다(R12). 기본 기한은 없다.
export function deadlineReached(
  expiresAt: string | null,
  now: string,
): boolean {
  if (expiresAt === null) return false;
  const deadline = Date.parse(expiresAt);
  const current = Date.parse(now);
  return Number.isFinite(deadline) && Number.isFinite(current) &&
    current >= deadline;
}

// 생성 전 고정 내용 검사. 필수 설명이 없거나 공백뿐이면 생성하지 않는다(R1, R2).
export function creationValid(input: {
  action: ApprovalAction;
  effect: ApprovalEffect;
  reason: string;
  changes: string;
  reversibility: string;
  external: string | undefined;
  repair: { preserved: string; verification: string } | undefined;
  expiresAt: string | null;
  now: string;
}): Result<void> {
  if (!approvalActionSchema.safeParse(input.action).success) {
    return err({ code: "invalid_input", message: "동작이 schema와 다르다" });
  }
  if (!approvalEffectSchema.safeParse(input.effect).success) {
    return err({ code: "invalid_input", message: "영향이 schema와 다르다" });
  }
  if (
    !descriptionPresent(input.reason) ||
    !descriptionPresent(input.changes) ||
    !descriptionPresent(input.reversibility)
  ) {
    return err({
      code: "invalid_input",
      message: "이유·변경 범위·되돌림 설명이 비어 있다",
    });
  }
  if (!externalDescribed(input.effect, input.external)) {
    return err({
      code: "invalid_input",
      message: "외부 전송 설명이 영향과 맞지 않는다",
    });
  }
  if (!repairDescribed(input.repair)) {
    return err({
      code: "invalid_input",
      message: "수리 동작의 보존 데이터·검증 기준이 비어 있다",
    });
  }
  if (!deadlineValid(input.expiresAt, input.now)) {
    return err({
      code: "invalid_input",
      message: "기한이 생성 시각보다 뒤가 아니다",
    });
  }
  return ok(undefined);
}

// 요청자·동작·영향·설명·기한은 생성 뒤 바꾸지 않는다(R6).
// 저장된 값과 다른 제안은 새 request다. 수정 route는 없다.
export function immutableFields(): readonly string[] {
  return ["requester", "action", "effect", "reason_blob", "expires_at"];
}

// 대기 request만 끝낼 수 있다. 끝난 결정은 다시 열리지 않는다(R6).
export function closeAllowed(
  status: ApprovalStatus,
  next: "expired" | "cancelled",
): Result<void> {
  if (!approvalStatusSchema.safeParse(status).success) {
    return err({ code: "invalid_input", message: "상태가 schema와 다르다" });
  }
  if (status !== "pending") {
    return err({
      code: "conflict",
      message: "끝난 결정은 다시 열거나 바꾸지 않는다",
    });
  }
  if (next !== "expired" && next !== "cancelled") {
    return err({ code: "invalid_input", message: "종료 상태가 아니다" });
  }
  return ok(undefined);
}

// 취소 actor(R13). 사람·원래 요청자·machine만 된다.
// machine은 원래 일 종료·취소·전제 변경 때 호출한다. 그 근거 판정은 호출 concern이 한다.
export function cancelActorAllowed(
  actor: Actor,
  requester: Actor,
): Result<void> {
  if (actor === "user" || actor === "machine") return ok(undefined);
  if (actor === requester) return ok(undefined);
  return err({
    code: "forbidden",
    message: "취소는 사람·원래 요청자·machine만 한다",
  });
}

// session 허락을 고를 수 있는 request는 session 있는 run의 agent tool call ask뿐이다(R20). 앱 command의
// confirm·앱 permission·release 적용·복원처럼 정확한 대상 하나를 보고 결정해야 하는 request는
// agent tool call의 ask가 아니거나(요청자가 agent가 아님) confirm 접수 동작이라 켜지 못한다.
export function sessionGrantableValid(input: {
  sessionGrantable: boolean;
  requester: Actor;
  run: string | null;
  session: string | null;
  action: ApprovalAction;
}): Result<void> {
  if (!input.sessionGrantable) return ok(undefined);
  if (!input.requester.startsWith("agent:") || input.run === null) {
    return err({
      code: "invalid_input",
      message: "session 허락은 agent tool call의 ask에만 있다",
    });
  }
  if (
    input.action.concern === CONFIRM_CONCERN &&
    input.action.command === CONFIRM_COMMAND
  ) {
    return err({
      code: "invalid_input",
      message: "사람이 확인하는 앱 command에는 session 허락이 없다",
    });
  }
  if (input.session === null) {
    return err({
      code: "invalid_input",
      message: "session이 없는 run의 ask에는 session 허락이 없다",
    });
  }
  return ok(undefined);
}

// 허락 범위는 once와 session이고 session은 session_grantable인 request만 고른다(R18, R20).
export function grantScopeAllowed(
  sessionGrantable: boolean,
  scope: ApprovalGrantScope,
): Result<void> {
  if (scope === "session" && !sessionGrantable) {
    return err({
      code: "invalid_input",
      message: "이 request에는 session 허락이 없다",
    });
  }
  return ok(undefined);
}
