import { assert, assertEquals } from "@std/assert";
import {
  asInternalError,
  ERROR_CODES,
  type ErrorCode,
  internalError,
} from "./errors.ts";

Deno.test("platform/api#R3: 공통 오류 코드는 일곱 개이고 분류 순서대로다", () => {
  const expected: ErrorCode[] = [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "conflict",
    "unavailable",
    "internal",
  ];
  assertEquals([...ERROR_CODES], expected);
});

Deno.test(
  "platform/api#R4: 알 수 없는 throw는 원문과 stack 없이 internal이 " +
    "된다",
  () => {
    const secret = "token-secret-stack";
    const thrown = new Error(secret);
    const error = asInternalError(thrown);
    assertEquals(error, internalError());
    assertEquals(error.code, "internal");
    const encoded = JSON.stringify(error);
    assert(!encoded.includes(secret));
    assert(!encoded.includes("stack"));
    assert(error.details === undefined);
  },
);
