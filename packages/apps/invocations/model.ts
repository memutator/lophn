import { err, ok, type Result } from "../../base/mod.ts";
import {
  REDACTION_MAX_DEPTH,
  REDACTION_REPLACEMENT,
} from "../../contracts/platform/mod.ts";
import {
  type Invocation,
  INVOCATION_SUMMARY_MAX_BYTES,
  type InvocationRecordDeniedInput,
  type InvocationRecordFinishedInput,
  type InvocationRecordStartedInput,
} from "../../contracts/apps/mod.ts";

function conflict(message: string): Result<never> {
  return err({ code: "conflict", message });
}

// terminal(succeeded·failed·denied·unknown) 상태는 결과를 바꾸지 않는다.
function terminal(status: Invocation["status"]): boolean {
  return status !== "accepted" && status !== "running";
}

// 같은 시작 사실인지. 모든 필드가 같을 때만 재전송이다. confirm 접수(accepted)는 실제 시작이
// 아직 없으므로 started_at 말고 접수가 고정한 대상·주체·호출자가 같은지만 본다(R9).
export function startedFactsMatch(
  current: Invocation,
  input: InvocationRecordStartedInput,
): boolean {
  return current.app === input.app &&
    current.release === input.release &&
    current.mode === input.mode &&
    current.actor === input.actor &&
    JSON.stringify(current.caller) === JSON.stringify(input.caller) &&
    JSON.stringify(current.operation) === JSON.stringify(input.operation) &&
    JSON.stringify(current.trigger) === JSON.stringify(input.trigger) &&
    (current.status === "accepted" || current.started_at === input.started_at);
}

// 같은 종료 사실인지. 저장된 summary 전체와 비교한다.
export function finishedFactsMatch(
  current: Invocation,
  input: InvocationRecordFinishedInput,
): boolean {
  return current.status === input.status &&
    current.started_at === input.started_at &&
    current.finished_at === input.finished_at &&
    JSON.stringify(current.summary) === JSON.stringify(input.summary) &&
    (current.detail_hash ?? null) === (input.detail_hash ?? null);
}

// 같은 거절 사실인지. 거절은 app·release·actor·caller·operation·trigger와 함께 남는다.
export function deniedFactsMatch(
  current: Invocation,
  input: InvocationRecordDeniedInput,
): boolean {
  return current.app === input.app &&
    current.release === input.release &&
    current.actor === input.actor &&
    JSON.stringify(current.caller) === JSON.stringify(input.caller) &&
    JSON.stringify(current.operation) === JSON.stringify(input.operation) &&
    JSON.stringify(current.trigger) === JSON.stringify(input.trigger) &&
    current.finished_at === input.finished_at &&
    JSON.stringify(current.summary) === JSON.stringify(input.summary);
}

// summary의 민감 key를 구조로 지운다. 원문 일치와 무관하다(platform/redaction#R3).
const SENSITIVE_KEYS =
  /^(?:secret|token|password|credential|authorization|cookie)$/i;

export function redactSummary(
  summary: InvocationRecordFinishedInput["summary"],
): InvocationRecordFinishedInput["summary"] {
  const walk = (value: unknown, depth: number): unknown => {
    if (depth > REDACTION_MAX_DEPTH) return value;
    if (Array.isArray(value)) {
      return value.map((item) => walk(item, depth + 1));
    }
    if (value !== null && typeof value === "object") {
      const record = value as Record<string, unknown>;
      const next: Record<string, unknown> = {};
      for (const key of Object.keys(record)) {
        next[key] = SENSITIVE_KEYS.test(key)
          ? REDACTION_REPLACEMENT
          : walk(record[key], depth + 1);
      }
      return next;
    }
    return value;
  };
  return walk(summary, 0) as InvocationRecordFinishedInput["summary"];
}

// 늦은 시작은 terminal을 running으로 되돌리지 않는다(R6). terminal 뒤 같은 사실은
// 그대로다. absent(null) row는 record_started가 만들고, record_finished·
// record_denied는 만들지 않는다(R10 가짜 Invocation 금지).
export function applyStarted(
  current: Invocation | null,
  input: InvocationRecordStartedInput,
): Result<Invocation | null> {
  if (current === null) {
    return ok({
      id: input.invocation,
      app: input.app,
      release: input.release,
      operation: input.operation,
      trigger: input.trigger,
      mode: input.mode,
      actor: input.actor,
      caller: input.caller,
      approval: null,
      input_hash: null,
      status: "running",
      started_at: input.started_at,
      finished_at: null,
      summary: {},
      detail_hash: null,
    });
  }
  if (!startedFactsMatch(current, input)) {
    return conflict("invocation facts differ");
  }
  // 접수만 있던 confirm 호출은 실제 시작을 관측한 뒤에야 running이 된다. 시작 시각은
  // 접수 시각으로 채우지 않고 관측한 값 그대로다(R9). 그 밖의 재전송은 무변경이다.
  if (current.status === "accepted") {
    return ok({ ...current, status: "running", started_at: input.started_at });
  }
  return ok(null);
}

// 확정한 종료와 충돌하는 늦은 사실은 거절한다(R6). unknown이 실제 성공과 경쟁하면
// 먼저 확정된 terminal을 유지한다(같은 사실이 아닌 이상 conflict).
export function applyFinished(
  current: Invocation | null,
  input: InvocationRecordFinishedInput,
): Result<Invocation | null> {
  if (current === null) {
    return conflict("absent invocation cannot be finished");
  }
  if (terminal(current.status)) {
    if (finishedFactsMatch(current, input)) return ok(null);
    return conflict("terminal invocation facts differ");
  }
  return ok({
    ...current,
    status: input.status,
    started_at: input.started_at ?? current.started_at,
    finished_at: input.finished_at,
    summary: redactSummary(input.summary),
    detail_hash: input.detail_hash ?? null,
  });
}

// handler를 부르기 전 거절(R10). running 뒤의 denied는 전이가 아니다.
export function applyDenied(
  current: Invocation | null,
  input: InvocationRecordDeniedInput,
): Result<Invocation | null> {
  // 접수 없이 handler 전에 거절된 알려진 호출(인증된 연결·선언된 command)은 거절 행으로 남는다.
  // 실제 시작이 없으므로 started_at은 없고 approval·입력 지문도 없다(R2, R9).
  if (current === null) {
    return ok({
      id: input.invocation,
      app: input.app,
      release: input.release,
      operation: input.operation,
      trigger: input.trigger,
      mode: "live",
      actor: input.actor,
      caller: input.caller,
      approval: null,
      input_hash: null,
      status: "denied",
      started_at: null,
      finished_at: input.finished_at,
      summary: redactSummary(input.summary),
      detail_hash: null,
    });
  }
  if (terminal(current.status)) {
    if (deniedFactsMatch(current, input)) return ok(null);
    return conflict("terminal invocation facts differ");
  }
  if (current.status === "running") {
    return conflict("running invocation is not denied");
  }
  // accepted(status running 아님)만 denied로 간다. started_at은 그대로 둔다(없음).
  return ok({
    ...current,
    status: "denied",
    finished_at: input.finished_at,
    summary: redactSummary(input.summary),
  });
}

// 요약 상한은 contract schema가 판정한다. redaction 후 같은 한도를 다시 본다.
export function summaryWithinLimit(
  summary: InvocationRecordFinishedInput["summary"],
): boolean {
  return new TextEncoder().encode(JSON.stringify(summary)).length <=
    INVOCATION_SUMMARY_MAX_BYTES;
}
