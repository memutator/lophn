import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { defineCommand } from "../base/route.ts";
import {
  atSchema,
  blobSizeSchema,
  seqSchema,
  sha256Schema,
} from "../base/values.ts";
import {
  turnElapsedOutputSchema,
  turnElapsedSchema,
  turnLimitsSchema,
  turnModeSchema,
  turnOutcomeOutputSchema,
  turnOutcomeSchema,
} from "./turn-values.ts";

const turnRef = { turn: idSchema("trn") };
const stateSeq = { state_seq: seqSchema };

// queue의 입력이 turn이 되는 순간이다. 행이 이때 생기므로 compare가 없다.
const startTurnInputSchema = z
  .strictObject({
    id: idSchema("trn"),
    session: idSchema("ses"),
    input_message: idSchema("msg"),
    basis: sha256Schema,
    // 준비한 basis blob의 크기. 있으면 command가 영구 참조를 등록한다.
    basis_size: blobSizeSchema.optional(),
    // 고정한 resolved agent 전체 값의 blob(hash는 blob 바이트의 hash이고 기준의 resolved.hash와 다르다).
    // 두 칸은 함께 오고, 있으면 command가 영구 참조를 등록한다.
    resolved: sha256Schema.optional(),
    resolved_size: blobSizeSchema.optional(),
    limits: turnLimitsSchema,
    mode: turnModeSchema,
  })
  .refine(
    (value) =>
      (value.resolved === undefined) === (value.resolved_size === undefined),
    { message: "resolved and resolved_size come together" },
  );

const checkpointTurnInputSchema = z.strictObject({
  ...turnRef,
  elapsed: turnElapsedSchema,
  // turn 안 이력(model에 보낸 이 turn의 진행)을 준비한 blob. 있으면 이 turn의 이력 참조를 이 값으로 바꾼다.
  // 다음 turn이 이 이력을 이전 대화에 그대로 이어 붙여 앞 turn의 prompt cache를 읽는다.
  history: sha256Schema.optional(),
  history_size: blobSizeSchema.optional(),
});

const finishTurnInputSchema = z.strictObject({
  ...turnRef,
  outcome: turnOutcomeSchema,
  result: sha256Schema,
  // 준비한 result blob의 크기. 있으면 command가 영구 참조를 등록한다.
  result_size: blobSizeSchema.optional(),
});

// 사람이 멈추는 것만 있다. 켤 때와 session 끝남은 command 없이 core가 interrupted로 닫는다. child가 사라지는
// 것은 `interruptTurns`가 닫는다.
const stopTurnInputSchema = z.strictObject({
  ...turnRef,
  request_key: z.string().min(1),
  reason: z.literal("user_stopped"),
});

const stateSeqCompareSchema = z.strictObject(stateSeq);

export const startTurn = defineCommand({
  resource: "turns",
  method: "start",
  name: "StartTurn",
  input: startTurnInputSchema,
  output: z.object({
    id: idSchema("trn"),
    state: z.literal("running"),
    state_seq: seqSchema,
    started_at: atSchema,
    basis: sha256Schema,
  }),
  actors: ["machine"],
  errors: ["conflict", "forbidden", "unavailable", "unauthorized", "not_found"],
});

export const checkpointTurn = defineCommand({
  resource: "turns",
  method: "checkpoint",
  name: "CheckpointTurn",
  input: checkpointTurnInputSchema,
  output: z.object({
    id: idSchema("trn"),
    // 사람이 멈춘 turn은 이력만 싣는 checkpoint를 받아 finished로 돌려준다.
    state: z.enum(["running", "finished"]),
    state_seq: seqSchema,
    elapsed: turnElapsedOutputSchema,
  }),
  compare: stateSeqCompareSchema,
  actors: ["machine"],
  errors: [
    "conflict",
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
  ],
});

export const finishTurn = defineCommand({
  resource: "turns",
  method: "finish",
  name: "FinishTurn",
  input: finishTurnInputSchema,
  output: z.object({
    id: idSchema("trn"),
    state: z.literal("finished"),
    state_seq: seqSchema,
    outcome: turnOutcomeOutputSchema,
    result: sha256Schema,
    finished_at: atSchema,
  }),
  compare: stateSeqCompareSchema,
  actors: ["machine"],
  errors: [
    "conflict",
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
  ],
});

export const stopTurn = defineCommand({
  resource: "turns",
  method: "stop",
  name: "StopTurn",
  input: stopTurnInputSchema,
  output: z.object({
    id: idSchema("trn"),
    state: z.literal("finished"),
    state_seq: seqSchema,
    outcome: turnOutcomeOutputSchema,
    result: sha256Schema,
    finished_at: atSchema,
    replayed: z.boolean(),
  }),
  compare: stateSeqCompareSchema,
  actors: ["user", "machine"],
  errors: [
    "conflict",
    "forbidden",
    "unauthorized",
    "invalid_input",
    "not_found",
  ],
});

// agent runtime child가 사라졌다(crash·교체). 그 child가 돌리던 turn 전부를 interrupted(restarted)로 닫는다.
// core 안 machine만 쓴다.
export const interruptTurns = defineCommand({
  resource: "turns",
  method: "interrupt",
  name: "InterruptTurns",
  input: z.strictObject({}),
  output: z.object({ interrupted: z.number().int() }),
  actors: ["machine"],
  errors: ["forbidden", "internal"],
});

export const TURN_COMMANDS = [
  startTurn,
  checkpointTurn,
  finishTurn,
  stopTurn,
  interruptTurns,
] as const;
