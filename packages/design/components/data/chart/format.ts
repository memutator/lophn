// 축·tooltip·표 보기의 숫자와 날짜. Intl로만 만들고 locale과 시간대는 caller가 준다.
import { formatDate, formatNumber, t } from "@lophn/wording";

export interface ChartLocale {
  readonly locale: string;
  // 없으면 실행 환경의 시간대다.
  readonly timeZone?: string;
}

// 축은 10만 이상을 compact로 줄인다.
export function axisNumber(value: number, { locale }: ChartLocale): string {
  return formatNumber(value, locale);
}

// tooltip과 표 보기는 값을 비교하므로 줄이지 않는다.
export function exactNumber(value: number, { locale }: ChartLocale): string {
  return formatNumber(value, locale, { notation: "standard" });
}

// 축 날짜: en에서 "Sep 26".
export function axisDate(
  value: Date,
  { locale, timeZone }: ChartLocale,
): string {
  return formatDate(value, locale, {
    month: "short",
    day: "numeric",
    timeZone,
  });
}

// tooltip 날짜: en에서 "Sep 26, 2026 (Sat)". 날짜와 요일의 순서는 catalog 문장이 정한다.
export function tooltipDate(
  value: Date,
  { locale, timeZone }: ChartLocale,
): string {
  return t("common.label.date-with-weekday", {
    date: formatDate(value, locale, {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone,
    }),
    weekday: formatDate(value, locale, { weekday: "short", timeZone }),
  });
}

export function valueRange(
  start: number,
  end: number,
  chartLocale: ChartLocale,
): string {
  return t("common.label.value-range", {
    start: exactNumber(start, chartLocale),
    end: exactNumber(end, chartLocale),
  });
}
