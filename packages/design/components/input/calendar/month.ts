// 달력 한 장의 날짜 계산. 날짜는 앱이 있는 곳의 달력 날짜("YYYY-MM-DD"), 달은 "YYYY-MM"이다.
import { toDay } from "../filter/range.ts";

function parts(day: string): [number, number, number] {
  const [year, month, date] = day.split("-").map(Number);
  return [year, month, date];
}

export function dateOf(day: string): Date {
  const [year, month, date] = parts(day);
  return new Date(year, month - 1, date);
}

export function monthOf(day: string): string {
  return day.slice(0, 7);
}

export function shiftDay(day: string, days: number): string {
  const [year, month, date] = parts(day);
  return toDay(new Date(year, month - 1, date + days));
}

// 달을 옮겨도 같은 날짜에 선다. 그 날짜가 없는 달(1월 31일 → 2월)이면 그 달의 마지막 날이다.
export function shiftDayByMonth(day: string, months: number): string {
  const [year, month, date] = parts(day);
  const last = new Date(year, month - 1 + months + 1, 0).getDate();
  return toDay(new Date(year, month - 1 + months, Math.min(date, last)));
}

// 일요일이 0이다.
export function weekdayOf(day: string): number {
  return dateOf(day).getDay();
}

// 그 달을 덮는 6주다. 일요일부터 시작하고 앞뒤 달의 날로 채워 달마다 높이가 같다.
export function monthWeeks(month: string): string[][] {
  const [year, index] = month.split("-").map(Number);
  const offset = new Date(year, index - 1, 1).getDay();
  return Array.from({ length: 6 }, (_, week) =>
    Array.from({ length: 7 }, (_, weekday) =>
      toDay(new Date(year, index - 1, 1 - offset + week * 7 + weekday)),
    ),
  );
}
