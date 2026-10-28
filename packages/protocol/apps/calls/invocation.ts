import { z } from "zod";
import { withReadCommon } from "../../base/envelope.ts";
import { idSchema } from "../../base/ids.ts";
import { defineRead } from "../../base/route.ts";
import { atSchema, sha256Schema } from "../../base/values.ts";
import { appIdSchema } from "../../projects/values.ts";
import {
  invocationIdSchema,
  releaseIdSchema,
  runtimeModeSchema,
} from "../channel-values.ts";
import { invocationSummarySchema } from "../invocations.ts";
import { appToolCallerSchema } from "./caller.ts";
import { toolNameSchema } from "../channel-values.ts";

const sequence = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

// data_change는 옛 모양 그대로다.
export const appInvocationOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tool"), tool: toolNameSchema }),
  z.object({
    kind: z.literal("start"),
    reason: z.enum(["activation", "restart"]),
  }),
  z
    .object({
      kind: z.literal("data_change"),
      from: sequence,
      to: sequence,
    })
    .refine((value) => value.to > value.from, {
      message: "data_change to is not after from",
    }),
]);

const appInvocationStatusSchema = z.enum([
  "running",
  "succeeded",
  "failed",
  "denied",
  "unknown",
]);

export const invocationEffectSchema = z.enum(["read", "write", "external"]);

const changesetSummarySchema = z.strictObject({
  hash: sha256Schema,
  size_bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

// caller가 null이면 앱 시작과 data_change다.
export const appInvocationSchema = z
  .object({
    id: invocationIdSchema,
    app: appIdSchema,
    release: releaseIdSchema,
    mode: runtimeModeSchema,
    operation: appInvocationOperationSchema,
    caller: appToolCallerSchema.nullable(),
    effect: invocationEffectSchema,
    status: appInvocationStatusSchema,
    started_at: atSchema.nullable(),
    finished_at: atSchema.nullable(),
    input_hash: sha256Schema.nullable(),
    summary: invocationSummarySchema,
    detail_hash: sha256Schema.nullable(),
    changeset: changesetSummarySchema.nullable(),
    reverted_by: idSchema("rwd").nullable(),
  })
  .refine((value) => value.changeset === null || value.effect !== "read", {
    message: "a read has no changeset",
  })
  .refine(
    (value) => (value.finished_at !== null) === (value.status !== "running"),
    {
      message: "finished_at is set only when not running",
    },
  )
  .refine(
    (value) =>
      value.reverted_by === null ||
      ["succeeded", "failed", "unknown"].includes(value.status),
    { message: "reverted_by needs a succeeded, failed or unknown invocation" },
  );
export type AppInvocation = z.infer<typeof appInvocationSchema>;

const readActors = ["user", "agent", "machine"] as const;
const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

const APP_INVOCATIONS_MAX_COUNT = 200;

// session·turn 필터는 session·turn별 write 목록에 쓴다.
export const appInvocationsInputSchema = z.strictObject({
  app: appIdSchema.optional(),
  session: idSchema("ses").optional(),
  turn: idSchema("trn").optional(),
  effect: invocationEffectSchema.optional(),
  status: appInvocationStatusSchema.optional(),
  reverted: z.boolean().optional(),
  mode: runtimeModeSchema.optional(),
  release: releaseIdSchema.optional(),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(APP_INVOCATIONS_MAX_COUNT).optional(),
});
const appInvocationsOutputSchema = withReadCommon(
  z.object({
    invocations: z.array(appInvocationSchema),
  }),
);
export const appInvocations = defineRead({
  resource: "apps",
  method: "invocations",
  name: "app.invocations",
  input: appInvocationsInputSchema,
  output: appInvocationsOutputSchema,
  actors: readActors,
  errors: readErrors,
});

const appInvocationInputSchema = z.strictObject({
  invocation: invocationIdSchema,
});
const appInvocationOutputSchema = withReadCommon(
  z.object({
    invocation: appInvocationSchema.nullable(),
  }),
);
export const appInvocation = defineRead({
  resource: "apps",
  method: "invocation",
  name: "app.invocation",
  input: appInvocationInputSchema,
  output: appInvocationOutputSchema,
  actors: readActors,
  errors: readErrors,
});
