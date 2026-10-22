import { formatAt } from "../../base/mod.ts";

// 순수 함수다. 시각과 zone은 인자로만 받는다.
export type JobSpec = { every: string; at: string | null; zone: string };

const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

function parseEvery(every: string): { n: number; unit: "m" | "h" | "d" } {
  return {
    n: Number(every.slice(0, -1)),
    unit: every.slice(-1) as "m" | "h" | "d",
  };
}

const msOf = (at: string) => Temporal.Instant.from(at).epochMilliseconds;

// at이 없으면 고정 길이다. Nd도 24시간 × N이라 서머타임에 local 시각이 밀린다. 시각을 지키려면 at을 준다.
function fixedMs(spec: JobSpec): number | null {
  if (spec.at !== null) return null;
  const { n, unit } = parseEvery(spec.every);
  return n * UNIT_MS[unit];
}

function localDate(ms: number, zone: string): Temporal.PlainDate {
  return Temporal.Instant.fromEpochMilliseconds(ms)
    .toZonedDateTimeISO(zone).toPlainDate();
}

// local 날짜와 시각 → 시각. 서머타임 규칙이 한 곳에 있다.
// - 없는 시각(건너뜀)은 시계가 건너뛴 순간이다. compatible은 같은 폭만큼 밀어 02:30을 03:30으로 풀므로 결과가 다르면 직전 전환 시각을 쓴다.
// - 두 번 오는 시각은 compatible이 첫 번째를 고르므로 그날 차례는 한 번이다.
function resolveLocal(
  date: Temporal.PlainDate,
  at: string,
  zone: string,
): number {
  const [hour, minute] = at.split(":").map(Number) as [number, number];
  const resolved = Temporal.ZonedDateTime.from({
    year: date.year,
    month: date.month,
    day: date.day,
    hour,
    minute,
    timeZone: zone,
  }, { disambiguation: "compatible" });
  if (resolved.hour === hour && resolved.minute === minute) {
    return resolved.epochMilliseconds;
  }
  return resolved.getTimeZoneTransition("previous")!.epochMilliseconds;
}

// at이 있는 job에서 직전 차례 뒤의 다음 차례. 날짜는 달력으로 더한다.
function nextTurn(spec: JobSpec, prev: number): number {
  const date = localDate(prev, spec.zone).add({
    days: parseEvery(spec.every).n,
  });
  return resolveLocal(date, spec.at!, spec.zone);
}

// after 뒤의 첫 차례. 만들 때, 다시 켤 때, 주기나 시각을 바꿀 때 쓴다(그때부터 새로 센다).
export function firstDue(spec: JobSpec, after: string): string {
  const afterMs = msOf(after);
  const fixed = fixedMs(spec);
  if (fixed !== null) return formatAt(afterMs + fixed);
  const date = localDate(afterMs, spec.zone);
  const today = resolveLocal(date, spec.at!, spec.zone);
  return formatAt(
    today > afterMs
      ? today
      : resolveLocal(date.add({ days: 1 }), spec.at!, spec.zone),
  );
}

// due(이미 온 차례, due <= now)부터 now까지 온 차례 수(due 포함), 그 가운데 마지막, now 뒤의 첫 차례.
export function dueTurns(
  spec: JobSpec,
  due: string,
  now: string,
): { count: number; last: string; next: string } {
  const dueMs = msOf(due);
  const nowMs = msOf(now);
  const fixed = fixedMs(spec);
  if (fixed !== null) {
    const count = Math.floor((nowMs - dueMs) / fixed) + 1;
    const last = dueMs + (count - 1) * fixed;
    return { count, last: formatAt(last), next: formatAt(last + fixed) };
  }
  let count = 1;
  let last = dueMs;
  let next = nextTurn(spec, last);
  while (next <= nowMs) {
    count += 1;
    last = next;
    next = nextTurn(spec, last);
  }
  return { count, last: formatAt(last), next: formatAt(next) };
}
