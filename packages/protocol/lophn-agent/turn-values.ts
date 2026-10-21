import { z } from "zod";
import {
  atSchema,
  durationMsSchema,
  positiveSafeIntegerSchema,
  seqSchema,
  sha256Schema,
} from "../base/values.ts";
import { idSchema } from "../base/ids.ts";

// agent event TurnEnded의 outcome이다. interrupted는 사람이 멈춤, lophn이 꺼졌다 켜짐, session을
// archive하거나 지움이다.
const TURN_OUTCOME_REASONS = {
  completed: ["answer_completed"],
  failed: [
    "model_error",
    "tool_error",
    "context_limit",
    "model_attempt_limit",
    "stall_limit",
    "active_limit",
    "repeated_tool_failure",
    "effect_unknown",
    "clock_uncertain",
    "configuration_unavailable",
    "target_unavailable",
    "no_answer",
  ],
  interrupted: ["user_stopped", "restarted", "session_ended"],
} as const;

export const turnOutcomeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("completed"),
    reason: z.enum(TURN_OUTCOME_REASONS.completed),
  }),
  z.strictObject({
    kind: z.literal("failed"),
    reason: z.enum(TURN_OUTCOME_REASONS.failed),
  }),
  z.strictObject({
    kind: z.literal("interrupted"),
    reason: z.enum(TURN_OUTCOME_REASONS.interrupted),
  }),
]);

export const turnOutcomeOutputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("completed"),
    reason: z.enum(TURN_OUTCOME_REASONS.completed),
  }),
  z.object({
    kind: z.literal("failed"),
    reason: z.enum(TURN_OUTCOME_REASONS.failed),
  }),
  z.object({
    kind: z.literal("interrupted"),
    reason: z.enum(TURN_OUTCOME_REASONS.interrupted),
  }),
]);

export type TurnOutcome = z.infer<typeof turnOutcomeSchema>;

// 입력은 메모리 입력함에 있다가 turn이 시작되면서 행이 생긴다. 권한·질문 대기는 turn이 running인 채
// session snapshot이 가진다.
// turn의 한도다. 시작할 때 정해 기준에 고정한다.
const turnLimitsFields = {
  model_attempts: positiveSafeIntegerSchema,
  stall_ms: positiveSafeIntegerSchema,
  active_ms: positiveSafeIntegerSchema,
};

export const turnLimitsSchema = z.strictObject(turnLimitsFields);
const turnLimitsOutputSchema = z.object(turnLimitsFields);
export type TurnLimits = z.infer<typeof turnLimitsSchema>;

// 앱 하나를 짓는 turn에 model call이 약 85번 든다. 오래 도는 turn은 active_ms와 stall_ms가 멈춘다.
export const DEFAULT_TURN_LIMITS = {
  model_attempts: 150,
  stall_ms: 300_000,
  active_ms: 1_800_000,
} as const;

// 쓴 시간이다. checkpoint가 주기로 남긴다.
const turnElapsedFields = {
  active_ms: durationMsSchema,
  stall_ms: durationMsSchema,
  checkpoint_at: atSchema.nullable(),
};

export const turnElapsedSchema = z.strictObject(turnElapsedFields);
export const turnElapsedOutputSchema = z.object(turnElapsedFields);
export type TurnElapsed = z.infer<typeof turnElapsedSchema>;

const TURN_STATES = ["running", "finished"] as const;
export const turnStateSchema = z.enum(TURN_STATES);

// turn mode. approvals protocol이 import하므로 approvals가 아니라 여기 둔다(approvals가 이미
// lophn-agent를 import해서, 반대로 두면 protocol-cycle이다).
// attended는 사람이 곁에 있어 묻는 길이 열려 있고, unattended는 사람이 없어 묻는 일이 거절이 되고,
// skip은 사람이 그 session의 묻기를 껐다.
//
// mode가 사는 곳:
// - turn: `turns.mode` 열, `StartTurn` 입력 `mode`, `turnRecordSchema.mode`. turn을 시작할 때 한 번
//   정하고 끝날 때까지 바꾸지 않는다. 도는 turn에 사람이 steer한 메시지도 그 turn의 mode를 따른다.
// - session: `sessions.skip`(boolean), session record `skip`, 사람만 부르는 command
//   `ChangeSessionSkip`(resource `sessions`, method `change-skip`, 입력 `{session, skip}`,
//   compare `{state_seq}`, actors `user`). 새 Operator session은 정의의 `skip: true`면 켜진 채 열린다.
//   fork한 session은 skip을 가져가지 않고 정의의 기본값으로 시작한다.
// - 봉투: `unattended: boolean`이 `CallEnvelope`, `RoutedInput`(메모리), `agent_calls` 행에 있다.
//   받은 메시지 기록(`receivedEnvelopeSchema`, `messages`)에는 싣지 않는다. 받은 turn의 mode는 메모리의
//   `RoutedInput`에서 정하고 `turns.mode`에 남는다. `SendCall`·`ReplyCall` 입력에는
//   `unattended?: true`로 실린다. call·reply tool이 그 turn의 mode로 채우고 model 입력에는 없다.
//   그 call의 답과 늦게 오는 실패, 취소 알림도 call의 표시를 싣는다.
//
// 정하는 규칙(`turnModeOf`): turn을 연 입력의 봉투가 unattended면 `unattended`, 아니면 session이 skip이면
// `skip`, 그 밖(사람 메시지, reaction, attended turn이 보낸 call·reply와 그 알림)은 `attended`다.
// unattended call이 연 skip session도 unattended로 남아 사슬이 표시를 잇는다.
export const TURN_MODES = ["attended", "unattended", "skip"] as const;
export const turnModeSchema = z.enum(TURN_MODES);
export type TurnMode = z.infer<typeof turnModeSchema>;

// 고정한 resolved agent는 hash와 칸별 출처만 기준에 두고 전체 값은 blob이다.

export const turnRecordSchema = z.object({
  id: idSchema("trn"),
  session: idSchema("ses"),
  // 이 turn을 시작한 입력의 메시지.
  input_message: idSchema("msg"),
  state: turnStateSchema,
  basis: sha256Schema,
  started_at: atSchema,
  limits: turnLimitsOutputSchema,
  mode: turnModeSchema,
  elapsed: turnElapsedOutputSchema,
  finished_at: atSchema.nullable(),
  outcome: turnOutcomeOutputSchema.nullable(),
  result: sha256Schema.nullable(),
  state_seq: seqSchema,
}).refine((value) => {
  const finished = value.state === "finished";
  return (value.finished_at !== null) === finished &&
    (value.outcome !== null) === finished &&
    (value.result !== null) === finished;
}, { message: "turn state fields are not coupled" });

export type TurnRecord = z.infer<typeof turnRecordSchema>;
