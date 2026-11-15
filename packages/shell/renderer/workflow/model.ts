// workflow 탭이 읽은 값을 화면에 그릴 꼴로 바꾸는 순수 함수와 protocol 값 → message key 표. desktop만 쓰는 것이 여기 있다.
import { formatRelativeTime, t } from "@lophn/i18n";

import type {
  WorkflowInstanceDetailView,
  WorkflowInstanceSummaryView,
  WorkflowInstanceView,
  WorkflowLineView,
} from "../workspace/source.ts";
import type { StepRow as Row } from "./rules.ts";

// 폰 앱과 같이 쓰는 규칙은 rules.ts에 있다(import가 깨끗한 file).
export {
  notHandedKey,
  participantText,
  type Shown,
  STATE_KEY,
  STEP_KEY,
  type StepShown,
  shownOf,
  stepRows,
  turnOf,
} from "./rules.ts";

export type StepRow = Row<
  WorkflowInstanceView["steps"][number],
  WorkflowLineView,
  WorkflowLineView
>;

/** job이 한 일의 담당 글. 지워진 job은 제목이 null이다. */
export const jobWho = (title: string | null): string =>
  title === null
    ? t("workflow.label.participant-job-untitled")
    : t("workflow.label.participant-job", { title });

export const runningCount = (
  instances: readonly WorkflowInstanceSummaryView[],
): number => instances.filter((item) => item.state === "running").length;

/** step이 없는 줄(ended, stopped, program_exited, step 없는 edit과 lophn_restarted). instance 머리 쪽에 둔다. */
export const headLines = (
  detail: WorkflowInstanceDetailView,
): WorkflowLineView[] =>
  detail.lines.filter(
    (line) =>
      line.kind === "ended" ||
      line.kind === "stopped" ||
      line.kind === "program_exited" ||
      ((line.kind === "edit" || line.kind === "lophn_restarted") &&
        line.step === null),
  );

export const whenOf = (at: string): string =>
  formatRelativeTime(new Date(at), new Date());
