import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import {
  atSchema,
  durationMsSchema,
  positiveSafeIntegerSchema,
  seqSchema,
  sha256Schema,
} from "../base/values.ts";

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
    // 지운 일한 시간 한도로 끝난 지난 turn의 이유다. events는 고치지 않는 기록이라 남긴다. 새 turn은 내지 않는다.
    "active_limit",
    "repeated_tool_failure",
    "effect_unknown",
    "clock_uncertain",
    "configuration_unavailable",
    // 이 session·agent·project·전역 어디에도 model을 고르지 않았다. 사람이 model을 고르면 풀린다.
    "model_required",
    "target_unavailable",
    "no_answer",
    // core 안에서 던진 예외 같은 lophn 자체의 오류다. 설정을 고쳐도 풀리지 않는다.
    "internal",
  ],
  interrupted: ["user_stopped", "restarted", "session_ended"],
} as const;

// 화면이 실패 이유마다 문구를 고른다.
export const TURN_FAILED_REASONS = TURN_OUTCOME_REASONS.failed;

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

// 입력은 메모리 queue에 있다가 turn이 시작되면서 행이 생긴다. 권한·질문 대기는 turn이 running인 채
// session snapshot이 가진다.
// turn의 한도다. 시작할 때 정해 기준에 고정한다. model_attempts가 null이면 model 호출 수 상한이 없다.
const turnLimitsFields = {
  model_attempts: positiveSafeIntegerSchema.nullable(),
  stall_ms: positiveSafeIntegerSchema,
};

export const turnLimitsSchema = z.strictObject(turnLimitsFields);
const turnLimitsOutputSchema = z.object(turnLimitsFields);
export type TurnLimits = z.infer<typeof turnLimitsSchema>;

// 진행 없이 도는 turn은 stall_ms가 멈춘다. 일한 시간·호출 수 상한은 기본으로 두지 않는다. 30분 상한이 진행
// 중인 긴 일을 끊었다(omp·Hermes·opencode도 기본 상한이 없다). 호출 수 상한은 eval처럼 돈을 막을 때 고른다.
export const DEFAULT_TURN_LIMITS = {
  model_attempts: null,
  stall_ms: 300_000,
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

// 권한 단계(session)와 실행 맥락(turn). approvals protocol이 import하므로 approvals가 아니라 여기 둔다
// (approvals가 이미 lophn-agent를 import해서, 반대로 두면 protocol-cycle이다).
//
// PermissionMode:
// - read_only: 읽기·검색만 허락
// - ask: 읽기만 묻지 않고 쓰기·shell·바깥은 묻는다
// - workspace: 등록 폴더 안 파일 수정과 내장 읽기 명령은 묻지 않고, 그 밖의 shell·폴더 밖·바깥은 묻는다(초기 기본값)
// - full: floor·deny·사람 전용 등급 밖은 묻지 않는다
export const PERMISSION_MODES = [
  "read_only",
  "ask",
  "workspace",
  "full",
] as const;
export const permissionModeSchema = z.enum(PERMISSION_MODES);
export type PermissionMode = z.infer<typeof permissionModeSchema>;

export const DEFAULT_PERMISSION_MODE: PermissionMode = "workspace";

export const PERMISSION_MODE_RANK: Record<PermissionMode, number> = {
  read_only: 0,
  ask: 1,
  workspace: 2,
  full: 3,
};

export function comparePermissionMode(
  a: PermissionMode,
  b: PermissionMode,
): number {
  return PERMISSION_MODE_RANK[a] - PERMISSION_MODE_RANK[b];
}

export function minPermissionMode(
  a: PermissionMode,
  b: PermissionMode,
): PermissionMode {
  return PERMISSION_MODE_RANK[a] <= PERMISSION_MODE_RANK[b] ? a : b;
}

export function isModeDowngrade(
  from: PermissionMode,
  to: PermissionMode,
): boolean {
  return PERMISSION_MODE_RANK[to] < PERMISSION_MODE_RANK[from];
}

// 실행 맥락. 단계와 분리해 사람이 곁에 있는지(attended), 무인인지(unattended), 팀 자식인지(team_child)를 나타낸다.
export const EXECUTION_CONTEXTS = [
  "attended",
  "unattended",
  "team_child",
] as const;
export const executionContextSchema = z.enum(EXECUTION_CONTEXTS);
export type ExecutionContext = z.infer<typeof executionContextSchema>;

// turn mode. attended는 사람이 곁에 있어 묻는 길이 열려 있고, unattended는 사람이 없어 ask가 거절이 된다.
// session의 권한 단계는 `sessions.permission_mode`와 `ChangeSessionMode`로 따로 관리한다.
export const TURN_MODES = ["attended", "unattended"] as const;
export const turnModeSchema = z.enum(TURN_MODES);
export type TurnMode = z.infer<typeof turnModeSchema>;

// 고정한 resolved agent는 hash와 칸별 출처만 기준에 두고 전체 값은 blob이다.

export const turnRecordSchema = z
  .object({
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
  })
  .refine(
    (value) => {
      const finished = value.state === "finished";
      return (
        (value.finished_at !== null) === finished &&
        (value.outcome !== null) === finished &&
        (value.result !== null) === finished
      );
    },
    { message: "turn state fields are not coupled" },
  );

export type TurnRecord = z.infer<typeof turnRecordSchema>;
