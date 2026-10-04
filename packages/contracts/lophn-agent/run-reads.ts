import { z } from "zod";
import {
  defineRead,
  idSchema,
  seqSchema,
  sha256Schema,
  withReadCommon,
} from "../platform/mod.ts";
import {
  readCursorSchema,
  runOutcomeOutputSchema,
  runRecordSchema,
  runStateSchema,
} from "./run-values.ts";

const runRef = { run: idSchema("run") };

export const runReadInputSchema = z.strictObject(runRef);

export const runListInputSchema = z.strictObject({
  assignment: idSchema("asg").optional(),
  state: runStateSchema.optional(),
  cursor: readCursorSchema.optional(),
});

export const runResultInputSchema = z.strictObject(runRef);

const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

const readActors = ["user", "agent", "machine", "coding_agent"] as const;

export const runRead = defineRead({
  resource: "runs",
  method: "read",
  name: "ReadRun",
  input: runReadInputSchema,
  output: withReadCommon(z.object({ run: runRecordSchema })).refine(
    (value) =>
      seqSchema.safeParse(value.run.state_seq).success &&
      seqSchema.safeParse(value.as_of_seq).success &&
      BigInt(value.run.state_seq) <= BigInt(value.as_of_seq),
    { message: "run state is newer than read snapshot" },
  ),
  actors: readActors,
  errors: [...readErrors],
});

export const runList = defineRead({
  resource: "runs",
  method: "list",
  name: "ListRuns",
  input: runListInputSchema,
  output: withReadCommon(z.object({ runs: z.array(runRecordSchema) })).refine(
    (value) =>
      seqSchema.safeParse(value.as_of_seq).success &&
      value.runs.every((run) =>
        seqSchema.safeParse(run.state_seq).success &&
        BigInt(run.state_seq) <= BigInt(value.as_of_seq)
      ),
    { message: "run state is newer than read snapshot" },
  ),
  actors: readActors,
  errors: [...readErrors],
});

export const runResult = defineRead({
  resource: "runs",
  method: "result",
  name: "ReadRunResult",
  input: runResultInputSchema,
  output: withReadCommon(z.object({
    run: idSchema("run"),
    state: runStateSchema,
    outcome: runOutcomeOutputSchema.nullable(),
    result: sha256Schema.nullable(),
  })).refine(
    (value) =>
      (value.outcome !== null) === (value.state === "finished") &&
      (value.result !== null) === (value.state === "finished"),
    {
      message: "only finished runs have a final outcome and result",
    },
  ),
  actors: readActors,
  errors: [...readErrors],
});

export const RUN_READS = [runRead, runList, runResult] as const;
