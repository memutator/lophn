// harness hook이 CLI를 거쳐 core에 닿는 route. core가 `hookSignalOf`로 agent event로 바꾼다.
import { z } from "zod";
import { jsonValueSchema } from "../base/json-values.ts";
import { defineMemory } from "../base/route.ts";
import { harnessIdSchema } from "./harnesses.ts";

export const HOOK_EVENT_MAX_CHARS = 80;
export const HOOK_PAYLOAD_MAX_BYTES = 65_536;

// ledger에 쓰지 않는다. 모르는 이벤트 이름은 오류가 아니라 `accepted: false`다.
export const codingHook = defineMemory({
  resource: "coding_agent_sessions",
  method: "hook",
  name: "coding.hook",
  input: z.strictObject({
    harness: harnessIdSchema,
    event: z.string().min(1).max(HOOK_EVENT_MAX_CHARS),
    payload: jsonValueSchema.refine(
      (value) =>
        new TextEncoder().encode(JSON.stringify(value)).length <=
          HOOK_PAYLOAD_MAX_BYTES,
      { message: "hook payload too large" },
    ),
  }),
  output: z.object({ accepted: z.boolean() }),
  actors: ["coding_agent"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
});

export const HOOK_ROUTES = [codingHook] as const;
