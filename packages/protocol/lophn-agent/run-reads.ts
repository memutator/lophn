import { z } from "zod";
import { defineRead } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { readCursorSchema, seqSchema, sha256Schema } from "../base/values.ts";
import { withReadCommon } from "../base/envelope.ts";
import {
  runOutcomeOutputSchema,
  runRecordSchema,
  runStateSchema,
} from "./run-values.ts";

const runRef = { run: idSchema("run") };

const runReadInputSchema = z.strictObject(runRef);

const runListInputSchema = z.strictObject({
  assignment: idSchema("asg").optional(),
  state: runStateSchema.optional(),
  cursor: readCursorSchema.optional(),
});

const runResultInputSchema = z.strictObject(runRef);

const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

const readActors = ["user", "agent", "machine", "coding_agent"] as const;

const runRead = defineRead({
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

const runList = defineRead({
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

const runResult = defineRead({
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

export const RUN_READS = [
  runRead,
  runList,
  runResult,
] as const;
