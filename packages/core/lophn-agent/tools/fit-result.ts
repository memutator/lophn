import { err, type Result } from "../../../base/mod.ts";
import type { ToolResult } from "../../../protocol/lophn-agent/mod.ts";
import { fitJson } from "./result.ts";

// 결과 상한 안에 맞춰 돌려준다. 넘으면 arrayKeys의 뒤쪽 항목부터 덜어 내고 content.omitted에 수를 남긴다.
export function fitted(
  summary: string,
  value: Record<string, unknown>,
  arrayKeys: readonly string[] = [],
): ToolResult {
  const fit = fitJson(value, arrayKeys);
  return {
    status: "success",
    summary,
    content: fit.content as ToolResult["content"],
    complete: fit.complete,
    source: null,
    continuation: null,
    pending: [],
  };
}

// 읽기 route 출력에서 읽기 공통 칸을 걷는다. 다음 page가 있는지만 따로 돌려준다.
export function readBody<T extends { next_cursor?: string | null }>(
  value: T,
): { body: Omit<T, "as_of_seq" | "next_cursor" | "omitted">; more: boolean } {
  const { as_of_seq: _seq, next_cursor, omitted: _omitted, ...body } = value as
    & T
    & { as_of_seq?: unknown; omitted?: unknown };
  return {
    body: body as Omit<T, "as_of_seq" | "next_cursor" | "omitted">,
    more: (next_cursor ?? null) !== null,
  };
}

// 목록 tool 입력에는 cursor가 없다. 더 있으면 조건을 좁히라고 알린다.
export function countSummary(noun: string, count: number, more: boolean) {
  return more
    ? `${count} ${noun} (more exist; narrow the filter)`
    : `${count} ${noun}`;
}

export function forbidden(message: string): Result<never> {
  return err({ code: "forbidden", message });
}

export function notFound(message: string): Result<never> {
  return err({ code: "not_found", message });
}

export function unavailable(message: string): Result<never> {
  return err({ code: "unavailable", message });
}

export function invalid(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}
