// call이 실행 옵션을 고르지 않았을 때 쓰는 Settings 기본.
import { z } from "zod";
import { harnessIdSchema } from "../../../protocol/coding-agent/harness-id.ts";
import { declareSetting } from "../../../protocol/config/mod.ts";

export const codingDefaultHarness = declareSetting({
  key: "coding-agent.default_harness",
  type: harnessIdSchema.nullable(),
  default: null,
});

export const codingDefaultModel = declareSetting({
  key: "coding-agent.default_model",
  type: z.string().min(1).nullable(),
  default: null,
});
