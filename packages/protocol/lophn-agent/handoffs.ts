import { z } from "zod";
import {
  defineCommand,
  defineRead,
  idSchema,
  seqSchema,
  sha256Schema,
  withReadCommon,
} from "../server/mod.ts";
import { handoffReferenceSchema } from "./run-values.ts";
import {
  handoffAllowed,
  handoffContentSchema,
  roleKindSchema,
} from "./decision-values.ts";

const commandErrors = [
  "invalid_input",
  "forbidden",
  "not_found",
  "conflict",
  "unavailable",
  "unauthorized",
] as const;

const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

const readActors = ["user", "agent", "machine", "coding_agent"] as const;

// submit은 AcceptRun의 출처 검사 wrapper다. 받는 run의 출처는 run source handoff 가지다.
export const handoffSubmitInputSchema = z.strictObject({
  sender_run: idSchema("run"),
  receiver_run: idSchema("run"),
  receiver_assignment: idSchema("asg"),
  from_role: roleKindSchema,
  to_role: roleKindSchema,
  original_message: idSchema("msg"),
  content: handoffContentSchema,
  body: sha256Schema,
  references: z.array(handoffReferenceSchema),
  dedup_key: z.string().min(1),
}).refine((value) => value.sender_run !== value.receiver_run, {
  message: "a handoff cannot be received by its sender",
}).refine((value) => handoffAllowed(value.from_role, value.to_role), {
  message: "handoff direction is not allowed",
});

export const handoffStatusInputSchema = z.strictObject({
  sender_run: idSchema("run"),
  dedup_key: z.string().min(1),
});

export const handoffResultInputSchema = z.strictObject({
  receiver_run: idSchema("run"),
});

const submittedOutput = z.object({
  receiver_run: idSchema("run"),
  accepted_seq: seqSchema,
  replayed: z.boolean(),
});

const statusOutput = z.object({
  sender_run: idSchema("run"),
  receiver_run: idSchema("run"),
  state: z.enum(["accepted", "running", "waiting_user", "finished"]),
});

const resultFields = z.object({
  receiver_run: idSchema("run"),
  finished: z.boolean(),
  result: sha256Schema.nullable(),
  version: idSchema("ver").nullable(),
  absent_reason: sha256Schema.nullable(),
});

function handoffResultShape(value: {
  finished: boolean;
  result: string | null;
  version: string | null;
  absent_reason: string | null;
}): boolean {
  return value.finished
    ? (value.version === null) !== (value.absent_reason === null)
    : value.result === null && value.version === null &&
      value.absent_reason === null;
}

export const handoffSubmit = defineCommand({
  resource: "handoffs",
  method: "submit",
  name: "SubmitHandoff",
  input: handoffSubmitInputSchema,
  output: submittedOutput,
  actors: ["agent"],
  errors: [...commandErrors],
});

export const handoffStatus = defineRead({
  resource: "handoffs",
  method: "status",
  name: "ReadHandoffStatus",
  input: handoffStatusInputSchema,
  output: withReadCommon(statusOutput),
  actors: readActors,
  errors: [...readErrors],
});

export const handoffResult = defineRead({
  resource: "handoffs",
  method: "result",
  name: "ReadHandoffResult",
  input: handoffResultInputSchema,
  output: withReadCommon(resultFields).refine(handoffResultShape, {
    message: "handoff result must be a fixed version or an absence reason",
  }),
  actors: readActors,
  errors: [...readErrors],
});

export const HANDOFF_ROUTES = [
  handoffSubmit,
  handoffStatus,
  handoffResult,
] as const;
