// Tasks 탭의 순수 계산. coding-agent가 정한 화면 상태·다음 행동 값을 en wording key로 바꾸는 자리다
// (coding-agent#T27 → shell). 값이 곧 key 이름이다. Task 상태, 실제 검사, TUI 상태, 첫 prompt 전달은
// 서로 다른 사실이라 각자 따로 말한다.
import type { StatusTone } from "@lophn/design";
import { t } from "@lophn/wording";

import type {
  CheckResult,
  ConditionKind,
  PromptDelivery,
  TaskDetail,
  TaskNext,
  TaskState,
  TuiState,
} from "./source.ts";

export function stateText(state: TaskState): string {
  switch (state) {
    case "needs_confirmation":
      return t("app-detail.label.task-state-needs-confirmation");
    case "ready":
      return t("app-detail.label.task-state-ready");
    case "in_progress":
      return t("app-detail.label.task-state-in-progress");
    case "reported":
      return t("app-detail.label.task-state-reported");
    case "confirmed":
      return t("app-detail.label.task-state-confirmed");
    case "check_failed":
      return t("app-detail.label.task-state-check-failed");
    case "cancelled":
      return t("app-detail.label.task-state-cancelled");
  }
}

export function stateTone(state: TaskState): StatusTone {
  switch (state) {
    case "confirmed":
      return "good";
    case "check_failed":
      return "serious";
    case "needs_confirmation":
    case "reported":
      return "warning";
    default:
      return "neutral";
  }
}

export function nextText(next: TaskNext): string {
  switch (next) {
    case "start":
      return t("app-detail.label.task-next-start");
    case "needs_confirmation":
      return t("app-detail.label.task-next-needs-confirmation");
    case "check_result":
      return t("app-detail.label.task-next-check-result");
    case "waiting_for_approval":
      return t("app-detail.label.task-next-waiting-for-approval");
  }
}

export function tuiText(state: TuiState): string {
  switch (state) {
    case "starting":
      return t("app-detail.label.tui-starting");
    case "ready":
      return t("app-detail.label.tui-ready");
    case "working":
      return t("app-detail.label.tui-working");
    case "waiting_input":
      return t("app-detail.label.tui-waiting-input");
    case "ended":
      return t("app-detail.label.tui-ended");
    case "unknown":
      return t("app-detail.label.tui-unknown");
  }
}

/** 모르는 상태를 활동이 있다는 색으로 칠하지 않는다. */
export function tuiTone(state: TuiState): StatusTone {
  switch (state) {
    case "working":
    case "ready":
      return "good";
    case "waiting_input":
    case "unknown":
      return "warning";
    default:
      return "neutral";
  }
}

export function promptText(delivery: PromptDelivery): string | null {
  switch (delivery) {
    case "none":
      return null;
    case "pending":
      return t("app-detail.note.prompt-pending");
    case "delivered":
      return t("app-detail.note.prompt-delivered");
    case "not_delivered":
      return t("app-detail.note.prompt-not-delivered");
    case "unknown":
      return t("app-detail.note.prompt-unknown");
  }
}

export function checkResultText(result: CheckResult): string {
  switch (result) {
    case "pass":
      return t("app-detail.label.check-pass");
    case "fail":
      return t("app-detail.label.check-fail");
    case "inconclusive":
      return t("app-detail.label.check-inconclusive");
  }
}

/** 미확인을 통과 색으로 칠하지 않는다. */
export function checkTone(result: CheckResult): StatusTone {
  return result === "pass" ? "good" : result === "fail" ? "serious" : "warning";
}

export function conditionText(kind: ConditionKind): string {
  switch (kind) {
    case "test_command":
      return t("app-detail.label.condition-test-command");
    case "app_test":
      return t("app-detail.label.condition-app-test");
    case "reproduction_test":
      return t("app-detail.label.condition-reproduction");
    case "release_active":
      return t("app-detail.label.condition-version-in-use");
    case "problems_closed":
      return t("app-detail.label.condition-issues-closed");
    case "human_confirmation":
      return t("app-detail.label.condition-human");
  }
}

/** 시작하지 못한 이유 한 문장. 다른 harness·폴더로 바꿔 시작했다고 말하지 않는다. */
export function startErrorText(reason: string): string {
  switch (reason) {
    case "folder_changed":
      return t("app-detail.error.start-folder-changed");
    case "ticket_changed":
      return t("app-detail.error.start-task-changed");
    case "ticket_unavailable":
      return t("app-detail.error.start-task-unavailable");
    case "connection_unavailable":
      return t("app-detail.error.start-connection-unavailable");
    case "plan_refused":
    case "plan_mismatch":
      return t("app-detail.error.start-refused");
    case "host_refused":
      return t("app-detail.error.start-host-refused");
    default:
      return t("app-detail.error.start-failed");
  }
}

/** 한 줄 사유: 공백만이 아니고 줄바꿈이 없고 200자 안이다(coding-agent/tickets#R22). */
export function validReason(text: string): boolean {
  const reason = text.trim();
  return reason !== "" && !/[\r\n]/.test(reason) && [...reason].length <= 200;
}

export function validTitle(text: string): boolean {
  const title = text.trim();
  return title !== "" && !/[\r\n]/.test(title) && [...title].length <= 120;
}

export function validBody(text: string): boolean {
  const body = text.trim();
  return body !== "" && [...body].length <= 2000;
}

/** 취소할 수 있는 상태. 끝났거나 이미 취소된 일은 취소하지 않는다. */
export function cancellable(state: TaskState): boolean {
  return state !== "cancelled" && state !== "confirmed";
}

/** 완료 보고가 있는데 통과로 닫히지 않은 조건이 남았는지. 보고가 확인됨을 뜻하지 않는다. */
export function hasRemaining(detail: TaskDetail): boolean {
  return detail.remaining.length > 0;
}

/**
 * 복사할 요청 문장. 자기 터미널의 coding agent에 붙여 넣어 이 Task를 시작하게 한다. 사람이 읽는 문장이라
 * 안쪽 이름 대신 Task라 부르고 Task 번호만 정확히 싣는다.
 */
export function requestSentence(task: { id: string; request: string }): string {
  return t("app-detail.text.task-request-sentence", {
    task: task.id,
    request: task.request,
  });
}
