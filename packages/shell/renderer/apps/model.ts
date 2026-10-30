// 앱 상태를 화면 말로 바꾼다. 원시 enum은 사용자 라벨에 나오지 않는다.
import { t } from "@lophn/i18n";
import type { StatusTone } from "@lophn/ui";

import type { AppRow, RunState } from "./source.ts";

/** 보관은 실행 상태보다 앞선다. 실행 상태를 읽지 못했으면 unknown이다. */
export type AppStatus = RunState | "archived" | "unknown";

export function appStatus(
  row: Pick<AppRow, "archived">,
  run: RunState | null,
): AppStatus {
  if (row.archived) return "archived";
  return run ?? "unknown";
}

export function statusLabel(status: AppStatus): string {
  switch (status) {
    case "running":
      return t("common.label.app-running");
    case "stopped":
      return t("common.label.app-stopped");
    case "preparing":
      return t("common.label.app-preparing");
    case "unavailable":
      return t("common.label.app-unavailable");
    case "archived":
      return t("common.label.app-archived");
    case "unknown":
      return t("common.label.app-unknown");
  }
}

export function statusTone(status: AppStatus): StatusTone {
  switch (status) {
    case "running":
      return "good";
    case "unavailable":
      return "warning";
    default:
      return "neutral";
  }
}

/** 보관하지 않은 앱을 먼저, 그 안에서는 사람이 지은 이름 순서다. */
export function sortApps(rows: readonly AppRow[]): AppRow[] {
  return [...rows].sort(
    (a, b) =>
      Number(a.archived) - Number(b.archived) ||
      a.name.localeCompare(b.name, "en") ||
      a.id.localeCompare(b.id),
  );
}
