// Issues 탭의 순수 계산. 상태 이름과 색, 기간 거르기.
import type { StatusTone } from "@lophn/design";
import { t } from "@lophn/wording";

import type { IssueOccurrence, IssueStatus } from "./source.ts";

export const STATUS_FILTERS: readonly (IssueStatus | "all")[] = [
  "all",
  "open",
  "resolved",
  "ignored",
];

export function statusText(status: IssueStatus): string {
  switch (status) {
    case "open":
      return t("app-detail.label.issue-status-open");
    case "resolved":
      return t("app-detail.label.issue-status-resolved");
    case "ignored":
      return t("app-detail.label.issue-status-ignored");
  }
}

export function statusTone(status: IssueStatus): StatusTone {
  switch (status) {
    case "open":
      return "warning";
    case "resolved":
      return "good";
    case "ignored":
      return "neutral";
  }
}

export type Period = "day" | "week" | "month" | "all";

export const PERIODS: readonly Period[] = ["day", "week", "month", "all"];

export function periodText(period: Period): string {
  switch (period) {
    case "day":
      return t("app-detail.label.period-day");
    case "week":
      return t("app-detail.label.period-week");
    case "month":
      return t("app-detail.label.period-month");
    case "all":
      return t("app-detail.label.period-all");
  }
}

const DAYS: Record<Exclude<Period, "all">, number> = {
  day: 1,
  week: 7,
  month: 30,
};

/** 기간의 시작 시각(ISO). 전체 기간이면 null이다. */
export function periodSince(period: Period, now: Date): string | null {
  if (period === "all") return null;
  return new Date(now.getTime() - DAYS[period] * 86_400_000).toISOString();
}

export function occurrenceKindText(kind: IssueOccurrence["kind"]): string {
  return kind === "app_error"
    ? t("app-detail.label.occurrence-app-error")
    : t("app-detail.label.occurrence-report");
}
