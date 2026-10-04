// 제출 직전 검사. 통과해야만 handle을 쓴다. 실패하면 옛 버튼을 없앨지 함께 알린다.
import { contentBasis, type LiveHandle } from "./handle.ts";
import type { CanonPort, Gate } from "./coordinator.ts";

export interface SubmitCheck {
  readonly handle: LiveHandle;
  readonly decision: string;
  readonly confirmedSecond?: boolean;
  readonly secondPending: boolean;
  readonly now: number;
  readonly connected: boolean;
  readonly read: Awaited<ReturnType<CanonPort["read"]>>;
}

export type SubmitCheckResult =
  | { ok: true }
  | {
    ok: false;
    drop: boolean;
    gate: Gate;
    /** null이면 표시를 비운다. 읽기에 성공하면 최신 표시를 남긴다. */
    display: unknown;
    clearDisplay: boolean;
    error: { code: string; message: string };
  };

const STALE = "대상이 바뀌었거나 연결을 확인할 수 없다";

export function checkSubmission(input: SubmitCheck): SubmitCheckResult {
  if (input.now >= input.handle.expiresAtMs) {
    return {
      ok: false,
      drop: true,
      gate: { state: "expired" },
      display: null,
      clearDisplay: false,
      error: { code: "conflict", message: "확인 기한이 지났다" },
    };
  }
  if (!input.connected) {
    return {
      ok: false,
      drop: true,
      gate: { state: "stale", reason: STALE },
      display: null,
      clearDisplay: false,
      error: { code: "unavailable", message: STALE },
    };
  }
  if (!input.read.ok) {
    return {
      ok: false,
      drop: true,
      gate: { state: "stale", reason: input.read.error.message },
      display: null,
      clearDisplay: true,
      error: input.read.error,
    };
  }
  const basis = contentBasis(input.read.value.content);
  if (
    basis !== input.handle.contentHash ||
    input.read.value.targetRef !== input.handle.targetRef ||
    !input.read.value.allowed.includes(input.decision)
  ) {
    return {
      ok: false,
      drop: true,
      gate: { state: "stale", reason: STALE },
      display: input.read.value.display,
      clearDisplay: false,
      error: { code: "conflict", message: STALE },
    };
  }
  if (input.secondPending && input.confirmedSecond !== true) {
    return {
      ok: false,
      drop: false,
      gate: {
        state: "ready",
        decisions: input.read.value.allowed,
        second: true,
      },
      display: input.read.value.display,
      clearDisplay: false,
      error: { code: "conflict", message: "영향과 범위를 다시 확인해야 한다" },
    };
  }
  return { ok: true };
}
