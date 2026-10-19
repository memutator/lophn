// handler가 효과를 내기 전에 "이 호출은 받지 않는다"고 알리는 오류다. runtime은 일반 예외(500,
// 효과를 모름)와 달리 이 코드와 안내 문장을 호출자에게 돌려주고 write도 효과 없음으로 기록한다.
// 심볼과 코드 목록은 packages/core/apps/invocations/context.ts의 APP_TOOL_REJECTION과 같다
// (SDK는 packages/core/apps를 import하지 않는다). 안내 문장에는 입력·상태 값을 넣지 않는다.

export const APP_TOOL_REJECTION = Symbol.for("lophn.app-tool-rejection");

export const REJECTION_CODES = [
  "invalid_input",
  "forbidden",
  "conflict",
  "unavailable",
] as const;
export type RejectionCode = (typeof REJECTION_CODES)[number];

export class ToolRejection extends Error {
  readonly code: RejectionCode;
  readonly [APP_TOOL_REJECTION]: RejectionCode;

  constructor(code: RejectionCode, message: string) {
    super(message);
    this.name = "ToolRejection";
    this.code = code;
    this[APP_TOOL_REJECTION] = code;
  }
}
