import { REASONING_BUDGET_TOKENS } from "../../../contracts/lophn-agent/mod.ts";
import type { Result } from "../../../base/mod.ts";
import { err, ok } from "../../../base/mod.ts";

// token 예산과 보수 상한 계산이다. 정확한 tokenizer가 아니라 호출 gate에 쓰는
// 하한 확인이다. 순수 규칙만 두고 I/O는 없다.

// 확인된 min/max 안으로 clamp한다(R17). 2048·8192·16384·32768은 요구에 고정된
// 값이고 maximum=32768은 high=16384와 다르다. min/max가 확인되지 않으면(null)
// 확인된 예산 방식이 아니므로 제공하지 않는다.
export function clampBudgetTokens(
  level: "low" | "medium" | "high" | "maximum",
  min: number | null,
  max: number | null,
): number | null {
  if (min === null || max === null) return null;
  const budget = REASONING_BUDGET_TOKENS[level];
  if (min > max) return null;
  return Math.min(Math.max(budget, min), max);
}

// text UTF-8 byte 수를 보수적 token 상한으로 쓴다(R14). TextEncoder는 잘못된
// 대리쌍을 U+FFFD로 바꾼다. 한글·이모지도 UTF-8 byte 그대로 세어 chars/4 같은
// 추측이 아니다. 작은 보수가 아니라 interop 하한이다: byte 수 ≤ 정확한 token 수는
// 보장하지 않지만, char 수 기반 추측보다 작게 나오는 방향은 없다.
// 토큰 수 ≤ byte 수는 일반적으로 항상 참이라 이 상한은 보수적으로 안전하다.
export function textTokenUpperBound(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

// 비텍스트(이미지·PDF·음성·영상)는 크기를 모르면 호출하지 않는다(R14).
// 크기가 확인됐으면 크기를 그대로 token 상한으로 본다. 확장자 추측 없음.
export function nonTextTokenBound(
  sizeBytes: number | null,
): Result<number | null> {
  if (sizeBytes === null) {
    return err({
      code: "invalid_input",
      message: "비텍스트 크기를 모른다",
    });
  }
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    return err({ code: "invalid_input", message: "비텍스트 크기가 틀리다" });
  }
  return ok(sizeBytes);
}
