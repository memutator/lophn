import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import {
  ERROR_HTTP_STATUS,
  errorBodySchema,
  errorCodeForStatus,
} from "./errors.ts";

Deno.test(
  "platform/api#R3: 공통 오류는 분류 순서대로 400·401·403·404·409·503·500이다",
  () => {
    assertEquals(
      ERROR_CODES.map((code) => ERROR_HTTP_STATUS[code]),
      [400, 401, 403, 404, 409, 503, 500],
    );
    for (const code of ERROR_CODES) {
      assertEquals(errorCodeForStatus(ERROR_HTTP_STATUS[code]), code);
    }
    assertEquals(errorCodeForStatus(200), undefined);
  },
);

Deno.test(
  "platform/api#R3: 실패 본문은 error 객체 하나에 code·message·선택 details를 담는다",
  () => {
    assert(
      errorBodySchema.safeParse({
        error: { code: "conflict", message: "changed" },
      }).success,
    );
    const withDetails = errorBodySchema.safeParse({
      error: {
        code: "invalid_input",
        message: "bad",
        details: { field: "title" },
        stack: "no",
      },
    });
    assert(withDetails.success);
    if (withDetails.success) {
      assertEquals("stack" in withDetails.data.error, false);
    }
    assert(
      !errorBodySchema.safeParse({ code: "conflict", message: "x" }).success,
    );
    assert(
      !errorBodySchema.safeParse({ error: { code: "nope", message: "x" } })
        .success,
    );
  },
);
