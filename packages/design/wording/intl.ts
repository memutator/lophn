// 날짜·숫자·상대 시각은 Intl로만 만든다. 시각은 인자로 받아 테스트가 고정한다.
const COMPACT_FROM = 100_000;

export function formatDate(
  value: Date,
  locale = "en",
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
): string {
  return new Intl.DateTimeFormat(locale, options).format(value);
}

export function formatDateTooltip(value: Date, locale = "en"): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    weekday: "short",
  }).format(value);
}

export function formatNumber(value: number, locale = "en"): string {
  const options: Intl.NumberFormatOptions = Math.abs(value) >= COMPACT_FROM
    ? { notation: "compact" }
    : {};
  return new Intl.NumberFormat(locale, options).format(value);
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 60 * 60 * 24 * 365],
  ["month", 60 * 60 * 24 * 30],
  ["day", 60 * 60 * 24],
  ["hour", 60 * 60],
  ["minute", 60],
  ["second", 1],
];

export function formatRelativeTime(
  value: Date,
  now: Date,
  locale = "en",
): string {
  const seconds = Math.round((value.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(seconds);
  const [unit, size] = UNITS.find(([, unitSize]) => abs >= unitSize) ??
    UNITS[UNITS.length - 1];
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
    Math.round(seconds / size),
    unit,
  );
}
