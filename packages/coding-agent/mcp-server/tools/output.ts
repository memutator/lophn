// 문서 tool들이 같이 쓰는 결과 모양이다. server가 mcpToolResult로 두 표현을 만든다(R5).
import type { LophnError } from "../../../base/mod.ts";

export type ToolOutput = {
  summary: string;
  data: unknown;
  next: string[];
  // 실행 실패·거절은 true다. 성공 결과는 생략한다(R7).
  isError?: true;
};

// core·소유 route의 오류를 그대로 전한다. 이유는 오류의 message이고 진단은 data에 남긴다.
export function failureOutput(
  error: LophnError,
  next: string[],
): ToolOutput {
  return {
    summary: error.message,
    data: { code: error.code, details: error.details ?? {} },
    next,
    isError: true,
  };
}

// `op`는 tool 입력의 선택자다. 소유 route 입력은 strict라 떼어 보낸다.
export function withoutOp(input: unknown): Record<string, unknown> {
  const { op: _op, ...rest } = (input ?? {}) as Record<string, unknown>;
  return rest;
}
