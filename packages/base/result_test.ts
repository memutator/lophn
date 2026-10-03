import { assertEquals } from "@std/assert";
import { internalError } from "./errors.ts";
import { err, ok } from "./result.ts";

Deno.test(
  "platform/api#R3: Result는 성공 값과 공통 오류를 한 모양으로 나눈다",
  () => {
    const success = ok({ seq: "1" });
    const failure = err(internalError());
    assertEquals(success.ok, true);
    if (success.ok) assertEquals(success.value, { seq: "1" });
    assertEquals(failure.ok, false);
    if (!failure.ok) assertEquals(failure.error.code, "internal");
  },
);
