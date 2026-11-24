// workflow 탭이 읽은 값을 화면에 그릴 꼴로 바꾸는 순수 함수와 protocol 값 → message key 표. desktop만 쓰는 것이 여기 있다.
import { formatRelativeTime, type MessageKey, t } from "@lophn/i18n";

import {
  codingBuiltinOf,
  isLophn,
} from "../../../protocol/lophn-agent/workspaces.ts";
import { FLOW_STEP_BY } from "../../../protocol/workflows/values.ts";
import type { SessionDot } from "../parts/agent-session/activity.ts";
import type { AvatarLook } from "../parts/avatar/avatar.tsx";
import { harnessVendorOf } from "../parts/vendor-icon/vendors.ts";
import type {
  WorkflowCheckpointView,
  WorkflowDerivedStatus,
  WorkflowEntryView,
  WorkflowInstanceDetailView,
  WorkflowInstanceSummaryView,
  WorkflowInstanceView,
  WorkflowLineView,
  WorkflowRemoteStepView,
  WorkflowSessionNodeView,
  WorkflowState,
} from "../workspace/source.ts";
import {
  participantText,
  type Shown,
  shownOf,
  STATE_KEY,
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

/** desktop run 화면과 목록이 보이는 상태. 폰과 나누는 Shown에 blocked를 더했다. */
export type DesktopShown = Shown | "blocked";

export const DESKTOP_STATE_KEY: Record<DesktopShown, MessageKey> = {
  ...STATE_KEY,
  blocked: "workflow.label.state-blocked",
};

/** `derived_status`가 있으면 그대로 옮기고, 없으면 저장 상태와 current로 계산한다. */
export function shownOfRun(
  state: WorkflowState,
  current: WorkflowInstanceView["current"],
  derived?: WorkflowDerivedStatus,
): DesktopShown {
  if (state !== "running") return state;
  if (derived === "blocked") return "blocked";
  if (derived === "needs_you") return "human";
  if (derived === "working") return "running";
  return shownOf(state, current);
}

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

/** step이 없는 줄(ended, stopped, program_exited, code_updated, step 없는 edit·lophn_restarted·retried·escalated). run 머리 쪽에 둔다. */
export const headLines = (
  detail: WorkflowInstanceDetailView,
): WorkflowLineView[] =>
  detail.lines.filter(
    (line) =>
      line.kind === "ended" ||
      line.kind === "stopped" ||
      line.kind === "program_exited" ||
      line.kind === "code_updated" ||
      ((line.kind === "edit" ||
        line.kind === "lophn_restarted" ||
        line.kind === "retried" ||
        line.kind === "escalated") &&
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

/** agent의 얼굴. 탭이 agent 목록에서 handle과 agent id 둘 다로 찾아 넘긴다(없으면 handle 글만 보인다). */
export interface WorkflowFace {
  readonly name: string;
  readonly avatar: AvatarLook;
}
export type FaceOf = (handleOrId: string) => WorkflowFace | undefined;

/** 내장 coding agent(handle이 harness id, id가 `coding_<harness>`)의 제품 이름과 아이콘. 아니면 undefined. */
function codingFace(handleOrId: string): WorkflowFace | undefined {
  const coding =
    codingBuiltinOf(handleOrId) ?? codingBuiltinOf(`coding_${handleOrId}`);
  if (coding === null) return undefined;
  const vendor = harnessVendorOf(coding.harness);
  return {
    name: coding.label,
    avatar:
      vendor === undefined
        ? { kind: "initial", text: coding.label.slice(0, 1).toUpperCase() }
        : { kind: "vendor", vendor },
  };
}

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

/** agent 참가자의 얼굴. 이 창의 agent 목록에 없으면(다른 workspace) 내장 coding agent의 제품 얼굴을 쓴다. */
export const agentFace = (
  handle: string,
  faceOf: FaceOf | undefined,
): WorkflowFace | undefined => faceOf?.(handle) ?? codingFace(handle);

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
      const placed =
        who.participant.workspace !== undefined ||
        who.participant.on !== undefined;
      if (!placed) {
        return agentFace(who.handle, faceOf)?.name ?? who.handle;
      }
      // 다른 workspace나 다른 컴퓨터의 agent는 이 창이 아는 얼굴이 아니다. 제품 이름(내장 coding agent)이나 선언에 적힌 이름에 자리를 붙인다.
      return participantText({
        ...who.participant,
        agent: codingFace(who.handle)?.name ?? who.handle,
      });
    }
  }
}

/** session을 돌리는 agent의 얼굴. `coding_antigravity` 같은 id 대신 제품 이름과 아이콘을 보인다. */
export function sessionFace(
  node: Pick<WorkflowSessionNodeView, "agent" | "harness">,
  faceOf: FaceOf | undefined,
): WorkflowFace {
  const known =
    codingFace(node.agent) ??
    faceOf?.(node.agent) ??
    (isLophn(node.agent) ? faceOf?.("lophn") : undefined);
  if (known !== undefined) return known;
  const name = isLophn(node.agent)
    ? t("workflow.label.participant-lophn")
    : node.agent;
  const vendor =
    node.harness === null || node.harness === undefined
      ? undefined
      : harnessVendorOf(node.harness);
  return {
    name,
    avatar:
      vendor === undefined
        ? { kind: "initial", text: name.slice(0, 1).toUpperCase() }
        : { kind: "vendor", vendor },
  };
}

/** 화면에 그리는 step 한 칸. 정의 화면은 `shown`이 없고 run 화면은 그 step의 상태를 싣는다. */
export interface StepCell {
  readonly name: string;
  readonly who: Who;
  /** 사람 step에서 같이 이야기하는 agent. */
  readonly with: Who | null;
  readonly shown?: StepShown;
  /** 이 step으로 넘기지 못했거나 넘긴 것이 끊겼을 수 있다(run 화면만). */
  readonly blocked?: boolean;
  /** 명시적 report 없이 turn이 끝나 멈췄다(run 화면만). */
  readonly stalled?: boolean;
  /** 다른 컴퓨터로 넘겼는데 아직 거기서 돌지 않는다(닿지 않았거나 그 컴퓨터에서 사람을 기다린다). 그 컴퓨터 이름이다. */
  readonly waitingOn?: string;
  /** 늦게 닿아 그 컴퓨터에서 사람의 결정을 기다린다. 사람 차례의 색으로 보인다. */
  readonly heldThere?: boolean;
}

const stepCell = (
  participants: Participants | null,
  step: {
    readonly name: string;
    readonly by: string;
    readonly with: string | null;
  },
  shown?: StepShown,
): StepCell => ({
  name: step.name,
  who: whoOf(participants, step.by),
  with: step.with === null ? null : whoOf(participants, step.with),
  ...(shown === undefined ? {} : { shown }),
});

/** 맡은 쪽 글. 사람 step은 "You, with lophn"다. */
export const assigneeText = (
  step: StepCell,
  faceOf: FaceOf | undefined,
): string =>
  step.with === null
    ? whoName(step.who, faceOf)
    : t("workflow.label.assignee-with", {
        by: whoName(step.who, faceOf),
        with: whoName(step.with, faceOf),
      });

/** 선언의 step. 틀린 선언은 step이 없다. */
export const cellsOfEntry = (entry: WorkflowEntryView): StepCell[] =>
  (entry.steps ?? []).map((step) => stepCell(entry.participants, step));

export const cellsOfRun = (detail: WorkflowInstanceDetailView): StepCell[] =>
  stepRows(detail).map((row) => {
    const remote =
      row.shown === "current" ? remoteOfStep(detail, row.step.name) : null;
    return {
      ...stepCell(detail.instance.participants, row.step, row.shown),
      ...(row.notice === null ? {} : { blocked: true }),
      ...(row.notice?.kind === "step_stalled" ? { stalled: true } : {}),
      ...(remote === null ||
      remote.delivery === null ||
      remote.delivery === "running"
        ? {}
        : { waitingOn: remote.computer }),
      ...(remote?.delivery === "held" ? { heldThere: true } : {}),
    };
  });

/**
 * step을 선언 순서대로 단계로 묶는다(값은 step의 index). 이웃한 step들이 같은 `next`를 가지고 서로에게 넘기지 않으면
 * 한 단계의 선택지다: relay는 한 번에 한 step만 돌아서 그런 step들은 둘 중 하나만 지나간다(예: 조사를 Claude Code가 하거나 Antigravity가 한다).
 */
export function stagesOf(
  steps: readonly {
    readonly name: string;
    readonly next: readonly string[];
  }[],
): number[][] {
  const stages: number[][] = [];
  steps.forEach((step, index) => {
    const stage = stages.at(-1);
    const first = stage === undefined ? undefined : steps[stage[0]];
    const alternative =
      stage !== undefined &&
      first !== undefined &&
      step.next.length > 0 &&
      step.next.length === first.next.length &&
      step.next.every((name) => first.next.includes(name)) &&
      !stage.some((member) => step.next.includes(steps[member].name)) &&
      !first.next.includes(step.name);
    if (alternative) stage.push(index);
    else stages.push([index]);
  });
  return stages;
}

export interface RunGroups {
  /** 사람 차례이거나 판단을 기다리는 run. */
  readonly needsYou: readonly WorkflowInstanceSummaryView[];
  /** stall·넘김 실패·재시작 등으로 막힌 run. */
  readonly blocked: readonly WorkflowInstanceSummaryView[];
  readonly running: readonly WorkflowInstanceSummaryView[];
  /** 끝났거나 멈춘 run. */
  readonly earlier: readonly WorkflowInstanceSummaryView[];
}

export type ActiveWorkflowTone = "working" | "needs_you" | "blocked";

/** 도는 instance 한 개의 계산 상태(working | needs_you | blocked). derived_status가 없으면 줄과 current로 맞춘다. */
export function activeToneOf(
  item: WorkflowInstanceSummaryView,
): ActiveWorkflowTone {
  if (item.derived_status === "needs_you") return "needs_you";
  if (item.derived_status === "blocked") return "blocked";
  if (item.derived_status === "working") return "working";
  if (
    item.last_line?.kind === "not_handed" ||
    item.last_line?.kind === "lophn_restarted" ||
    item.last_line?.kind === "step_stalled" ||
    item.last_line?.kind === "program_exited"
  ) {
    return "blocked";
  }
  if (
    item.current?.human_turn === true ||
    item.last_line?.kind === "escalated"
  ) {
    return "needs_you";
  }
  return "working";
}

/** run 목록을 사람이 볼 순서로 가른다. 받은 순서(새것이 앞)는 묶음 안에서 그대로다. */
export function groupRuns(
  instances: readonly WorkflowInstanceSummaryView[],
): RunGroups {
  const needsYou: WorkflowInstanceSummaryView[] = [];
  const blocked: WorkflowInstanceSummaryView[] = [];
  const running: WorkflowInstanceSummaryView[] = [];
  const earlier: WorkflowInstanceSummaryView[] = [];
  for (const item of instances) {
    if (item.state !== "running") {
      earlier.push(item);
      continue;
    }
    const tone = activeToneOf(item);
    if (tone === "needs_you") needsYou.push(item);
    else if (tone === "blocked") blocked.push(item);
    else running.push(item);
  }
  return { needsYou, blocked, running, earlier };
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
  /** durable flow의 `human()` checkpoint가 사람의 입력을 기다린다. */
  | {
      readonly kind: "human_checkpoint";
      readonly key: string;
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
  /** escalate: 사람의 판단을 기다린다. */
  | {
      readonly kind: "escalated";
      readonly line: Line<"escalated">;
      readonly step: string | null;
      readonly session: string | null;
    }
  /** 넘기지 못했거나 stall·재시작·flow 종료 등으로 막혔다. session은 말을 걸 만한 agent의 대화다. */
  | {
      readonly kind: "blocked";
      readonly line:
        | Line<"not_handed">
        | Line<"lophn_restarted">
        | Line<"step_stalled">
        | Line<"program_exited">
        | null;
      readonly step: string | null;
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

/** 사람의 입력을 기다리며 열려 있는 가장 나중 `human` checkpoint. 없으면 null이다. */
export function activeHumanCheckpoint(
  detail: WorkflowInstanceDetailView,
): WorkflowCheckpointView | null {
  const checkpoints = detail.checkpoints;
  if (checkpoints === undefined || checkpoints.length === 0) return null;
  return (
    checkpoints.findLast(
      (checkpoint) =>
        checkpoint.kind === "human" && checkpoint.state === "started",
    ) ?? null
  );
}

/** 이 instance가 flow 실행을 가지는가(code_snapshot 또는 flow 종료·중단 줄·interrupted checkpoint). */
export function hasFlowExecution(detail: WorkflowInstanceDetailView): boolean {
  const { instance, lines, checkpoints } = detail;
  if (
    typeof instance.code_snapshot === "string" &&
    instance.code_snapshot.length > 0
  ) {
    return true;
  }
  if (
    lines.some(
      (line) =>
        line.kind === "program_exited" ||
        (line.kind === "lophn_restarted" && line.step === null),
    )
  ) {
    return true;
  }
  return (
    checkpoints?.some((checkpoint) => checkpoint.state === "interrupted") ===
    true
  );
}

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
  const reportedAgentSession = () => {
    const reported = lines.findLast(
      (line) => line.kind === "report" && line.by.kind === "agent",
    );
    return reported?.by.kind === "agent" ? reported.by.session : null;
  };
  // 가장 나중 전이가 실패·끊김·stall·escalate·flow 종료이면 그 뒤로 다시 넘기거나 retry·code 갱신을 하지 않은 것이다.
  const moved = lines.findLast(
    (line) =>
      line.kind === "handed" ||
      line.kind === "not_handed" ||
      line.kind === "step_stalled" ||
      line.kind === "retried" ||
      line.kind === "escalated" ||
      line.kind === "code_updated" ||
      line.kind === "program_exited" ||
      line.kind === "lophn_restarted",
  );
  if (
    moved?.kind === "not_handed" ||
    moved?.kind === "step_stalled" ||
    (moved?.kind === "lophn_restarted" && moved.step !== null)
  ) {
    const direct =
      moved.kind === "step_stalled"
        ? moved.session
        : moved.kind === "lophn_restarted"
          ? moved.receiver
          : null;
    return {
      kind: "blocked",
      line: moved,
      step: moved.step,
      session:
        direct ??
        (moved.step === null ? null : sessionOfStep(lines, moved.step)) ??
        reportedAgentSession(),
    };
  }
  if (
    (moved?.kind === "program_exited" ||
      (moved?.kind === "lophn_restarted" && moved.step === null)) &&
    detail.derived_status !== "working" &&
    detail.derived_status !== "needs_you"
  ) {
    const step =
      moved.kind === "lophn_restarted"
        ? moved.step
        : (instance.current?.step ?? null);
    return {
      kind: "blocked",
      line: moved,
      step,
      session:
        (step === null ? null : sessionOfStep(lines, step)) ??
        reportedAgentSession(),
    };
  }
  if (moved?.kind === "escalated") {
    return {
      kind: "escalated",
      line: moved,
      step: moved.step,
      session:
        (moved.step === null ? null : sessionOfStep(lines, moved.step)) ??
        reportedAgentSession(),
    };
  }
  if (detail.derived_status === "blocked") {
    const step = instance.current?.step ?? null;
    const flowLine = hasFlowExecution(detail)
      ? (lines.findLast(
          (line): line is Line<"program_exited"> | Line<"lophn_restarted"> =>
            line.kind === "program_exited" ||
            (line.kind === "lophn_restarted" && line.step === null),
        ) ?? null)
      : null;
    return {
      kind: "blocked",
      line: flowLine,
      step,
      session:
        (step === null ? null : sessionOfStep(lines, step)) ??
        reportedAgentSession(),
    };
  }
  const current = instance.current;
  const turn = turnOf(detail);
  if (turn !== null && current !== null) {
    return {
      kind: "human",
      step: current.step,
      who: whoOf(instance.participants, turn.participant),
      session: turn.receiver,
    };
  }
  const humanCheckpoint = activeHumanCheckpoint(detail);
  if (
    humanCheckpoint !== null &&
    (detail.derived_status === "needs_you" || current === null)
  ) {
    return {
      kind: "human_checkpoint",
      key: humanCheckpoint.key,
      session: humanCheckpoint.handle_ref,
    };
  }
  if (current === null) return { kind: "waiting" };
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

/** [Resume] / [Resume with updated code] 단추를 보일 조건. 도는 중이고 blocked이며 flow 실행을 가진다. */
export function canResume(
  detail: WorkflowInstanceDetailView,
  now: Now,
): boolean {
  return (
    detail.instance.state === "running" &&
    (detail.derived_status === "blocked" || now.kind === "blocked") &&
    hasFlowExecution(detail)
  );
}

/** [Retry] 단추를 보일 조건. 도는 중이고 derived_status가 blocked이거나 지금 상태가 blocked다. */
export function canRetry(
  detail: WorkflowInstanceDetailView,
  now: Now,
): boolean {
  if (
    detail.instance.state !== "running" ||
    (detail.derived_status !== "blocked" && now.kind !== "blocked")
  ) {
    return false;
  }
  // flow가 step 없이 process 종료·중단으로 막힌 경우는 [Resume]만 쓴다.
  if (
    hasFlowExecution(detail) &&
    detail.instance.current === null &&
    (now.kind !== "blocked" || now.step === null)
  ) {
    return false;
  }
  return true;
}

/** session tree 한 줄의 상태 점. */
export type SessionNodeStatus = "running" | "waiting" | "idle" | "failed";

export interface SessionTreeRow {
  readonly node: WorkflowSessionNodeView;
  readonly depth: number;
  readonly status: SessionNodeStatus;
}

export interface SessionSummary {
  readonly total: number;
  readonly done: number;
  readonly running: number;
  readonly waiting: number;
  readonly failed: number;
}

/** session node 한 개의 live 상태. 창이 아는 dot이 있으면 더 빠른 live 상태를 반영한다. */
export function sessionNodeStatus(
  node: WorkflowSessionNodeView,
  dotOf?: (session: string) => SessionDot | null,
): SessionNodeStatus {
  const dot = dotOf?.(node.session) ?? null;
  if (
    node.state === "waiting" ||
    node.waiting_for !== null ||
    dot === "waiting"
  ) {
    return "waiting";
  }
  if (node.state === "running" || dot === "working") return "running";
  if (node.last_error !== null) return "failed";
  return "idle";
}

/** `sessions` 평면 목록을 parent(`spawned_by`) 기준 pre-order tree 줄로 푼다. 순환이나 빠진 부모에도 안전하다. */
export function buildSessionTree(
  sessions: readonly WorkflowSessionNodeView[] | undefined,
  dotOf?: (session: string) => SessionDot | null,
): SessionTreeRow[] {
  if (sessions === undefined || sessions.length === 0) return [];
  const byId = new Map(sessions.map((node) => [node.session, node]));
  const children = new Map<string, WorkflowSessionNodeView[]>();
  const roots: WorkflowSessionNodeView[] = [];
  for (const node of sessions) {
    if (
      node.parent !== null &&
      node.parent !== node.session &&
      byId.has(node.parent)
    ) {
      const list = children.get(node.parent);
      if (list === undefined) children.set(node.parent, [node]);
      else list.push(node);
    } else {
      roots.push(node);
    }
  }
  const rows: SessionTreeRow[] = [];
  const visited = new Set<string>();
  const walk = (node: WorkflowSessionNodeView, depth: number) => {
    if (visited.has(node.session)) return;
    visited.add(node.session);
    rows.push({ node, depth, status: sessionNodeStatus(node, dotOf) });
    for (const child of children.get(node.session) ?? []) {
      walk(child, depth + 1);
    }
  };
  for (const root of roots) walk(root, 0);
  // 순환에 갇힌 노드가 남아 있으면 root로 덧붙여 누락을 막는다.
  for (const node of sessions) walk(node, 0);
  return rows;
}

export function summarizeSessions(
  rows: readonly SessionTreeRow[],
): SessionSummary {
  let done = 0;
  let running = 0;
  let waiting = 0;
  let failed = 0;
  for (const row of rows) {
    if (row.status === "running") running += 1;
    else if (row.status === "waiting") waiting += 1;
    else if (row.status === "failed") failed += 1;
    else done += 1;
  }
  return { total: rows.length, done, running, waiting, failed };
}

/**
 * session을 step마다 가른다. session은 `workflow_origin.step`(가장 나중에 받은 step, 자식은 태어난 때 부모의 step)과
 * 그 session에 넘긴 줄(handed)의 step에 붙는다. 어느 것도 없으면 부모를 따르고, 선언에 없는 step이면 `rest`다.
 */
export function sessionsByStep(detail: WorkflowInstanceDetailView): {
  readonly byStep: ReadonlyMap<string, readonly WorkflowSessionNodeView[]>;
  readonly rest: readonly WorkflowSessionNodeView[];
} {
  const sessions = detail.sessions ?? [];
  const declared = new Set(detail.instance.steps.map((step) => step.name));
  const byId = new Map(sessions.map((node) => [node.session, node]));
  const own = new Map<string, Set<string>>();
  for (const node of sessions) {
    const steps = new Set<string>();
    if (typeof node.step === "string" && declared.has(node.step)) {
      steps.add(node.step);
    }
    own.set(node.session, steps);
  }
  for (const line of detail.lines) {
    if (line.kind !== "handed" || line.receiver === null) continue;
    if (declared.has(line.step)) own.get(line.receiver)?.add(line.step);
  }
  const stepsOf = (node: WorkflowSessionNodeView): ReadonlySet<string> => {
    const seen = new Set<string>();
    let at: WorkflowSessionNodeView | undefined = node;
    while (at !== undefined && !seen.has(at.session)) {
      seen.add(at.session);
      const steps = own.get(at.session);
      if (steps !== undefined && steps.size > 0) return steps;
      at = at.parent === null ? undefined : byId.get(at.parent);
    }
    return new Set();
  };
  const byStep = new Map<string, WorkflowSessionNodeView[]>();
  const rest: WorkflowSessionNodeView[] = [];
  for (const node of sessions) {
    const steps = stepsOf(node);
    if (steps.size === 0) rest.push(node);
    for (const step of steps) {
      const list = byStep.get(step);
      if (list === undefined) byStep.set(step, [node]);
      else list.push(node);
    }
  }
  return { byStep, rest };
}

/** 그 step의 report들이 적은 산출물 경로. 중복 없이 낸 순서대로다. */
export function refsOfStep(
  lines: readonly WorkflowLineView[],
  step: string,
): string[] {
  const seen = new Set<string>();
  for (const line of lines) {
    if (line.kind !== "report" || line.step !== step) continue;
    for (const path of line.refs ?? []) {
      const trimmed = path.trim();
      if (trimmed !== "") seen.add(trimmed);
    }
  }
  return [...seen];
}

/** 예: "4/6 done · 1 running · 1 failed" */
export function sessionSummaryText(summary: SessionSummary): string {
  const parts = [
    t("workflow.label.session-done", {
      done: summary.done,
      total: summary.total,
    }),
  ];
  if (summary.running > 0) {
    parts.push(t("workflow.label.session-running", { count: summary.running }));
  }
  if (summary.waiting > 0) {
    parts.push(t("workflow.label.session-waiting", { count: summary.waiting }));
  }
  if (summary.failed > 0) {
    parts.push(t("workflow.label.session-failed", { count: summary.failed }));
  }
  return parts.join(" · ");
}

/** 마지막 assistant 텍스트를 한 줄 평문으로 정리하고 최대 max자(기본 160자)로 자른다. */
export function previewText(
  text: string | null | undefined,
  max = 160,
): string | null {
  if (text === null || text === undefined) return null;
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat === "") return null;
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/** instance의 명시적 산출물 경로 목록. `detail.refs`가 없으면 report 줄의 `refs`에서 모은다. */
export function refsOf(detail: WorkflowInstanceDetailView): string[] {
  const raw =
    detail.refs !== undefined
      ? detail.refs
      : detail.lines.flatMap((line) =>
          line.kind === "report" && line.refs !== undefined ? line.refs : [],
        );
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of raw) {
    const trimmed = path.trim();
    if (trimmed === "" || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

const TONE_PRIORITY: Record<ActiveWorkflowTone, number> = {
  needs_you: 3,
  blocked: 2,
  working: 1,
};

const DESK_TONE_KEY: Record<ActiveWorkflowTone, MessageKey> = {
  needs_you: "workflow.label.desk-needs-you",
  blocked: "workflow.label.desk-blocked",
  working: "workflow.label.desk-running",
};

/**
 * title bar DeskSwitcher의 workflow desk 줄에 실을 진행 상태(글과 색).
 * 도는 run이 없으면 undefined다. 여럿 돌면 needs_you > blocked > working 순으로 앞세운다.
 */
export function workflowDeskStatus(
  workflow: string,
  instances: readonly WorkflowInstanceSummaryView[],
): { readonly status: string; readonly tone: ActiveWorkflowTone } | undefined {
  const active = instances.filter(
    (item) => item.workflow === workflow && item.state === "running",
  );
  if (active.length === 0) return undefined;
  let top = active[0];
  let topTone = activeToneOf(top);
  for (const item of active.slice(1)) {
    const tone = activeToneOf(item);
    if (TONE_PRIORITY[tone] > TONE_PRIORITY[topTone]) {
      top = item;
      topTone = tone;
    }
  }
  const toneLabel = t(DESK_TONE_KEY[topTone]);
  if (active.length === 1) {
    const step = top.current?.step;
    return {
      tone: topTone,
      status:
        step === undefined
          ? toneLabel
          : t("workflow.label.desk-step-status", { step, status: toneLabel }),
    };
  }
  return {
    tone: topTone,
    status:
      topTone === "working"
        ? t("workflow.label.running-count", { count: active.length })
        : t("workflow.label.desk-multi-status", {
            count: active.length,
            status: toneLabel,
          }),
  };
}

/** workflow 선언 problem을 화면 글로 정리한다. `invalid_inputs`와 `broken_flow`는 이유 머릿말을 덧붙인다. */
export function workflowProblemText(
  problem: NonNullable<WorkflowEntryView["problem"]>,
): string {
  if (problem.reason === "invalid_inputs") {
    const title = t("workflow.note.problem-invalid-inputs");
    return problem.message.trim() === ""
      ? title
      : `${title}: ${problem.message}`;
  }
  if (problem.reason === "broken_flow") {
    const title = t("workflow.note.problem-broken-flow");
    return problem.message.trim() === ""
      ? title
      : `${title}: ${problem.message}`;
  }
  return problem.message;
}

export interface RunInputRow {
  readonly key: string;
  readonly value: string;
}

/** run이 받은 선언적 input 값을 읽기 전용 요약 글로 바꾼다. */
export function formatInputValue(value: unknown): string {
  if (typeof value === "boolean") {
    return t(value ? "workflow.label.input-yes" : "workflow.label.input-no");
  }
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(formatInputValue).join(", ");
  if (value === null || value === undefined) return "";
  return JSON.stringify(value);
}

/** run detail에 담긴 선언적 inputs 요약 행. 없거나 비었으면 빈 배열이다. */
export function runInputsOf(detail: WorkflowInstanceDetailView): RunInputRow[] {
  const inputs = detail.inputs ?? detail.instance.inputs;
  if (inputs === undefined) return [];
  return Object.entries(inputs).map(([key, value]) => ({
    key,
    value: formatInputValue(value),
  }));
}
