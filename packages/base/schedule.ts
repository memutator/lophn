import { formatAt } from "./clock.ts";
import { err, ok, type Result } from "./result.ts";

// 주기 시각도 기록 시각과 같은 형식만 쓴다(domain-model platform/ledger "시각·기간·seq").
const AT = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;

export type DueTimesInput = {
  first_at: string;
  every_ms: number;
  last_due_at: string | null;
  now: string;
};

export type DueTimes = {
  latest_due_at: string | null;
  missed_count: number;
  next_due_at: string;
};

function invalid(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

function parseAt(at: string): Result<number> {
  if (!AT.test(at)) return invalid("invalid instant");
  const ms = Date.parse(at);
  // 2026-13-45T99:99:99.999Z처럼 형식은 맞지만 없는 날짜는 Date.parse가 NaN으로 돌려준다.
  if (Number.isNaN(ms)) return invalid("invalid instant");
  return ok(ms);
}

// 회차가 |Date| 범위를 넘으면 formatAt이 예외를 던지므로 Result로 받아 낸다.
function formatDue(ms: number): Result<string> {
  try {
    return ok(formatAt(ms));
  } catch {
    return invalid("due cycle is outside the instant range");
  }
}

// now 이하인 가장 최근 회차 번호(now가 first_at 전이면 음수).
function latestIndex(firstMs: number, everyMs: number, nowMs: number): number {
  const k = Math.floor((nowMs - firstMs) / everyMs);
  // 나눗셈이 반올림되어 경계 회차를 놓치거나 하나 더 셀 수 있어 곱으로 한 번 맞춘다.
  if (firstMs + k * everyMs > nowMs) return k - 1;
  if (firstMs + (k + 1) * everyMs <= nowMs) return k + 1;
  return k;
}

// 지금 처리할 회차와 그 앞의 놓친 회차 수를 센다(lophn-agent/scheduling#R6).
export function dueTimes(input: DueTimesInput): Result<DueTimes> {
  const { first_at, every_ms, last_due_at, now } = input;
  if (!Number.isSafeInteger(every_ms) || every_ms <= 0) {
    return invalid("invalid every_ms");
  }
  const first = parseAt(first_at);
  if (!first.ok) return first;
  const at = parseAt(now);
  if (!at.ok) return at;

  // last_due_at이 null이면 처리한 회차가 없으므로 first_at 회차부터 센다.
  let lastK = -1;
  if (last_due_at !== null) {
    const last = parseAt(last_due_at);
    if (!last.ok) return last;
    const gap = last.value - first.value;
    if (gap < 0 || gap % every_ms !== 0) {
      return invalid("last_due_at is not a due cycle");
    }
    lastK = gap / every_ms;
  }

  const k = latestIndex(first.value, every_ms, at.value);
  // last_due_at이 이미 가장 최근 회차면(또는 아직 first_at 전이면) 처리할 회차가 없다.
  const latestK = k > lastK ? k : null;
  let latestAt: string | null = null;
  if (latestK !== null) {
    const latest = formatDue(first.value + latestK * every_ms);
    if (!latest.ok) return latest;
    latestAt = latest.value;
  }

  const next = formatDue(first.value + (k < 0 ? 0 : k + 1) * every_ms);
  if (!next.ok) return next;

  return ok({
    latest_due_at: latestAt,
    missed_count: latestK === null ? 0 : latestK - lastK - 1,
    next_due_at: next.value,
  });
}
