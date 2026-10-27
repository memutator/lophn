// app-detail의 순수 계산. 안쪽 값(상태 enum·종류·ID)을 사람 말로 바꾸는 자리이다.
import { formatDate, t } from "@lophn/wording";

import type {
  ActivationStep,
  ActivityRow,
  AgentRole,
  Caller,
  CallState,
  LossLine,
  OAuthReason,
  OAuthState,
  ResourceKind,
  RewindOutcome,
} from "./source.ts";

/** release 번호를 `r7` 꼴로. */
export const releaseName = (number: number) => `r${number}`;

/** "Oct 15, 13:58". 값이 없으면 빈 문자열이다. */
export function dateTime(iso: string | null): string {
  if (iso === null) return "";
  return formatDate(new Date(iso), "en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** 표의 시각 칸. 오늘이면 "14:41", 아니면 "Oct 15". */
export function callTime(iso: string | null, now: Date): string {
  if (iso === null) return t("app-detail.label.time-unknown");
  const at = new Date(iso);
  if (at.toDateString() === now.toDateString()) {
    return formatDate(at, "en", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  return formatDate(at);
}

// ---- Version ----

export function stepText(step: ActivationStep, release: number): string {
  const count = step.count ?? 0;
  switch (step.key) {
    case "hold":
      return step.count === null
        ? t("app-detail.label.step-hold")
        : t("app-detail.label.step-hold-count", { count });
    case "drain":
      return t("app-detail.label.step-drain");
    case "stop":
      return t("app-detail.label.step-stop");
    case "migrate":
      return step.count === null
        ? t("app-detail.label.step-migrate")
        : t("app-detail.label.step-migrate-count", { count });
    case "start":
      return t("app-detail.label.step-start", {
        release: releaseName(release),
      });
  }
}

export function lossText(loss: LossLine): { label: string; value: string } {
  switch (loss.kind) {
    case "drop_table":
      return {
        label: t("app-detail.label.loss-drop-table"),
        value: loss.table,
      };
    case "drop_column":
      return {
        label: t("app-detail.label.loss-drop-column"),
        value: `${loss.table}.${loss.column ?? ""}`,
      };
    case "narrow_type":
      return {
        label: t("app-detail.label.loss-narrow-type"),
        value: `${loss.table}.${loss.column ?? ""}`,
      };
  }
}

// ---- Access ----

export function resourceKindText(kind: ResourceKind): string {
  switch (kind) {
    case "file-read":
    case "file-write":
      return t("app-detail.label.resource-file");
    case "network":
    case "listen":
      return t("app-detail.label.resource-network");
    case "secret":
      return t("app-detail.label.resource-secret");
  }
}

export function resourceDetail(kind: ResourceKind, grantedAt: string): string {
  const when = dateTime(grantedAt);
  switch (kind) {
    case "file-read":
      return t("app-detail.note.resource-file-read", { when });
    case "file-write":
      return t("app-detail.note.resource-file-write", { when });
    case "network":
      return t("app-detail.note.resource-network", { when });
    case "listen":
      return t("app-detail.note.resource-listen", { when });
    case "secret":
      return t("app-detail.note.resource-secret");
  }
}

const FAILED_NOTE: Record<OAuthReason, () => string> = {
  callback_timeout: () => t("app-detail.note.oauth-failed-callback-timeout"),
  state_mismatch: () => t("app-detail.note.oauth-failed-state-mismatch"),
  exchange_failed: () => t("app-detail.note.oauth-failed-exchange-failed"),
  refresh_rejected: () => t("app-detail.note.oauth-failed-refresh-rejected"),
  expired: () => t("app-detail.note.oauth-failed-expired"),
  store_failed: () => t("app-detail.note.oauth-failed-store-failed"),
};

/** OAuth 줄의 상태 표시. 실패는 이유가 글이 된다. */
export function oauthStatus(
  state: OAuthState,
  reason: OAuthReason | null,
): { tone: "neutral" | "warning" | "good" | "critical"; label: string } {
  switch (state) {
    case "none":
      return {
        tone: "neutral",
        label: t("app-detail.label.oauth-not-signed-in"),
      };
    case "in_progress":
      return { tone: "warning", label: t("app-detail.label.oauth-waiting") };
    case "signed_in":
      return { tone: "good", label: t("app-detail.label.oauth-signed-in") };
    case "failed":
      return {
        tone: "critical",
        label: FAILED_NOTE[reason ?? "store_failed"](),
      };
  }
}

// ---- Activity ----

const ROLE_TEXT: Record<AgentRole, () => string> = {
  lophn: () => t("app-detail.label.role-lophn"),
  project_manager: () => t("app-detail.label.role-project-manager"),
  app_engineer: () => t("app-detail.label.role-app-engineer"),
  operator: () => t("app-detail.label.role-operator"),
};

/** 행에 보이는 부른 쪽 이름. */
export function callerText(caller: Caller): string {
  switch (caller.kind) {
    case "person":
      return t("app-detail.label.caller-person");
    case "agent":
      return ROLE_TEXT[caller.role]();
    case "app":
      return t("app-detail.label.caller-app", {
        name: caller.appName ?? t("app-detail.label.caller-app-unnamed"),
      });
    case "program":
      return t("app-detail.label.caller-program");
    case "flow":
      return t("app-detail.label.caller-flow");
    case "start":
      return t("app-detail.label.caller-start");
  }
}

/** 호출 이름. 앱 시작과 data 변경은 정해진 말이다. */
export function callName(row: Pick<ActivityRow, "kind" | "tool">): string {
  if (row.kind === "start") return t("app-detail.label.call-start");
  if (row.kind === "data_change") return t("app-detail.label.call-data-change");
  return row.tool ?? "";
}

export function callStateText(row: ActivityRow): string {
  if (row.undone) return t("app-detail.label.state-undone");
  return STATE_TEXT[row.state]();
}

const STATE_TEXT: Record<CallState, () => string> = {
  done: () => t("app-detail.label.state-done"),
  failed: () => t("app-detail.label.state-failed"),
  waiting: () => t("app-detail.label.state-waiting"),
  running: () => t("app-detail.label.state-running"),
  unknown: () => t("app-detail.label.state-unknown"),
};

/** 지금 release의 live write·external·앱 시작에서만 rewind를 시작할 수 있다. */
export function canRewind(row: ActivityRow): boolean {
  return (
    !row.earlier &&
    row.effect !== "read" &&
    row.state === "done" &&
    !row.undone &&
    row.kind !== "data_change"
  );
}

export function outcomeText(outcome: RewindOutcome): string {
  switch (outcome) {
    case "undone":
      return t("app-detail.label.outcome-undone");
    case "stays":
      return t("app-detail.label.outcome-stays");
    case "cannot":
      return t("app-detail.label.outcome-cannot");
  }
}
