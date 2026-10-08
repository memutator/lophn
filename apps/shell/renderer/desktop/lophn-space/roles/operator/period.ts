// Repeating check의 순수 규칙. 고르는 간격과 처음 시각을 값으로 바꾸고 사람이 읽는 말로 되돌린다.
import type { MessageKey } from "@lophn/wording";

const HOUR = 60 * 60 * 1000;

export const EVERY = [
  { key: "hour", ms: HOUR, label: "roles.label.every-hour" },
  { key: "six-hours", ms: 6 * HOUR, label: "roles.label.every-six-hours" },
  { key: "day", ms: 24 * HOUR, label: "roles.label.every-day" },
  { key: "week", ms: 7 * 24 * HOUR, label: "roles.label.every-week" },
] as const satisfies readonly {
  key: string;
  ms: number;
  label: MessageKey;
}[];

export type EveryKey = (typeof EVERY)[number]["key"];

export const DEFAULT_EVERY: EveryKey = "day";

export function everyMs(key: EveryKey): number {
  return EVERY.find((item) => item.key === key)!.ms;
}

/** 간격이 고르는 목록에 있으면 그 말, 아니면 null이다(예전에 다른 방법으로 정한 간격). */
export function everyLabel(ms: number): MessageKey | null {
  return EVERY.find((item) => item.ms === ms)?.label ?? null;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** `<input type="datetime-local">`의 값. 분 단위, 지역 시각이다. */
export function localInput(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${
    pad(date.getDate())
  }T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 입력 값(지역 시각)을 UTC ISO로. 읽을 수 없으면 null이다. */
export function toIso(input: string): string | null {
  if (input.length === 0) return null;
  const at = new Date(input).getTime();
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}

/** 지금 이후 첫 정각에서 한 시간 뒤. 처음 시각의 기본값이다. */
export function defaultFirst(now: number): number {
  return Math.ceil((now + HOUR) / HOUR) * HOUR;
}

/** 새 주기는 적용하는 시각보다 뒤에서 시작해야 한다. 여유로 1분을 둔다. */
export function startsLater(iso: string, now: number): boolean {
  return Date.parse(iso) > now + 60_000;
}

export function when(iso: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}
