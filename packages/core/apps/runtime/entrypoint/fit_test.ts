import { assertEquals } from "@std/assert";
import { CALL_RESPONSE_MAX_BYTES } from "../../../../protocol/base/frame.ts";
import { fitChangeset } from "./fit.ts";
import { RESULT_MAX_BYTES } from "./limits.ts";

Deno.test("frame에 안 들어가는 changeset은 빼고 too_large로 알리며 들어가는 응답은 그대로 나간다", () => {
  const small = { status: "ok", result: 1, changeset: "AAAA" };
  assertEquals(fitChangeset(small), small);

  const big = {
    status: "error",
    error: { code: "internal", message: "x" },
    changeset: "A".repeat(CALL_RESPONSE_MAX_BYTES),
  };
  assertEquals(fitChangeset(big), {
    status: "error",
    error: { code: "internal", message: "x" },
    changeset: null,
    changeset_dropped: "too_large",
  });

  const none = {
    status: "ok",
    result: "x".repeat(CALL_RESPONSE_MAX_BYTES),
    changeset: null,
  };
  assertEquals(fitChangeset(none), none);
});

Deno.test("결과 상한만큼 큰 결과가 있는 응답은 changeset을 빼고 나면 frame 한도 안이다", () => {
  const body = {
    status: "ok",
    result: "x".repeat(RESULT_MAX_BYTES - 2),
    changeset: "A".repeat(CALL_RESPONSE_MAX_BYTES),
  };
  const fitted = fitChangeset(body) as { changeset_dropped?: string };
  assertEquals(fitted.changeset_dropped, "too_large");
  const size = new TextEncoder().encode(JSON.stringify(fitted)).byteLength;
  assertEquals(size <= CALL_RESPONSE_MAX_BYTES, true);
});
