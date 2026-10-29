import type { z } from "zod";
import { canonicalize, err, ok, type Result } from "../../../base/mod.ts";

// 진입 전 입력 검사. JSON Schema 검증은 정의의 zod schema가 맡는다. 숫자
// 문자열을 숫자로 바꾸거나 모르는 필드를 지우거나 잘못된 값을 추측해 고치지
// 않는다. 실패는 입력을 하나도 적용하지 않은 invalid_input이다.

type InputRejection = {
  code: "invalid_input";
  message: string;
  // 모델이 고칠 자리. 값 자체는 담지 않는다.
  path: string;
};

// zod의 기본 변환을 끈다. z.coerce는 정의에서 쓰지 않고, 여기 옵션이 문자열
// 숫자를 숫자로 받는 경로를 막는다.
const PARSE = { reportInput: true } as const;

// 첫 문제 하나만 알린다. 모르는 key는 그 이름을, 그 밖은 zod 설명 글을 붙인다. 설명 글은 schema가 기대한 것(type,
// 범위, 형식)이고 입력 값은 담지 않는다. model이 왕복 없이 고칠 수 있게 하려는 것이다.
export function checkInput(
  schema: z.ZodType,
  input: unknown,
): Result<unknown, InputRejection> {
  const parsed = schema.safeParse(input, PARSE);
  if (parsed.success) return ok(parsed.data);
  const issue = parsed.error.issues[0];
  if (issue === undefined) {
    return err({
      code: "invalid_input",
      message: "tool input does not match the definition",
      path: "",
    });
  }
  const path = issue.path.join(".");
  const detail =
    issue.code === "unrecognized_keys"
      ? `unknown key ${issue.keys.join(", ")}`
      : issue.message;
  return err({
    code: "invalid_input",
    message: `tool input does not match the definition at ${path || "input"}: ${detail}`,
    path,
  });
}

// 입력이 바뀌지 않았는지 본다. 변환·보정이 있었다면 실행하지 않는다. 객체 key의 순서는 값이 아니라
// 모델이 쓴 순서일 뿐이므로 정규화해 비교한다(순서만 다른 입력을 바뀐 입력으로 거절하지 않는다).
export function unchanged(input: unknown, parsed: unknown): boolean {
  try {
    return canonicalize(input) === canonicalize(parsed);
  } catch {
    return false;
  }
}
