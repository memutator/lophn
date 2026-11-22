// workflow 탭이 읽은 값을 화면에 그릴 꼴로 바꾸는 순수 함수와 protocol 값 → message key 표. desktop만 쓰는 것이 여기 있다.
import { formatRelativeTime, t } from "@lophn/i18n";

import { FLOW_STEP_BY } from "../../../protocol/workflows/values.ts";
import type { AvatarLook } from "../parts/avatar/avatar.tsx";
import type {
  WorkflowEntryView,
  WorkflowInstanceDetailView,
  WorkflowInstanceSummaryView,
  WorkflowInstanceView,
  WorkflowLineView,
  WorkflowRemoteStepView,
} from "../workspace/source.ts";
import {
  participantText,
  type StepRow as Row,
  type StepShown,
  stepRows,
  turnOf,
} from "./rules.ts";

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

type Line<K extends WorkflowLineView["kind"]> = Extract<
  WorkflowLineView,
  { kind: K }
>;
type Participants = WorkflowInstanceView["participants"];
type AgentParticipant = Extract<Participants[string], { agent: string }>;

/** job이 한 일의 담당 글. 지워진 job은 제목이 null이다. */
export const jobWho = (title: string | null): string =>
  title === null
    ? t("workflow.label.participant-job-untitled")
    : t("workflow.label.participant-job", { title });

export const runningCount = (
  instances: readonly WorkflowInstanceSummaryView[],
): number => instances.filter((item) => item.state === "running").length;

/** step이 없는 줄(ended, stopped, program_exited, step 없는 edit과 lophn_restarted). run 머리 쪽에 둔다. */
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

/** run의 이름. 시작 입력의 첫 줄이다. */
export const runTitle = (input: string): string =>
  input
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "") ?? "";

/** agent handle의 얼굴. 탭이 agent 목록에서 찾아 넘긴다(없으면 handle 글만 보인다). */
export interface WorkflowFace {
  readonly name: string;
  readonly avatar: AvatarLook;
}
export type FaceOf = (handle: string) => WorkflowFace | undefined;

/** step을 맡은 쪽. 참가자 key를 선언의 참가자로 풀어 사람, program, agent로 가른다. */
export type Who =
  | { readonly kind: "human" }
  | { readonly kind: "program" }
  | {
      readonly kind: "agent";
      readonly handle: string;
      readonly participant: AgentParticipant;
    }
  /** 선언에 없는 참가자 key. 넘길 때 `not_handed`가 된다. */
  | { readonly kind: "unknown"; readonly key: string };

export function whoOf(participants: Participants | null, key: string): Who {
  const found = participants?.[key];
  if (found === undefined) {
    return key === FLOW_STEP_BY
      ? { kind: "program" }
      : { kind: "unknown", key };
  }
  return "kind" in found
    ? { kind: "human" }
    : { kind: "agent", handle: found.agent, participant: found };
}

/** 맡은 쪽의 이름. agent는 사람이 지은 이름이 있으면 그것이고, 다른 workspace의 agent는 선언에 적힌 자리를 붙인다. */
export function whoName(who: Who, faceOf: FaceOf | undefined): string {
  switch (who.kind) {
    case "human":
      return t("workflow.label.participant-human");
    case "program":
      return t("workflow.label.participant-program");
    case "unknown":
      return who.key;
    case "agent": {
      const face = faceOf?.(who.handle);
      // 다른 workspace나 다른 컴퓨터의 agent는 이 창이 아는 얼굴이 아니라 선언에 적힌 글로 부른다.
      return face === undefined ||
        who.participant.workspace !== undefined ||
        who.participant.on !== undefined
        ? participantText(who.participant)
        : face.name;
    }
  }
}

/** step 줄(relay)의 한 칸. 정의 화면은 `shown`이 없고 run 화면은 그 step의 상태를 싣는다. */
export interface RelayStep {
  readonly name: string;
  readonly who: Who;
  /** 사람 step에서 같이 이야기하는 agent. */
  readonly with: Who | null;
  readonly shown?: StepShown;
  /** 이 step으로 넘기지 못했거나 넘긴 것이 끊겼을 수 있다(run 화면만). */
  readonly blocked?: boolean;
  /** 다른 컴퓨터로 넘겼는데 아직 거기서 돌지 않는다(닿지 않았거나 그 컴퓨터에서 사람을 기다린다). 그 컴퓨터 이름이다. */
  readonly waitingOn?: string;
  /** 늦게 닿아 그 컴퓨터에서 사람의 결정을 기다린다. 사람 차례의 색으로 보인다. */
  readonly heldThere?: boolean;
}

const relayStep = (
  participants: Participants | null,
  step: {
    readonly name: string;
    readonly by: string;
    readonly with: string | null;
  },
  shown?: StepShown,
): RelayStep => ({
  name: step.name,
  who: whoOf(participants, step.by),
  with: step.with === null ? null : whoOf(participants, step.with),
  ...(shown === undefined ? {} : { shown }),
});

/** 선언의 step 순서. 틀린 선언은 step이 없다. */
export const relayOfEntry = (entry: WorkflowEntryView): RelayStep[] =>
  (entry.steps ?? []).map((step) => relayStep(entry.participants, step));

export const relayOfRun = (detail: WorkflowInstanceDetailView): RelayStep[] =>
  stepRows(detail).map((row) => {
    const remote =
      row.shown === "current" ? remoteOfStep(detail, row.step.name) : null;
    return {
      ...relayStep(detail.instance.participants, row.step, row.shown),
      ...(row.notice === null ? {} : { blocked: true }),
      ...(remote === null ||
      remote.delivery === null ||
      remote.delivery === "running"
        ? {}
        : { waitingOn: remote.computer }),
      ...(remote?.delivery === "held" ? { heldThere: true } : {}),
    };
  });

export interface RunGroups {
  /** 사람 차례인 run. */
  readonly needsYou: readonly WorkflowInstanceSummaryView[];
  readonly running: readonly WorkflowInstanceSummaryView[];
  /** 끝났거나 멈춘 run. */
  readonly earlier: readonly WorkflowInstanceSummaryView[];
}

/** run 목록을 사람이 볼 순서로 가른다. 받은 순서(새것이 앞)는 묶음 안에서 그대로다. */
export function groupRuns(
  instances: readonly WorkflowInstanceSummaryView[],
): RunGroups {
  const running = instances.filter((item) => item.state === "running");
  return {
    needsYou: running.filter((item) => item.current?.human_turn === true),
    running: running.filter((item) => item.current?.human_turn !== true),
    earlier: instances.filter((item) => item.state !== "running"),
  };
}

/** 그 step을 가장 나중에 받은 session. 아직 아무도 받지 않았으면 null이다. */
export const sessionOfStep = (
  lines: readonly WorkflowLineView[],
  step: string,
): string | null =>
  lines.findLast(
    (line): line is Line<"handed"> =>
      line.kind === "handed" && line.step === step,
  )?.receiver ?? null;

const lastOf = <K extends WorkflowLineView["kind"]>(
  lines: readonly WorkflowLineView[],
  kind: K,
): Line<K> | undefined =>
  lines.findLast((line): line is Line<K> => line.kind === kind);

/**
 * 그 step을 다른 컴퓨터로 넘겼으면 그 컴퓨터와 지금 전달 상태. 이 컴퓨터로 넘긴 step은 null이다.
 * turnEnded는 그 step의 가장 나중 줄이 그 컴퓨터의 lophn이 쓴 줄(가져간 turn이 report 없이 끝남)이라는 것이다.
 */
export function remoteOfStep(
  detail: WorkflowInstanceDetailView,
  step: string,
): { computer: string; delivery: RemoteDelivery; turnEnded: boolean } | null {
  const handed = detail.lines.findLast(
    (line): line is Line<"handed"> =>
      line.kind === "handed" && line.step === step,
  );
  const remote = handed?.remote ?? null;
  if (remote === null) return null;
  const call = detail.remote_steps.find((item) => item.call === remote.call);
  const last = detail.lines.findLast(
    (line) => "step" in line && line.step === step,
  );
  return {
    computer: remote.computer,
    delivery: call?.delivery ?? null,
    turnEnded: last?.by.kind === "remote_lophn",
  };
}

/** 다른 컴퓨터로 넘긴 step의 전달 상태. 끝난 call은 null이다. */
export type RemoteDelivery = WorkflowRemoteStepView["delivery"];

/** run이 지금 어디에 있는가. run 화면 머리의 한 장이 이것을 그린다. */
export type Now =
  /** 사람 차례. session은 같이 이야기할 agent의 대화다(그 agent가 다른 컴퓨터에 있으면 여기에는 없다). */
  | {
      readonly kind: "human";
      readonly step: string;
      readonly who: Who;
      readonly session: string | null;
    }
  | {
      readonly kind: "working";
      readonly step: string;
      readonly who: Who;
      readonly session: string | null;
    }
  /** 다른 컴퓨터의 agent가 맡았다. 받은 session은 그 컴퓨터에 있어 여기서 열지 못한다. */
  | {
      readonly kind: "remote";
      readonly step: string;
      readonly who: Who;
      readonly computer: string;
      readonly delivery: RemoteDelivery;
      /** 그 컴퓨터에서 step을 가져간 turn이 report 없이 끝났다. step은 열려 있다. */
      readonly turnEnded: boolean;
    }
  /** flow의 program이 도는 중이다. */
  | { readonly kind: "program"; readonly step: string }
  /** 넘기지 못했거나 lophn이 다시 켜져 끊겼을 수 있다. session은 말을 걸 만한 agent의 대화다. */
  | {
      readonly kind: "blocked";
      readonly line: Line<"not_handed"> | Line<"lophn_restarted">;
      readonly session: string | null;
    }
  | {
      readonly kind: "ended";
      readonly at: string;
      /** 가장 나중 report. 끝을 알린 글이다. */
      readonly report: Line<"report"> | null;
      readonly exit: Line<"program_exited"> | null;
    }
  | { readonly kind: "stopped"; readonly at: string }
  /** 도는 중인데 아직 아무도 step을 받지 않았다. */
  | { readonly kind: "waiting" };

export function nowOf(detail: WorkflowInstanceDetailView): Now {
  const { instance, lines } = detail;
  if (instance.state === "stopped") {
    return {
      kind: "stopped",
      at:
        lastOf(lines, "stopped")?.at ??
        instance.finished_at ??
        instance.created_at,
    };
  }
  if (instance.state === "ended") {
    return {
      kind: "ended",
      at: instance.finished_at ?? instance.created_at,
      report: lastOf(lines, "report") ?? null,
      exit: lastOf(lines, "program_exited") ?? null,
    };
  }
  // 가장 나중에 넘기려던 결과가 실패나 끊김이면 그 뒤로 아무도 받지 않은 것이다.
  const moved = lines.findLast(
    (line) =>
      line.kind === "handed" ||
      line.kind === "not_handed" ||
      (line.kind === "lophn_restarted" && line.step !== null),
  );
  if (moved?.kind === "not_handed" || moved?.kind === "lophn_restarted") {
    const reported = lines.findLast(
      (line) => line.kind === "report" && line.by.kind === "agent",
    );
    return {
      kind: "blocked",
      line: moved,
      session:
        (moved.kind === "lophn_restarted" ? moved.receiver : null) ??
        (reported?.by.kind === "agent" ? reported.by.session : null),
    };
  }
  const current = instance.current;
  if (current === null) return { kind: "waiting" };
  const turn = turnOf(detail);
  if (turn !== null) {
    return {
      kind: "human",
      step: current.step,
      who: whoOf(instance.participants, turn.participant),
      session: turn.receiver,
    };
  }
  const step = instance.steps.find((item) => item.name === current.step);
  const who = whoOf(instance.participants, step?.by ?? FLOW_STEP_BY);
  if (who.kind === "program") return { kind: "program", step: current.step };
  const remote = remoteOfStep(detail, current.step);
  if (remote !== null) {
    return { kind: "remote", step: current.step, who, ...remote };
  }
  return {
    kind: "working",
    step: current.step,
    who,
    session: sessionOfStep(lines, current.step),
  };
}
