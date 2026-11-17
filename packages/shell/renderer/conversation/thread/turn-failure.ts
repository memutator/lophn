// turn이 끝난 이유(code)를 사람의 말로 옮긴다. 원시 이유("configuration unavailable")는 무엇을 하라는지 말하지 못한다.
// DOM이 없어 폰의 오류 줄도 import한다.
import { type MessageKey, t } from "@lophn/i18n";

import { TURN_FAILED_REASONS } from "../../../../protocol/lophn-agent/turn-values.ts";

type FailedReason = (typeof TURN_FAILED_REASONS)[number];

// 이유마다 문구 하나. 이유가 늘면 type이 이 표를 채우게 한다.
const FAILED_TEXT = {
  model_error: "conversation.error.turn-model-error",
  tool_error: "conversation.error.turn-tool-error",
  context_limit: "conversation.error.turn-context-limit",
  model_attempt_limit: "conversation.error.turn-model-attempt-limit",
  stall_limit: "conversation.error.turn-stall-limit",
  active_limit: "conversation.error.turn-active-limit",
  repeated_tool_failure: "conversation.error.turn-repeated-tool-failure",
  effect_unknown: "conversation.error.turn-effect-unknown",
  clock_uncertain: "conversation.error.turn-clock-uncertain",
  configuration_unavailable:
    "conversation.error.turn-configuration-unavailable",
  model_required: "conversation.error.turn-model-required",
  target_unavailable: "conversation.error.turn-target-unavailable",
  no_answer: "conversation.error.turn-no-answer",
  internal: "conversation.error.turn-internal",
} as const satisfies Record<FailedReason, MessageKey>;

// 원인을 말하는 문구. 표에 없으면 turn이 끝난 이유의 문구다.
function causeText(
  code: string,
  status: number | null | undefined,
): MessageKey | null {
  if (code === "configuration_unavailable") {
    if (status === 402 || status === 429) {
      return "conversation.error.turn-usage-limit";
    }
    if (status === 401 || status === 403) {
      return "conversation.error.turn-sign-in-rejected";
    }
  }
  if (
    (code === "model_error" || code === "model_attempt_limit") &&
    status === 429
  ) {
    return "conversation.error.turn-rate-limited";
  }
  return null;
}

/** 실패한 turn의 글. 이유도 원인도 모르는 code면 core가 준 글(`message`)이다. */
export function failedText(
  code: string,
  status: number | null | undefined,
  message: string,
): string {
  const cause = causeText(code, status);
  if (cause !== null) return t(cause);
  return code in FAILED_TEXT ? t(FAILED_TEXT[code as FailedReason]) : message;
}
