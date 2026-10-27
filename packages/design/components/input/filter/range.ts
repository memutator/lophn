// 기간 값과 그 해석. 날짜는 앱이 있는 곳의 달력 날짜("YYYY-MM-DD")이고 양 끝을 포함한다.
export type RangePreset =
  | "today"
  | "last-7-days"
  | "last-30-days"
  | "last-90-days"
  | "this-month";

// 화면 상태와 read command 입력에 싣는 기간 값.
export type DateRange =
  | { preset: RangePreset }
  | { preset: "custom"; from: string; to: string };

// 고르는 목록에 보이는 순서.
export const RANGE_PRESETS: readonly RangePreset[] = [
  "today",
  "last-7-days",
  "last-30-days",
  "last-90-days",
  "this-month",
];

const DAYS: Partial<Record<RangePreset, number>> = {
  today: 1,
  "last-7-days": 7,
  "last-30-days": 30,
  "last-90-days": 90,
};

export function toDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}`;
}

// 없는 날짜(2월 30일 같은)와 다른 모양은 undefined다.
export function parseDay(day: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return undefined;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  return toDay(date) === day ? date : undefined;
}

// 기간의 첫날과 마지막 날. "최근 7일"은 오늘을 포함한 7일이다. 거꾸로 준 직접 기간은 바로 놓는다.
export function resolveRange(
  range: DateRange,
  now: Date,
): { from: string; to: string } {
  if (range.preset === "custom") {
    return range.from <= range.to
      ? { from: range.from, to: range.to }
      : { from: range.to, to: range.from };
  }
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = DAYS[range.preset];
  const first =
    days === undefined
      ? new Date(today.getFullYear(), today.getMonth(), 1)
      : new Date(
          today.getFullYear(),
          today.getMonth(),
          today.getDate() - (days - 1),
        );
  return { from: toDay(first), to: toDay(today) };
}
