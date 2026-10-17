import { z } from "zod";
import {
  appApiKeySchema,
  appIdSchema,
  atSchema,
  invocationIdSchema,
  processNonceSchema,
  releaseIdSchema,
  sha256Schema,
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

// 서명된 일시 값. 서명·TTL은 core가 정한다.
const confirmProofFields = {
  invocation: invocationIdSchema,
  process_nonce: processNonceSchema,
  release: releaseIdSchema,
  command: appApiKeySchema,
  input_hash: sha256Schema,
  caller: invocationCallerSchema,
  expires_at: atSchema,
};
export const confirmExecutionProofSchema = z.object(confirmProofFields);
