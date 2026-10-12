import { assertEquals } from "@std/assert";
import {
  TEST_OBSERVATION_FRAME_MAX_BYTES,
  TEST_OBSERVATION_SIDE_MAX_BYTES,
  testObservationFrameSchema,
  testObservationFramesSchema,
} from "./mod.ts";

const frame = {
  side: "single",
  test_hash: "a".repeat(64),
  name: "actual_failure_path",
  actual: { code: "account_auth" },
  reason: "Observed the failure path.",
};
const encoder = new TextEncoder();
Deno.test("problems/tests#R19: private observations require side, hash, check name and JSON actual", () => {
  assertEquals(testObservationFrameSchema.safeParse(frame).success, true);
  assertEquals(
    testObservationFrameSchema.safeParse({
      ...frame,
      side: "before",
      symptom_reproduced: true,
      expectation_met: false,
    }).success,
    true,
  );
  for (
    const value of [
      { ...frame, side: "stdout" },
      { ...frame, test_hash: "pass" },
      { ...frame, name: " " },
      { ...frame, actual: undefined },
      { ...frame, actual: NaN },
      { ...frame, reason: " " },
      { ...frame, unknown: true },
    ]
  ) assertEquals(testObservationFrameSchema.safeParse(value).success, false);
  assertEquals(testObservationFramesSchema.safeParse([]).success, false);
  assertEquals(TEST_OBSERVATION_FRAME_MAX_BYTES, 65_536);
  assertEquals(TEST_OBSERVATION_SIDE_MAX_BYTES, 1_048_576);
});
Deno.test("problems/tests#R19: frame limit is UTF-8 bytes including JSON overhead", () => {
  const blank = { ...frame, actual: "" };
  const overhead = encoder.encode(JSON.stringify(blank)).length;
  const exact = {
    ...blank,
    actual: "x".repeat(TEST_OBSERVATION_FRAME_MAX_BYTES - overhead),
  };
  assertEquals(encoder.encode(JSON.stringify(exact)).length, 65_536);
  assertEquals(testObservationFrameSchema.safeParse(exact).success, true);
  assertEquals(
    testObservationFrameSchema.safeParse({
      ...exact,
      actual: exact.actual + "x",
    }).success,
    false,
  );
  assertEquals(
    testObservationFrameSchema.safeParse({
      ...blank,
      actual: "한".repeat(30_000),
    }).success,
    false,
  );
});
Deno.test("problems/tests#R19: cumulative limit applies independently to each side", () => {
  const blank = { ...frame, actual: "" };
  const overhead = encoder.encode(JSON.stringify(blank)).length;
  const exact = {
    ...blank,
    actual: "x".repeat(TEST_OBSERVATION_FRAME_MAX_BYTES - overhead),
  };
  assertEquals(TEST_OBSERVATION_SIDE_MAX_BYTES, 1_048_576);
  assertEquals(
    testObservationFramesSchema.safeParse(Array(16).fill(exact)).success,
    true,
  );
  assertEquals(
    testObservationFramesSchema.safeParse([...Array(16).fill(exact), frame])
      .success,
    false,
  );
  assertEquals(
    testObservationFramesSchema.safeParse([...Array(16).fill(exact), {
      ...frame,
      side: "after",
    }]).success,
    true,
  );
});
