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
  blocksText,
  LOPHN_AGENT_HANDLE,
  type TurnOutcome,
} from "../../protocol/lophn-agent/mod.ts";
import type { Input, Output } from "../../protocol/server/mod.ts";
import {
  type FlowAgentMode,
  type HandoffPlan,
  type LineBy,
  type ReportLine,
  type SessionChoice,
  type StartedBy,
  validateWorkflowInputs,
  type WorkflowCheckpoint,
  type WorkflowSoftOutput,
  type workflowCheckpointUpsert,
  type workflowEdit,
  type workflowInstanceApply,
  type workflowInstanceRead,
  type workflowList,
  type workflowReport,
  type workflowResume,
  type workflowRetry,
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
  entryOf,
  flowStepsOf,
  parseDeclaration,
  participantsOf,
  stepsOf,
} from "./declaration.ts";
import { planHandoff, retryContinueBody } from "./plan.ts";
import type {
  WorkflowAgents,
  WorkflowFiles,
  WorkflowFlows,
  WorkflowProjects,
  WorkflowRemote,
  WorkflowSnapshots,
  WorkflowStore,
  WorkflowTurns,
} from "./ports.ts";
import { deriveWorkflowStatus } from "./reads.ts";
import { remoteTurnEndedText } from "./remote.ts";
import { STATUS_LINE_KINDS, type StatusLineKind } from "./store.ts";
import {
  runSubWorkflowCall,
  type SubWorkflowRequest,
} from "./workflow-call.ts";
import {
  isFlowInstance,
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
  if (
    instance.state !== "running" ||
    instance.current === null ||
    instance.current.human_turn
  ) {
    return null;
  }
  const handedAt = lines.findLastIndex((l) => l.kind === "handed");
  const handed = lines[handedAt];
  if (
    handed?.kind !== "handed" ||
    handed.receiver !== session ||
    handed.human_turn ||
    handed.step !== instance.current.step
  ) {
    return null;
  }
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
      (l.kind === "report" && l.step === handed.step && l.next !== null) ||
      l.kind === "not_handed" ||
      (l.kind === "step_stalled" && l.step === handed.step) ||
      (l.kind === "lophn_restarted" && l.step === handed.step),
  );
  return resolved ? null : handed.step;
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
        (l.kind === "report" && l.next !== null),
    );
    const lastProgress = lines[lastProgressAt];
    if (lastProgress?.kind === "not_handed") {
      step = lastProgress.step;
    } else if (instance.current !== null) {
      step = instance.current.step;
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
        l.kind === "handed" ||
        (l.kind === "report" && l.step === step && l.next !== null),
    );
    if (!movedOn) {
      return ok({ mode: "re_handoff", step });
    }
  }

  // 이미 local session으로 넘긴 현재 step: 기록된 같은 session에 이어서 하라는 입력을 넣는다.
  const handedAt = lines.findLastIndex((l) => l.kind === "handed");
  const handed = lines[handedAt];
  if (
    handed?.kind !== "handed" ||
    handed.step !== step ||
    handed.receiver === null ||
    instance.current?.step !== step
  ) {
    return fail("conflict", "workflow step is not blocked");
  }
  const afterHanded = lines.slice(handedAt + 1);
  if (
    afterHanded.some(
      (l) =>
        (l.kind === "report" && l.step === step && l.next !== null) ||
        l.kind === "not_handed",
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
  signal?: AbortSignal;
};

export function createWorkflowService(deps: {
  files: WorkflowFiles;
  projects: WorkflowProjects;
  agents?: WorkflowAgents;
  turns: WorkflowTurns;
  store: WorkflowStore;
  flows: WorkflowFlows;
  remote: WorkflowRemote;
  snapshots?: WorkflowSnapshots;
  agentPorts?: AgentPrimitivePorts;
  clock?: Clock;
  ids: IdSource;
  logger: Logger;
}) {
  const {
    files,
    projects,
    agents,
    turns,
    store,
    flows,
    remote,
    snapshots,
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
  ): Promise<string> {
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

  async function start(
    input: z.output<typeof workflowStart.input>,
    by: StartedBy,
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
    const entry = entryOf(project.value.id, input.workflow, file);
    const parsed = parseDeclaration(file);
    if (!entry.startable || !parsed.ok) {
      return fail(
        "conflict",
        entry.problem?.message ?? "workflow cannot be started",
      );
    }
    let validatedInputs: Record<string, unknown> | undefined;
    if (parsed.declaration.inputs !== undefined) {
      let callableAgents: ReadonlySet<string> | undefined;
      const needsAgents = Object.values(parsed.declaration.inputs).some(
        (field) => field.type === "agent",
      );
      if (needsAgents && agents !== undefined) {
        const callable = await agents.listCallable(project.value.id);
        if (!callable.ok) return callable;
        callableAgents = new Set(callable.value.map((a) => a.name));
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
      const created = await store.create({
        id,
        project: project.value.id,
        workflow: name,
        input: input.text,
        ...(validatedInputs !== undefined ? { inputs: validatedInputs } : {}),
        ...(codeSnapshot !== undefined ? { code_snapshot: codeSnapshot } : {}),
        participants: participantsOf(parsed.declaration),
        steps: flowStepsOf(parsed.declaration),
        started_by: by,
        handoff: null,
      });
      if (!created.ok) return created;
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

    const steps = stepsOf(parsed.declaration);
    const participants = participantsOf(parsed.declaration);
    const step = input.step ?? steps[0]!.name;
    if (!steps.some((s) => s.name === step)) {
      return fail("not_found", "step not found");
    }
    const id = ids.newId("wfi") as Id<"wfi">;
    const created = await store.create({
      id,
      project: project.value.id,
      workflow: name,
      input: input.text,
      ...(validatedInputs !== undefined ? { inputs: validatedInputs } : {}),
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

    try {
      const outcome = await runAgentPrimitive(wrappedPorts, {
        agent: targetAgent,
        prompt: req.prompt,
        ...(req.input !== undefined ? { input: req.input } : {}),
        ...(req.schema !== undefined ? { schema: req.schema } : {}),
        mode: req.mode ?? "turn",
        ...(req.session !== undefined ? { session: req.session } : {}),
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

    try {
      const outcome = await runAgentPrimitive(wrappedPorts, {
        agent: targetAgent,
        prompt: req.prompt,
        ...(req.input !== undefined ? { input: req.input } : {}),
        mode: "report",
        ...(req.session !== undefined ? { session: req.session } : {}),
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
          change: { kind: "code_updated", code_snapshot: captured.value },
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
    const done = await apply(input.instance, ({ instance }) =>
      ok({
        instance: instance.id,
        change: {
          kind: "step_stalled",
          step: input.step,
          session: input.session,
          ...(input.reason !== undefined ? { reason: input.reason } : {}),
          ...(input.message !== undefined ? { message: input.message } : {}),
        },
        by: { kind: "lophn" },
        handoff: null,
      }),
    );
    return done.ok ? ok(undefined) : done;
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
      const workflows = listed.value.map((file) =>
        entryOf(project.value.id, `${project.value.name}/${file.name}`, file),
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

    start,

    async report(input: z.output<typeof workflowReport.input>, by: LineBy) {
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
      let nextRemoteCall: string | null = null;
      const done = await apply(input.instance, (state) => {
        const { instance, lines } = state;
        wasYaml = !isFlowInstance(instance, lines);
        wasHumanTurn =
          instance.current?.step === input.step && instance.current.human_turn;
        const next = input.next ?? null;
        // stopped·end·next 없음은 넘기지 않는다. stopped의 report는 줄만 남는다.
        // flow(program)의 report도 넘기지 않는다. next는 current를 옮기고 닫는 데만 쓴다.
        const hands =
          by.kind !== "program" &&
          instance.state !== "stopped" &&
          next !== null &&
          next !== "end";
        const session = input.session ?? "new";
        return ok({
          instance: instance.id,
          change: {
            kind: "report",
            step: input.step,
            text: input.text,
            next,
            session,
            ...(input.refs !== undefined ? { refs: input.refs } : {}),
            ...(input.data !== undefined ? { data: input.data } : {}),
          },
          by,
          handoff: hands
            ? planHandoff({
                instance,
                step: next,
                cause: "report",
                session,
                received: input.text,
                sameSession: sameSessionIn(state),
                remote,
              })
            : null,
        });
      });
      if (!done.ok) return done;

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

      // YAML 내장 interpreter checkpoint 기록: 완료 report(next 있음)는 completed, 다음 넘김은 started.
      if (wasYaml && by.kind !== "program") {
        if (input.next !== undefined) {
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
        if (done.value.handed?.outcome === "handed") {
          if (done.value.handed.receiver === null) {
            const after = await store.read(input.instance as Id<"wfi">);
            if (after.ok) {
              const lastHanded = after.value.lines.findLast(
                (l) => l.kind === "handed",
              );
              if (lastHanded?.kind === "handed") {
                nextRemoteCall = lastHanded.remote?.call ?? null;
              }
            }
          }
          await recordYamlHandoffCheckpoint(store, {
            instance: input.instance as Id<"wfi">,
            handed: done.value.handed,
            remoteCall: nextRemoteCall,
          });
        }
      }

      return ok({ line: done.value.line, handed: done.value.handed });
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
      const text =
        ended === undefined
          ? blocksText(mail.body!)
          : remoteTurnEndedText(origin.computer, ended);
      const done = await apply(id, (state) => {
        const { instance, lines } = state;
        wasYaml = !isFlowInstance(instance, lines);
        wasHumanTurn =
          instance.current?.step === step && instance.current.human_turn;
        const next = ended === undefined ? report.next : null;
        const hands =
          instance.state !== "stopped" && next !== null && next !== "end";
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
          handoff: hands
            ? planHandoff({
                instance,
                step: next,
                cause: "report",
                session: report.session,
                received: text,
                sameSession: sameSessionIn(state),
                remote,
              })
            : null,
          mail: { mail, origin },
        });
      });
      if (done.ok) {
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
          if (done.value.handed?.outcome === "handed") {
            await recordYamlHandoffCheckpoint(store, {
              instance: id,
              handed: done.value.handed,
            });
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
      const done = await apply(id, (state) => {
        const { instance, lines } = state;
        wasYaml = !isFlowInstance(instance, lines);
        if (instance.state === "stopped") {
          return fail("conflict", "workflow instance is stopped");
        }
        let handoff = null;
        if (edit.op === "hand_now") {
          const session = edit.session ?? "new";
          const lastReport = lines.findLast(
            (l): l is ReportLine => l.kind === "report",
          );
          handoff = planHandoff({
            instance,
            step: edit.step,
            cause: "edit",
            session,
            received: edit.text ?? lastReport?.text ?? instance.input,
            sameSession: sameSessionIn(state),
            remote,
          });
        }
        return ok({
          instance: id,
          change: { kind: "edit", edit },
          by,
          handoff,
        });
      });
      if (!done.ok) return done;
      if (
        wasYaml &&
        edit.op === "hand_now" &&
        done.value.handed?.outcome === "handed"
      ) {
        await recordYamlHandoffCheckpoint(store, {
          instance: id as Id<"wfi">,
          handed: done.value.handed,
        });
      }
      return ok({ line: done.value.line, handed: done.value.handed });
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

    // local non-human step을 받은 session의 turn이 끝났을 때, 명시적 완료 report도 열린 하위 call도 없으면
    // 넘김/retry 시도당 최대 한 번 step_stalled 줄을 남긴다.
    async turnEnded(event: {
      session: Id<"ses">;
      turn: Id<"trn">;
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
        if (item.current === null || item.current.human_turn) continue;
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
