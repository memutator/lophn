// workflow instance의 줄을 화면에 그릴 꼴로 바꾸는 순수 규칙. desktop workflow 탭(model.ts)과 폰 앱이 같이 쓴다.
// import는 i18n뿐이고 type은 쓰는 모양만 받는다. desktop의 view type(workspace/source.ts)을 import하면 폰의 typecheck가
// desktop tab 전체를 끌어오기 때문이다.
import { type MessageKey, t } from "@lophn/i18n";

export type Shown = "running" | "human" | "ended" | "stopped";

type RunState = "running" | "ended" | "stopped";
type Current = {
  readonly step: string;
  readonly human_turn: boolean;
} | null;

/** 목록과 머리가 보이는 상태. 도는 instance가 사람 차례면 human이다. */
export const shownOf = (state: RunState, current: Current): Shown =>
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

/** 넘기지 못한 이유(protocol의 `NOT_HANDED_REASONS`) → 글. 모르는 값은 unresolved 글이다. */
const NOT_HANDED_KEY: Record<string, MessageKey> = {
  unknown_step: "workflow.note.not-handed-unknown-step",
  unknown_participant: "workflow.note.not-handed-unknown-participant",
  no_with: "workflow.note.not-handed-no-with",
  unresolved: "workflow.note.not-handed-unresolved",
  unknown_computer: "workflow.note.not-handed-unknown-computer",
  remote_failed: "workflow.note.not-handed-remote-failed",
};

export const notHandedKey = (reason: string): MessageKey =>
  NOT_HANDED_KEY[reason] ?? "workflow.note.not-handed-unresolved";

type Participant =
  | {
      readonly agent: string;
      readonly workspace?:
        | { readonly project: string }
        | { readonly app: string }
        | { readonly home: true };
      /** 그 agent가 도는 다른 컴퓨터. 없으면 이 컴퓨터다. */
      readonly on?: string;
    }
  | { readonly kind: "human" };

/** 참가자 글. agent는 workflow.yaml에 쓴 이름 그대로이고 workspace는 적힌 project나 앱만 붙인다. */
export function participantText(participant: Participant): string {
  if ("kind" in participant) {
    return t("workflow.label.participant-human");
  }
  const { agent, workspace, on } = participant;
  const placed =
    workspace === undefined || "home" in workspace
      ? agent
      : t("workflow.label.participant-placed", {
          agent,
          workspace: "project" in workspace ? workspace.project : workspace.app,
        });
  return on === undefined
    ? placed
    : t("workflow.label.participant-on", { who: placed, computer: on });
}

type Line = { readonly kind: string; readonly step?: string | null };

interface Detail<S extends { readonly name: string }, L extends Line, R> {
  readonly instance: {
    readonly state: RunState;
    readonly steps: readonly S[];
    readonly current: Current;
  };
  readonly last_reports: Readonly<Record<string, R>>;
  readonly lines: readonly L[];
}

export interface StepRow<S, L, R> {
  readonly step: S;
  readonly shown: StepShown;
  /** 그 step의 마지막 report. 아직 없으면 undefined. */
  readonly report: R | undefined;
  readonly lines: readonly L[];
  /** 그 step의 마지막 줄이 넘기지 못함이거나 lophn이 다시 켜진 것이면 그 줄(다시 넘기면 마지막 줄이 바뀌어 사라진다). */
  readonly notice: L | null;
  readonly current: boolean;
}

/** instance의 steps 순서대로 step 줄을 만든다. */
export function stepRows<
  S extends { readonly name: string },
  L extends Line,
  R,
>(detail: Detail<S, L, R>): StepRow<S, L, R>[] {
  const { instance, last_reports, lines } = detail;
  return instance.steps.map((step) => {
    const stepLines = lines.filter((line) => line.step === step.name);
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

/** 사람 차례이면 지금 step을 가장 나중에 받은 줄(받은 참가자와 대화 session). */
export function turnOf<L extends Line>(
  detail: Detail<{ readonly name: string }, L, unknown>,
): Extract<L, { kind: "handed" }> | null {
  const { instance, lines } = detail;
  if (instance.current?.human_turn !== true) return null;
  const handed = lines.findLast(
    (line): line is Extract<L, { kind: "handed" }> =>
      line.kind === "handed" && line.step === instance.current?.step,
  );
  return handed ?? null;
}
