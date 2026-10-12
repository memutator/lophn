// credential 사용 가능 상태와 과금 경로. 순수 함수만. IO 없다.
// provider에는 credential이 하나라 고르거나 뒤 계정으로 넘기는 규칙은 없다.

import {
  type ModelBlock,
  type ProviderCredential,
  USAGE_WAIT_DEFAULT_MS,
} from "../../../protocol/lophn-agent/mod.ts";
import type { FailureVerdict } from "./failures.ts";

// ---- R27 과금 경로 ----

// API key는 API 과금, ChatGPT·SuperGrok OAuth는 구독이다. Claude OAuth 자리는
// 없다(D31). 확정되지 않은 청구액은 모름이다.
export function billingRouteOf(
  credential: Pick<ProviderCredential, "kind"> | null,
): "api" | "subscription" | "unknown" {
  if (credential === null) return "unknown";
  if (credential.kind === "api_key") return "api";
  if (credential.kind === "oauth") return "subscription";
  // 인증 없음(loopback)은 과금 근거가 없다. 모름이다.
  return "unknown";
}

// credential이 지금 쓸 수 있는가. usage_wait는 until 도달까지 막는다. model 전용 대기는 그
// model에만 막는다. rejected·revoked는 쓸 수 없다. provider에는 credential이 하나라
// 고르거나 넘어갈 다른 credential은 없고, 쓸 수 없으면 run이 멈춘다.
export function credentialUsable(
  credential: ProviderCredential | null,
  facts: { modelName: string; nowMs: number },
): boolean {
  if (credential === null) return false;
  if (credential.state === "revoked") return false;
  if (credential.state === "rejected") return false;
  if (credential.state === "usage_wait") {
    // usage_wait는 until 도달까지 막는다. until은 waiting 상태에 필수다.
    if (credential.until === null) return false;
    const until = Date.parse(credential.until);
    if (Number.isNaN(until)) return false;
    if (until > facts.nowMs) return false;
  }
  // model 전용 대기는 이 model에만 막는다. 다른 model block은 상관 없다.
  const block = credential.model_blocks.find(
    (entry) => entry.model_name === facts.modelName,
  );
  if (block !== undefined) {
    if (block.until === null) return false;
    const until = Date.parse(block.until);
    if (Number.isNaN(until)) return false;
    if (until > facts.nowMs) return false;
  }
  return true;
}

// ---- 실패 분류 → credential 사용 가능 상태 ----

// RecordProviderAvailability 입력 중 provider 밖의 값이다.
export type AvailabilityChange = {
  state: ProviderCredential["state"];
  unavailable_reason: ProviderCredential["unavailable_reason"];
  until: string | null;
  model_block: ModelBlock | null;
};

// 실패 판정이 credential 상태를 바꾸는가. 바꾸지 않으면 null이다.
// - credential_unavailable: 인증 거절·확인된 plan 거절은 rejected, 사용량·잔액은
//   usage_wait(reset 시각까지 또는 1시간). 인증 폐기(revoked)는 token refresh
//   쪽이 정하므로 여기서 revoked를 만들지 않는다.
// - model_unavailable: 그 credential+model 조합만 막고 credential 상태는 그대로다.
// - 그 밖(일시·문맥 초과·잘못된 요청·거절·취소·원인 불명)은 상태를 바꾸지 않는다. 원인
//   불명을 인증 실패로 올리지 않는다.
export function availabilityFromVerdict(
  verdict: Pick<
    FailureVerdict,
    "code" | "unavailable_reason" | "until_ms" | "provider_code"
  >,
  current: Pick<
    ProviderCredential,
    "state" | "unavailable_reason" | "until"
  >,
  facts: { modelName: string; nowMs: number },
  at: (ms: number) => string,
): AvailabilityChange | null {
  if (verdict.code === "credential_unavailable") {
    const reason = verdict.unavailable_reason;
    if (reason === null || reason === "refresh_revoked") return null;
    if (reason === "quota") {
      const until = verdict.until_ms ?? facts.nowMs + USAGE_WAIT_DEFAULT_MS;
      return {
        state: "usage_wait",
        unavailable_reason: "quota",
        until: at(until),
        model_block: null,
      };
    }
    return {
      state: "rejected",
      unavailable_reason: reason,
      until: null,
      model_block: null,
    };
  }
  if (verdict.code === "model_unavailable") {
    return {
      state: current.state,
      unavailable_reason: current.unavailable_reason,
      until: current.until,
      model_block: {
        model_name: facts.modelName,
        reason: verdict.provider_code === "model_not_available"
          ? "account_model_access"
          : "not_found",
        until: null,
      },
    };
  }
  return null;
}
