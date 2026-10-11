// 역할·상태·notification 계기의 화면 말. 원시 enum을 화면에 내보이지 않는다(ui-ux 3절).
import { formatRelativeTime, t } from "@lophn/wording";

import type { NotificationRow, Request, Role } from "./source.ts";

export function roleLabel(role: Role): string {
  switch (role) {
    case "lophn":
      return t("things-to-confirm.label.role-lophn");
    case "app_engineer":
      return t("things-to-confirm.label.role-app-engineer");
    case "context_engineer":
      return t("things-to-confirm.label.role-context-engineer");
    case "operator":
      return t("things-to-confirm.label.role-operator");
  }
}

/** 목록·칸의 머리. 역할을 모르면 종류만 말한다. */
export function requestTitle(request: Request): string {
  if (request.kind === "question") {
    return request.role === null
      ? t("things-to-confirm.label.question")
      : t("things-to-confirm.label.question-from", {
        role: roleLabel(request.role),
      });
  }
  return request.role === null
    ? t("things-to-confirm.label.decision")
    : t("things-to-confirm.label.decision-from", {
      role: roleLabel(request.role),
    });
}

export type StatusTone = "neutral" | "warning" | "good" | "serious";

/** 상태 이름과 모양. 색 없이도 글로 읽는다. */
export function statusOf(
  request: Request,
): { readonly label: string; readonly tone: StatusTone } {
  if (request.status === "pending") {
    return {
      label: t("things-to-confirm.label.status-waiting"),
      tone: "warning",
    };
  }
  if (request.status === "expired") {
    return {
      label: t("things-to-confirm.label.status-expired"),
      tone: "neutral",
    };
  }
  if (request.kind === "question") {
    if (request.status === "answered") {
      return {
        label: t("things-to-confirm.label.status-answered"),
        tone: "good",
      };
    }
    if (request.closedReason === "deferred") {
      return {
        label: t("things-to-confirm.label.status-deferred"),
        tone: "neutral",
      };
    }
    if (request.closedReason === "superseded") {
      return {
        label: t("things-to-confirm.label.status-replaced"),
        tone: "neutral",
      };
    }
    return {
      label: t("things-to-confirm.label.status-cancelled"),
      tone: "neutral",
    };
  }
  if (request.status === "granted") {
    return { label: t("things-to-confirm.label.status-allowed"), tone: "good" };
  }
  if (request.status === "rejected") {
    return {
      label: t("things-to-confirm.label.status-declined"),
      tone: "serious",
    };
  }
  return {
    label: t("things-to-confirm.label.status-cancelled"),
    tone: "neutral",
  };
}

/** notification 계기의 이름. 계기 표에 없는 것은 일반 안내로 말한다. */
export function eventTitle(sourceEvent: string): string {
  switch (sourceEvent) {
    case "QuestionCreated":
      return t("things-to-confirm.label.event-question");
    case "ApprovalRequestCreated":
      return t("things-to-confirm.label.event-decision");
    case "ProblemOpened":
      return t("things-to-confirm.label.event-issue-opened");
    case "ProblemReopened":
      return t("things-to-confirm.label.event-issue-reopened");
    case "ProblemClosed":
      return t("things-to-confirm.label.event-issue-closed");
    case "TicketConfirmed":
      return t("things-to-confirm.label.event-task-confirmed");
    case "TicketCheckFailed":
      return t("things-to-confirm.label.event-task-check-failed");
    case "AssignmentPaused":
      return t("things-to-confirm.label.event-paused");
    case "ReleaseActivationFailed":
      return t("things-to-confirm.label.event-activation-failed");
    default:
      return t("things-to-confirm.label.event-other");
  }
}

/**
 * chip의 한 줄. 무슨 일인지(계기), 언제인지(발생 시각이 있을 때)를 notification이 이미 가진
 * 사실로만 말한다. 계기 표에 없는 계기는 일반 안내다.
 */
export function noticeTitle(
  notification: NotificationRow,
  nowMs: number,
): string {
  const title = eventTitle(notification.sourceEvent);
  const parts = [title];
  const when = notification.occurredAt === undefined
    ? Number.NaN
    : Date.parse(notification.occurredAt);
  if (Number.isFinite(when)) {
    parts.push(formatRelativeTime(new Date(when), new Date(nowMs)));
  }
  return parts.join(" · ");
}
