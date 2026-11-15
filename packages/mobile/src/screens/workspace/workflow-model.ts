// The rules that turn a run's lines into what the screen draws: its state, its step rows, whose turn it is. They are the
// desktop workflow tab's (packages/shell/renderer/workflow/model.ts) on the protocol's own types. That file cannot be imported
// here: its types come through workspace/source.ts, which reaches every desktop tab and their CSS.
import { t, type MessageKey } from "@lophn/i18n";
import type {
  WorkflowInstance,
  WorkflowLine,
} from "../../../../protocol/workflows/instances.ts";
import type { WorkflowDetail } from "../../data/places.ts";

export type Shown = "running" | "human" | "ended" | "stopped";

/** The state a list and a run's head say. A running run on a person's turn is `human`. */
export const shownOf = (
  state: WorkflowInstance["state"],
  current: WorkflowInstance["current"],
): Shown =>
  state !== "running" ? state : current?.human_turn ? "human" : "running";

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

const NOT_HANDED_KEY: Record<string, MessageKey> = {
  unknown_step: "workflow.note.not-handed-unknown-step",
  unknown_participant: "workflow.note.not-handed-unknown-participant",
  no_with: "workflow.note.not-handed-no-with",
  unresolved: "workflow.note.not-handed-unresolved",
};

export const notHandedKey = (reason: string): MessageKey =>
  NOT_HANDED_KEY[reason] ?? "workflow.note.not-handed-unresolved";

type Participant = WorkflowInstance["participants"][string];

/** A participant as the person reads it: the agent's name, with its workspace when the workflow names one. */
export function participantText(participant: Participant): string {
  if ("kind" in participant) return t("workflow.label.participant-human");
  const { agent, workspace } = participant;
  if (workspace === undefined || "home" in workspace) return agent;
  return t("workflow.label.participant-placed", {
    agent,
    workspace: "project" in workspace ? workspace.project : workspace.app,
  });
}

export interface StepRow {
  readonly step: WorkflowInstance["steps"][number];
  readonly shown: StepShown;
  /** The step's last report; undefined before it has one. */
  readonly report: Extract<WorkflowLine, { kind: "report" }> | undefined;
  /** The step's last line when it could not be handed on or lophn restarted. */
  readonly notice: WorkflowLine | null;
  readonly current: boolean;
}

export function stepRows(detail: WorkflowDetail): StepRow[] {
  const { instance, last_reports, lines } = detail;
  return instance.steps.map((step) => {
    const last = lines.findLast(
      (line) => "step" in line && line.step === step.name,
    );
    const report = last_reports[step.name];
    const current = instance.current?.step === step.name;
    return {
      step,
      report,
      current,
      shown: current
        ? instance.current?.human_turn === true
          ? "human"
          : instance.state === "stopped"
            ? "stopped"
            : "current"
        : report === undefined
          ? "waiting"
          : "reported",
      notice:
        last?.kind === "not_handed" || last?.kind === "lophn_restarted"
          ? last
          : null,
    };
  });
}

/** On a person's turn, the line that handed the current step over: who got it and the session to talk in. */
export function turnOf(
  detail: WorkflowDetail,
): Extract<WorkflowLine, { kind: "handed" }> | null {
  const { instance, lines } = detail;
  if (instance.current?.human_turn !== true) return null;
  const handed = lines.findLast(
    (line) => line.kind === "handed" && line.step === instance.current?.step,
  );
  return handed?.kind === "handed" ? handed : null;
}
