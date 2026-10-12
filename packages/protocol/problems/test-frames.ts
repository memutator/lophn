import { z } from "zod";
import { sha256Schema } from "../base/values.ts";
import { testSideSchema } from "./tests.ts";

export const TEST_OBSERVATION_FRAME_MAX_BYTES = 65_536;
export const TEST_OBSERVATION_SIDE_MAX_BYTES = 1_048_576;
const encoder = new TextEncoder();

export const testObservationFrameSchema = z.strictObject({
  side: testSideSchema,
  test_hash: sha256Schema,
  name: z.string().regex(/\S/),
  actual: z.json(),
  symptom_reproduced: z.boolean().optional(),
  expectation_met: z.boolean().optional(),
  reason: z.string().regex(/\S/),
}).refine(
  (value) =>
    encoder.encode(JSON.stringify(value)).length <=
      TEST_OBSERVATION_FRAME_MAX_BYTES,
  { message: "test observation frame exceeds byte limit" },
);
export type TestObservationFrame = z.infer<typeof testObservationFrameSchema>;

// IPC framing bytes are excluded; limits apply to UTF-8 JSON observations.
export const testObservationFramesSchema = z.array(testObservationFrameSchema)
  .min(1).refine((values) => {
    const totals = { single: 0, before: 0, after: 0 };
    for (const value of values) {
      totals[value.side] += encoder.encode(JSON.stringify(value)).length;
    }
    return Object.values(totals).every((bytes) =>
      bytes <= TEST_OBSERVATION_SIDE_MAX_BYTES
    );
  }, { message: "test observations exceed side byte limit" });
