// workflow 탭이 읽은 값을 화면에 그릴 꼴로 바꾸는 순수 함수와 protocol 값 → message key 표.
import { formatRelativeTime, type MessageKey, t } from "@lophn/i18n";

import type {
  WorkflowInstanceDetailView,
  WorkflowInstanceSummaryView,
  WorkflowInstanceView,
  WorkflowLineView,
} from "../workspace/source.ts";

export type Shown = "running" | "human" | "ended" | "stopped";

/** 목록과 머리가 보이는 상태. 도는 instance가 사람 차례면 human이다. */
export const shownOf = (
  state: WorkflowInstanceView["state"],
  current: WorkflowInstanceView["current"],
): Shown =>
  state !== "running" ? state : current?.human_turn ? "human" : "running";

/** job이 한 일의 담당 글. 지워진 job은 제목이 null이다. */
export const jobWho = (title: string | null): string =>
  title === null
    ? t("workflow.label.participant-job-untitled")
    : t("workflow.label.participant-job", { title });

export const STATE_KEY: Record<Shown, MessageKey> = {
  running: "workflow.label.state-running",
  human: "workflow.label.state-human",
  ended: "workflow.label.state-ended",
  stopped: "workflow.label.state-stopped",
};

export type StepShown =
  | "human"
  | "current"
  | "stopped"
  | "reported"
  | "waiting";

export const STEP_KEY: Record<StepShown, MessageKey> = {
  human: "workflow.label.state-human",
  current: "workflow.label.step-current",
  stopped: "workflow.label.step-stopped",
  reported: "workflow.label.step-reported",
  waiting: "workflow.label.step-waiting",
};

/** 넘기지 못한 이유(protocol의 `NOT_HANDED_REASONS`) → 글. 모르는 값은 unresolved 글이다. */
const NOT_HANDED_KEY: Record<string, MessageKey> = {
  unknown_step: "workflow.note.not-handed-unknown-step",
  unknown_participant: "workflow.note.not-handed-unknown-participant",
  harness: "workflow.note.not-handed-harness",
  no_with: "workflow.note.not-handed-no-with",
  unresolved: "workflow.note.not-handed-unresolved",
};

export const notHandedKey = (reason: string): MessageKey =>
  NOT_HANDED_KEY[reason] ?? "workflow.note.not-handed-unresolved";

/** 참가자 글. agent는 workflow.yaml에 쓴 이름 그대로이고 place는 적힌 것만 붙인다. */
export function participantText(
  participant: WorkflowInstanceView["participants"][string],
): string {
  if ("kind" in participant) {
    return t(
      participant.kind === "human"
        ? "workflow.label.participant-human"
        : "workflow.label.participant-harness",
    );
  }
  const { agent, place } = participant;
  if (place === undefined) return agent;
  return t("workflow.label.participant-placed", {
    agent,
    place: "project" in place ? place.project : place.app,
  });
}

export const runningCount = (
  instances: readonly WorkflowInstanceSummaryView[],
): number => instances.filter((item) => item.state === "running").length;

type Step = WorkflowInstanceView["steps"][number];

export interface StepRow {
  readonly step: Step;
  readonly shown: StepShown;
  /** 그 step의 마지막 report. 아직 없으면 undefined. */
  readonly report: WorkflowLineView | undefined;
  readonly lines: readonly WorkflowLineView[];
  /** 그 step의 마지막 줄이 넘기지 못함이거나 lophn이 다시 켜진 것이면 그 줄(다시 넘기면 마지막 줄이 바뀌어 사라진다). */
  readonly notice: WorkflowLineView | null;
  readonly current: boolean;
}

/** instance의 steps 순서대로 step 줄을 만든다. */
export function stepRows(detail: WorkflowInstanceDetailView): StepRow[] {
  const { instance, last_reports, lines } = detail;
  return instance.steps.map((step) => {
    const stepLines = lines.filter(
      (line) => "step" in line && line.step === step.name,
    );
    const report = last_reports[step.name];
    const current = instance.current?.step === step.name;
    const shown: StepShown = current
      ? instance.current?.human_turn === true
        ? "human"
        : instance.state === "stopped"
          ? "stopped"
          : "current"
      : report === undefined
        ? "waiting"
        : "reported";
    const last = stepLines.at(-1);
    const notice =
      last?.kind === "not_handed" || last?.kind === "lophn_restarted"
        ? last
        : null;
    return { step, shown, report, lines: stepLines, notice, current };
  });
}

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

/** 사람 차례이면 지금 step을 가장 나중에 받은 줄(받은 참가자와 대화 session). */
export function turnOf(
  detail: WorkflowInstanceDetailView,
): Extract<WorkflowLineView, { kind: "handed" }> | null {
  const { instance, lines } = detail;
  if (instance.current?.human_turn !== true) return null;
  const handed = lines.findLast(
    (line) => line.kind === "handed" && line.step === instance.current?.step,
  );
  return handed?.kind === "handed" ? handed : null;
}

export const whenOf = (at: string): string =>
  formatRelativeTime(new Date(at), new Date());
