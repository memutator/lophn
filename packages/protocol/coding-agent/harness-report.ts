// shell main이 감지한 harness를 core 메모리에 알리고, core가 제품마다 보이는 값을 돌려준다.
import { z } from "zod";
import { defineMemory } from "../base/route.ts";
import { harnessDetectionSchema, harnessIdSchema } from "./harnesses.ts";

export const harnessReport = defineMemory({
  resource: "coding_agent_harnesses",
  method: "report",
  name: "harness.report",
  input: z.strictObject({ detections: z.array(harnessDetectionSchema) }),
  output: z.strictObject({}),
  actors: ["user"],
  errors: ["invalid_input", "unauthorized", "forbidden"],
});

// can_launch와 can_deliver_messages는 `canLaunch`·`canDeliverMessages`와 같은 뜻이고 core가 채운다.
const harnessListItemSchema = z.strictObject({
  harness: harnessIdSchema,
  detected: z.boolean(),
  version: z.string().nullable(),
  can_launch: z.boolean(),
  can_deliver_messages: z.boolean(),
});
export type HarnessListItem = z.infer<typeof harnessListItemSchema>;

export const harnessList = defineMemory({
  resource: "coding_agent_harnesses",
  method: "list",
  name: "harness.list",
  input: z.strictObject({}),
  output: z.object({ harnesses: z.array(harnessListItemSchema) }),
  actors: ["user", "agent"],
  errors: ["invalid_input", "unauthorized", "forbidden"],
});

export const HARNESS_ROUTES = [harnessReport, harnessList] as const;
