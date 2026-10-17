import { z } from "zod";
import {
  appIdSchema,
  invocationIdSchema,
  releaseIdSchema,
  toolCallIdSchema,
  turnIdSchema,
} from "./channel-values.ts";

// AppCallOrigin에서 감사 caller로 남기는 것만. path·nonce·credential은 복제하지 않는다.
const invocationCallerBranches = [
  z.strictObject({ kind: z.literal("direct") }),
  z.strictObject({
    kind: z.literal("app"),
    app: appIdSchema,
    release: releaseIdSchema,
    parent_invocation: invocationIdSchema.nullable(),
  }),
  z.strictObject({
    kind: z.literal("agent"),
    turn: turnIdSchema,
    tool_call: toolCallIdSchema,
  }),
  z.strictObject({ kind: z.literal("system") }),
] as const;
export const invocationCallerSchema = z.discriminatedUnion(
  "kind",
  invocationCallerBranches,
);
