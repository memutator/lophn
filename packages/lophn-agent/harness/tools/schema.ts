import type { z } from "zod";
import { err, ok, type Result } from "../../../base/mod.ts";

// 진입 전 입력 검사(R3). JSON Schema 검증은 정의의 zod schema가 맡는다. 숫자
// 문자열을 숫자로 바꾸거나 모르는 필드를 지우거나 잘못된 값을 추측해 고치지
// 않는다. 실패는 입력을 하나도 적용하지 않은 invalid_input이다.

export type InputRejection = {
  code: "invalid_input";
  message: string;
  // 모델이 고칠 자리. 값 자체는 담지 않는다.
  path: string;
};

// zod의 기본 변환을 끈다. z.coerce는 정의에서 쓰지 않고, 여기 옵션이 문자열
// 숫자를 숫자로 받는 경로를 막는다.
const PARSE = { reportInput: true } as const;

export function checkInput(
  schema: z.ZodType,
  input: unknown,
): Result<unknown, InputRejection> {
  const parsed = schema.safeParse(input, PARSE);
  if (parsed.success) return ok(parsed.data);
  const issue = parsed.error.issues[0];
  const path = issue === undefined ? "" : issue.path.join(".");
  return err({
    code: "invalid_input",
    message: issue === undefined
      ? "tool input does not match the definition"
      : `tool input does not match the definition at ${path || "input"}`,
    path,
  });
}

// 입력이 바뀌지 않았는지 본다. 변환·보정이 있었다면 실행하지 않는다.
export function unchanged(input: unknown, parsed: unknown): boolean {
  return JSON.stringify(input) === JSON.stringify(parsed);
}
