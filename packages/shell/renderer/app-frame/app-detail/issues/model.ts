// Issues 탭의 순수 계산. 안쪽 값(status·closure·test state)을 tone과 선택지로 바꾸는 자리이고
// 문장은 problems가 정한 값을 그대로 쓴다. 상태 이름만 shell이 말한다.
import type { StatusTone } from "@lophn/design";
import { t } from "@lophn/wording";

import type {
  IssueChoice,
  IssueStatus,
  IssueTestState,
  IssueView,
} from "./source.ts";

export function statusText(status: IssueStatus): string {
  switch (status) {
    case "open":
      return t("app-detail.label.issue-status-open");
    case "fixing":
      return t("app-detail.label.issue-status-fixing");
    case "closed":
      return t("app-detail.label.issue-status-closed");
  }
}

export function statusTone(status: IssueStatus): StatusTone {
  switch (status) {
    case "open":
      return "warning";
    case "fixing":
      return "neutral";
    case "closed":
      return "good";
  }
}

/** 미확인·미실행·읽지 못함을 성공 색으로 칠하지 않는다. */
export function testTone(
  state: IssueTestState | "not_run" | "unknown",
): StatusTone {
  switch (state) {
    case "pass":
      return "good";
    case "fail":
      return "serious";
    case "unconfirmed":
    case "unknown":
      return "warning";
    default:
      return "neutral";
  }
}

export interface ChoiceOption {
  readonly choice: IssueChoice;
  readonly enabled: boolean;
  /** 막혔으면 이유가 있다. */
  readonly blocked: "version" | null;
}

/**
 * 지금 보이는 결정. 닫힌 문제는 "아직 안 고쳐졌다"만 있다(다시 열기). fixed는 쓰는 Version을,
 * not_visible은 Version과 마지막 관찰을 알아야 한다(closing contract의 결정 binding 규칙).
 * dismiss의 한 줄 이유는 화면이 받고 창이 그대로 보인다.
 */
export function choiceOptions(view: IssueView): readonly ChoiceOption[] {
  if (view.closed !== null) {
    return [{ choice: "not_fixed", enabled: true, blocked: null }];
  }
  const { versionKnown, observationKnown } = view.basis;
  return [
    {
      choice: "fixed",
      enabled: versionKnown,
      blocked: versionKnown ? null : "version",
    },
    { choice: "not_fixed", enabled: true, blocked: null },
    {
      choice: "not_visible",
      enabled: versionKnown && observationKnown,
      blocked: versionKnown && observationKnown ? null : "version",
    },
    { choice: "dismiss", enabled: true, blocked: null },
  ];
}

/** 한 줄 이유: 공백만이 아니고 줄바꿈이 없다. */
export function isOneLine(text: string): boolean {
  return /^[^\r\n]*\S[^\r\n]*$/.test(text);
}

export function choiceText(choice: IssueChoice): string {
  switch (choice) {
    case "fixed":
      return t("app-detail.button.issue-fixed");
    case "not_fixed":
      return t("app-detail.button.issue-not-fixed");
    case "not_visible":
      return t("app-detail.button.issue-not-visible");
    case "dismiss":
      return t("app-detail.button.issue-dismiss");
  }
}
