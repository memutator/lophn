import { createHash } from "node:crypto";
import {
  canonicalize,
  err,
  formatAt,
  ok,
  type Result,
} from "../../../base/mod.ts";
import {
  DEFAULT_TURN_LIMITS,
  type TurnElapsed,
  turnLimitsSchema,
} from "../../../protocol/lophn-agent/mod.ts";
import type { EffectiveSetting } from "../../../protocol/config/mod.ts";
import type { z } from "zod";

export type TurnLimits = z.infer<typeof turnLimitsSchema>;

// turn 한도. 한도 값은 공통 설정이고 시작 때 turn에 고정된다(turns_started_immutable). 이 파일은
// 시간·횟수를 세는 순수 계산이다. 시계는 주입한 단조 ms다. model·tool·ledger를 직접 부르지 않는다.

// 공통 설정 key. 정의(SettingDefinition) 등록은 packages/core/lophn-agent/register.ts가 한다.
export const TURN_LIMIT_SETTING_KEYS = {
  model_attempts: "lophn-agent.run.model_attempts",
  stall_ms: "lophn-agent.run.stall_ms",
  active_ms: "lophn-agent.run.active_ms",
} as const;

export type TurnLimitKey = keyof typeof TURN_LIMIT_SETTING_KEYS;

// 다음 turn을 시작할 한도. 적용값이 비어 있으면 내장 기본값이다(필수 선택이 아니므로 turn 시작을 막지
// 않는다). 값이 있는데 양의 정수가 아니면 기본값으로 대신하지 않고 거절한다(0·무제한 금지).
export function resolveTurnLimits(
  settings: readonly EffectiveSetting[],
): Result<TurnLimits> {
  const picked: Record<string, unknown> = {};
  for (const key of Object.keys(TURN_LIMIT_SETTING_KEYS) as TurnLimitKey[]) {
    const setting = settings.find((item) =>
      item.key === TURN_LIMIT_SETTING_KEYS[key]
    );
    picked[key] = setting === undefined || !setting.resolved
      ? DEFAULT_TURN_LIMITS[key]
      : setting.value;
  }
  const parsed = turnLimitsSchema.safeParse(picked);
  if (!parsed.success) {
    return err({
      code: "invalid_input",
      message: "turn limits are positive integers only",
    });
  }
  return ok(parsed.data);
}

// 저장된 공통 선택(setting_choices)에서 다음 turn의 한도를 계산한다. 선택이 없는 항목은
// 내장 기본값이다(정의의 기본값과 같은 DEFAULT_TURN_LIMITS). 저장값이 양의 정수가
// 아니면 기본값으로 대신하지 않고 거절한다.
export function effectiveTurnLimits(
  choices: readonly { key: string; value: unknown }[],
): Result<TurnLimits> {
  const picked: Record<string, unknown> = {};
  for (const name of Object.keys(TURN_LIMIT_SETTING_KEYS) as TurnLimitKey[]) {
    const choice = choices.find((item) =>
      item.key === TURN_LIMIT_SETTING_KEYS[name]
    );
    picked[name] = choice === undefined
      ? DEFAULT_TURN_LIMITS[name]
      : choice.value;
  }
  const parsed = turnLimitsSchema.safeParse(picked);
  if (!parsed.success) {
    return err({
      code: "invalid_input",
      message: "turn limits are positive integers only",
    });
  }
  return ok(parsed.data);
}

export type LimitReason =
  | "model_attempt_limit"
  | "stall_limit"
  | "active_limit";

export type ModelPurpose = "judgment" | "organizing" | "finalizing";

// 완전한 응답만 진행이다. partial·failed·cancelled는 시도 횟수에는 들어가고
// 무진행 시간은 되돌리지 않는다.
export type AttemptEnd = "complete" | "partial" | "failed" | "cancelled";

export type TurnLimiterInit = {
  limits: TurnLimits;
  // 마지막 CheckpointTurn 값.
  elapsed: TurnElapsed;
  // 지금까지 센 model 시도. ledger의 ModelCall 수에서 읽는다. 실패·retry 포함.
  attempts: number;
  // 단조 ms. 사람이 기다리는 동안에도 흐르지만 그 구간은 세지 않는다.
  nowMs: () => number;
};

export type AttemptStart =
  | { allowed: true; attempt: number }
  | { allowed: false; limit: LimitReason };

export class TurnLimiter {
  #limits: TurnLimits;
  #nowMs: () => number;
  #active: number;
  #stall: number;
  #attempts: number;
  // 마지막으로 시간을 센 시각. null이면 사람 기다림이라 시간이 늘지 않는다.
  #mark: number | null;
  #tripped: LimitReason | null = null;

  constructor(init: TurnLimiterInit) {
    this.#limits = { ...init.limits };
    this.#nowMs = init.nowMs;
    this.#active = init.elapsed.active_ms;
    this.#stall = init.elapsed.stall_ms;
    this.#attempts = init.attempts;
    this.#mark = init.nowMs();
  }

  get attempts(): number {
    return this.#attempts;
  }

  get waiting(): boolean {
    return this.#mark === null;
  }

  #measure(): void {
    if (this.#mark === null) return;
    const now = this.#nowMs();
    // 시계가 뒤로 가도 시간은 줄지 않는다.
    const delta = Math.max(0, now - this.#mark);
    this.#active += delta;
    this.#stall += delta;
    this.#mark = Math.max(now, this.#mark);
  }

  // 한도에 닿았는지. 한 번 닿으면 이후 model 호출은 모두 막힌다.
  check(): LimitReason | null {
    this.#measure();
    if (this.#tripped !== null) return this.#tripped;
    if (this.#attempts >= this.#limits.model_attempts) {
      // 횟수는 다음 시도를 막는 한도다. 시도 수가 상한과 같아지면 이미 도달이다.
      this.#tripped = "model_attempt_limit";
    } else if (this.#stall >= this.#limits.stall_ms) {
      this.#tripped = "stall_limit";
    } else if (this.#active >= this.#limits.active_ms) {
      this.#tripped = "active_limit";
    }
    return this.#tripped;
  }

  // 시도 하나를 시작한다. 허용되면 즉시 횟수에 센다. 실패해도 줄지 않는다.
  // purpose는 judgment·organizing·마무리 모두 같은 한도를 쓴다.
  startAttempt(_purpose: ModelPurpose): AttemptStart {
    const limit = this.check();
    if (limit !== null) return { allowed: false, limit };
    this.#attempts += 1;
    return { allowed: true, attempt: this.#attempts };
  }

  endAttempt(end: AttemptEnd): void {
    this.#measure();
    if (end === "complete") this.#stall = 0;
  }

  // 부분 token은 시간만 센다. 무진행 시간을 되돌리지 않는다.
  partialToken(): void {
    this.#measure();
  }

  // 확정한 tool 결과는 진행이다.
  toolResult(): void {
    this.#measure();
    this.#stall = 0;
  }

  // 사람의 답을 기다리는 동안 active·stall을 모두 멈춘다.
  enterWait(): void {
    this.#measure();
    this.#mark = null;
  }

  leaveWait(): void {
    if (this.#mark === null) this.#mark = this.#nowMs();
  }

  // 가장 가까운 시간 한도까지 남은 ms. 진행 중인 호출을 중단할 timer에 쓴다.
  // 사람 기다림 중이거나 이미 닿았으면 null·0이다.
  nextDeadlineMs(): number | null {
    if (this.#mark === null) return null;
    this.#measure();
    return Math.max(
      0,
      Math.min(
        this.#limits.stall_ms - this.#stall,
        this.#limits.active_ms - this.#active,
      ),
    );
  }

  // CheckpointTurn 입력. 단조 누적값이다.
  snapshot(): TurnElapsed {
    this.#measure();
    return {
      active_ms: Math.floor(this.#active),
      stall_ms: Math.floor(this.#stall),
      checkpoint_at: formatAt(this.#nowMs()),
    };
  }
}

export type GuardedCall<T> =
  | { called: true; value: T }
  | { called: false; limit: LimitReason };

// model 호출의 유일한 문. 한도에 닿은 뒤에는 purpose와 관계없이 호출하지 않는다.
export async function callWithinLimits<T>(
  limiter: TurnLimiter,
  purpose: ModelPurpose,
  call: () => Promise<T>,
): Promise<GuardedCall<T>> {
  const started = limiter.startAttempt(purpose);
  if (!started.allowed) return { called: false, limit: started.limit };
  return { called: true, value: await call() };
}

// 한도로 끝낼 때 machine이 확정한 사실만으로 만든 결과. model 본문이 없다.
export type ConfirmedFacts = {
  // 확정한 변경·미실행·불명확 효과·미반영 입력의 참조. 호출자가 ledger에서 읽은 것만 넣는다.
  changes: readonly string[];
  unexecuted: readonly string[];
  unknown_effects: readonly string[];
  unapplied_inputs: readonly string[];
};

export type LimitResult = {
  outcome: { kind: "failed"; reason: LimitReason };
  result: string;
  facts: Record<string, unknown>;
};

export function limitResult(input: {
  turn: string;
  reason: LimitReason;
  elapsed: TurnElapsed;
  attempts: number;
  limits: TurnLimits;
  confirmed: ConfirmedFacts;
}): LimitResult {
  const facts = {
    turn: input.turn,
    outcome: { kind: "failed", reason: input.reason },
    attempts: input.attempts,
    limits: input.limits,
    elapsed: {
      active_ms: input.elapsed.active_ms,
      stall_ms: input.elapsed.stall_ms,
    },
    confirmed: {
      changes: [...input.confirmed.changes],
      unexecuted: [...input.confirmed.unexecuted],
      unknown_effects: [...input.confirmed.unknown_effects],
      unapplied_inputs: [...input.confirmed.unapplied_inputs],
    },
  };
  return {
    outcome: { kind: "failed", reason: input.reason },
    result: createHash("sha256").update(canonicalize(facts), "utf8").digest(
      "hex",
    ),
    facts,
  };
}
