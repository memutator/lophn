import { assertEquals } from "@std/assert";
import {
  problemCodeDeclarationSchema,
  problemCodeDeclarationsSchema,
  problemMessageKeySchema,
  problemMessageSchema,
  RESERVED_PROBLEM_CODES,
  reservedProblemCodeSchema,
} from "./mod.ts";

const declaration = {
  code: "account_auth",
  message_key: "app-detail.issue.authentication_failed",
  message: "Sign in to your account again.",
  fixer: "user",
};
Deno.test("problems/problem-codes#R1: code boundaries and unique declarations", () => {
  for (const code of ["ab", "a".repeat(48)]) {
    assertEquals(
      problemCodeDeclarationSchema.safeParse({ ...declaration, code }).success,
      true,
    );
  }
  for (const code of ["a", "a".repeat(49), "A_code", "a-code", "_exception"]) {
    assertEquals(
      problemCodeDeclarationSchema.safeParse({ ...declaration, code }).success,
      false,
    );
  }
  assertEquals(problemCodeDeclarationsSchema.safeParse([]).success, true);
  assertEquals(
    problemCodeDeclarationsSchema.safeParse([declaration, declaration]).success,
    false,
  );
});
Deno.test("problems/problem-codes#R2: fixed message, key and fixer are required", () => {
  assertEquals(
    problemCodeDeclarationSchema.safeParse(declaration).success,
    true,
  );
  for (const message of [" ", "line\nline", "line\rline", "Missing {name}."]) {
    assertEquals(
      problemCodeDeclarationSchema.safeParse({ ...declaration, message })
        .success,
      false,
    );
  }
  for (
    const value of [
      { ...declaration, message_key: "bad" },
      { ...declaration, fixer: "agent" },
      { ...declaration, message: undefined },
      { ...declaration, message_key: undefined },
      { ...declaration, fixer: undefined },
      { ...declaration, unknown: true },
    ]
  ) assertEquals(problemCodeDeclarationSchema.safeParse(value).success, false);
});
Deno.test("problems/problem-codes#R5, problems/problem-codes#R6: platform-only reserved catalog", () => {
  assertEquals(RESERVED_PROBLEM_CODES, [
    {
      code: "_exception",
      message_key: "app-detail.issue.unexpected_error",
      message: "Something went wrong in this app.",
      fixer: "coding_agent",
    },
    {
      code: "_feedback",
      message_key: "app-detail.issue.reported",
      message: "You reported an issue.",
      fixer: "coding_agent",
    },
    {
      code: "_invalid_report",
      message_key: "app-detail.issue.report_incomplete",
      message: "This app could not report an issue correctly.",
      fixer: "coding_agent",
    },
  ]);
  for (const value of RESERVED_PROBLEM_CODES) {
    assertEquals(reservedProblemCodeSchema.safeParse(value.code).success, true);
    assertEquals(
      problemMessageKeySchema.safeParse(value.message_key).success,
      true,
    );
    assertEquals(problemMessageSchema.safeParse(value.message).success, true);
    assertEquals(problemCodeDeclarationSchema.safeParse(value).success, false);
  }
  assertEquals(
    reservedProblemCodeSchema.safeParse("account_auth").success,
    false,
  );
});
