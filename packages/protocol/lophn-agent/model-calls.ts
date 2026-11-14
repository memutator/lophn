import { z } from "zod";
import { defineCommand, defineRead } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { blobSizeSchema, seqSchema, sha256Schema } from "../base/values.ts";
import { withReadCommon } from "../base/envelope.ts";
import {
  callCostOutputSchema,
  initialCallCostSchema,
  modelCallRecordSchema,
  modelOutcomeSchema,
  tokenUsageSchema,
} from "./model-call-values.ts";

const nonblankSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "expected nonblank text",
});
const measuredSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .nullable();

const machineErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "conflict",
  "unavailable",
] as const;
const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;
const readActors = ["user", "agent", "machine"] as const;

const startModelCallInputSchema = z
  .strictObject({
    call: modelCallRecordSchema.strict(),
    applied_messages: z.array(idSchema("msg")),
    // 준비한 input·context_basis blob의 크기. 있으면 command가 영구 참조를 등록한다.
    blob_sizes: z
      .strictObject({
        input: blobSizeSchema,
        context_basis: blobSizeSchema,
      })
      .optional(),
    state_seq: seqSchema,
  })
  .refine(
    (value) =>
      value.call.state === "started" &&
      value.call.output === null &&
      value.call.outcome === null &&
      value.call.finished_at === null &&
      initialCallCostSchema.safeParse(value.call.cost).success,
    { message: "a started call has no result and an unknown cost" },
  );
const modelCallCompareSchema = z.strictObject({ state_seq: seqSchema });

const finishModelCallInputSchema = z
  .strictObject({
    call: idSchema("mcl"),
    output: sha256Schema.nullable(),
    // 준비한 output blob의 크기. 있으면 command가 영구 참조를 등록한다.
    output_size: blobSizeSchema.optional(),
    outcome: modelOutcomeSchema,
    usage: tokenUsageSchema,
    cost: callCostOutputSchema,
    duration_ms: measuredSchema,
    first_output_ms: measuredSchema,
    state_seq: seqSchema,
  })
  .refine(
    (value) => value.outcome.kind !== "partial" || value.output !== null,
    { message: "a partial outcome keeps the received output" },
  );

const supplementModelCallInputSchema = z
  .strictObject({
    call: idSchema("mcl"),
    supplement_key: nonblankSchema,
    usage: tokenUsageSchema.nullable(),
    cost: callCostOutputSchema.nullable(),
    outcome: modelOutcomeSchema.nullable(),
    basis: sha256Schema.nullable(),
  })
  .refine(
    (value) =>
      value.usage !== null || value.cost !== null || value.outcome !== null,
    { message: "a supplement adds a late fact" },
  );

const callOutput = z.object({ call: modelCallRecordSchema });

export const startModelCall = defineCommand({
  resource: "model-calls",
  method: "start",
  name: "StartModelCall",
  changes: [],
  input: startModelCallInputSchema,
  output: callOutput,
  compare: modelCallCompareSchema,
  actors: ["machine"],
  errors: [...machineErrors],
});

export const finishModelCall = defineCommand({
  resource: "model-calls",
  method: "finish",
  name: "FinishModelCall",
  changes: [],
  input: finishModelCallInputSchema,
  output: callOutput,
  compare: modelCallCompareSchema,
  actors: ["machine"],
  errors: ["invalid_input", "unauthorized", "conflict", "not_found"],
});

export const supplementModelCall = defineCommand({
  resource: "model-calls",
  method: "supplement",
  name: "SupplementModelCall",
  changes: [],
  input: supplementModelCallInputSchema,
  output: callOutput,
  compare: modelCallCompareSchema,
  actors: ["machine"],
  errors: ["invalid_input", "unauthorized", "conflict", "not_found"],
});

export const modelCallRead = defineRead({
  resource: "model-calls",
  method: "read",
  name: "ReadModelCall",
  input: z.strictObject({ call: idSchema("mcl") }),
  output: withReadCommon(callOutput),
  actors: readActors,
  errors: [...readErrors],
});

export const modelCallList = defineRead({
  resource: "model-calls",
  method: "list",
  name: "ListModelCalls",
  input: z.strictObject({
    turn: idSchema("trn").optional(),
    session: idSchema("ses").optional(),
    cursor: z.string().min(1).optional(),
  }),
  output: withReadCommon(z.object({ calls: z.array(modelCallRecordSchema) })),
  actors: readActors,
  errors: [...readErrors],
});

export const MODEL_CALL_ROUTES = [
  startModelCall,
  finishModelCall,
  supplementModelCall,
  modelCallRead,
  modelCallList,
] as const;
