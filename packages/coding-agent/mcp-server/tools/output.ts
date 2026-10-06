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

type Paged = {
  complete?: boolean;
  next_cursor?: string | null;
  omitted?: { reason: string; count: number }[];
};

const OMIT_REASON: Record<string, string> = {
  page_limit: "쪽 한도로",
  byte_limit: "크기 한도로",
};

// 한 쪽 읽기의 잘림과 이어 읽기를 한 문장으로 알린다. 허용 밖 대상은 세지 않으므로
// 생략 수는 읽을 수 있는 것의 남은 수다. 이어 읽을 것이 없으면 text가 비어 있다.
export function continuation(value: Paged): { text: string; more: boolean } {
  const parts: string[] = [];
  for (const item of value.omitted ?? []) {
    if (item.count > 0) {
      parts.push(
        `${OMIT_REASON[item.reason] ?? "한도로"} ${item.count}개 생략`,
      );
    }
  }
  const cursor = typeof value.next_cursor === "string" &&
    value.next_cursor !== "";
  const more = cursor || value.complete === false;
  if (more) parts.push("이어 읽을 것이 더 있다(next_cursor)");
  return { text: parts.join(", "), more };
}

// 요약 뒤에 잘림 안내를 붙인다.
export function withContinuation(summary: string, value: Paged): string {
  const { text } = continuation(value);
  return text === "" ? summary : `${summary}. ${text}`;
}
