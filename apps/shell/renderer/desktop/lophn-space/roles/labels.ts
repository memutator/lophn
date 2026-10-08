// roles 화면의 안쪽 값을 화면 말 key로 바꾸는 표. 말은 packages/design/wording/en.ts가 정한다.
import { type MessageKey, t } from "@lophn/wording";

import type { StepStatus, StepTarget, WorkStatus } from "./model.ts";
import type { CallOutcome, RoleKind, RoleRow, RoleState } from "./source.ts";

export const ROLE_LABEL: Record<RoleKind, MessageKey> = {
  lophn: "roles.label.role-lophn",
  app_engineer: "roles.label.role-app-engineer",
  context_engineer: "roles.label.role-context-engineer",
  operator: "roles.label.role-operator",
};

export const STATE_LABEL: Record<RoleState, MessageKey> = {
  enabled: "roles.label.state-active",
  paused: "roles.label.state-paused",
  withdrawn: "roles.label.state-withdrawn",
};

export const STATUS_LABEL: Record<WorkStatus, MessageKey> = {
  "in-progress": "roles.label.status-in-progress",
  waiting: "roles.label.status-waiting",
  stopped: "roles.label.status-stopped",
  done: "roles.label.status-done",
};

export const STATUS_TONE = {
  "in-progress": "neutral",
  waiting: "warning",
  stopped: "serious",
  done: "good",
} as const;

export const STEP_TARGET_LABEL: Record<StepTarget, MessageKey> = {
  document: "roles.label.target-document",
  project: "roles.label.target-project",
  app: "roles.label.target-app",
  focus: "roles.label.target-focus",
  meaning: "roles.label.target-meaning",
  chart: "roles.label.target-chart",
  file: "roles.label.target-file",
  guide: "roles.label.target-guide",
  skill: "roles.label.target-skill",
  question: "roles.label.target-question",
  approval: "roles.label.target-approval",
  role: "roles.label.target-role",
  outside: "roles.label.target-outside",
  tool: "roles.label.target-tool",
};

export const STEP_ACTION_LABEL = {
  read: "roles.label.action-read",
  write: "roles.label.action-write",
  external: "roles.label.action-external",
} as const satisfies Record<string, MessageKey>;

export const STEP_STATUS_LABEL: Record<StepStatus, MessageKey> = {
  done: "roles.label.step-done",
  failed: "roles.label.step-failed",
  denied: "roles.label.step-denied",
  "not-run": "roles.label.step-not-run",
  unclear: "roles.label.step-unclear",
  unfinished: "roles.label.step-unfinished",
};

export const STEP_TONE: Record<
  StepStatus,
  "good" | "serious" | "warning" | "neutral"
> = {
  done: "good",
  failed: "serious",
  denied: "warning",
  "not-run": "neutral",
  unclear: "warning",
  unfinished: "warning",
};

export const CALL_OUTCOME_LABEL: Record<CallOutcome, MessageKey> = {
  complete: "roles.label.call-complete",
  partial: "roles.label.call-partial",
  failed: "roles.label.call-failed",
  cancelled: "roles.label.call-cancelled",
  uncertain: "roles.label.call-uncertain",
  unfinished: "roles.label.call-unfinished",
};

/** 일이 끝난 이유. 안쪽 코드가 아니라 사람이 읽는 한 문장이다. */
export const REASON_LABEL: Record<string, MessageKey> = {
  answer_completed: "roles.reason.answer-completed",
  no_change: "roles.reason.no-change",
  model_error: "roles.reason.model-error",
  tool_error: "roles.reason.tool-error",
  context_limit: "roles.reason.context-limit",
  model_attempt_limit: "roles.reason.attempt-limit",
  stall_limit: "roles.reason.stall-limit",
  active_limit: "roles.reason.active-limit",
  repeated_tool_failure: "roles.reason.repeated-failure",
  effect_unknown: "roles.reason.effect-unknown",
  clock_uncertain: "roles.reason.clock-uncertain",
  configuration_unavailable: "roles.reason.configuration",
  target_unavailable: "roles.reason.target",
  user_stopped: "roles.reason.user-stopped",
  assignment_paused: "roles.reason.role-paused",
  assignment_withdrawn: "roles.reason.role-withdrawn",
  no_answer: "roles.reason.no-answer",
};

/** 역할 이름과 붙은 곳의 이름. 이름을 모르면(보관된 곳) 역할 이름만이다. */
export function roleTitle(
  row: RoleRow,
  names: Readonly<Record<string, string>>,
): string {
  const role = t(ROLE_LABEL[row.role]);
  const name = row.scope.id === null ? undefined : names[row.scope.id];
  return name === undefined
    ? role
    : t("roles.label.role-with-scope", { role, name });
}
