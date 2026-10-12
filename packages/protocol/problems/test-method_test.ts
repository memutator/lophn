import { assertEquals } from "@std/assert";
import {
  TEST_EXECUTION_LIMITS,
  testMethodInputSchema,
  testMethodSchema,
} from "./mod.ts";

const method = {
  argv: ["test", "tests.ts"],
  cwd: ".",
  timeout_ms: 60_000,
  expected_exit_code: 0,
  environment: "a".repeat(64),
};

Deno.test("problems/tests#R16, problems/tests#R19, problems/tests#R20: bounded Deno argv and source cwd", () => {
  assertEquals(testMethodSchema.safeParse(method).success, true);
  assertEquals(
    testMethodSchema.safeParse({
      ...method,
      argv: ["test", "--allow-read=fixtures", "tests.ts"],
    }).success,
    true,
  );
  assertEquals(
    testMethodInputSchema.safeParse({
      ...method,
      argv: ["test", "--no-check", "tests.ts"],
    }).success,
    true,
  );
  for (const timeout_ms of [1, 300_000]) {
    assertEquals(
      testMethodSchema.safeParse({ ...method, timeout_ms }).success,
      true,
    );
  }
  for (
    const value of [
      { ...method, timeout_ms: undefined },
      { ...method, timeout_ms: 0 },
      { ...method, timeout_ms: 300_001 },
      { ...method, timeout_ms: "60000" },
      { ...method, cwd: "../source" },
      { ...method, cwd: "/home" },
      { ...method, cwd: "C:\\home" },
      { ...method, argv: ["sh", "-c", "deno test"] },
      { ...method, argv: ["native-test"] },
      { ...method, argv: ["deno", "test", "tests.ts"] },
      { ...method, argv: ["test"] },
      { ...method, argv: ["test", "--no-check"] },
      { ...method, argv: ["test", ""] },
      { ...method, argv: ["test", "--allow-all", "test.ts"] },
      { ...method, argv: ["test", "--allow-read", "test.ts"] },
      { ...method, argv: ["test", "--allow-read=*", "test.ts"] },
      { ...method, argv: ["test", "--allow-run=deno", "test.ts"] },
      { ...method, argv: ["test", "tests.ts; cat secret"] },
      { ...method, argv: ["test", "../test.ts"] },
      { ...method, unknown: true },
    ]
  ) assertEquals(testMethodInputSchema.safeParse(value).success, false);
  assertEquals(TEST_EXECUTION_LIMITS, {
    concurrent: 2,
    preparing: 16,
    timeout_ms: 300_000,
    suggested_timeout_ms: 60_000,
    output_bytes_per_side: 1_048_576,
    process_memory_bytes: 536_870_912,
    deno_heap_bytes: 268_435_456,
  });
});
