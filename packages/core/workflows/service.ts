import { Buffer } from "node:buffer";
import { z } from "zod";
import {
  type Clock,
  err,
  type IdSource,
  type Logger,
  ok,
  type Result,
} from "../../base/mod.ts";
import type { Id, JsonValue } from "../../protocol/base/mod.ts";
import type { Mail } from "../../protocol/lophn-agent/mail.ts";
import {
  type AgentAddress,
  type AgentRuntime,
  agentHandleKey,
  blocksText,
  CODING_BUILTINS,
  DEFAULT_PERMISSION_MODE,
  HARNESS_RUNTIMES,
  isHarnessRuntime,
  LOPHN_AGENT_HANDLE,
  minPermissionMode,
  type PermissionMode,
  permissionModeSchema,
  type TurnOutcome,
} from "../../protocol/lophn-agent/mod.ts";
import type { Input, Output } from "../../protocol/server/mod.ts";
import {
  type FlowAgentMode,
  type HandoffPlan,
  type LineBy,
  type ReportLine,
  type SessionChoice,
  type SessionOpenMode,
  type StartedBy,
  validateWorkflowInputs,
  WORKFLOW_DECLARATION_FILE,
  WORKFLOW_FLOW_FILE,
  type WorkflowCheckpoint,
  type WorkflowExportFile,
  type WorkflowSoftOutput,
  type WorkflowTitleRequest,
  type workflowCheckpointUpsert,
  type workflowDelete,
  type workflowEdit,
  type workflowExport,
  type workflowImport,
  type workflowInstanceApply,
  type workflowInstanceRead,
  type workflowList,
  type workflowOverrideCode,
  type workflowRename,
  type workflowReport,
  type workflowResume,
  type workflowRetry,
  type workflowRun,
  type workflowSave,
  type workflowSetDefaults,
  type workflowStart,
  type workflowStop,
} from "../../protocol/workflows/mod.ts";
import {
  type AgentHandOffInput,
  type AgentPrimitivePorts,
  type AgentReportEvent,
  runAgentPrimitive,
  type WorkflowOutcome,
} from "./agent-primitive.ts";
import { checkpointToOutcome } from "./checkpoints.ts";
import {
  DEFAULT_FLOW_SDK_INFO,
  entryOf,
  flowStepsOf,
  parseDeclaration,
  participantsOf,
  patchWorkflowDeclarationYaml,
  stepsOf,
} from "./declaration.ts";
import {
  applyRunOverrides,
  buildOneOffApprovalLines,
  buildOverrideApprovalLines,
  buildOverrideCodeApprovalLines,
  hasFlowEntryFile,
  normalizeInlineSteps,
  serializeInstanceToYaml,
  summarizeFileChanges,
} from "./oneoff-override.ts";
import {
  activeStepsOf,
  evaluateParallelTransition,
  insertStepsInto,
  reportTargetsOf,
} from "./parallel.ts";
import { planHandoff, retryContinueBody } from "./plan.ts";
import type {
  FlowSdkInfo,
  WorkflowAgents,
  WorkflowFiles,
  WorkflowFlowChecker,
  WorkflowFlows,
  WorkflowLifecycle,
  WorkflowPermissionModes,
  WorkflowProjects,
  WorkflowRemote,
  WorkflowRunApprover,
  WorkflowSnapshots,
  WorkflowStore,
  WorkflowTurns,
} from "./ports.ts";
import { deriveWorkflowStatus } from "./reads.ts";
import { remoteTurnEndedText } from "./remote.ts";
import { mergeWorkflowFiles } from "./snapshot.ts";
import { STATUS_LINE_KINDS, type StatusLineKind } from "./store.ts";
import { autoWorkflowTitle, renameWorkflowTitle } from "./title-schema.ts";
import {
  parentPermissionCeiling,
  runSubWorkflowCall,
  type SubWorkflowRequest,
} from "./workflow-call.ts";
import {
  isFlowInstance,
  recordYamlCancelCheckpoint,
  recordYamlHandoffCheckpoint,
  recordYamlReportCheckpoint,
  recordYamlRetryCheckpoint,
} from "./yaml-interpreter.ts";

type State = Output<typeof workflowInstanceRead>;
type ApplyInput = Input<typeof workflowInstanceApply>;

const STATUS_KIND_SET: ReadonlySet<string> = new Set(STATUS_LINE_KINDS);

const fail = (
  code: "invalid_input" | "not_found" | "conflict" | "unavailable",
  message: string,
): Result<never> => err({ code, message });

function abortMessage(signal: AbortSignal): string {
  const reason: unknown = signal.reason;
  if (reason instanceof Error && reason.message !== "") return reason.message;
  if (typeof reason === "string" && reason !== "") return reason;
  return "cancelled";
}

// 그 참가자가 이 instance에서 마지막으로 step 메시지를 받은 session이다. 다른 컴퓨터로 넘겼으면 그 컴퓨터에서 받은 session(알면)이다.
function sameSessionIn(state: Pick<State, "lines" | "remote_steps">) {
  return (participant: string): Id<"ses"> | null => {
    const line = state.lines.findLast(
      (l) => l.kind === "handed" && l.participant === participant,
    );
    if (line?.kind !== "handed") return null;
    if (line.receiver !== null) return line.receiver as Id<"ses">;
    const call = line.remote?.call;
    const sent = state.remote_steps.find((each) => each.call === call);
    return (sent?.session ?? null) as Id<"ses"> | null;
  };
}

function latestStatusKindFromLines(
  lines: State["lines"],
): StatusLineKind | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const kind = lines[i]!.kind;
    if (STATUS_KIND_SET.has(kind)) return kind as StatusLineKind;
  }
  return null;
}

// 이 session이 지금 도는 non-human step의 담당이며, 이번 넘김/retry 시도에서 아직 완료 report도
// stall/restart 기록도 없을 때 그 step 이름을 돌려준다. 사람 step은 대화가 turn 끝으로 멈추지 않으므로 제외한다.
function stalledStepFor(state: State, session: Id<"ses">): string | null {
  const { instance, lines } = state;
  if (instance.state !== "running") return null;
  const activeNonHuman = new Set(
    activeStepsOf(instance)
      .filter((a) => !a.human_turn)
      .map((a) => a.step),
  );
  if (activeNonHuman.size === 0) return null;
  const handedAt = lines.findLastIndex(
    (l) =>
      l.kind === "handed" &&
      l.receiver === session &&
      !l.human_turn &&
      activeNonHuman.has(l.step),
  );
  if (handedAt < 0) return null;
  const handed = lines[handedAt];
  if (handed?.kind !== "handed") return null;
  // 같은 넘김(handed) 뒤에 사람이 retry로 이어 갔으면 그 retried를 새 시도로 본다.
  let attemptAt = handedAt;
  for (let i = lines.length - 1; i > handedAt; i--) {
    const line = lines[i]!;
    if (line.kind === "retried" && line.step === handed.step) {
      attemptAt = i;
      break;
    }
  }
  const afterAttempt = lines.slice(attemptAt + 1);
  const resolved = afterAttempt.some(
    (l) =>
      (l.kind === "report" &&
        l.step === handed.step &&
        reportTargetsOf(l).length > 0) ||
      (l.kind === "not_handed" && l.step === handed.step) ||
      (l.kind === "step_stalled" && l.step === handed.step) ||
      (l.kind === "lophn_restarted" && l.step === handed.step),
  );
  return resolved ? null : handed.step;
}

// 이 session이 step_stalled 또는 lophn_restarted로 막힌 non-human step의 담당이고,
// 아직 retried/report/handed 등으로 풀리지 않았으면 그 step 이름을 돌려준다.
function stalledToResumeFor(state: State, session: Id<"ses">): string | null {
  const { instance, lines } = state;
  if (instance.state !== "running") return null;
  const activeHuman = new Set(
    activeStepsOf(instance)
      .filter((a) => a.human_turn)
      .map((a) => a.step),
  );
  const settledSteps = new Set<string>();
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (line.kind === "retried" && line.session === session) return null;
    if (line.kind === "handed" && line.receiver === session) return null;
    if (line.kind === "report") {
      if (
        (line.by.kind === "agent" && line.by.session === session) ||
        reportTargetsOf(line).length > 0
      ) {
        settledSteps.add(line.step);
      }
      continue;
    }
    if (line.kind === "not_handed") {
      settledSteps.add(line.step);
      continue;
    }
    if (line.kind === "step_stalled" && line.session === session) {
      if (settledSteps.has(line.step)) return null;
      if (activeHuman.has(line.step)) return null;
      return line.step;
    }
    if (
      line.kind === "lophn_restarted" &&
      line.receiver === session &&
      line.step !== null
    ) {
      if (settledSteps.has(line.step)) return null;
      if (activeHuman.has(line.step)) return null;
      return line.step;
    }
  }
  return null;
}

type RetryTarget =
  | { mode: "re_handoff"; step: string }
  | {
      mode: "same_session";
      step: string;
      session: Id<"ses">;
      blockedByLine: boolean;
    };

function retryTargetOf(
  state: State,
  explicitStep: string | undefined,
): Result<RetryTarget> {
  const { instance, lines } = state;
  if (instance.state !== "running") {
    return fail("conflict", `workflow instance is ${instance.state}`);
  }
  const active = activeStepsOf(instance);
  let step: string;
  if (explicitStep !== undefined) {
    const known =
      instance.steps.some((s) => s.name === explicitStep) ||
      lines.some(
        (l) =>
          (l.kind === "handed" || l.kind === "not_handed") &&
          l.step === explicitStep,
      );
    if (!known) return fail("not_found", "step not found");
    step = explicitStep;
  } else {
    const lastProgressAt = lines.findLastIndex(
      (l) =>
        l.kind === "handed" ||
        l.kind === "not_handed" ||
        l.kind === "retried" ||
        (l.kind === "report" && reportTargetsOf(l).length > 0),
    );
    const lastProgress = lines[lastProgressAt];
    if (lastProgress?.kind === "not_handed") {
      step = lastProgress.step;
    } else if (active.length > 0) {
      // 병렬 활성 step 중 막힌(step_stalled / lophn_restarted) step이 있으면 그것을 우선 고른다.
      const blockedActive = active.find((a) => {
        const lastForStep = lines.findLast(
          (l) => "step" in l && l.step === a.step,
        );
        return (
          lastForStep?.kind === "step_stalled" ||
          lastForStep?.kind === "lophn_restarted"
        );
      });
      step = blockedActive?.step ?? active[0]!.step;
    } else {
      return fail("conflict", "workflow instance has no active step to retry");
    }
  }

  // session이 아직 열리지 않았거나(not_handed) 원격 step 실패로 not_handed가 최신이면 넘기기를 다시 시도한다.
  const lastNotHandedAt = lines.findLastIndex(
    (l) => l.kind === "not_handed" && l.step === step,
  );
  if (lastNotHandedAt >= 0) {
    const afterNotHanded = lines.slice(lastNotHandedAt + 1);
    const movedOn = afterNotHanded.some(
      (l) =>
        (l.kind === "handed" && l.step === step) ||
        (l.kind === "report" &&
          l.step === step &&
          reportTargetsOf(l).length > 0),
    );
    if (!movedOn) {
      return ok({ mode: "re_handoff", step });
    }
  }

  // 이미 local session으로 넘긴 활성 step: 기록된 같은 session에 이어서 하라는 입력을 넣는다.
  const handedAt = lines.findLastIndex(
    (l) => l.kind === "handed" && l.step === step,
  );
  const handed = lines[handedAt];
  if (
    handed?.kind !== "handed" ||
    handed.receiver === null ||
    !active.some((a) => a.step === step)
  ) {
    return fail("conflict", "workflow step is not blocked");
  }
  const afterHanded = lines.slice(handedAt + 1);
  if (
    afterHanded.some(
      (l) =>
        (l.kind === "report" &&
          l.step === step &&
          reportTargetsOf(l).length > 0) ||
        (l.kind === "not_handed" && l.step === step),
    )
  ) {
    return fail("conflict", "workflow step already moved on");
  }
  let attemptAt = handedAt;
  for (let i = lines.length - 1; i > handedAt; i--) {
    const line = lines[i]!;
    if (line.kind === "retried" && line.step === step) {
      attemptAt = i;
      break;
    }
  }
  const afterAttempt = lines.slice(attemptAt + 1);
  const blockedByCheckpoint = (state.checkpoints ?? []).some(
    (cp) =>
      (cp.key === step || cp.key.startsWith(`${step}#`)) &&
      cp.state === "interrupted",
  );
  const blockedByLine =
    blockedByCheckpoint ||
    afterAttempt.some(
      (l) =>
        (l.kind === "step_stalled" || l.kind === "lophn_restarted") &&
        l.step === step,
    );
  return ok({
    mode: "same_session",
    step,
    session: handed.receiver as Id<"ses">,
    blockedByLine,
  });
}

export type RunAgentCallRequest = {
  instance: Id<"wfi">;
  step: string;
  key: string;
  participant?: string;
  agent?: AgentAddress;
  mode?: FlowAgentMode;
  prompt: string;
  input?: JsonValue;
  schema?: Record<string, JsonValue>;
  session?: SessionChoice | Id<"ses">;
  open?: SessionOpenMode;
  on?: string;
  signal?: AbortSignal;
};

export type RunHumanStepRequest = {
  instance: Id<"wfi">;
  step: string;
  key: string;
  participant?: string;
  with?: AgentAddress;
  prompt: string;
  input?: JsonValue;
  session?: SessionChoice | Id<"ses">;
  open?: SessionOpenMode;
  signal?: AbortSignal;
};

export function createWorkflowService(
  deps: {
    files: WorkflowFiles;
    projects: WorkflowProjects;
    agents?: WorkflowAgents;
    turns: WorkflowTurns;
    store: WorkflowStore;
    flows: WorkflowFlows;
    remote: WorkflowRemote;
    snapshots?: WorkflowSnapshots;
    flowChecker?: WorkflowFlowChecker;
    lifecycle?: WorkflowLifecycle;
    agentPorts?: AgentPrimitivePorts;
    onTitleNeeded?: (request: WorkflowTitleRequest) => void;
    clock?: Clock;
    ids: IdSource;
    logger: Logger;
  } & WorkflowPermissionModes,
) {
  const {
    files,
    projects,
    agents,
    turns,
    store,
    flows,
    remote,
    snapshots,
    flowChecker,
    lifecycle,
    rememberedModesOf,
    agentDefaultModeOf,
    globalDefaultMode,
    isHarnessAgent,
    onTitleNeeded,
    ids,
    logger,
  } = deps;
  let agentPorts = deps.agentPorts;

  // in-process 알림 hub: workflow.report 도착과 instance 상태 전이를 runAgentCall·runHumanStep·runSubWorkflow에 즉시 알린다.
  const reportListeners = new Set<(event: AgentReportEvent) => void>();
  const instanceUpdateListeners = new Map<string, Set<() => void>>();
  // 실행 중인 durable primitive의 AbortController와 session을 instance별로 추적해 StopWorkflow 시 즉시 취소한다.
  const activeControllers = new Map<string, Set<AbortController>>();
  const activeSessions = new Map<string, Set<Id<"ses">>>();

  function subscribeReports(fn: (event: AgentReportEvent) => void): () => void {
    reportListeners.add(fn);
    return () => {
      reportListeners.delete(fn);
    };
  }

  function emitReport(event: AgentReportEvent): void {
    for (const fn of [...reportListeners]) {
      try {
        fn(event);
      } catch {
        // 개별 listener 오류가 report 기록을 막지 않는다.
      }
    }
  }

  function subscribeInstanceUpdated(
    instance: Id<"wfi">,
    fn: () => void,
  ): () => void {
    let set = instanceUpdateListeners.get(instance);
    if (set === undefined) {
      set = new Set();
      instanceUpdateListeners.set(instance, set);
    }
    set.add(fn);
    return () => {
      const current = instanceUpdateListeners.get(instance);
      if (current !== undefined) {
        current.delete(fn);
        if (current.size === 0) instanceUpdateListeners.delete(instance);
      }
    };
  }

  function notifyInstanceUpdated(instance: string): void {
    const set = instanceUpdateListeners.get(instance);
    if (set === undefined) return;
    for (const fn of [...set]) {
      try {
        fn();
      } catch {
        // ignore
      }
    }
  }

  function trackController(
    instance: string,
    outerSignal?: AbortSignal,
  ): { controller: AbortController; release: () => void } {
    const controller = new AbortController();
    let set = activeControllers.get(instance);
    if (set === undefined) {
      set = new Set();
      activeControllers.set(instance, set);
    }
    set.add(controller);
    const onOuterAbort = () => {
      if (!controller.signal.aborted) {
        controller.abort(outerSignal?.reason ?? "cancelled");
      }
    };
    if (outerSignal !== undefined) {
      if (outerSignal.aborted) {
        controller.abort(outerSignal.reason ?? "cancelled");
      } else {
        outerSignal.addEventListener("abort", onOuterAbort, { once: true });
      }
    }
    return {
      controller,
      release() {
        outerSignal?.removeEventListener("abort", onOuterAbort);
        const cur = activeControllers.get(instance);
        if (cur !== undefined) {
          cur.delete(controller);
          if (cur.size === 0) activeControllers.delete(instance);
        }
      },
    };
  }

  function trackSession(instance: string, session: Id<"ses">): () => void {
    let set = activeSessions.get(instance);
    if (set === undefined) {
      set = new Set();
      activeSessions.set(instance, set);
    }
    set.add(session);
    return () => {
      const cur = activeSessions.get(instance);
      if (cur !== undefined) {
        cur.delete(session);
        if (cur.size === 0) activeSessions.delete(instance);
      }
    };
  }

  const skip = (id: string, code: string): void => {
    logger.warn({
      component: "workflows",
      event: "skipped",
      fields: { instance: id, code },
    });
  };

  // 상태를 읽어 command 입력을 만들고 state_seq로 건다. conflict면 다시 읽어 state_seq가 바뀌었을 때만
  // 최대 8번 건다(Promise.all 병렬 agent() handoff 경합 허용). 안 바뀌었으면 진짜 conflict다.
  async function apply(
    instance: string,
    make: (state: State) => Result<ApplyInput>,
  ): Promise<Result<Output<typeof workflowInstanceApply>>> {
    let seen: string | null = null;
    let last: Result<never> | null = null;
    for (let attempt = 0; ; attempt++) {
      const read = await store.read(instance as Id<"wfi">);
      if (!read.ok) return read;
      const state = read.value;
      if (seen === state.instance.state_seq) return last!;
      const input = make(state);
      if (!input.ok) return input;
      const done = await store.apply(input.value, {
        state_seq: state.instance.state_seq,
      });
      if (done.ok) {
        notifyInstanceUpdated(instance);
        return done;
      }
      if (done.error.code !== "conflict" || attempt >= 7) {
        return done;
      }
      seen = state.instance.state_seq;
      last = done;
    }
  }

  async function upsertCheckpoint(
    input: Input<typeof workflowCheckpointUpsert>,
  ): Promise<Result<Output<typeof workflowCheckpointUpsert>>> {
    if (store.upsertCheckpoint === undefined) {
      return fail("unavailable", "workflow checkpoints are not configured");
    }
    return await store.upsertCheckpoint(input);
  }

  async function loadCheckpointsOf(
    instance: Id<"wfi">,
  ): Promise<Result<WorkflowCheckpoint[]>> {
    if (store.checkpoints !== undefined) {
      return await store.checkpoints(instance);
    }
    const read = await store.read(instance);
    return read.ok ? ok(read.value.checkpoints ?? []) : read;
  }

  async function resolveFlowAgentName(
    project: Id<"prj">,
    workflow: string,
    storedFlowAgent?: string | null,
  ): Promise<string> {
    if (
      storedFlowAgent !== undefined &&
      storedFlowAgent !== null &&
      storedFlowAgent !== ""
    ) {
      return storedFlowAgent;
    }
    if (files === undefined || typeof files.list !== "function") {
      return LOPHN_AGENT_HANDLE;
    }
    const listed = await files.list(project);
    if (!listed.ok) return LOPHN_AGENT_HANDLE;
    const file = listed.value.find((f) => f.name === workflow);
    if (file === undefined) return LOPHN_AGENT_HANDLE;
    const parsed = parseDeclaration(file);
    return parsed.ok
      ? (parsed.declaration.agent ?? LOPHN_AGENT_HANDLE)
      : LOPHN_AGENT_HANDLE;
  }

  async function wasSessionInterruptedOnRestart(
    session: Id<"ses">,
    instance: Id<"wfi">,
    step: string,
  ): Promise<boolean> {
    if (turns.lastTurn !== undefined) {
      const last = await turns.lastTurn(session);
      if (last.ok && last.value !== null) {
        if (
          last.value.outcome?.kind === "interrupted" &&
          last.value.outcome.reason === "restarted"
        ) {
          return true;
        }
      }
    }
    if (typeof turns.stepTurn === "function") {
      const found = await turns.stepTurn(session, instance, step);
      if (found.ok && found.value !== null) {
        const turn = found.value;
        if (
          turn.turn === null ||
          (turn.outcome?.kind === "interrupted" &&
            turn.outcome.reason === "restarted")
        ) {
          return true;
        }
      }
    }
    return false;
  }

  async function appendRestartLine(
    instance: Id<"wfi">,
    step: string | null,
    receiver: Id<"ses"> | null,
  ): Promise<void> {
    const done = await apply(instance, ({ instance: inst }) =>
      ok({
        instance: inst.id,
        change:
          step !== null && receiver !== null
            ? { kind: "lophn_restarted", step, receiver }
            : { kind: "flow_restarted" },
        by: { kind: "lophn" },
        handoff: null,
      }),
    );
    if (!done.ok) skip(instance, done.error.code);
  }

  async function programExited(input: {
    instance: Id<"wfi">;
    code: number | null;
    stderr_tail: string;
  }): Promise<Result<void>> {
    const done = await apply(input.instance, ({ instance }) =>
      ok({
        instance: instance.id,
        change: {
          kind: "program_exited",
          code: input.code,
          stderr_tail: input.stderr_tail,
        },
        by: { kind: "lophn" },
        handoff: null,
      }),
    );
    return done.ok ? ok(undefined) : done;
  }

  async function resolveFlowSdkInfo(): Promise<FlowSdkInfo> {
    if (files !== undefined && typeof files.flowSdkInfo === "function") {
      return await files.flowSdkInfo();
    }
    return DEFAULT_FLOW_SDK_INFO;
  }

  function isBuiltinHarnessAgent(agent: string): boolean {
    const key = agentHandleKey(agent);
    if ((HARNESS_RUNTIMES as readonly string[]).includes(key)) return true;
    return CODING_BUILTINS.some(
      (b) => agentHandleKey(b.harness) === key || agentHandleKey(b.id) === key,
    );
  }

  async function resolveParticipantModes(input: {
    project: Id<"prj">;
    workflow: string;
    participants: ReturnType<typeof participantsOf>;
    steps?: readonly {
      readonly name: string;
      readonly by: string;
      readonly with: string | null;
    }[];
    explicit: Record<string, PermissionMode> | undefined;
    explicitSteps: Record<string, PermissionMode> | undefined;
    by: StartedBy;
    maxMode: PermissionMode | undefined;
    callableRuntimeByName: Map<string, string | undefined> | undefined;
  }): Promise<
    Result<{
      participantModes: Record<string, PermissionMode> | undefined;
      stepModes: Record<string, PermissionMode> | undefined;
    }>
  > {
    if (input.explicit !== undefined) {
      for (const [key, value] of Object.entries(input.explicit)) {
        if (!permissionModeSchema.safeParse(value).success) {
          return fail(
            "invalid_input",
            `invalid permission mode for participant '${key}'`,
          );
        }
      }
    }
    if (input.explicitSteps !== undefined) {
      for (const [stepName, value] of Object.entries(input.explicitSteps)) {
        if (!permissionModeSchema.safeParse(value).success) {
          return fail(
            "invalid_input",
            `invalid permission mode for step '${stepName}'`,
          );
        }
      }
    }
    const entries = Object.entries(input.participants);
    if (entries.length === 0) {
      return ok({ participantModes: undefined, stepModes: undefined });
    }

    let runtimeByName = input.callableRuntimeByName;
    if (
      runtimeByName === undefined &&
      isHarnessAgent === undefined &&
      agents !== undefined
    ) {
      const callable = await agents.listCallable(input.project);
      if (callable.ok) {
        runtimeByName = new Map(
          callable.value.map((a) => [agentHandleKey(a.name), a.kind]),
        );
      }
    }

    let maxMode = input.maxMode;
    if (maxMode === undefined && input.by.kind === "workflow") {
      const parentRead = await store.read(input.by.instance as Id<"wfi">);
      if (parentRead.ok) {
        maxMode = parentPermissionCeiling(parentRead.value.instance);
      }
    }

    const remembered =
      rememberedModesOf !== undefined
        ? await rememberedModesOf(input.project, input.workflow)
        : undefined;
    const globalDefault =
      (globalDefaultMode !== undefined
        ? await globalDefaultMode()
        : undefined) ?? DEFAULT_PERMISSION_MODE;

    const resolved: Record<string, PermissionMode> = {};
    const agentDefaults = new Map<string, PermissionMode | undefined>();
    const lophnParticipants = new Set<string>();
    for (const [key, participant] of entries) {
      if ("kind" in participant) continue;
      if (isBuiltinHarnessAgent(participant.agent)) continue;
      if (isHarnessAgent !== undefined) {
        if (await isHarnessAgent(participant.agent, input.project)) continue;
      } else if (runtimeByName !== undefined) {
        const kind = runtimeByName.get(agentHandleKey(participant.agent));
        if (isHarnessRuntime(kind as AgentRuntime | undefined)) continue;
      }

      lophnParticipants.add(key);
      const explicitMode =
        input.by.kind === "user" ? input.explicit?.[key] : undefined;
      const rememberedMode = remembered?.[key];
      const agentDefault =
        agentDefaultModeOf !== undefined
          ? await agentDefaultModeOf(participant.agent, input.project)
          : undefined;
      agentDefaults.set(key, agentDefault);
      let mode: PermissionMode =
        explicitMode ?? rememberedMode ?? agentDefault ?? globalDefault;
      if (maxMode !== undefined) {
        mode = minPermissionMode(maxMode, mode);
      }
      resolved[key] = mode;
    }

    const resolvedSteps: Record<string, PermissionMode> = {};
    if (input.steps !== undefined) {
      for (const step of input.steps) {
        const byParticipant = input.participants[step.by];
        const effectiveKey =
          byParticipant !== undefined &&
          "kind" in byParticipant &&
          byParticipant.kind === "human"
            ? step.with
            : step.by;
        if (effectiveKey === null || !lophnParticipants.has(effectiveKey)) {
          continue;
        }
        const explicitStep =
          input.by.kind === "user"
            ? input.explicitSteps?.[step.name]
            : undefined;
        const explicitParticipant =
          input.by.kind === "user" ? input.explicit?.[effectiveKey] : undefined;
        const rememberedStep = remembered?.[`step:${step.name}`];
        const rememberedParticipant = remembered?.[effectiveKey];
        let mode: PermissionMode =
          explicitStep ??
          explicitParticipant ??
          rememberedStep ??
          rememberedParticipant ??
          agentDefaults.get(effectiveKey) ??
          globalDefault;
        if (maxMode !== undefined) {
          mode = minPermissionMode(maxMode, mode);
        }
        resolvedSteps[step.name] = mode;
      }
    }

    return ok({
      participantModes: Object.keys(resolved).length > 0 ? resolved : undefined,
      stepModes:
        Object.keys(resolvedSteps).length > 0 ? resolvedSteps : undefined,
    });
  }

  async function start(
    input: z.output<typeof workflowStart.input>,
    by: StartedBy,
    options?: { maxMode?: PermissionMode },
  ) {
    const [projectRef, name] = input.workflow.split("/") as [string, string];
    const project = await projects.resolve(projectRef);
    if (!project.ok) return project;
    const listed = await files.list(project.value.id);
    if (!listed.ok) return listed;
    const file = listed.value.find((f) => f.name === name);
    if (file === undefined) {
      return fail("not_found", "workflow not found");
    }
    const sdkInfo = await resolveFlowSdkInfo();
    const entry = entryOf(project.value.id, input.workflow, file, sdkInfo);
    const parsed = parseDeclaration(file);
    if (!entry.startable || !parsed.ok) {
      return fail(
        "conflict",
        entry.problem?.message ?? "workflow cannot be started",
      );
    }
    let validatedInputs: Record<string, unknown> | undefined;
    let callableRuntimeByName: Map<string, string | undefined> | undefined;
    if (parsed.declaration.inputs !== undefined) {
      let callableAgents: ReadonlySet<string> | undefined;
      const needsAgents = Object.values(parsed.declaration.inputs).some(
        (field) => field.type === "agent",
      );
      if (needsAgents && agents !== undefined) {
        const callable = await agents.listCallable(project.value.id);
        if (!callable.ok) return callable;
        callableAgents = new Set(callable.value.map((a) => a.name));
        callableRuntimeByName = new Map(
          callable.value.map((a) => [agentHandleKey(a.name), a.kind]),
        );
      }
      const checked = validateWorkflowInputs(
        parsed.declaration.inputs,
        input.inputs ?? {},
        callableAgents === undefined ? {} : { callableAgents },
      );
      if (!checked.ok) {
        const summary = Object.entries(checked.errors)
          .map(([field, msg]) => `${field}: ${msg}`)
          .join("; ");
        return fail("invalid_input", `invalid workflow inputs: ${summary}`);
      }
      if (Object.keys(checked.value).length > 0) {
        validatedInputs = checked.value;
      }
    } else if (
      input.inputs !== undefined &&
      Object.keys(input.inputs).length > 0
    ) {
      validatedInputs = input.inputs;
    }

    let explicitTitle: string | null = null;
    if (input.title !== undefined) {
      const checkedTitle = renameWorkflowTitle(input.title);
      if (!checkedTitle.ok) return checkedTitle;
      explicitTitle = checkedTitle.value;
    }

    const participants = participantsOf(parsed.declaration);
    const declaredSteps = file.flow ? undefined : stepsOf(parsed.declaration);
    const modesResolved = await resolveParticipantModes({
      project: project.value.id,
      workflow: name,
      participants,
      steps: declaredSteps,
      explicit: input.participant_modes,
      explicitSteps: input.step_modes,
      by,
      maxMode: options?.maxMode,
      callableRuntimeByName,
    });
    if (!modesResolved.ok) return modesResolved;
    const { participantModes, stepModes } = modesResolved.value;

    // 실행 모드는 오직 flow.ts 파일 유무로 결정한다.
    if (file.flow) {
      if (input.step !== undefined) {
        return fail("invalid_input", "a flow has no step to start from");
      }
      let codeSnapshot: string | undefined;
      if (snapshots !== undefined) {
        const captured = await snapshots.capture(project.value.id, name);
        if (!captured.ok) return captured;
        codeSnapshot = captured.value;
      }
      const id = ids.newId("wfi") as Id<"wfi">;
      const initialTitle =
        explicitTitle ?? autoWorkflowTitle(input.text, validatedInputs);
      const flowSteps = flowStepsOf(parsed.declaration).map((s) => {
        const override = input.step_open?.[s.name];
        return override !== undefined ? { ...s, open: override } : s;
      });
      const effectiveOpen = input.open ?? parsed.declaration.open;
      const created = await store.create({
        id,
        project: project.value.id,
        workflow: name,
        ...(initialTitle !== null ? { title: initialTitle } : {}),
        input: input.text,
        ...(validatedInputs !== undefined ? { inputs: validatedInputs } : {}),
        ...(codeSnapshot !== undefined ? { code_snapshot: codeSnapshot } : {}),
        ...(effectiveOpen !== undefined ? { open_mode: effectiveOpen } : {}),
        ...(participantModes !== undefined
          ? { participant_modes: participantModes }
          : {}),
        ...(parsed.declaration.agent !== undefined
          ? { flow_agent: parsed.declaration.agent }
          : {}),
        participants,
        steps: flowSteps,
        started_by: by,
        handoff: null,
      });
      if (!created.ok) return created;
      if (explicitTitle === null) {
        onTitleNeeded?.({
          instance: id,
          workflow: name,
          input: created.value.instance.input,
          ...(created.value.instance.inputs !== undefined
            ? { inputs: created.value.instance.inputs }
            : {}),
          expected: created.value.instance.title ?? null,
        });
      }
      // process 인자에는 redaction을 거친 instance.input·instance.inputs를 넘긴다.
      const launched = await flows.launch({
        instance: id,
        project: project.value.id,
        workflow: name,
        input: created.value.instance.input,
        ...(created.value.instance.inputs !== undefined
          ? { inputs: created.value.instance.inputs }
          : {}),
        agent: parsed.declaration.agent ?? LOPHN_AGENT_HANDLE,
        checkpoints: [],
        ...(created.value.instance.code_snapshot !== undefined
          ? { codeSnapshot: created.value.instance.code_snapshot }
          : {}),
      });
      if (launched.ok) return created;
      // 시작은 성공이다. 이유가 program_exited 줄로 남아 blocked 상태가 되어 사람이 본다.
      await programExited({
        instance: id,
        code: null,
        stderr_tail: launched.error.message,
      });
      const again = await store.read(id);
      return ok({
        instance: again.ok ? again.value.instance : created.value.instance,
        handed: null,
      });
    }

    const steps = (declaredSteps ?? stepsOf(parsed.declaration)).map((s) => {
      const override = input.step_open?.[s.name] ?? input.open;
      const stepMode = stepModes?.[s.name];
      return {
        ...s,
        ...(override !== undefined ? { open: override } : {}),
        ...(stepMode !== undefined ? { permission_mode: stepMode } : {}),
      };
    });
    const defaultStep =
      parsed.declaration.default_step !== undefined &&
      steps.some((s) => s.name === parsed.declaration.default_step)
        ? parsed.declaration.default_step
        : steps[0]!.name;
    const step = input.step ?? defaultStep;
    if (!steps.some((s) => s.name === step)) {
      return fail("not_found", "step not found");
    }
    const id = ids.newId("wfi") as Id<"wfi">;
    const initialTitle =
      explicitTitle ?? autoWorkflowTitle(input.text, validatedInputs);
    const created = await store.create({
      id,
      project: project.value.id,
      workflow: name,
      ...(initialTitle !== null ? { title: initialTitle } : {}),
      input: input.text,
      ...(validatedInputs !== undefined ? { inputs: validatedInputs } : {}),
      ...(input.open !== undefined ? { open_mode: input.open } : {}),
      ...(participantModes !== undefined
        ? { participant_modes: participantModes }
        : {}),
      participants,
      steps,
      started_by: by,
      handoff: planHandoff({
        instance: { id, project: project.value.id, participants, steps },
        step,
        cause: "start",
        session: null,
        received: input.text,
        ...(validatedInputs !== undefined ? { inputs: validatedInputs } : {}),
        sameSession: () => null,
        remote,
      }),
    });
    if (created.ok && explicitTitle === null) {
      onTitleNeeded?.({
        instance: id,
        workflow: name,
        input: created.value.instance.input,
        ...(created.value.instance.inputs !== undefined
          ? { inputs: created.value.instance.inputs }
          : {}),
        expected: created.value.instance.title ?? null,
      });
    }
    if (created.ok && created.value.handed !== null) {
      let remoteCall: string | null = null;
      if (
        created.value.handed.outcome === "handed" &&
        created.value.handed.receiver === null
      ) {
        const readAfter = await store.read(id);
        if (readAfter.ok) {
          const lastHanded = readAfter.value.lines.findLast(
            (l) => l.kind === "handed",
          );
          if (lastHanded?.kind === "handed") {
            remoteCall = lastHanded.remote?.call ?? null;
          }
        }
      }
      await recordYamlHandoffCheckpoint(store, {
        instance: id,
        handed: created.value.handed,
        remoteCall,
      });
    }
    return created;
  }

  async function stopRecursive(
    instanceId: Id<"wfi">,
    by: LineBy,
    visited: Set<string>,
  ): Promise<Result<{ instance: State["instance"] }>> {
    if (visited.has(instanceId)) {
      const read = await store.read(instanceId);
      return read.ok ? ok({ instance: read.value.instance }) : read;
    }
    visited.add(instanceId);

    const sessions = new Set<string>();
    const done = await apply(instanceId, ({ instance, lines, checkpoints }) => {
      if (instance.state === "stopped") {
        return fail("conflict", "workflow instance is stopped");
      }
      for (const l of lines) {
        if (l.kind === "handed" && l.receiver !== null) {
          sessions.add(l.receiver);
        }
      }
      for (const cp of checkpoints ?? []) {
        if (cp.handle_ref !== null && cp.handle_ref.startsWith("ses_")) {
          sessions.add(cp.handle_ref);
        }
      }
      return ok({
        instance: instance.id,
        change: { kind: "stop" },
        by,
        handoff: null,
      });
    });
    if (!done.ok) return done;

    // 진행 중이던 in-process durable primitive들을 즉시 취소한다.
    const controllers = activeControllers.get(instanceId);
    if (controllers !== undefined) {
      for (const controller of [...controllers]) {
        if (!controller.signal.aborted) {
          controller.abort("workflow stopped");
        }
      }
    }
    const trackedSessions = activeSessions.get(instanceId);
    if (trackedSessions !== undefined) {
      for (const ses of trackedSessions) sessions.add(ses);
    }

    // 멈춘 기록이 먼저다. 못 멈춘 session은 기록에 남기지 않는다(CancelRun과 같다).
    for (const session of sessions) {
      await turns.stopSession(session as Id<"ses">);
    }
    // process를 죽인다. 늦게 오는 program_exited는 stopped라 줄만 남는다. 못 죽여도 기록하지 않는다.
    await flows.stop(instanceId);

    // 실행 중인 모든 자식 sub-workflow instance를 연쇄로 중지한다.
    if (store.children !== undefined) {
      const kids = await store.children(instanceId);
      if (kids.ok) {
        for (const child of kids.value) {
          if (child.state === "running" && !visited.has(child.id)) {
            await stopRecursive(
              child.id as Id<"wfi">,
              { kind: "user" },
              visited,
            );
          }
        }
      }
    }
    notifyInstanceUpdated(instanceId);
    return ok({ instance: done.value.instance });
  }

  async function runAgentCall(
    req: RunAgentCallRequest,
  ): Promise<WorkflowOutcome<WorkflowSoftOutput>> {
    const existingList = await loadCheckpointsOf(req.instance);
    if (existingList.ok) {
      const existing = existingList.value.find((cp) => cp.key === req.key);
      if (existing !== undefined) {
        const replayed = checkpointToOutcome<WorkflowSoftOutput>(existing);
        if (replayed !== null) return replayed;
      }
    }

    if (req.signal?.aborted) {
      return {
        ok: false,
        reason: "cancelled",
        message: abortMessage(req.signal),
      };
    }
    if (agentPorts === undefined) {
      return {
        ok: false,
        reason: "unavailable",
        message: "agent primitive ports are not configured",
      };
    }

    const read = await store.read(req.instance);
    if (!read.ok) {
      return {
        ok: false,
        reason: read.error.code,
        message: read.error.message,
      };
    }
    const state = read.value;
    if (state.instance.state === "stopped") {
      return {
        ok: false,
        reason: "cancelled",
        message: "workflow instance is stopped",
      };
    }

    let targetAgent: AgentAddress;
    let targetOn: string | undefined = req.on;
    let participantOpen: SessionOpenMode | undefined;
    if (req.agent !== undefined) {
      targetAgent = {
        ...req.agent,
        workspace: req.agent.workspace ?? { project: state.instance.project },
      };
    } else if (req.participant !== undefined) {
      const p = state.instance.participants[req.participant];
      if (p === undefined) {
        return {
          ok: false,
          reason: "not_found",
          message: `participant ${req.participant} not found`,
        };
      }
      if ("kind" in p) {
        return {
          ok: false,
          reason: "invalid_input",
          message: `participant ${req.participant} is human; use human() instead`,
        };
      }
      targetAgent = {
        agent: p.agent,
        workspace: p.workspace ?? { project: state.instance.project },
      };
      targetOn = req.on ?? p.on;
      participantOpen = p.open;
    } else {
      return {
        ok: false,
        reason: "invalid_input",
        message: "agent or participant is required",
      };
    }

    let sameSession: Id<"ses"> | null = null;
    if (req.session === "same") {
      if (req.participant !== undefined) {
        sameSession = sameSessionIn(state)(req.participant);
      }
      if (sameSession === null) {
        const lastHanded = state.lines.findLast(
          (l) =>
            l.kind === "handed" &&
            l.receiver !== null &&
            (l.participant === (req.participant ?? targetAgent.agent) ||
              l.step === req.step),
        );
        if (lastHanded?.kind === "handed" && lastHanded.receiver !== null) {
          sameSession = lastHanded.receiver as Id<"ses">;
        }
      }
    }

    await upsertCheckpoint({
      instance: req.instance,
      key: req.key,
      kind: "agent",
      state: "started",
      handle_ref: null,
    });

    const { controller, release } = trackController(req.instance, req.signal);
    let activeSession: Id<"ses"> | null = null;
    let untrackSession: (() => void) | undefined;

    const basePorts = agentPorts;
    const wrappedPorts: AgentPrimitivePorts = {
      ...basePorts,
      async handOff(handInput: AgentHandOffInput) {
        const handed = await basePorts.handOff(handInput);
        if (handed.ok) {
          activeSession = handed.session;
          untrackSession = trackSession(req.instance, handed.session);
          await upsertCheckpoint({
            instance: req.instance,
            key: req.key,
            kind: "agent",
            state: "started",
            handle_ref: handed.session,
          });
        }
        return handed;
      },
      subscribeReport(fn) {
        const offBase = basePorts.subscribeReport(fn);
        const offLocal = subscribeReports(fn);
        return () => {
          offBase();
          offLocal();
        };
      },
    };

    const declaredStepOpen = state.instance.steps.find(
      (s) => s.name === req.step,
    )?.open;
    const effectiveOpen: SessionOpenMode | undefined =
      state.instance.open_mode ??
      declaredStepOpen ??
      req.open ??
      participantOpen;
    const participantMode =
      state.instance.participant_modes?.[req.participant ?? targetAgent.agent];

    try {
      const outcome = await runAgentPrimitive(wrappedPorts, {
        agent: targetAgent,
        prompt: req.prompt,
        ...(req.input !== undefined ? { input: req.input } : {}),
        ...(req.schema !== undefined ? { schema: req.schema } : {}),
        mode: req.mode ?? "turn",
        ...(req.session !== undefined ? { session: req.session } : {}),
        ...(effectiveOpen !== undefined ? { open: effectiveOpen } : {}),
        ...(participantMode !== undefined
          ? { permissionMode: participantMode }
          : {}),
        sameSession,
        origin: {
          project: state.instance.project as Id<"prj">,
          workflow: state.instance.workflow,
          instance: req.instance,
          step: req.step,
        },
        ...(targetOn !== undefined ? { on: targetOn } : {}),
        human: false,
        signal: controller.signal,
      });

      if (outcome.ok) {
        await upsertCheckpoint({
          instance: req.instance,
          key: req.key,
          kind: "agent",
          state: "completed",
          handle_ref: activeSession,
          output: outcome.result,
        });
      } else {
        await upsertCheckpoint({
          instance: req.instance,
          key: req.key,
          kind: "agent",
          state: "failed",
          handle_ref: outcome.session ?? activeSession,
          error: {
            reason: outcome.reason,
            message: outcome.message,
            ...(outcome.session !== undefined
              ? { session: outcome.session }
              : {}),
          },
        });
      }
      return outcome;
    } finally {
      untrackSession?.();
      release();
    }
  }

  async function waitExistingHumanReport(input: {
    instance: Id<"wfi">;
    step: string;
    key: string;
    session: Id<"ses">;
    signal?: AbortSignal;
  }): Promise<WorkflowOutcome<WorkflowSoftOutput>> {
    const { controller, release } = trackController(
      input.instance,
      input.signal,
    );
    const untrack = trackSession(input.instance, input.session);
    try {
      if (controller.signal.aborted) {
        const msg = abortMessage(controller.signal);
        const cancelled: WorkflowOutcome<WorkflowSoftOutput> = {
          ok: false,
          reason: "cancelled",
          message: msg,
          session: input.session,
        };
        await upsertCheckpoint({
          instance: input.instance,
          key: input.key,
          kind: "human",
          state: "failed",
          handle_ref: input.session,
          error: { reason: "cancelled", message: msg, session: input.session },
        });
        return cancelled;
      }

      const outcome = await new Promise<WorkflowOutcome<WorkflowSoftOutput>>(
        (resolve) => {
          let settled = false;
          const unsubs: Array<() => void> = [];
          const finish = (out: WorkflowOutcome<WorkflowSoftOutput>) => {
            if (settled) return;
            settled = true;
            controller.signal.removeEventListener("abort", onAbort);
            for (const u of unsubs.splice(0)) {
              try {
                u();
              } catch {
                // ignore
              }
            }
            resolve(out);
          };
          const onReport = (event: AgentReportEvent) => {
            if (
              event.instance !== input.instance ||
              event.step !== input.step ||
              event.session !== input.session
            ) {
              return;
            }
            finish({
              ok: true,
              result: {
                summary: event.summary,
                ...(event.refs !== undefined ? { refs: event.refs } : {}),
                ...(event.data !== undefined ? { data: event.data } : {}),
              },
            });
          };
          const onAbort = () => {
            const msg = abortMessage(controller.signal);
            finish({
              ok: false,
              reason: "cancelled",
              message: msg,
              session: input.session,
            });
          };
          controller.signal.addEventListener("abort", onAbort, { once: true });
          unsubs.push(subscribeReports(onReport));
          if (agentPorts !== undefined) {
            unsubs.push(agentPorts.subscribeReport(onReport));
          }
        },
      );

      if (outcome.ok) {
        await upsertCheckpoint({
          instance: input.instance,
          key: input.key,
          kind: "human",
          state: "completed",
          handle_ref: input.session,
          output: outcome.result,
        });
      } else {
        await upsertCheckpoint({
          instance: input.instance,
          key: input.key,
          kind: "human",
          state: "failed",
          handle_ref: input.session,
          error: {
            reason: outcome.reason,
            message: outcome.message,
            session: input.session,
          },
        });
      }
      return outcome;
    } finally {
      untrack();
      release();
    }
  }

  async function runHumanStep(
    req: RunHumanStepRequest,
  ): Promise<WorkflowOutcome<WorkflowSoftOutput>> {
    const existingList = await loadCheckpointsOf(req.instance);
    if (existingList.ok) {
      const existing = existingList.value.find((cp) => cp.key === req.key);
      if (existing !== undefined) {
        const replayed = checkpointToOutcome<WorkflowSoftOutput>(existing);
        if (replayed !== null) return replayed;
        // 재시작을 넘긴 idle human 대기(state === "started" && handle_ref !== null):
        // prompt를 다시 보내지 않고 기존 session에 다시 붙어 workflow.report만 기다린다.
        if (existing.state === "started" && existing.handle_ref !== null) {
          return await waitExistingHumanReport({
            instance: req.instance,
            step: req.step,
            key: req.key,
            session: existing.handle_ref as Id<"ses">,
            signal: req.signal,
          });
        }
      }
    }

    if (req.signal?.aborted) {
      return {
        ok: false,
        reason: "cancelled",
        message: abortMessage(req.signal),
      };
    }
    if (agentPorts === undefined) {
      return {
        ok: false,
        reason: "unavailable",
        message: "agent primitive ports are not configured",
      };
    }

    const read = await store.read(req.instance);
    if (!read.ok) {
      return {
        ok: false,
        reason: read.error.code,
        message: read.error.message,
      };
    }
    const state = read.value;
    if (state.instance.state === "stopped") {
      return {
        ok: false,
        reason: "cancelled",
        message: "workflow instance is stopped",
      };
    }

    let targetAgent: AgentAddress;
    if (req.with !== undefined) {
      targetAgent = {
        ...req.with,
        workspace: req.with.workspace ?? { project: state.instance.project },
      };
    } else if (req.participant !== undefined) {
      const p = state.instance.participants[req.participant];
      if (p === undefined) {
        return {
          ok: false,
          reason: "not_found",
          message: `participant ${req.participant} not found`,
        };
      }
      if ("kind" in p) {
        return {
          ok: false,
          reason: "invalid_input",
          message: "human() needs an agent participant to converse with",
        };
      }
      targetAgent = {
        agent: p.agent,
        workspace: p.workspace ?? { project: state.instance.project },
      };
    } else {
      return {
        ok: false,
        reason: "invalid_input",
        message: "participant or with agent is required for human()",
      };
    }

    const sameSession =
      req.session === "same" && req.participant !== undefined
        ? sameSessionIn(state)(req.participant)
        : null;

    await upsertCheckpoint({
      instance: req.instance,
      key: req.key,
      kind: "human",
      state: "started",
      handle_ref: null,
    });

    const { controller, release } = trackController(req.instance, req.signal);
    let activeSession: Id<"ses"> | null = null;
    let untrackSession: (() => void) | undefined;

    const basePorts = agentPorts;
    const wrappedPorts: AgentPrimitivePorts = {
      ...basePorts,
      async handOff(handInput: AgentHandOffInput) {
        const handed = await basePorts.handOff(handInput);
        if (handed.ok) {
          activeSession = handed.session;
          untrackSession = trackSession(req.instance, handed.session);
          await upsertCheckpoint({
            instance: req.instance,
            key: req.key,
            kind: "human",
            state: "started",
            handle_ref: handed.session,
          });
        }
        return handed;
      },
      subscribeReport(fn) {
        const offBase = basePorts.subscribeReport(fn);
        const offLocal = subscribeReports(fn);
        return () => {
          offBase();
          offLocal();
        };
      },
    };

    const declaredStepOpen = state.instance.steps.find(
      (s) => s.name === req.step,
    )?.open;
    const effectiveOpen: SessionOpenMode =
      state.instance.open_mode ?? declaredStepOpen ?? req.open ?? "tab";
    const participantMode =
      state.instance.participant_modes?.[req.participant ?? targetAgent.agent];

    try {
      const outcome = await runAgentPrimitive(wrappedPorts, {
        agent: targetAgent,
        prompt: req.prompt,
        ...(req.input !== undefined ? { input: req.input } : {}),
        mode: "report",
        ...(req.session !== undefined ? { session: req.session } : {}),
        open: effectiveOpen,
        ...(participantMode !== undefined
          ? { permissionMode: participantMode }
          : {}),
        sameSession,
        origin: {
          project: state.instance.project as Id<"prj">,
          workflow: state.instance.workflow,
          instance: req.instance,
          step: req.step,
        },
        // human step은 stall 판정에서 제외한다.
        human: true,
        signal: controller.signal,
      });

      if (outcome.ok) {
        await upsertCheckpoint({
          instance: req.instance,
          key: req.key,
          kind: "human",
          state: "completed",
          handle_ref: activeSession,
          output: outcome.result,
        });
      } else {
        await upsertCheckpoint({
          instance: req.instance,
          key: req.key,
          kind: "human",
          state: "failed",
          handle_ref: outcome.session ?? activeSession,
          error: {
            reason: outcome.reason,
            message: outcome.message,
            ...(outcome.session !== undefined
              ? { session: outcome.session }
              : {}),
          },
        });
      }
      return outcome;
    } finally {
      untrackSession?.();
      release();
    }
  }

  async function runSubWorkflow(
    req: SubWorkflowRequest,
  ): Promise<WorkflowOutcome<WorkflowSoftOutput>> {
    const { controller, release } = trackController(
      req.parentInstance,
      req.signal,
    );
    try {
      return await runSubWorkflowCall(
        {
          store,
          projects,
          start,
          stop: (stopInput, by) =>
            stopRecursive(stopInput.instance, by, new Set()),
          subscribeInstanceUpdated,
          loadCheckpoints: loadCheckpointsOf,
        },
        { ...req, signal: controller.signal },
      );
    } finally {
      release();
    }
  }

  async function escalate(input: {
    instance: Id<"wfi">;
    step?: string | null;
    reason: string;
  }): Promise<Result<{ line: string }>> {
    const done = await apply(input.instance, ({ instance }) => {
      if (instance.state === "stopped") {
        return fail("conflict", "workflow instance is stopped");
      }
      return ok({
        instance: instance.id,
        change: {
          kind: "escalated",
          step: input.step ?? null,
          text: input.reason,
        },
        by: { kind: "program" },
        handoff: null,
      });
    });
    return done.ok ? ok({ line: done.value.line }) : done;
  }

  async function resume(
    input: z.output<typeof workflowResume.input>,
  ): Promise<Result<z.output<typeof workflowResume.output>>> {
    const read = await store.read(input.instance as Id<"wfi">);
    if (!read.ok) return read;
    const state = read.value;
    const { instance, lines } = state;
    if (instance.state !== "running") {
      return fail("conflict", `workflow instance is ${instance.state}`);
    }
    const checkpoints =
      state.checkpoints ??
      (await loadCheckpointsOf(instance.id as Id<"wfi">).then((r) =>
        r.ok ? r.value : [],
      ));
    const derivedStatus =
      state.derived_status ??
      deriveWorkflowStatus({
        state: instance.state,
        current: instance.current,
        latestStatusLine: latestStatusKindFromLines(lines),
        sessions: state.sessions ?? [],
        remoteSteps: state.remote_steps ?? [],
        checkpoints,
      });
    if (derivedStatus !== "blocked") {
      return fail("conflict", "workflow instance is not blocked");
    }

    const useLatest = input.use_latest_code === true;
    const flowInstance = isFlowInstance(instance, lines);
    if (!flowInstance && !useLatest) {
      return fail("conflict", "only flow workflows can be resumed");
    }

    let codeSnapshot = instance.code_snapshot ?? null;
    let agent = LOPHN_AGENT_HANDLE;

    if (useLatest) {
      if (instance.one_off === true) {
        return fail(
          "conflict",
          "one-off workflow has no folder on disk; use workflow override-code to patch this instance",
        );
      }
      const listed = await files.list(instance.project as Id<"prj">);
      if (!listed.ok) return listed;
      const file = listed.value.find((f) => f.name === instance.workflow);
      if (file === undefined || !file.flow) {
        return fail("invalid_input", "flow.ts is missing for workflow");
      }
      const parsed = parseDeclaration(file);
      if (!parsed.ok) {
        return fail("invalid_input", parsed.problem.message);
      }
      agent = parsed.declaration.agent ?? LOPHN_AGENT_HANDLE;
      if (snapshots === undefined) {
        return fail("unavailable", "workflow snapshots are not configured");
      }
      const captured = await snapshots.capture(
        instance.project as Id<"prj">,
        instance.workflow,
      );
      if (!captured.ok) {
        return captured.error.code === "not_found"
          ? fail("invalid_input", captured.error.message)
          : captured;
      }
      const updated = await apply(instance.id, ({ instance: fresh }) =>
        ok({
          instance: fresh.id,
          change: {
            kind: "code_updated",
            code_snapshot: captured.value,
            ...(parsed.declaration.agent !== undefined
              ? { flow_agent: parsed.declaration.agent }
              : {}),
          },
          by: { kind: "user" },
          handoff: null,
        }),
      );
      if (!updated.ok) return updated;
      codeSnapshot = captured.value;
    } else {
      if (codeSnapshot === null) {
        return fail(
          "conflict",
          "workflow instance has no code snapshot; resume with use_latest_code",
        );
      }
      agent = await resolveFlowAgentName(
        instance.project as Id<"prj">,
        instance.workflow,
        instance.flow_agent,
      );
    }

    const launched = await flows.launch({
      instance: instance.id as Id<"wfi">,
      project: instance.project as Id<"prj">,
      workflow: instance.workflow,
      input: instance.input,
      ...(instance.inputs !== undefined ? { inputs: instance.inputs } : {}),
      agent,
      checkpoints,
      codeSnapshot,
    });
    if (!launched.ok) return launched;

    const refreshed = await store.read(instance.id as Id<"wfi">);
    return ok({
      instance: refreshed.ok ? refreshed.value.instance : instance,
    });
  }

  async function handOffStep(input: {
    instance: Id<"wfi">;
    plan: HandoffPlan;
  }): Promise<Result<Output<typeof workflowInstanceApply>>> {
    return await apply(input.instance, ({ instance }) => {
      if (instance.state === "stopped") {
        return fail("conflict", "workflow instance is stopped");
      }
      return ok({
        instance: instance.id,
        change: { kind: "handoff" },
        by: { kind: "program" },
        handoff: input.plan,
      });
    });
  }

  async function recordStall(input: {
    instance: Id<"wfi">;
    step: string;
    session: Id<"ses"> | null;
    reason?: string;
    message?: string;
  }): Promise<Result<void>> {
    let alreadyStalled = false;
    const done = await apply(input.instance, (state) => {
      if (
        input.session !== null &&
        stalledToResumeFor(state, input.session) === input.step
      ) {
        alreadyStalled = true;
        return fail("conflict", "step already stalled");
      }
      return ok({
        instance: state.instance.id,
        change: {
          kind: "step_stalled",
          step: input.step,
          session: input.session,
          ...(input.reason !== undefined ? { reason: input.reason } : {}),
          ...(input.message !== undefined ? { message: input.message } : {}),
        },
        by: { kind: "lophn" },
        handoff: null,
      });
    });
    return done.ok || alreadyStalled ? ok(undefined) : done;
  }

  async function reconcileOne(id: Id<"wfi">): Promise<{
    relaunch?: {
      instance: State["instance"];
      checkpoints: WorkflowCheckpoint[];
    };
  }> {
    const read = await store.read(id);
    if (!read.ok) {
      skip(id, read.error.code);
      return {};
    }
    const { instance, lines } = read.value;
    let checkpoints: WorkflowCheckpoint[];
    if (read.value.checkpoints !== undefined) {
      checkpoints = read.value.checkpoints;
    } else {
      const loaded = await loadCheckpointsOf(id);
      checkpoints = loaded.ok ? loaded.value : [];
    }
    const flowInstance = isFlowInstance(instance, lines);

    if (flowInstance) {
      const hasSnapshot =
        instance.code_snapshot !== undefined && instance.code_snapshot !== null;
      // Pre-Phase-4 running flow instance(code_snapshot 없고 checkpoint 없음):
      // lophn_restarted 줄을 남기고 blocked로 둔다(replay하지 않는다).
      if (!hasSnapshot && checkpoints.length === 0) {
        const alreadyMarked = lines.some((l) => l.kind === "lophn_restarted");
        if (!alreadyMarked) {
          await appendRestartLine(id, null, null);
        }
        return {};
      }

      let interruptedAny = false;
      let restartStep: string | null = null;
      let restartReceiver: Id<"ses"> | null = null;

      for (const cp of checkpoints) {
        if (cp.state !== "started") continue;
        if (cp.kind === "workflow" || cp.kind === "step") {
          // sub-workflow는 기존 자식 instance id에 재부착한다.
          continue;
        }
        const sessionRef =
          cp.handle_ref !== null && cp.handle_ref.startsWith("ses_")
            ? (cp.handle_ref as Id<"ses">)
            : null;
        if (cp.kind === "human") {
          // idle human 대기(turn이 재시작으로 끊기지 않음)는 started(needs_you)를 그대로 유지한다.
          const interrupted =
            sessionRef === null
              ? true
              : await wasSessionInterruptedOnRestart(sessionRef, id, cp.key);
          if (!interrupted) continue;
        }
        // agent / tool / 끊긴 human: 절대 자동 재실행하지 않고 interrupted로 확정한다.
        await upsertCheckpoint({
          instance: id,
          key: cp.key,
          kind: cp.kind,
          state: "interrupted",
          handle_ref: cp.handle_ref,
          error: {
            reason: "interrupted",
            message: `lophn restarted while ${cp.kind} was running`,
            ...(sessionRef !== null ? { session: sessionRef } : {}),
          },
        });
        interruptedAny = true;
        if (restartReceiver === null && sessionRef !== null) {
          restartStep = cp.key;
          restartReceiver = sessionRef;
        }
      }

      if (interruptedAny) {
        await appendRestartLine(id, restartStep, restartReceiver);
      }

      if (hasSnapshot) {
        const latestCheckpoints = await loadCheckpointsOf(id);
        return {
          relaunch: {
            instance,
            checkpoints: latestCheckpoints.ok
              ? latestCheckpoints.value
              : checkpoints,
          },
        };
      }
      return {};
    }

    // Non-flow (YAML) running instance: 절대 자동 재넘기기하지 않는다.
    const startedCheckpoints = checkpoints.filter(
      (cp) => cp.state === "started",
    );
    if (startedCheckpoints.length > 0) {
      let interruptedAny = false;
      let restartStep: string | null = null;
      let restartReceiver: Id<"ses"> | null = null;

      for (const cp of startedCheckpoints) {
        const sessionRef =
          cp.handle_ref !== null && cp.handle_ref.startsWith("ses_")
            ? (cp.handle_ref as Id<"ses">)
            : null;
        if (cp.kind === "human") {
          const interrupted =
            sessionRef === null
              ? true
              : await wasSessionInterruptedOnRestart(sessionRef, id, cp.key);
          if (!interrupted) continue;
        }
        await upsertCheckpoint({
          instance: id,
          key: cp.key,
          kind: cp.kind,
          state: "interrupted",
          handle_ref: cp.handle_ref,
          error: {
            reason: "interrupted",
            message: `lophn restarted while ${cp.kind} step was running`,
            ...(sessionRef !== null ? { session: sessionRef } : {}),
          },
        });
        interruptedAny = true;
        if (restartReceiver === null && sessionRef !== null) {
          restartStep = cp.key.split("#")[0] ?? cp.key;
          restartReceiver = sessionRef;
        }
      }
      if (interruptedAny) {
        await appendRestartLine(id, restartStep, restartReceiver);
      }
      return {};
    }

    // checkpoint 없는 옛 YAML instance: 기존 handed 줄 + stepTurn 검사로 lophn_restarted를 남긴다.
    const at = lines.findLastIndex((l) => l.kind === "handed");
    const handed = lines[at];
    if (handed?.kind !== "handed" || handed.receiver === null) return {};
    const done = lines
      .slice(at + 1)
      .some(
        (l) =>
          l.kind === "lophn_restarted" ||
          (l.kind === "report" && l.step === handed.step),
      );
    if (done) return {};
    const found = await turns.stepTurn(
      handed.receiver as Id<"ses">,
      id,
      handed.step,
    );
    if (!found.ok) {
      skip(id, found.error.code);
      return {};
    }
    const turn = found.value;
    if (turn === null) return {};
    const lost =
      turn.turn === null ||
      (turn.outcome?.kind === "interrupted" &&
        turn.outcome.reason === "restarted");
    if (!lost) return {};
    await appendRestartLine(id, handed.step, handed.receiver as Id<"ses">);
    return {};
  }

  async function enrichEntry(
    project: { id: Id<"prj">; name: string },
    file: Parameters<typeof entryOf>[2],
    sdkInfo: Awaited<ReturnType<typeof resolveFlowSdkInfo>>,
  ) {
    const entry = entryOf(
      project.id,
      `${project.name}/${file.name}`,
      file,
      sdkInfo,
    );
    if (
      entry.kind !== "agent" ||
      entry.steps === null ||
      entry.participants === null ||
      agents?.defaultOpen === undefined
    ) {
      return entry;
    }
    const participants = entry.participants;
    const steps = await Promise.all(
      entry.steps.map(async (step) => {
        if (step.open !== undefined) return step;
        const by = participants[step.by];
        if (by === undefined || "kind" in by) {
          return { ...step, open: "tab" as const };
        }
        const resolved = await agents.defaultOpen!({
          agent: by.agent,
          workspace: by.workspace ?? { project: project.id },
        });
        return resolved === undefined ? step : { ...step, open: resolved };
      }),
    );
    return { ...entry, steps };
  }

  return {
    programExited,
    upsertCheckpoint,
    loadCheckpoints: loadCheckpointsOf,
    runAgentCall,
    runHumanStep,
    runSubWorkflow,
    escalate,
    resume,
    handOffStep,
    recordStall,
    subscribeReports,
    notifyInstanceUpdated,
    setAgentPorts(ports: AgentPrimitivePorts) {
      agentPorts = ports;
    },

    async list(
      input: z.output<typeof workflowList.input>,
      defaultProject: string | null,
    ): Promise<Result<z.output<typeof workflowList.output>>> {
      const ref = input.project ?? defaultProject;
      if (ref === null) {
        return fail("invalid_input", "give a project");
      }
      const project = await projects.resolve(ref);
      if (!project.ok) return project;
      const listed = await files.list(project.value.id);
      if (!listed.ok) return listed;
      const sdkInfo = await resolveFlowSdkInfo();
      const workflows = await Promise.all(
        listed.value.map((file) => enrichEntry(project.value, file, sdkInfo)),
      );
      if (agents === undefined) {
        return ok({ workflows });
      }
      const callable = await agents.listCallable(project.value.id);
      if (!callable.ok) return callable;
      return ok({
        workflows,
        callable_agents: callable.value,
      });
    },

    async rename(
      input: z.output<typeof workflowRename.input>,
      defaultProject: string | null,
    ): Promise<Result<z.output<typeof workflowRename.output>>> {
      const ref = input.project ?? defaultProject;
      if (ref === null) {
        return fail("invalid_input", "give a project");
      }
      const project = await projects.resolve(ref);
      if (!project.ok) return project;
      if (input.from === input.to) {
        return fail(
          "conflict",
          "target workflow name must differ from current name",
        );
      }
      const listed = await files.list(project.value.id);
      if (!listed.ok) return listed;
      if (!listed.value.some((f) => f.name === input.from)) {
        return fail("not_found", "workflow not found");
      }
      if (listed.value.some((f) => f.name === input.to)) {
        return fail("conflict", `workflow '${input.to}' already exists`);
      }
      if (typeof files.rename !== "function") {
        return fail("unavailable", "workflow rename is not configured");
      }
      const renamed = await files.rename(
        project.value.id,
        input.from,
        input.to,
      );
      if (!renamed.ok) return renamed;
      let updatedJobs = 0;
      if (lifecycle !== undefined) {
        const ledger = await lifecycle.renameLedger(
          project.value.id,
          input.from,
          input.to,
        );
        if (!ledger.ok) {
          await files
            .rename(project.value.id, input.to, input.from)
            .catch(() => {});
          return ledger;
        }
        updatedJobs = ledger.value.updated_jobs;
        await lifecycle.updateLayoutOnRename?.(
          project.value.id,
          input.from,
          input.to,
        );
        lifecycle.publishRenamed?.(
          project.value.id,
          input.from,
          input.to,
          updatedJobs,
        );
      }
      return ok({
        project: project.value.id,
        from: input.from,
        to: input.to,
        updated_jobs: updatedJobs,
      });
    },

    async remove(
      input: z.output<typeof workflowDelete.input>,
      defaultProject: string | null,
    ): Promise<Result<z.output<typeof workflowDelete.output>>> {
      const ref = input.project ?? defaultProject;
      if (ref === null) {
        return fail("invalid_input", "give a project");
      }
      const project = await projects.resolve(ref);
      if (!project.ok) return project;
      const listed = await files.list(project.value.id);
      if (!listed.ok) return listed;
      if (!listed.value.some((f) => f.name === input.name)) {
        return fail("not_found", "workflow not found");
      }
      if (typeof files.remove !== "function") {
        return fail("unavailable", "workflow delete is not configured");
      }
      const running = await store.running();
      if (!running.ok) return running;
      for (const inst of running.value) {
        if (inst.project === project.value.id && inst.workflow === input.name) {
          const stopped = await stopRecursive(
            inst.id as Id<"wfi">,
            { kind: "user" },
            new Set(),
          );
          if (!stopped.ok && stopped.error.code !== "conflict") {
            return stopped;
          }
        }
      }
      let erasedJobs = 0;
      if (lifecycle !== undefined) {
        const ledger = await lifecycle.deleteLedger(
          project.value.id,
          input.name,
        );
        if (!ledger.ok) return ledger;
        erasedJobs = ledger.value.erased_jobs;
      }
      const removed = await files.remove(project.value.id, input.name);
      if (!removed.ok) return removed;
      await lifecycle?.updateLayoutOnDelete?.(project.value.id, input.name);
      lifecycle?.publishRemoved?.(project.value.id, input.name, erasedJobs);
      return ok({
        project: project.value.id,
        name: input.name,
        erased_jobs: erasedJobs,
        follow_ups: [],
        handoff_session: null,
      });
    },

    async exportWorkflow(
      input: z.output<typeof workflowExport.input>,
    ): Promise<Result<z.output<typeof workflowExport.output>>> {
      const project = await projects.resolve(input.project);
      if (!project.ok) return project;
      if (typeof files.exportBundle !== "function") {
        return fail("unavailable", "workflow export is not configured");
      }
      const exported = await files.exportBundle(project.value.id, input.name);
      if (!exported.ok) return exported;
      return ok({
        project: project.value.id,
        name: input.name,
        files: exported.value,
      });
    },

    async importWorkflow(
      input: z.output<typeof workflowImport.input>,
    ): Promise<Result<z.output<typeof workflowImport.output>>> {
      const project = await projects.resolve(input.project);
      if (!project.ok) return project;
      if (typeof files.importBundle !== "function") {
        return fail("unavailable", "workflow import is not configured");
      }
      const imported = await files.importBundle(
        project.value.id,
        input.name,
        input.files,
        { overwrite: input.overwrite === true },
      );
      if (!imported.ok) return imported;
      lifecycle?.publishImported?.(project.value.id, input.name);
      return ok({
        project: project.value.id,
        name: input.name,
        files_written: imported.value.files_written,
      });
    },

    async setDefaults(
      input: z.output<typeof workflowSetDefaults.input>,
    ): Promise<Result<z.output<typeof workflowSetDefaults.output>>> {
      if (
        input.default_step === undefined &&
        input.open === undefined &&
        (input.step_open === undefined ||
          Object.keys(input.step_open).length === 0) &&
        (input.inputs === undefined || Object.keys(input.inputs).length === 0)
      ) {
        return fail("invalid_input", "no default changes provided");
      }
      const project = await projects.resolve(input.project);
      if (!project.ok) return project;
      if (typeof files.writeDeclaration !== "function") {
        return fail(
          "unavailable",
          "workflow declaration write is not configured",
        );
      }
      const listed = await files.list(project.value.id);
      if (!listed.ok) return listed;
      const file = listed.value.find((f) => f.name === input.workflow);
      if (file === undefined) return fail("not_found", "workflow not found");
      if (file.declaration === null) {
        return fail("conflict", "workflow.yaml is missing");
      }
      const parsed = parseDeclaration(file);
      if (!parsed.ok) return fail("conflict", parsed.problem.message);

      if (file.flow) {
        if (input.default_step !== undefined) {
          return fail("invalid_input", "a flow has no default_step");
        }
        if (
          input.step_open !== undefined &&
          Object.keys(input.step_open).length > 0
        ) {
          return fail("invalid_input", "a flow has no per-step open defaults");
        }
      }

      if (
        input.inputs !== undefined &&
        Object.keys(input.inputs).length > 0 &&
        agents !== undefined
      ) {
        const declarations = parsed.declaration.inputs ?? {};
        const needsCallable = Object.entries(input.inputs).some(
          ([key, value]) =>
            declarations[key]?.type === "agent" &&
            value !== null &&
            value !== undefined,
        );
        if (needsCallable) {
          const callable = await agents.listCallable(project.value.id);
          if (!callable.ok) return callable;
          const allowed = new Set(callable.value.map((a) => a.name));
          for (const [key, value] of Object.entries(input.inputs)) {
            if (
              declarations[key]?.type === "agent" &&
              value !== null &&
              value !== undefined
            ) {
              if (typeof value !== "string" || !allowed.has(value)) {
                return fail(
                  "invalid_input",
                  `inputs.${key}: unknown or uncallable agent '${String(value)}'`,
                );
              }
            }
          }
        }
      }

      const patched = patchWorkflowDeclarationYaml(file.declaration, {
        ...(input.default_step !== undefined
          ? { default_step: input.default_step }
          : {}),
        ...(input.open !== undefined ? { open: input.open } : {}),
        ...(input.step_open !== undefined
          ? { step_open: input.step_open }
          : {}),
        ...(input.inputs !== undefined ? { inputs: input.inputs } : {}),
      });
      if (!patched.ok) return patched;

      const updatedFile = { ...file, declaration: patched.value };
      const rechecked = parseDeclaration(updatedFile);
      if (!rechecked.ok) {
        return fail("invalid_input", rechecked.problem.message);
      }

      const written = await files.writeDeclaration(
        project.value.id,
        input.workflow,
        patched.value,
      );
      if (!written.ok) return written;

      const sdkInfo = await resolveFlowSdkInfo();
      const entry = await enrichEntry(project.value, updatedFile, sdkInfo);
      return ok({ entry });
    },

    start,

    // 일회성 workflow(base 없음) 또는 기존 workflow의 instance 전용 override(base + override)를 시작한다.
    // agent 호출이면 검증·flow type-check 뒤에 approver(사람 전용 승인 카드)를 거친다.
    async run(
      input: z.output<typeof workflowRun.input>,
      by: StartedBy,
      options?: {
        defaultProject?: string | null;
        scopedProject?: string | null;
        approver?: WorkflowRunApprover;
      },
    ): Promise<Result<z.output<typeof workflowRun.output>>> {
      let explicitTitle: string | null = null;
      if (input.title !== undefined) {
        const checkedTitle = renameWorkflowTitle(input.title);
        if (!checkedTitle.ok) return checkedTitle;
        explicitTitle = checkedTitle.value;
      }

      if (input.workflow === undefined) {
        // ---------- 일회성(one-off) 모드 ----------
        if (input.override !== undefined) {
          return fail(
            "invalid_input",
            "override requires a base workflow key (<project>/<name>)",
          );
        }
        const projectRef =
          input.project ?? options?.defaultProject ?? undefined;
        if (projectRef === undefined || projectRef === "") {
          return fail(
            "invalid_input",
            "project is required for a one-off workflow",
          );
        }
        const project = await projects.resolve(projectRef);
        if (!project.ok) return project;
        if (
          options?.scopedProject !== undefined &&
          options.scopedProject !== null &&
          project.value.id !== options.scopedProject
        ) {
          return err({
            code: "forbidden",
            message: "an agent can only run workflows in its own project",
          });
        }

        const isFlow = hasFlowEntryFile(input.files);
        if (input.files !== undefined && !isFlow) {
          return fail(
            "invalid_input",
            `files must include ${WORKFLOW_FLOW_FILE}`,
          );
        }

        const workflowName = input.name ?? "one-off";
        const participants = input.participants ?? {};
        let steps: ReturnType<typeof stepsOf> = [];
        let checkedFiles: Record<string, string> | undefined;

        if (isFlow) {
          if (input.step !== undefined) {
            return fail("invalid_input", "a flow has no step to start from");
          }
          const validatedFiles = mergeWorkflowFiles({}, input.files!);
          if (!validatedFiles.ok) return validatedFiles;
          checkedFiles = validatedFiles.value;
          if (flowChecker !== undefined) {
            const checked = await flowChecker(checkedFiles);
            if (!checked.ok) return checked;
            if (checked.value.errors.length > 0) {
              return fail(
                "invalid_input",
                `flow.ts has type errors:\n${checked.value.errors.join("\n")}`,
              );
            }
          }
          if (input.steps !== undefined && input.steps.length > 0) {
            const normalized = normalizeInlineSteps(input.steps);
            if (!normalized.ok) return normalized;
            steps = normalized.value;
          }
        } else {
          if (
            Object.keys(participants).length === 0 ||
            input.steps === undefined ||
            input.steps.length === 0
          ) {
            return fail(
              "invalid_input",
              "a one-off YAML workflow requires participants and at least one step (or provide files with flow.ts)",
            );
          }
          const normalized = normalizeInlineSteps(input.steps);
          if (!normalized.ok) return normalized;
          steps = normalized.value;
          if (
            input.step !== undefined &&
            !steps.some((s) => s.name === input.step)
          ) {
            return fail("not_found", "step not found");
          }
        }

        const flowAgent = isFlow
          ? (input.agent ?? LOPHN_AGENT_HANDLE)
          : undefined;
        if (options?.approver !== undefined) {
          const lines = buildOneOffApprovalLines({
            projectName: project.value.name,
            workflow: workflowName,
            execution: isFlow ? "flow" : "agent",
            participants,
            steps,
            ...(checkedFiles !== undefined ? { files: checkedFiles } : {}),
            ...(flowAgent !== undefined ? { flowAgent } : {}),
            ...(input.open !== undefined ? { open: input.open } : {}),
            text: input.text,
          });
          const approved = await options.approver({
            project: project.value.id,
            mode: "one_off",
            workflow: workflowName,
            execution: isFlow ? "flow" : "agent",
            lines,
            ...(input.tool_call !== undefined
              ? { toolCall: input.tool_call }
              : {}),
          });
          if (!approved.ok) return approved;
        }

        const validatedInputs =
          input.inputs !== undefined && Object.keys(input.inputs).length > 0
            ? input.inputs
            : undefined;
        const modesResolved = await resolveParticipantModes({
          project: project.value.id,
          workflow: workflowName,
          participants,
          steps: isFlow ? undefined : steps,
          explicit: undefined,
          explicitSteps: undefined,
          by,
          maxMode: undefined,
          callableRuntimeByName: undefined,
        });
        if (!modesResolved.ok) return modesResolved;
        const { participantModes, stepModes } = modesResolved.value;

        if (isFlow) {
          if (snapshots === undefined || snapshots.captureFiles === undefined) {
            return fail("unavailable", "workflow snapshots are not configured");
          }
          const captured = await snapshots.captureFiles(checkedFiles!);
          if (!captured.ok) return captured;
          const id = ids.newId("wfi") as Id<"wfi">;
          const initialTitle =
            explicitTitle ?? autoWorkflowTitle(input.text, validatedInputs);
          const flowSteps = steps.map((s) => {
            const override = input.step_open?.[s.name];
            return override !== undefined ? { ...s, open: override } : s;
          });
          const created = await store.create({
            id,
            project: project.value.id,
            workflow: workflowName,
            ...(initialTitle !== null ? { title: initialTitle } : {}),
            input: input.text,
            ...(validatedInputs !== undefined
              ? { inputs: validatedInputs }
              : {}),
            code_snapshot: captured.value,
            ...(input.open !== undefined ? { open_mode: input.open } : {}),
            ...(participantModes !== undefined
              ? { participant_modes: participantModes }
              : {}),
            one_off: true,
            flow_agent: flowAgent!,
            ...(by.kind === "agent" ? { editor_session: by.session } : {}),
            participants,
            steps: flowSteps,
            started_by: by,
            handoff: null,
          });
          if (!created.ok) return created;
          if (explicitTitle === null) {
            onTitleNeeded?.({
              instance: id,
              workflow: workflowName,
              input: created.value.instance.input,
              ...(created.value.instance.inputs !== undefined
                ? { inputs: created.value.instance.inputs }
                : {}),
              expected: created.value.instance.title ?? null,
            });
          }
          const launched = await flows.launch({
            instance: id,
            project: project.value.id,
            workflow: workflowName,
            input: created.value.instance.input,
            ...(created.value.instance.inputs !== undefined
              ? { inputs: created.value.instance.inputs }
              : {}),
            agent: flowAgent!,
            checkpoints: [],
            codeSnapshot:
              created.value.instance.code_snapshot ?? captured.value,
          });
          if (launched.ok) return created;
          await programExited({
            instance: id,
            code: null,
            stderr_tail: launched.error.message,
          });
          const again = await store.read(id);
          return ok({
            instance: again.ok ? again.value.instance : created.value.instance,
            handed: null,
          });
        }

        const effectiveSteps = steps.map((s) => {
          const override = input.step_open?.[s.name] ?? input.open;
          const stepMode = stepModes?.[s.name];
          return {
            ...s,
            ...(override !== undefined ? { open: override } : {}),
            ...(stepMode !== undefined ? { permission_mode: stepMode } : {}),
          };
        });
        const firstStep = input.step ?? effectiveSteps[0]!.name;
        const id = ids.newId("wfi") as Id<"wfi">;
        const initialTitle =
          explicitTitle ?? autoWorkflowTitle(input.text, validatedInputs);
        const created = await store.create({
          id,
          project: project.value.id,
          workflow: workflowName,
          ...(initialTitle !== null ? { title: initialTitle } : {}),
          input: input.text,
          ...(validatedInputs !== undefined ? { inputs: validatedInputs } : {}),
          ...(input.open !== undefined ? { open_mode: input.open } : {}),
          ...(participantModes !== undefined
            ? { participant_modes: participantModes }
            : {}),
          one_off: true,
          ...(by.kind === "agent" ? { editor_session: by.session } : {}),
          participants,
          steps: effectiveSteps,
          started_by: by,
          handoff: planHandoff({
            instance: {
              id,
              project: project.value.id,
              participants,
              steps: effectiveSteps,
            },
            step: firstStep,
            cause: "start",
            session: null,
            received: input.text,
            ...(validatedInputs !== undefined
              ? { inputs: validatedInputs }
              : {}),
            sameSession: () => null,
            remote,
          }),
        });
        if (created.ok && explicitTitle === null) {
          onTitleNeeded?.({
            instance: id,
            workflow: workflowName,
            input: created.value.instance.input,
            ...(created.value.instance.inputs !== undefined
              ? { inputs: created.value.instance.inputs }
              : {}),
            expected: created.value.instance.title ?? null,
          });
        }
        if (created.ok && created.value.handed !== null) {
          let remoteCall: string | null = null;
          if (
            created.value.handed.outcome === "handed" &&
            created.value.handed.receiver === null
          ) {
            const readAfter = await store.read(id);
            if (readAfter.ok) {
              const lastHanded = readAfter.value.lines.findLast(
                (l) => l.kind === "handed",
              );
              if (lastHanded?.kind === "handed") {
                remoteCall = lastHanded.remote?.call ?? null;
              }
            }
          }
          await recordYamlHandoffCheckpoint(store, {
            instance: id,
            handed: created.value.handed,
            remoteCall,
          });
        }
        return created;
      }

      // ---------- 기존 workflow의 instance 전용 override 모드 ----------
      if (
        input.name !== undefined ||
        input.participants !== undefined ||
        input.steps !== undefined ||
        input.files !== undefined ||
        input.agent !== undefined
      ) {
        return fail(
          "invalid_input",
          "use the override object when customizing an existing workflow",
        );
      }
      const [projectRef, name] = input.workflow.split("/") as [string, string];
      const project = await projects.resolve(projectRef);
      if (!project.ok) return project;
      if (
        options?.scopedProject !== undefined &&
        options.scopedProject !== null &&
        project.value.id !== options.scopedProject
      ) {
        return err({
          code: "forbidden",
          message: "an agent can only run workflows in its own project",
        });
      }
      const listed = await files.list(project.value.id);
      if (!listed.ok) return listed;
      const file = listed.value.find((f) => f.name === name);
      if (file === undefined) {
        return fail("not_found", "workflow not found");
      }
      const sdkInfo = await resolveFlowSdkInfo();
      const entry = entryOf(project.value.id, input.workflow, file, sdkInfo);
      const parsed = parseDeclaration(file);
      if (!entry.startable || !parsed.ok) {
        return fail(
          "conflict",
          entry.problem?.message ?? "workflow cannot be started",
        );
      }

      let validatedInputs: Record<string, unknown> | undefined;
      let callableRuntimeByName: Map<string, string | undefined> | undefined;
      if (parsed.declaration.inputs !== undefined) {
        let callableAgents: ReadonlySet<string> | undefined;
        const needsAgents = Object.values(parsed.declaration.inputs).some(
          (field) => field.type === "agent",
        );
        if (needsAgents && agents !== undefined) {
          const callable = await agents.listCallable(project.value.id);
          if (!callable.ok) return callable;
          callableAgents = new Set(callable.value.map((a) => a.name));
          callableRuntimeByName = new Map(
            callable.value.map((a) => [agentHandleKey(a.name), a.kind]),
          );
        }
        const checked = validateWorkflowInputs(
          parsed.declaration.inputs,
          input.inputs ?? {},
          callableAgents === undefined ? {} : { callableAgents },
        );
        if (!checked.ok) {
          const summary = Object.entries(checked.errors)
            .map(([field, msg]) => `${field}: ${msg}`)
            .join("; ");
          return fail("invalid_input", `invalid workflow inputs: ${summary}`);
        }
        if (Object.keys(checked.value).length > 0) {
          validatedInputs = checked.value;
        }
      } else if (
        input.inputs !== undefined &&
        Object.keys(input.inputs).length > 0
      ) {
        validatedInputs = input.inputs;
      }

      const baseParticipants = participantsOf(parsed.declaration);
      const baseSteps = file.flow
        ? flowStepsOf(parsed.declaration)
        : stepsOf(parsed.declaration);
      const applied = applyRunOverrides({
        baseParticipants,
        baseSteps,
        override: input.override,
      });
      if (!applied.ok) return applied;
      const { participants, steps: overriddenSteps, diffLines } = applied.value;

      const filePatches = input.override?.files;
      const effectiveIsFlow = file.flow
        ? !(
            filePatches !== undefined &&
            Object.hasOwn(filePatches, WORKFLOW_FLOW_FILE) &&
            filePatches[WORKFLOW_FLOW_FILE] === null
          )
        : hasFlowEntryFile(filePatches);

      let mergedFiles: Record<string, string> | undefined;
      let fileChanges: string[] = [];
      if (effectiveIsFlow) {
        if (input.step !== undefined) {
          return fail("invalid_input", "a flow has no step to start from");
        }
        if (filePatches !== undefined) {
          let baseFolderFiles: Record<string, string> = {};
          if (file.flow) {
            if (
              snapshots === undefined ||
              snapshots.readFolderFiles === undefined
            ) {
              return fail(
                "unavailable",
                "workflow folder snapshot read is not configured",
              );
            }
            const loadedFolder = await snapshots.readFolderFiles(
              project.value.id,
              name,
            );
            if (!loadedFolder.ok) return loadedFolder;
            baseFolderFiles = loadedFolder.value;
          }
          const merged = mergeWorkflowFiles(baseFolderFiles, filePatches);
          if (!merged.ok) return merged;
          if (!Object.hasOwn(merged.value, WORKFLOW_FLOW_FILE)) {
            return fail(
              "invalid_input",
              `${WORKFLOW_FLOW_FILE} is required for a flow workflow`,
            );
          }
          mergedFiles = merged.value;
          fileChanges = summarizeFileChanges(baseFolderFiles, filePatches);
          if (flowChecker !== undefined) {
            const checked = await flowChecker(mergedFiles);
            if (!checked.ok) return checked;
            if (checked.value.errors.length > 0) {
              return fail(
                "invalid_input",
                `flow.ts has type errors:\n${checked.value.errors.join("\n")}`,
              );
            }
          }
        }
      } else {
        if (filePatches !== undefined) {
          return fail(
            "invalid_input",
            `override.files must include ${WORKFLOW_FLOW_FILE} for a flow workflow`,
          );
        }
        if (
          Object.keys(participants).length === 0 ||
          overriddenSteps.length === 0
        ) {
          return fail(
            "invalid_input",
            "YAML workflow requires participants and at least one step after overrides",
          );
        }
      }

      const flowAgent = effectiveIsFlow
        ? (input.override?.agent ??
          parsed.declaration.agent ??
          LOPHN_AGENT_HANDLE)
        : undefined;
      const isOverridden =
        input.override !== undefined ||
        input.open !== undefined ||
        (input.step_open !== undefined &&
          Object.keys(input.step_open).length > 0);

      if (options?.approver !== undefined) {
        const lines = buildOverrideApprovalLines({
          projectName: project.value.name,
          workflow: name,
          execution: effectiveIsFlow ? "flow" : "agent",
          diffLines,
          fileChanges,
          ...(input.override?.agent !== undefined
            ? { flowAgentOverride: input.override.agent }
            : {}),
          ...(input.open !== undefined ? { openOverride: input.open } : {}),
          text: input.text,
        });
        const approved = await options.approver({
          project: project.value.id,
          mode: "override",
          workflow: name,
          execution: effectiveIsFlow ? "flow" : "agent",
          lines,
          ...(input.tool_call !== undefined
            ? { toolCall: input.tool_call }
            : {}),
        });
        if (!approved.ok) return approved;
      }

      const modesResolved = await resolveParticipantModes({
        project: project.value.id,
        workflow: name,
        participants,
        steps: effectiveIsFlow ? undefined : overriddenSteps,
        explicit: undefined,
        explicitSteps: undefined,
        by,
        maxMode: undefined,
        callableRuntimeByName,
      });
      if (!modesResolved.ok) return modesResolved;
      const { participantModes, stepModes } = modesResolved.value;

      if (effectiveIsFlow) {
        let codeSnapshot: string | undefined;
        if (mergedFiles !== undefined) {
          if (snapshots === undefined || snapshots.captureFiles === undefined) {
            return fail("unavailable", "workflow snapshots are not configured");
          }
          const captured = await snapshots.captureFiles(mergedFiles);
          if (!captured.ok) return captured;
          codeSnapshot = captured.value;
        } else if (snapshots !== undefined) {
          const captured = await snapshots.capture(project.value.id, name);
          if (!captured.ok) return captured;
          codeSnapshot = captured.value;
        }
        const id = ids.newId("wfi") as Id<"wfi">;
        const initialTitle =
          explicitTitle ?? autoWorkflowTitle(input.text, validatedInputs);
        const flowSteps = overriddenSteps.map((s) => {
          const override = input.step_open?.[s.name];
          return override !== undefined ? { ...s, open: override } : s;
        });
        const effectiveOpen = input.open ?? parsed.declaration.open;
        const created = await store.create({
          id,
          project: project.value.id,
          workflow: name,
          ...(initialTitle !== null ? { title: initialTitle } : {}),
          input: input.text,
          ...(validatedInputs !== undefined ? { inputs: validatedInputs } : {}),
          ...(codeSnapshot !== undefined
            ? { code_snapshot: codeSnapshot }
            : {}),
          ...(effectiveOpen !== undefined ? { open_mode: effectiveOpen } : {}),
          ...(participantModes !== undefined
            ? { participant_modes: participantModes }
            : {}),
          ...(isOverridden ? { overridden: true } : {}),
          ...(flowAgent !== undefined ? { flow_agent: flowAgent } : {}),
          ...(by.kind === "agent" ? { editor_session: by.session } : {}),
          participants,
          steps: flowSteps,
          started_by: by,
          handoff: null,
        });
        if (!created.ok) return created;
        if (explicitTitle === null) {
          onTitleNeeded?.({
            instance: id,
            workflow: name,
            input: created.value.instance.input,
            ...(created.value.instance.inputs !== undefined
              ? { inputs: created.value.instance.inputs }
              : {}),
            expected: created.value.instance.title ?? null,
          });
        }
        const launched = await flows.launch({
          instance: id,
          project: project.value.id,
          workflow: name,
          input: created.value.instance.input,
          ...(created.value.instance.inputs !== undefined
            ? { inputs: created.value.instance.inputs }
            : {}),
          agent: flowAgent!,
          checkpoints: [],
          ...(created.value.instance.code_snapshot !== undefined
            ? { codeSnapshot: created.value.instance.code_snapshot }
            : {}),
        });
        if (launched.ok) return created;
        await programExited({
          instance: id,
          code: null,
          stderr_tail: launched.error.message,
        });
        const again = await store.read(id);
        return ok({
          instance: again.ok ? again.value.instance : created.value.instance,
          handed: null,
        });
      }

      const steps = overriddenSteps.map((s) => {
        const override = input.step_open?.[s.name] ?? input.open;
        const stepMode = stepModes?.[s.name];
        return {
          ...s,
          ...(override !== undefined ? { open: override } : {}),
          ...(stepMode !== undefined ? { permission_mode: stepMode } : {}),
        };
      });
      const defaultStep =
        parsed.declaration.default_step !== undefined &&
        steps.some((s) => s.name === parsed.declaration.default_step)
          ? parsed.declaration.default_step
          : steps[0]!.name;
      const step = input.step ?? defaultStep;
      if (!steps.some((s) => s.name === step)) {
        return fail("not_found", "step not found");
      }
      const id = ids.newId("wfi") as Id<"wfi">;
      const initialTitle =
        explicitTitle ?? autoWorkflowTitle(input.text, validatedInputs);
      const created = await store.create({
        id,
        project: project.value.id,
        workflow: name,
        ...(initialTitle !== null ? { title: initialTitle } : {}),
        input: input.text,
        ...(validatedInputs !== undefined ? { inputs: validatedInputs } : {}),
        ...(input.open !== undefined ? { open_mode: input.open } : {}),
        ...(participantModes !== undefined
          ? { participant_modes: participantModes }
          : {}),
        ...(isOverridden ? { overridden: true } : {}),
        ...(by.kind === "agent" ? { editor_session: by.session } : {}),
        participants,
        steps,
        started_by: by,
        handoff: planHandoff({
          instance: { id, project: project.value.id, participants, steps },
          step,
          cause: "start",
          session: null,
          received: input.text,
          ...(validatedInputs !== undefined ? { inputs: validatedInputs } : {}),
          sameSession: () => null,
          remote,
        }),
      });
      if (created.ok && explicitTitle === null) {
        onTitleNeeded?.({
          instance: id,
          workflow: name,
          input: created.value.instance.input,
          ...(created.value.instance.inputs !== undefined
            ? { inputs: created.value.instance.inputs }
            : {}),
          expected: created.value.instance.title ?? null,
        });
      }
      if (created.ok && created.value.handed !== null) {
        let remoteCall: string | null = null;
        if (
          created.value.handed.outcome === "handed" &&
          created.value.handed.receiver === null
        ) {
          const readAfter = await store.read(id);
          if (readAfter.ok) {
            const lastHanded = readAfter.value.lines.findLast(
              (l) => l.kind === "handed",
            );
            if (lastHanded?.kind === "handed") {
              remoteCall = lastHanded.remote?.call ?? null;
            }
          }
        }
        await recordYamlHandoffCheckpoint(store, {
          instance: id,
          handed: created.value.handed,
          remoteCall,
        });
      }
      return created;
    },

    // 실행 중·막힌 flow instance 하나의 code_snapshot만 패치한다(원본 workflow 폴더는 건드리지 않는다).
    async overrideCode(
      input: z.output<typeof workflowOverrideCode.input>,
      by: LineBy,
      options?: {
        scopedProject?: string | null;
        approver?: WorkflowRunApprover;
      },
    ): Promise<Result<z.output<typeof workflowOverrideCode.output>>> {
      const read = await store.read(input.instance as Id<"wfi">);
      if (!read.ok) return read;
      const state = read.value;
      const { instance, lines } = state;
      if (
        options?.scopedProject !== undefined &&
        options.scopedProject !== null &&
        instance.project !== options.scopedProject
      ) {
        return err({
          code: "forbidden",
          message: "an agent can only override workflows in its own project",
        });
      }
      if (instance.state !== "running") {
        return fail("conflict", `workflow instance is ${instance.state}`);
      }
      if (!isFlowInstance(instance, lines)) {
        return fail(
          "conflict",
          "only flow workflow instances support code overrides",
        );
      }
      const checkpoints: WorkflowCheckpoint[] =
        state.checkpoints ??
        (await loadCheckpointsOf(instance.id as Id<"wfi">).then((r) =>
          r.ok && r.value !== undefined ? r.value : [],
        ));
      const hasInFlight = checkpoints.some(
        (cp) =>
          (cp.kind === "agent" || cp.kind === "tool") && cp.state === "started",
      );
      if (hasInFlight) {
        return fail(
          "conflict",
          "cannot override code while an agent or tool step is actively running",
        );
      }
      if (snapshots === undefined || snapshots.captureFiles === undefined) {
        return fail("unavailable", "workflow snapshots are not configured");
      }
      let currentFiles: Record<string, string>;
      if (
        instance.code_snapshot !== undefined &&
        instance.code_snapshot !== null
      ) {
        if (snapshots.readFiles === undefined) {
          return fail(
            "unavailable",
            "workflow snapshot read is not configured",
          );
        }
        const loaded = await snapshots.readFiles(instance.code_snapshot);
        if (!loaded.ok) return loaded;
        currentFiles = loaded.value;
      } else if (
        instance.one_off !== true &&
        snapshots.readFolderFiles !== undefined
      ) {
        const loaded = await snapshots.readFolderFiles(
          instance.project as Id<"prj">,
          instance.workflow,
        );
        if (!loaded.ok) return loaded;
        currentFiles = loaded.value;
      } else {
        return fail("conflict", "workflow instance has no code snapshot");
      }

      const merged = mergeWorkflowFiles(currentFiles, input.files);
      if (!merged.ok) return merged;
      if (!Object.hasOwn(merged.value, WORKFLOW_FLOW_FILE)) {
        return fail(
          "invalid_input",
          `${WORKFLOW_FLOW_FILE} cannot be removed from a flow instance`,
        );
      }
      if (flowChecker !== undefined) {
        const checked = await flowChecker(merged.value);
        if (!checked.ok) return checked;
        if (checked.value.errors.length > 0) {
          return fail(
            "invalid_input",
            `flow.ts has type errors:\n${checked.value.errors.join("\n")}`,
          );
        }
      }

      const shouldResume = input.resume !== false;
      const fileChanges = summarizeFileChanges(currentFiles, input.files);
      if (options?.approver !== undefined) {
        const approvalLines = buildOverrideCodeApprovalLines({
          instance: instance.id,
          workflow: instance.workflow,
          fileChanges,
          ...(input.agent !== undefined
            ? { flowAgentOverride: input.agent }
            : {}),
          resume: shouldResume,
        });
        const approved = await options.approver({
          project: instance.project as Id<"prj">,
          mode: "override_code",
          workflow: instance.workflow,
          execution: "flow",
          lines: approvalLines,
          ...(input.tool_call !== undefined
            ? { toolCall: input.tool_call }
            : {}),
        });
        if (!approved.ok) return approved;
      }

      const captured = await snapshots.captureFiles(merged.value);
      if (!captured.ok) return captured;

      await flows.stop(instance.id as Id<"wfi">);
      const updated = await apply(instance.id, ({ instance: fresh }) => {
        if (fresh.state !== "running") {
          return fail("conflict", `workflow instance is ${fresh.state}`);
        }
        return ok({
          instance: fresh.id,
          change: {
            kind: "code_updated",
            code_snapshot: captured.value,
            overridden: true,
            ...(input.agent !== undefined ? { flow_agent: input.agent } : {}),
          },
          by,
          handoff: null,
        });
      });
      if (!updated.ok) return updated;

      if (shouldResume) {
        const latestCheckpoints = await loadCheckpointsOf(
          instance.id as Id<"wfi">,
        ).then((r) => (r.ok ? r.value : checkpoints));
        const agent = await resolveFlowAgentName(
          instance.project as Id<"prj">,
          instance.workflow,
          input.agent ?? instance.flow_agent,
        );
        const launched = await flows.launch({
          instance: instance.id as Id<"wfi">,
          project: instance.project as Id<"prj">,
          workflow: instance.workflow,
          input: updated.value.instance.input,
          ...(updated.value.instance.inputs !== undefined
            ? { inputs: updated.value.instance.inputs }
            : {}),
          agent,
          checkpoints: latestCheckpoints,
          codeSnapshot: captured.value,
        });
        if (!launched.ok) {
          await programExited({
            instance: instance.id as Id<"wfi">,
            code: null,
            stderr_tail: launched.error.message,
          });
        }
      }

      const refreshed = await store.read(instance.id as Id<"wfi">);
      return ok({
        instance: refreshed.ok
          ? refreshed.value.instance
          : updated.value.instance,
      });
    },

    // 일회성 또는 override된 instance를 project의 정식 workflow 폴더로 저장(승격)한다.
    async save(
      input: z.output<typeof workflowSave.input>,
      options?: { scopedProject?: string | null },
    ): Promise<Result<z.output<typeof workflowSave.output>>> {
      if (typeof files.importBundle !== "function") {
        return fail("unavailable", "workflow save is not configured");
      }
      const read = await store.read(input.instance as Id<"wfi">);
      if (!read.ok) return read;
      const { instance, lines } = read.value;
      if (
        options?.scopedProject !== undefined &&
        options.scopedProject !== null &&
        instance.project !== options.scopedProject
      ) {
        return err({
          code: "forbidden",
          message: "an agent can only save workflows in its own project",
        });
      }

      const flow = isFlowInstance(instance, lines);
      const bundle: WorkflowExportFile[] = [];
      const encode = (text: string) =>
        Buffer.from(text, "utf8").toString("base64");

      if (flow) {
        let sourceFiles: Record<string, string> = {};
        if (
          instance.code_snapshot !== undefined &&
          instance.code_snapshot !== null
        ) {
          if (snapshots === undefined || snapshots.readFiles === undefined) {
            return fail(
              "unavailable",
              "workflow snapshot read is not configured",
            );
          }
          const loaded = await snapshots.readFiles(instance.code_snapshot);
          if (!loaded.ok) return loaded;
          sourceFiles = loaded.value;
        } else if (
          instance.one_off !== true &&
          snapshots?.readFolderFiles !== undefined
        ) {
          const loaded = await snapshots.readFolderFiles(
            instance.project as Id<"prj">,
            instance.workflow,
          );
          if (!loaded.ok) return loaded;
          sourceFiles = loaded.value;
        }
        if (!Object.hasOwn(sourceFiles, WORKFLOW_FLOW_FILE)) {
          return fail(
            "conflict",
            "flow instance has no flow.ts snapshot to save",
          );
        }
        const sdkInfo = await resolveFlowSdkInfo();
        const hasDecl = Object.hasOwn(sourceFiles, WORKFLOW_DECLARATION_FILE);
        for (const [path, content] of Object.entries(sourceFiles).sort(
          ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
        )) {
          bundle.push({ path, content_base64: encode(content) });
        }
        if (!hasDecl) {
          bundle.unshift({
            path: WORKFLOW_DECLARATION_FILE,
            content_base64: encode(
              serializeInstanceToYaml({
                instance,
                isFlow: true,
                flowSdkVersion: sdkInfo.current,
              }),
            ),
          });
        }
      } else {
        bundle.push({
          path: WORKFLOW_DECLARATION_FILE,
          content_base64: encode(
            serializeInstanceToYaml({
              instance,
              isFlow: false,
            }),
          ),
        });
      }

      const written = await files.importBundle(
        instance.project as Id<"prj">,
        input.name,
        bundle,
        { overwrite: input.overwrite === true },
      );
      if (!written.ok) return written;
      lifecycle?.publishImported?.(instance.project as Id<"prj">, input.name);
      return ok({
        project: instance.project as Id<"prj">,
        name: input.name,
        kind: flow ? "flow" : "agent",
        files_written: written.value.files_written,
      });
    },

    async report(input: z.output<typeof workflowReport.input>, by: LineBy) {
      if (input.next !== undefined && input.next_steps !== undefined) {
        return fail("invalid_input", "cannot specify both next and next_steps");
      }
      if (
        input.insert_steps !== undefined &&
        (input.next !== undefined || input.next_steps !== undefined)
      ) {
        return fail(
          "invalid_input",
          "cannot combine insert_steps with next or next_steps; use then_step to link after inserted steps",
        );
      }
      // 다른 컴퓨터에서 받은 step이면 이 컴퓨터에는 instance가 없다. 그 step을 받은 session의 report만 보낸 컴퓨터로 간다.
      if (by.kind === "agent") {
        const call = await remote.receivedStep(
          by.session as Id<"ses">,
          input.instance as Id<"wfi">,
          input.step,
        );
        if (!call.ok) return call;
        if (call.value !== null) {
          const sent = await remote.report({
            call: call.value,
            session: by.session as Id<"ses">,
            text: input.text,
            next: input.next ?? null,
            choice: input.session ?? "new",
          });
          return sent.ok ? ok({ line: null, handed: null }) : sent;
        }
      }
      let wasYaml = false;
      let wasHumanTurn = false;
      let completedTargets = false;
      let cancelledSteps: string[] = [];
      let cancelledSessions: Id<"ses">[] = [];
      const done = await apply(input.instance, (state) => {
        const { instance, lines } = state;
        wasYaml = !isFlowInstance(instance, lines);
        const activeList = activeStepsOf(instance);
        wasHumanTurn =
          activeList.some((a) => a.step === input.step && a.human_turn) ||
          (instance.current?.step === input.step &&
            instance.current.human_turn);
        const session = input.session ?? "new";

        if (input.insert_steps !== undefined) {
          if (!wasYaml) {
            return fail(
              "conflict",
              "insert_steps is only supported on YAML workflow instances",
            );
          }
          if (instance.state === "stopped") {
            return fail("conflict", "workflow instance is stopped");
          }
          const preview = insertStepsInto(instance.steps, {
            steps: input.insert_steps,
            sourceStep: input.step,
            ...(input.then_step !== undefined
              ? { thenStep: input.then_step }
              : {}),
            ...(input.join !== undefined ? { join: input.join } : {}),
          });
          if (!preview.ok) return preview;
          const insertedNames = preview.value.inserted;
          const nextSingle =
            insertedNames.length === 1 ? insertedNames[0]! : null;
          const nextMulti =
            insertedNames.length > 1 ? insertedNames : undefined;
          completedTargets = true;
          cancelledSteps = [];
          cancelledSessions = [];
          const nextInstance = { ...instance, steps: preview.value.steps };
          const handoffPlans = insertedNames.map((target) =>
            planHandoff({
              instance: nextInstance,
              step: target,
              cause: "report",
              session,
              received: input.text,
              sameSession: sameSessionIn(state),
              remote,
            }),
          );
          return ok({
            instance: instance.id,
            change: {
              kind: "report",
              step: input.step,
              text: input.text,
              next: nextSingle,
              ...(nextMulti !== undefined ? { next_steps: nextMulti } : {}),
              insert_steps: {
                steps: input.insert_steps,
                after: input.step,
                ...(input.then_step !== undefined
                  ? { then_step: input.then_step }
                  : {}),
                ...(input.join !== undefined ? { join: input.join } : {}),
              },
              session,
              ...(input.refs !== undefined ? { refs: input.refs } : {}),
              ...(input.data !== undefined ? { data: input.data } : {}),
            },
            by,
            handoff: handoffPlans[0] ?? null,
            ...(handoffPlans.length > 0 ? { handoffs: handoffPlans } : {}),
          });
        }

        const next = input.next ?? null;
        const nextSteps =
          input.next_steps !== undefined && input.next_steps.length === 1
            ? undefined
            : input.next_steps;
        const effectiveNext =
          input.next_steps !== undefined && input.next_steps.length === 1
            ? input.next_steps[0]!
            : next;
        const targets =
          nextSteps !== undefined
            ? nextSteps
            : effectiveNext !== null
              ? [effectiveNext]
              : [];
        completedTargets = targets.length > 0;
        cancelledSteps = [];
        cancelledSessions = [];

        // stopped·end·next 없음은 넘기지 않는다. stopped의 report는 줄만 남는다.
        // flow(program)의 report도 넘기지 않는다. next는 current를 옮기고 닫는 데만 쓴다.
        let handoffPlans: HandoffPlan[] = [];
        if (
          by.kind !== "program" &&
          instance.state !== "stopped" &&
          targets.length > 0
        ) {
          const transition = evaluateParallelTransition({
            instance,
            lines,
            completedStep: input.step,
            completedText: input.text,
            targets,
          });
          cancelledSteps = transition.cancelSteps;
          for (const cancelStep of cancelledSteps) {
            const handedLine = lines.findLast(
              (l) =>
                l.kind === "handed" &&
                l.step === cancelStep &&
                l.receiver !== null,
            );
            if (handedLine?.kind === "handed" && handedLine.receiver !== null) {
              cancelledSessions.push(handedLine.receiver as Id<"ses">);
            }
          }
          handoffPlans = transition.handoffs.map((h) =>
            planHandoff({
              instance,
              step: h.step,
              cause: "report",
              session,
              received: h.received,
              sameSession: sameSessionIn(state),
              remote,
            }),
          );
        }
        return ok({
          instance: instance.id,
          change: {
            kind: "report",
            step: input.step,
            text: input.text,
            next: effectiveNext,
            ...(nextSteps !== undefined ? { next_steps: nextSteps } : {}),
            session,
            ...(input.refs !== undefined ? { refs: input.refs } : {}),
            ...(input.data !== undefined ? { data: input.data } : {}),
          },
          by,
          handoff: handoffPlans[0] ?? null,
          ...(handoffPlans.length > 0 ? { handoffs: handoffPlans } : {}),
          ...(cancelledSteps.length > 0
            ? { cancel_steps: cancelledSteps }
            : {}),
        });
      });
      if (!done.ok) return done;

      // join: any 합류로 취소된 병렬 형제 step의 실행 중 turn을 멈추고 checkpoint를 취소로 닫는다.
      for (const ses of cancelledSessions) {
        await turns.stopSession(ses);
      }
      if (wasYaml && cancelledSteps.length > 0) {
        for (const stepName of cancelledSteps) {
          await recordYamlCancelCheckpoint(store, {
            instance: input.instance as Id<"wfi">,
            step: stepName,
          });
        }
      }

      // flow의 agent(mode: "report") / human() 대기자에게 즉시 알린다.
      if (by.kind === "agent") {
        emitReport({
          instance: input.instance as Id<"wfi">,
          step: input.step,
          session: by.session as Id<"ses">,
          summary: input.text,
          ...(input.refs !== undefined ? { refs: input.refs } : {}),
          ...(input.data !== undefined ? { data: input.data } : {}),
        });
      }

      // YAML 내장 interpreter checkpoint 기록: 완료 report는 completed, 다음 넘김은 모두 started.
      if (wasYaml && by.kind !== "program") {
        if (completedTargets) {
          await recordYamlReportCheckpoint(store, {
            instance: input.instance as Id<"wfi">,
            step: input.step,
            humanTurn: wasHumanTurn,
            session: by.kind === "agent" ? by.session : undefined,
            output: {
              summary: input.text,
              ...(input.refs !== undefined ? { refs: input.refs } : {}),
              ...(input.data !== undefined ? { data: input.data } : {}),
            },
          });
        }
        const handedResults =
          done.value.handed_all ??
          (done.value.handed !== null ? [done.value.handed] : []);
        const succeeded = handedResults.filter((h) => h.outcome === "handed");
        if (succeeded.length > 0) {
          let afterLines: State["lines"] | null = null;
          for (const item of succeeded) {
            let remoteCall: string | null = null;
            if (item.receiver === null) {
              if (afterLines === null) {
                const after = await store.read(input.instance as Id<"wfi">);
                afterLines = after.ok ? after.value.lines : [];
              }
              const lastHanded = afterLines.findLast(
                (l) => l.kind === "handed" && l.step === item.step,
              );
              if (lastHanded?.kind === "handed") {
                remoteCall = lastHanded.remote?.call ?? null;
              }
            }
            await recordYamlHandoffCheckpoint(store, {
              instance: input.instance as Id<"wfi">,
              handed: item,
              remoteCall,
            });
          }
        }
      }

      return ok({
        line: done.value.line,
        handed: done.value.handed,
        ...(done.value.handed_all !== undefined
          ? { handed_all: done.value.handed_all }
          : {}),
      });
    },

    // 다른 컴퓨터의 참가자가 낸 report(reply mail). mail 입구가 부른다. 그 call로 넘긴 step이 없으면 null이다(Router의 보통 길로 간다).
    // 본 기록, report 줄, 다음 넘기기가 ApplyWorkflowChange 하나에서 된다. 그 기계로 보낸 열린 step이 아니거나 이미 본 mail이면 conflict다.
    async remoteReport(
      mail: Extract<Mail, { kind: "reply" }>,
      origin: { machine: string; computer: string },
    ): Promise<Result<null | { line: string | null }>> {
      const report = mail.report;
      const hand = remote.handOf(mail.call);
      // 그 컴퓨터의 program이 쓴 진행 줄(step을 가져간 turn이 report 없이 끝남)은 본문이 없고 글을 이 컴퓨터가 쓴다.
      const ended = report?.ended;
      if (
        report === undefined ||
        (mail.body === null && ended === undefined) ||
        !hand.ok
      ) {
        return hand.ok ? ok(null) : hand;
      }
      if (hand.value === null) return ok(null);
      const { instance: id, step } = hand.value;
      const machine = origin.machine as Id<"mch">;
      let wasYaml = false;
      let wasHumanTurn = false;
      let cancelledSteps: string[] = [];
      let cancelledSessions: Id<"ses">[] = [];
      const text =
        ended === undefined
          ? blocksText(mail.body!)
          : remoteTurnEndedText(origin.computer, ended);
      const done = await apply(id, (state) => {
        const { instance, lines } = state;
        wasYaml = !isFlowInstance(instance, lines);
        const activeList = activeStepsOf(instance);
        wasHumanTurn =
          activeList.some((a) => a.step === step && a.human_turn) ||
          (instance.current?.step === step && instance.current.human_turn);
        const next = ended === undefined ? report.next : null;
        cancelledSteps = [];
        cancelledSessions = [];
        let handoffPlans: HandoffPlan[] = [];
        if (instance.state !== "stopped" && next !== null) {
          const transition = evaluateParallelTransition({
            instance,
            lines,
            completedStep: step,
            completedText: text,
            targets: [next],
          });
          cancelledSteps = transition.cancelSteps;
          for (const cancelStep of cancelledSteps) {
            const handedLine = lines.findLast(
              (l) =>
                l.kind === "handed" &&
                l.step === cancelStep &&
                l.receiver !== null,
            );
            if (handedLine?.kind === "handed" && handedLine.receiver !== null) {
              cancelledSessions.push(handedLine.receiver as Id<"ses">);
            }
          }
          handoffPlans = transition.handoffs.map((h) =>
            planHandoff({
              instance,
              step: h.step,
              cause: "report",
              session: report.session,
              received: h.received,
              sameSession: sameSessionIn(state),
              remote,
            }),
          );
        }
        return ok({
          instance: instance.id,
          change: {
            kind: "report",
            step,
            text,
            next,
            session: report.session,
          },
          by:
            ended === undefined
              ? {
                  kind: "remote",
                  machine,
                  computer: origin.computer,
                  name: mail.from.name,
                }
              : { kind: "remote_lophn", machine, computer: origin.computer },
          handoff: handoffPlans[0] ?? null,
          ...(handoffPlans.length > 0 ? { handoffs: handoffPlans } : {}),
          ...(cancelledSteps.length > 0
            ? { cancel_steps: cancelledSteps }
            : {}),
          mail: { mail, origin },
        });
      });
      if (done.ok) {
        for (const ses of cancelledSessions) {
          await turns.stopSession(ses);
        }
        if (wasYaml && cancelledSteps.length > 0) {
          for (const stepName of cancelledSteps) {
            await recordYamlCancelCheckpoint(store, {
              instance: id,
              step: stepName,
            });
          }
        }
        if (ended === undefined && mail.from.session !== undefined) {
          emitReport({
            instance: id,
            step,
            session: mail.from.session as Id<"ses">,
            summary: text,
          });
        }
        if (wasYaml && ended === undefined) {
          if (report.next !== null) {
            await recordYamlReportCheckpoint(store, {
              instance: id,
              step,
              humanTurn: wasHumanTurn,
              output: { summary: text },
            });
          }
          const handedResults =
            done.value.handed_all ??
            (done.value.handed !== null ? [done.value.handed] : []);
          for (const item of handedResults) {
            if (item.outcome === "handed") {
              await recordYamlHandoffCheckpoint(store, {
                instance: id,
                handed: item,
              });
            }
          }
        }
        return ok({ line: done.value.line });
      }
      // 다시 읽어 걸어도 instance가 계속 바뀌었다. 본 것으로 적지 않고 그 컴퓨터가 같은 mail을 다시 보내게 한다.
      return done.error.code === "conflict"
        ? err({ code: "unavailable", message: done.error.message })
        : done;
    },

    async edit(input: z.output<typeof workflowEdit.input>, by: LineBy) {
      const { instance: id, ...edit } = input;
      let wasYaml = false;
      let stoppedSessions: Id<"ses">[] = [];
      let cancelledSteps: string[] = [];
      const done = await apply(id, (state) => {
        const { instance, lines } = state;
        wasYaml = !isFlowInstance(instance, lines);
        if (instance.state === "stopped") {
          return fail("conflict", "workflow instance is stopped");
        }
        stoppedSessions = [];
        cancelledSteps = [];
        let handoffPlans: HandoffPlan[] = [];
        if (edit.op === "hand_now") {
          const session = edit.session ?? "new";
          const lastReport = lines.findLast(
            (l): l is ReportLine => l.kind === "report",
          );
          const targetNames =
            edit.steps !== undefined && edit.steps.length > 0
              ? edit.steps
              : [edit.step];
          handoffPlans = targetNames.map((stepName) =>
            planHandoff({
              instance,
              step: stepName,
              cause: "edit",
              session,
              received: edit.text ?? lastReport?.text ?? instance.input,
              sameSession: sameSessionIn(state),
              remote,
            }),
          );
        } else if (edit.op === "insert_steps" && edit.hand_now === true) {
          const preview = insertStepsInto(instance.steps, {
            steps: edit.steps,
            ...(edit.after !== undefined ? { after: edit.after } : {}),
            ...(edit.then_step !== undefined
              ? { thenStep: edit.then_step }
              : {}),
            ...(edit.join !== undefined ? { join: edit.join } : {}),
          });
          if (!preview.ok) return preview;
          const session = edit.session ?? "new";
          const lastReport = lines.findLast(
            (l): l is ReportLine => l.kind === "report",
          );
          const nextInstance = { ...instance, steps: preview.value.steps };
          handoffPlans = preview.value.inserted.map((stepName) =>
            planHandoff({
              instance: nextInstance,
              step: stepName,
              cause: "edit",
              session,
              received: edit.text ?? lastReport?.text ?? instance.input,
              sameSession: sameSessionIn(state),
              remote,
            }),
          );
        } else if (edit.op === "remove_step") {
          const removedDef = instance.steps.find((s) => s.name === edit.name);
          if (removedDef === undefined) {
            return fail("not_found", "step not found");
          }
          const wasActive = activeStepsOf(instance).some(
            (a) => a.step === edit.name,
          );
          if (wasActive) {
            const handedLine = lines.findLast(
              (l) =>
                l.kind === "handed" &&
                l.step === edit.name &&
                l.receiver !== null,
            );
            if (handedLine?.kind === "handed" && handedLine.receiver !== null) {
              stoppedSessions.push(handedLine.receiver as Id<"ses">);
            }
            // 제거된 병렬 형제를 기다리던 join 대상 step이 이제 조건을 채우면 즉시 합류한다.
            const remainingSteps = instance.steps.filter(
              (s) => s.name !== edit.name,
            );
            const candidateTargets = new Set<string>(
              removedDef.next.filter((n) => n !== "end"),
            );
            for (const s of remainingSteps) {
              if (s.needs?.includes(edit.name)) candidateTargets.add(s.name);
            }
            if (candidateTargets.size > 0) {
              const transition = evaluateParallelTransition({
                instance: {
                  ...instance,
                  steps: remainingSteps,
                },
                lines,
                completedStep: edit.name,
                completedText: null,
                targets: [...candidateTargets],
              });
              cancelledSteps = transition.cancelSteps;
              handoffPlans = transition.handoffs.map((h) =>
                planHandoff({
                  instance: { ...instance, steps: remainingSteps },
                  step: h.step,
                  cause: "edit",
                  session: "new",
                  received: h.received,
                  sameSession: sameSessionIn(state),
                  remote,
                }),
              );
            }
          }
        }
        return ok({
          instance: id,
          change: { kind: "edit", edit },
          by,
          handoff: handoffPlans[0] ?? null,
          ...(handoffPlans.length > 0 ? { handoffs: handoffPlans } : {}),
          ...(cancelledSteps.length > 0
            ? { cancel_steps: cancelledSteps }
            : {}),
        });
      });
      if (!done.ok) return done;
      for (const ses of stoppedSessions) {
        await turns.stopSession(ses);
      }
      if (wasYaml && edit.op === "remove_step") {
        await recordYamlCancelCheckpoint(store, {
          instance: id as Id<"wfi">,
          step: edit.name,
          message: "step removed from workflow instance",
        });
      }
      if (wasYaml) {
        const handedResults =
          done.value.handed_all ??
          (done.value.handed !== null ? [done.value.handed] : []);
        for (const item of handedResults) {
          if (item.outcome === "handed") {
            await recordYamlHandoffCheckpoint(store, {
              instance: id as Id<"wfi">,
              handed: item,
            });
          }
        }
      }
      return ok({
        line: done.value.line,
        handed: done.value.handed,
        ...(done.value.handed_all !== undefined
          ? { handed_all: done.value.handed_all }
          : {}),
      });
    },

    async setEditorSession(
      instanceId: Id<"wfi">,
      session: Id<"ses"> | null,
    ): Promise<Result<State["instance"]>> {
      const done = await apply(instanceId, ({ instance }) =>
        ok({
          instance: instance.id,
          change: { kind: "set_editor_session", session },
          by: { kind: "user" },
          handoff: null,
        }),
      );
      return done.ok ? ok(done.value.instance) : done;
    },

    async retry(input: z.output<typeof workflowRetry.input>) {
      let seen: string | null = null;
      let last: Result<never> | null = null;
      for (let attempt = 0; ; attempt++) {
        const read = await store.read(input.instance as Id<"wfi">);
        if (!read.ok) return read;
        const state = read.value;
        if (seen === state.instance.state_seq) return last!;
        const target = retryTargetOf(state, input.step);
        if (!target.ok) return target;
        let applyInput: ApplyInput;
        if (target.value.mode === "re_handoff") {
          const { step } = target.value;
          const lastReport = state.lines.findLast(
            (l): l is ReportLine => l.kind === "report",
          );
          const session =
            lastReport !== undefined && lastReport.next === step
              ? lastReport.session
              : null;
          applyInput = {
            instance: state.instance.id,
            change: { kind: "retried", step, session: null },
            by: { kind: "user" },
            handoff: planHandoff({
              instance: state.instance,
              step,
              cause: "retry",
              session,
              received: lastReport?.text ?? state.instance.input,
              ...(lastReport === undefined &&
              state.instance.inputs !== undefined
                ? { inputs: state.instance.inputs }
                : {}),
              sameSession: sameSessionIn(state),
              remote,
            }),
          };
        } else {
          const { step, session, blockedByLine } = target.value;
          if (!blockedByLine) {
            const found = await turns.stepTurn(
              session,
              state.instance.id as Id<"wfi">,
              step,
            );
            if (!found.ok) return found;
            const turn = found.value;
            const failedTurn =
              turn !== null &&
              turn.state === "finished" &&
              (turn.outcome?.kind === "failed" ||
                turn.outcome?.kind === "interrupted");
            if (!failedTurn) {
              return fail("conflict", "workflow step is not blocked");
            }
          }
          const stepDef =
            state.instance.steps.find((s) => s.name === step) ?? null;
          applyInput = {
            instance: state.instance.id,
            change: {
              kind: "retried",
              step,
              session,
              body: retryContinueBody(stepDef, step),
            },
            by: { kind: "user" },
            handoff: null,
          };
        }
        const done = await store.apply(applyInput, {
          state_seq: state.instance.state_seq,
        });
        if (done.ok) {
          notifyInstanceUpdated(state.instance.id);
          if (!isFlowInstance(state.instance, state.lines)) {
            if (target.value.mode === "same_session") {
              await recordYamlRetryCheckpoint(store, {
                instance: state.instance.id as Id<"wfi">,
                step: target.value.step,
                session: target.value.session,
                humanTurn: state.instance.current?.human_turn === true,
              });
            } else if (done.value.handed?.outcome === "handed") {
              await recordYamlHandoffCheckpoint(store, {
                instance: state.instance.id as Id<"wfi">,
                handed: done.value.handed,
              });
            }
          }
          return ok({ instance: done.value.instance, line: done.value.line });
        }
        if (done.error.code !== "conflict" || attempt >= 2) return done;
        seen = state.instance.state_seq;
        last = done;
      }
    },

    // 사람이 막힌(step_stalled·lophn_restarted) step의 session에 직접 새 turn을 시작하면
    // 중복 입력 없이 retried 줄을 남겨 working 상태로 즉시 복구한다.
    async sessionResumed(session: Id<"ses">): Promise<void> {
      const running = await store.running();
      if (!running.ok) return;
      for (const item of running.value) {
        const read = await store.read(item.id as Id<"wfi">);
        if (!read.ok) {
          skip(item.id, read.error.code);
          continue;
        }
        const stalledStep = stalledToResumeFor(read.value, session);
        if (stalledStep === null) continue;
        let alreadyResolved = false;
        let wasYaml = false;
        const done = await apply(item.id, (freshState) => {
          const step = stalledToResumeFor(freshState, session);
          if (step === null) {
            alreadyResolved = true;
            return fail("conflict", "step already resumed");
          }
          wasYaml = !isFlowInstance(freshState.instance, freshState.lines);
          return ok({
            instance: freshState.instance.id,
            change: {
              kind: "retried",
              step,
              session,
            },
            by: { kind: "user" },
            handoff: null,
          });
        });
        if (done.ok && wasYaml) {
          await recordYamlRetryCheckpoint(store, {
            instance: item.id as Id<"wfi">,
            step: stalledStep,
            session,
            humanTurn: false,
          });
        } else if (!done.ok && !alreadyResolved) {
          skip(item.id, done.error.code);
        }
      }
    },

    // local non-human step을 받은 session의 turn이 끝났을 때, 명시적 완료 report·열린 하위 call·
    // 대기 중 입력·후속 turn이 모두 없으면 넘김/retry 시도당 최대 한 번 step_stalled 줄을 남긴다.
    async turnEnded(event: {
      session: Id<"ses">;
      turn?: Id<"trn">;
      outcome: TurnOutcome;
      error?: { code: string; message: string } | null;
    }): Promise<void> {
      // 재시작으로 끊긴 turn은 reconcile()이 lophn_restarted 줄을 남긴다.
      if (
        event.outcome.kind === "interrupted" &&
        event.outcome.reason === "restarted"
      ) {
        return;
      }
      const running = await store.running();
      if (!running.ok) return;
      let reason: string | undefined;
      let message: string | undefined;
      if (event.outcome.kind === "failed") {
        reason = event.outcome.reason;
        message =
          event.error?.message !== undefined && event.error.message !== ""
            ? event.error.message
            : event.outcome.reason.replaceAll("_", " ");
      } else if (event.outcome.kind === "interrupted") {
        reason = event.outcome.reason;
        message = event.outcome.reason.replaceAll("_", " ");
      }
      for (const item of running.value) {
        const hasActiveNonHuman = activeStepsOf(item).some(
          (a) => !a.human_turn,
        );
        if (!hasActiveNonHuman) continue;
        const read = await store.read(item.id as Id<"wfi">);
        if (!read.ok) {
          skip(item.id, read.error.code);
          continue;
        }
        if (stalledStepFor(read.value, event.session) === null) continue;
        const open = await turns.openOutgoingCalls(event.session);
        if (!open.ok) {
          skip(item.id, open.error.code);
          continue;
        }
        if (open.value > 0) continue;
        // 직전 turn 실행 중 마지막 worker 응답 등이 도착해 대기 중이거나 이미 후속 turn이 열렸으면 stall이 아니다.
        // 상태 전이(open call -> pending message -> running turn -> newer turn) 순서대로 확인해 틈을 없앤다.
        if (turns.hasPendingMessages !== undefined) {
          const pending = await turns.hasPendingMessages(event.session);
          if (!pending.ok) {
            skip(item.id, pending.error.code);
            continue;
          }
          if (pending.value) continue;
        }
        if (turns.isTurnRunning !== undefined) {
          const active = await turns.isTurnRunning(event.session);
          if (!active.ok) {
            skip(item.id, active.error.code);
            continue;
          }
          if (active.value) continue;
        }
        if (event.turn !== undefined && turns.lastTurn !== undefined) {
          const latest = await turns.lastTurn(event.session);
          if (!latest.ok) {
            skip(item.id, latest.error.code);
            continue;
          }
          if (latest.value !== null && latest.value.turn !== event.turn) {
            continue;
          }
        }
        let alreadyResolved = false;
        const done = await apply(item.id, (freshState) => {
          const step = stalledStepFor(freshState, event.session);
          if (step === null) {
            alreadyResolved = true;
            return fail("conflict", "step already resolved");
          }
          return ok({
            instance: freshState.instance.id,
            change: {
              kind: "step_stalled",
              step,
              session: event.session,
              ...(reason !== undefined ? { reason } : {}),
              ...(message !== undefined ? { message } : {}),
            },
            by: { kind: "lophn" },
            handoff: null,
          });
        });
        if (!done.ok && !alreadyResolved) skip(item.id, done.error.code);
      }
    },

    async stop(input: z.output<typeof workflowStop.input>, by: LineBy) {
      return await stopRecursive(input.instance as Id<"wfi">, by, new Set());
    },

    // 켤 때 한 번(router가 돌던 turn을 닫은 뒤).
    // 1단계: 모든 running instance의 checkpoint·lophn_restarted를 확정(idle human은 started 유지, 끊긴 agent/tool/human은 interrupted).
    // 2단계: code_snapshot이 있는 durable flow instance를 replay로 다시 띄운다(자식까지 모두 정리된 뒤 실행).
    async reconcile(): Promise<void> {
      const running = await store.running();
      if (!running.ok) return;
      const toRelaunch: Array<{
        instance: State["instance"];
        checkpoints: WorkflowCheckpoint[];
      }> = [];
      for (const { id } of running.value) {
        try {
          const result = await reconcileOne(id as Id<"wfi">);
          if (result.relaunch !== undefined) {
            toRelaunch.push(result.relaunch);
          }
        } catch (e) {
          logger.error({
            component: "workflows",
            event: "reconcile_failed",
            message: `workflows: could not reconcile ${id}`,
            fields: { error: String(e) },
          });
        }
      }
      for (const item of toRelaunch) {
        try {
          const agent = await resolveFlowAgentName(
            item.instance.project as Id<"prj">,
            item.instance.workflow,
            item.instance.flow_agent,
          );
          const launched = await flows.launch({
            instance: item.instance.id as Id<"wfi">,
            project: item.instance.project as Id<"prj">,
            workflow: item.instance.workflow,
            input: item.instance.input,
            ...(item.instance.inputs !== undefined
              ? { inputs: item.instance.inputs }
              : {}),
            agent,
            checkpoints: item.checkpoints,
            codeSnapshot: item.instance.code_snapshot ?? null,
          });
          if (!launched.ok) {
            await programExited({
              instance: item.instance.id as Id<"wfi">,
              code: null,
              stderr_tail: launched.error.message,
            });
          }
        } catch (e) {
          logger.error({
            component: "workflows",
            event: "reconcile_launch_failed",
            message: `workflows: could not relaunch ${item.instance.id}`,
            fields: { error: String(e) },
          });
        }
      }
    },
  };
}

export type WorkflowService = ReturnType<typeof createWorkflowService>;
