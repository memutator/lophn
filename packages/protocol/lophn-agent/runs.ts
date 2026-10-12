import { blobSizeSchema } from "./run-blobs.ts";
import { z } from "zod";
import {
  atSchema,
  defineCommand,
  defineEvent,
  idSchema,
  seqSchema,
  sha256Schema,
} from "../platform/mod.ts";
import { RUN_READS } from "./run-reads.ts";
import { agentAppScopeOutputSchema, agentAppScopeSchema } from "./scope.ts";
import {
  INITIAL_RUN_ELAPSED,
  nonSelfRunLinks,
  positiveRevisionSchema,
  runElapsedOutputSchema,
  runElapsedSchema,
  runLimitsOutputSchema,
  runLimitsSchema,
  runOutcomeOutputSchema,
  runOutcomeSchema,
  runSourceOutputSchema,
  runSourceSchema,
} from "./run-values.ts";
import {
  correctWaitingRun,
  recoverRun,
  resolveRunWait,
  RUN_WAIT_COMMANDS,
  runRecovered,
  runResumed,
  runWaited,
  waitRun,
} from "./run-wait.ts";

const runLinkFields = {
  continued_from: idSchema("run").nullable(),
  start_after: idSchema("run").nullable(),
};

const runRef = { run: idSchema("run") };
const stateSeq = { state_seq: seqSchema };

export const acceptRunInputSchema = z.strictObject({
  id: idSchema("run"),
  assignment: idSchema("asg"),
  session: idSchema("ses").nullable(),
  source: runSourceSchema,
  ...runLinkFields,
}).refine(nonSelfRunLinks, {
  message: "run links cannot reference themselves",
});

export const acceptRunCompareSchema = z.strictObject({
  assignment_revision: positiveRevisionSchema,
});

export const startRunInputSchema = z.strictObject({
  ...runRef,
  basis: sha256Schema,
  // 준비한 basis blob의 크기. 있으면 command가 영구 참조를 등록한다.
  basis_size: blobSizeSchema.optional(),
  // 고정한 resolved agent 전체 값의 blob(hash는 blob 바이트의 hash이고 기준의 agent.hash와 다르다). 이어 하기가
  // 이 blob을 그대로 쓴다. 두 칸은 함께 오고, 있으면 command가 영구 참조를 등록한다.
  agent: sha256Schema.optional(),
  agent_size: blobSizeSchema.optional(),
  limits: runLimitsSchema,
  scope: agentAppScopeSchema,
}).refine(
  (value) => (value.agent === undefined) === (value.agent_size === undefined),
  {
    message: "agent and agent_size come together",
  },
);

export const startRunCompareSchema = z.strictObject(stateSeq);

export const checkpointRunInputSchema = z.strictObject({
  ...runRef,
  elapsed: runElapsedSchema,
});

export const checkpointRunCompareSchema = z.strictObject(stateSeq);

export const finishRunInputSchema = z.strictObject({
  ...runRef,
  outcome: runOutcomeSchema,
  result: sha256Schema,
  // 준비한 result blob의 크기. 있으면 command가 영구 참조를 등록한다.
  result_size: blobSizeSchema.optional(),
});

export const finishRunCompareSchema = z.strictObject(stateSeq);

export const stopRunInputSchema = z.strictObject({
  ...runRef,
  request_key: z.string().min(1),
  reason: z.enum([
    "user_stopped",
    "assignment_paused",
    "assignment_withdrawn",
  ]),
});

export const stopRunCompareSchema = z.strictObject(stateSeq);

export const confirmNextRunInputSchema = z.strictObject({
  ...runRef,
  predecessor: idSchema("run"),
}).refine((value) => value.run !== value.predecessor, {
  message: "a run cannot be its own predecessor",
});

export const confirmNextRunCompareSchema = z.strictObject({
  accepted_seq: seqSchema,
  predecessor_state_seq: seqSchema,
});

const commandErrors = [
  "invalid_input",
  "forbidden",
  "not_found",
  "conflict",
  "unauthorized",
] as const;

const acceptedOutput = z.object({
  id: idSchema("run"),
  state: z.literal("accepted"),
  accepted_seq: seqSchema,
  state_seq: seqSchema,
});

export const acceptRun = defineCommand({
  resource: "runs",
  method: "accept",
  name: "AcceptRun",
  input: acceptRunInputSchema,
  output: acceptedOutput,
  compare: acceptRunCompareSchema,
  actors: ["machine"],
  errors: [...commandErrors],
});

export const startRun = defineCommand({
  resource: "runs",
  method: "start",
  name: "StartRun",
  input: startRunInputSchema,
  output: z.object({
    id: idSchema("run"),
    state: z.literal("running"),
    state_seq: seqSchema,
    started_at: atSchema,
    basis: sha256Schema,
    scope: agentAppScopeOutputSchema,
  }),
  compare: startRunCompareSchema,
  actors: ["machine"],
  errors: ["conflict", "forbidden", "unavailable", "unauthorized", "not_found"],
});

export const checkpointRun = defineCommand({
  resource: "runs",
  method: "checkpoint",
  name: "CheckpointRun",
  input: checkpointRunInputSchema,
  output: z.object({
    id: idSchema("run"),
    state: z.literal("running"),
    state_seq: seqSchema,
    elapsed: runElapsedOutputSchema,
  }),
  compare: checkpointRunCompareSchema,
  actors: ["machine"],
  errors: [
    "conflict",
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
  ],
});

export const finishRun = defineCommand({
  resource: "runs",
  method: "finish",
  name: "FinishRun",
  input: finishRunInputSchema,
  output: z.object({
    id: idSchema("run"),
    state: z.literal("finished"),
    state_seq: seqSchema,
    outcome: runOutcomeOutputSchema,
    result: sha256Schema,
    finished_at: atSchema,
  }),
  compare: finishRunCompareSchema,
  actors: ["machine"],
  errors: [
    "conflict",
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
  ],
});

export const stopRun = defineCommand({
  resource: "runs",
  method: "stop",
  name: "StopRun",
  input: stopRunInputSchema,
  output: z.object({
    id: idSchema("run"),
    state: z.literal("finished"),
    state_seq: seqSchema,
    outcome: runOutcomeOutputSchema,
    result: sha256Schema,
    finished_at: atSchema,
    replayed: z.boolean(),
  }),
  compare: stopRunCompareSchema,
  actors: ["user", "machine"],
  errors: [
    "conflict",
    "forbidden",
    "unauthorized",
    "invalid_input",
    "not_found",
  ],
});

export const confirmNextRun = defineCommand({
  resource: "runs",
  method: "confirm-next",
  name: "ConfirmNextRun",
  input: confirmNextRunInputSchema,
  output: z.object({
    id: idSchema("run"),
    predecessor: idSchema("run"),
    start_confirmed_seq: seqSchema,
    state: z.literal("accepted"),
  }),
  compare: confirmNextRunCompareSchema,
  actors: ["user"],
  errors: [
    "conflict",
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
  ],
});

const runSubject = idSchema("run");

export const runAccepted = defineEvent("RunAccepted", {
  subject: runSubject,
  payload: z.object({
    assignment: idSchema("asg"),
    session: idSchema("ses").nullable(),
    source: runSourceOutputSchema,
    accepted_seq: seqSchema,
  }),
});

export const runStarted = defineEvent("RunStarted", {
  subject: runSubject,
  payload: z.object({
    basis: sha256Schema,
    limits: runLimitsOutputSchema,
    started_at: atSchema,
    scope: agentAppScopeOutputSchema,
  }),
});

export const runFinished = defineEvent("RunFinished", {
  subject: runSubject,
  payload: z.object({
    assignment: idSchema("asg"),
    started: z.boolean(),
    started_at: atSchema.nullable(),
    outcome: runOutcomeOutputSchema,
    result: sha256Schema,
    finished_at: atSchema,
  }).refine(
    (value) => (value.started_at === null) !== value.started,
    { message: "started flag and started_at disagree" },
  ),
});

export const RUN_COMMANDS = [
  acceptRun,
  startRun,
  checkpointRun,
  finishRun,
  stopRun,
  confirmNextRun,
  ...RUN_WAIT_COMMANDS,
  ...RUN_READS,
] as const;

export const RUN_EVENTS = [
  runAccepted,
  runStarted,
  runWaited,
  runResumed,
  runRecovered,
  runFinished,
] as const;

export {
  correctWaitingRun,
  INITIAL_RUN_ELAPSED,
  recoverRun,
  resolveRunWait,
  runRecovered,
  runResumed,
  runWaited,
  waitRun,
};
