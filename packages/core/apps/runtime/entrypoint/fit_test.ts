import { assertEquals } from "@std/assert";
import { CALL_RESPONSE_MAX_BYTES } from "../../../../protocol/base/frame.ts";
import { fitChangeset } from "./fit.ts";

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
