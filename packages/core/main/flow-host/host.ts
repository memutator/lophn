import { appendFile, mkdir } from "node:fs/promises";
import { type Clock, err, ok, type Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { JsonValue } from "../../../protocol/base/mod.ts";
import type {
  AgentAddress,
  AgentAtWorkspace,
} from "../../../protocol/lophn-agent/mod.ts";
import { RUN_WAIT_MAX_MS } from "../../../protocol/runs/mod.ts";
import {
  FLOW_ENTRY_FILE,
  FLOW_SDK_NAME,
  FLOW_SDK_VERSION,
  type FlowEventMessage,
  type FlowOutcome,
  type FlowRequest,
  type FlowStartMessage,
} from "../../../protocol/workflows/flow-wire.ts";
import {
  WORKFLOW_FLOW_FILE,
  workflowFolder,
} from "../../../protocol/workflows/paths.ts";
import {
  WORKFLOW_OUTCOME_REASONS,
  type WorkflowOutcomeReason,
} from "../../../protocol/workflows/values.ts";
import { packageInstallPath } from "../../apps/packages/mod.ts";
import {
  createStreamDecoder,
  drain,
} from "../../apps/runtime/observations/stream-decoder.ts";
import type { InstanceOrigin, RunService } from "../../runs/mod.ts";
import { settledWithin } from "../../supervision/responsiveness/deadline.ts";
import {
  type Spawned,
  spawnProcess,
} from "../../supervision/responsiveness/process.ts";
import {
  type NodeCommand,
  nodeCommand,
} from "../../supervision/security/node-command.ts";
import type {
  FlowEventRegistry,
  FlowEventSource,
} from "../../workflows/event-subscriptions.ts";
import {
  checkpointToOutcome,
  type createWorkflowService,
  type WorkflowFlows,
  type WorkflowOutcome,
} from "../../workflows/mod.ts";
import { createWriter, readRequests } from "./channel.ts";
import { linkFlowSdk } from "./sdk-link.ts";
import { cleanupFlowRunDir, prepareFlowRunDir } from "./snapshot-dir.ts";

export type FlowHostWorkflows = Pick<
  ReturnType<typeof createWorkflowService>,
  | "report"
  | "escalate"
  | "programExited"
  | "upsertCheckpoint"
  | "loadCheckpoints"
  | "runAgentCall"
  | "runHumanStep"
  | "runSubWorkflow"
>;

export type FlowHostDeps = {
  dataRoot: string;
  env: Record<string, string>;
  clock: Clock;
  runs: Pick<RunService, "start" | "wait" | "cancel" | "cancelOfInstance">;
  // launch에서 한 번 푼다. 도는 중 이름이 바뀌어 다른 agent의 할당으로 바뀌지 않게 한다.
  resolveAgent(address: AgentAddress): Result<AgentAtWorkspace>;
  // onEvent 앱 구독 시 앱 slug 또는 id를 app id로 푼다.
  resolveApp?(app: string): Promise<Result<Id<"app">>> | Result<Id<"app">>;
  // 비영속 flow onEvent 구독 표(jobs wiring이 나중에 채우므로 호출 시 읽는다).
  flowEvents?: () => FlowEventRegistry | undefined;
  workflows: FlowHostWorkflows;
  // null이면 redaction이 끝나지 못한 것이다. 그 글은 쓰지 않는다.
  redact(line: string): string | null;
  // 테스트용 주입 지점(기본은 실제 Electron Node spawnProcess).
  spawn?: typeof spawnProcess;
  // 테스트용 snapshot blob 읽기 주입 지점(기본은 dataRoot의 blobs 경로).
  readSnapshotBlob?: (hash: string) => Promise<Result<Uint8Array>>;
};

// log의 자리. project workspace의 session이 쓰는 workflow 폴더 밖이라 flow가 덮어쓰지 못한다.
const FLOWS_FOLDER = "flows";
const LOG_MAX_BYTES = 1024 * 1024;
const TAIL_LINES = 10;
const TAIL_LINE_CHARS = 500;
// exit 신호가 마지막 data나 EOF보다 늦게 올 수 있다. 정상 종료를 틀린 통로로 읽지 않게 잠깐 기다린다.
const EXIT_GRACE_MS = 200;
// AI가 짠 flow code가 memory를 끝없이 늘려도 사람의 기계 memory를 다 잡지 않게 V8 heap을 묶는다. 넘으면 process가
// 죽고 program_exited 줄에 끝 code와 stderr 끝이 남는다.
const FLOW_HEAP_LIMIT_MB = 512;

const OUTCOME_REASON_SET: ReadonlySet<string> = new Set(
  WORKFLOW_OUTCOME_REASONS,
);

export type FlowLaunchStart = Parameters<WorkflowFlows["launch"]>[0];

export type FlowHost = WorkflowFlows & {
  close(): Promise<void>;
};

export function startMessage(
  start: Pick<FlowLaunchStart, "instance" | "input" | "inputs" | "checkpoints">,
): FlowStartMessage {
  return {
    type: "start",
    instance: start.instance,
    input: start.input,
    ...(start.inputs !== undefined ? { inputs: start.inputs } : {}),
    ...(start.checkpoints !== undefined
      ? { checkpoints: start.checkpoints }
      : {}),
  };
}

export function flowCommand(entry: string, flowFile: string): NodeCommand {
  return nodeCommand(
    entry,
    [flowFile],
    [`--max-old-space-size=${FLOW_HEAP_LIMIT_MB}`],
  );
}

type Entry = {
  child: Spawned;
  respond(id: string, outcome: FlowOutcome): void;
  sendEvent(message: FlowEventMessage): void;
  // report·escalate는 step 순서가 의미를 가져 한 줄로 처리한다. agent·human·workflow·tool은 동시에 돈다.
  reports: Promise<void>;
  controllersByCancelId: Map<string, AbortController>;
  allControllers: Set<AbortController>;
  snapshotDir: string | null;
  tail: string[];
  exited: boolean;
  // launch가 실패해 service가 직접 닫는다. 끝난 뒤 programExited를 또 부르지 않는다.
  quiet: boolean;
  logBytes: number;
  logFull: boolean;
  logChain: Promise<void>;
};

function failure(
  reason: WorkflowOutcomeReason,
  message: string,
  session?: Id<"ses">,
): FlowOutcome {
  return session === undefined
    ? { ok: false, reason, message }
    : { ok: false, reason, message, session };
}

function toFlowOutcome(outcome: WorkflowOutcome<unknown>): FlowOutcome {
  if (outcome.ok) {
    return {
      ok: true,
      result: (outcome.result === undefined
        ? null
        : outcome.result) as JsonValue,
    };
  }
  return failure(outcome.reason, outcome.message, outcome.session);
}

function mapRunFailReason(
  reason: string,
  message: string,
): WorkflowOutcomeReason {
  if (OUTCOME_REASON_SET.has(reason)) {
    return reason as WorkflowOutcomeReason;
  }
  const colon = message.indexOf(":");
  if (colon > 0) {
    const prefix = message.slice(0, colon).trim();
    if (OUTCOME_REASON_SET.has(prefix)) {
      return prefix as WorkflowOutcomeReason;
    }
  }
  switch (reason) {
    case "tool_denied":
      return "forbidden";
    case "tool_unknown":
    case "start_failed":
      return "unavailable";
    case "lophn_restarted":
    case "turn_interrupted":
      return "interrupted";
    case "turn_failed":
    case "no_answer":
      return "model_error";
    case "invalid_output":
      return "invalid_input";
    default:
      return "internal";
  }
}

function abortMessage(signal: AbortSignal): string {
  const reason: unknown = signal.reason;
  if (reason instanceof Error && reason.message !== "") return reason.message;
  if (typeof reason === "string" && reason !== "") return reason;
  return "cancelled";
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createFlowHost(deps: FlowHostDeps): FlowHost {
  const { dataRoot, clock } = deps;
  const spawn = deps.spawn ?? spawnProcess;
  const flowsRoot = `${dataRoot}/${FLOWS_FOLDER}`;
  const processes = new Map<string, Entry>();
  let closing = false;
  let launchSeq = 0;

  // log 폴더는 instance와 무관해 한 번만 만든다. 동시 launch가 같은 mkdir을 되풀이하지 않게 promise를 재사용한다.
  let logsReady: Promise<void> | undefined;
  const ensureLogs = () =>
    (logsReady ??= mkdir(flowsRoot, { recursive: true, mode: 0o700 }).then(
      () => {},
      (e) => {
        logsReady = undefined;
        throw e;
      },
    ));

  // log 쓰기가 실패해도 flow는 멈추지 않는다.
  function appendLog(instance: string, entry: Entry, text: string) {
    if (entry.logFull) return;
    const at = clock.now();
    let data = `${at} ${text}\n`;
    const bytes = new TextEncoder().encode(data).length;
    if (entry.logBytes + bytes > LOG_MAX_BYTES) {
      entry.logFull = true;
      data = `${at} [log truncated]\n`;
    } else entry.logBytes += bytes;
    entry.logChain = entry.logChain
      .then(() =>
        appendFile(`${flowsRoot}/${instance}.log`, data, { mode: 0o600 }),
      )
      .catch(() => {});
  }

  // stderr 한 줄(과 host가 stderr에 남기는 [lophn] 줄)을 redaction을 거쳐 log와 끝 줄에 쌓는다.
  function stderrLine(instance: string, entry: Entry, raw: string) {
    const safe = deps.redact(raw);
    if (safe === null) {
      return appendLog(instance, entry, "[line withheld: redaction not ready]");
    }
    appendLog(instance, entry, safe);
    entry.tail.push(safe.slice(0, TAIL_LINE_CHARS));
    if (entry.tail.length > TAIL_LINES) entry.tail.shift();
  }

  async function guard<T>(
    work: () => Promise<T>,
    otherwise: (message: string) => T,
  ): Promise<T> {
    try {
      return await work();
    } catch (e) {
      return otherwise(messageOf(e));
    }
  }

  function trackController(
    entry: Entry,
    cancelId: string | undefined,
  ): { controller: AbortController; release: () => void } {
    const controller = new AbortController();
    entry.allControllers.add(controller);
    if (cancelId !== undefined) {
      entry.controllersByCancelId.set(cancelId, controller);
    }
    return {
      controller,
      release() {
        entry.allControllers.delete(controller);
        if (
          cancelId !== undefined &&
          entry.controllersByCancelId.get(cancelId) === controller
        ) {
          entry.controllersByCancelId.delete(cancelId);
        }
      },
    };
  }

  function abortEntryControllers(entry: Entry, reason: string): void {
    for (const controller of [...entry.allControllers]) {
      if (!controller.signal.aborted) {
        controller.abort(reason);
      }
    }
    entry.allControllers.clear();
    entry.controllersByCancelId.clear();
  }

  async function waitRunWithAbort(
    runId: Id<"run">,
    signal: AbortSignal,
  ): Promise<
    | { kind: "aborted" }
    | { kind: "waited"; result: Awaited<ReturnType<RunService["wait"]>> }
  > {
    if (signal.aborted) return { kind: "aborted" };
    let onAbort: (() => void) | undefined;
    const abortPromise = new Promise<{ kind: "aborted" }>((resolve) => {
      onAbort = () => resolve({ kind: "aborted" });
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      return await Promise.race([
        deps.runs
          .wait(runId, RUN_WAIT_MAX_MS)
          .then((result) => ({ kind: "waited" as const, result })),
        abortPromise,
      ]);
    } finally {
      if (onAbort !== undefined) {
        signal.removeEventListener("abort", onAbort);
      }
    }
  }

  async function runToolCall(
    instance: Id<"wfi">,
    entry: Entry,
    request: Extract<FlowRequest, { type: "tool" }>,
    origin: InstanceOrigin,
  ): Promise<FlowOutcome | null> {
    // replay 검사: 이미 completed/failed/interrupted인 tool key는 앱 tool을 다시 부르지 않는다.
    const existingList = await deps.workflows.loadCheckpoints(instance);
    if (existingList.ok) {
      const existing = existingList.value.find((cp) => cp.key === request.key);
      if (existing !== undefined) {
        const replayed = checkpointToOutcome<unknown>(existing);
        if (replayed !== null) return toFlowOutcome(replayed);
      }
    }

    const { controller, release } = trackController(entry, request.cancel_id);
    try {
      if (controller.signal.aborted) {
        return failure("cancelled", abortMessage(controller.signal));
      }
      await deps.workflows.upsertCheckpoint({
        instance,
        key: request.key,
        kind: "tool",
        state: "started",
        handle_ref: null,
      });

      const started = await deps.runs.start(
        {
          kind: "tool",
          app: request.app,
          tool: request.tool,
          input: request.input,
        },
        origin,
      );
      if (!started.ok) {
        if (closing) return null;
        const reason = started.error.code;
        await deps.workflows.upsertCheckpoint({
          instance,
          key: request.key,
          kind: "tool",
          state: "failed",
          handle_ref: null,
          error: { reason, message: started.error.message },
        });
        return failure(reason, started.error.message);
      }

      let run = started.value;
      await deps.workflows.upsertCheckpoint({
        instance,
        key: request.key,
        kind: "tool",
        state: "started",
        handle_ref: run.id,
      });

      while (run.state === "running") {
        if (closing) return null;
        if (entry.exited) return null;
        const step = await waitRunWithAbort(
          run.id as Id<"run">,
          controller.signal,
        );
        if (closing) return null;
        if (step.kind === "aborted") {
          const message = abortMessage(controller.signal);
          await deps.runs.cancel(run.id as Id<"run">).catch(() => {});
          await deps.workflows.upsertCheckpoint({
            instance,
            key: request.key,
            kind: "tool",
            state: "failed",
            handle_ref: run.invocation ?? run.id,
            error: { reason: "cancelled", message },
          });
          return failure("cancelled", message);
        }
        if (!step.result.ok) {
          const reason = step.result.error.code;
          await deps.workflows.upsertCheckpoint({
            instance,
            key: request.key,
            kind: "tool",
            state: "failed",
            handle_ref: run.invocation ?? run.id,
            error: { reason, message: step.result.error.message },
          });
          return failure(reason, step.result.error.message);
        }
        run = step.result.value;
      }

      if (closing) return null;

      if (run.state === "done") {
        const result = (
          run.result === undefined ? null : run.result
        ) as JsonValue;
        await deps.workflows.upsertCheckpoint({
          instance,
          key: request.key,
          kind: "tool",
          state: "completed",
          handle_ref: run.invocation ?? run.id,
          output: result,
        });
        return { ok: true, result };
      }

      if (run.state === "failed") {
        const message = run.error?.message ?? "tool failed";
        const reason = mapRunFailReason(
          run.error?.reason ?? "internal",
          message,
        );
        await deps.workflows.upsertCheckpoint({
          instance,
          key: request.key,
          kind: "tool",
          state: "failed",
          handle_ref: run.invocation ?? run.id,
          error: { reason, message },
        });
        return failure(reason, message);
      }

      const cancelMsg = "the run was cancelled";
      await deps.workflows.upsertCheckpoint({
        instance,
        key: request.key,
        kind: "tool",
        state: "failed",
        handle_ref: run.invocation ?? run.id,
        error: { reason: "cancelled", message: cancelMsg },
      });
      return failure("cancelled", cancelMsg);
    } finally {
      release();
    }
  }

  async function handleSubscribe(
    instance: Id<"wfi">,
    project: Id<"prj">,
    entry: Entry,
    request: Extract<FlowRequest, { type: "subscribe" }>,
  ): Promise<FlowOutcome> {
    const registry = deps.flowEvents?.();
    if (registry === undefined) {
      return failure("unavailable", "flow event registry is not available");
    }
    let source: FlowEventSource;
    if (request.source === "lophn" || request.source === "session") {
      source = {
        kind: "session",
        ...(request.workspace !== undefined
          ? { workspace: request.workspace }
          : {}),
      };
    } else {
      let appId: string;
      if (deps.resolveApp !== undefined) {
        const resolved = await deps.resolveApp(request.source);
        if (!resolved.ok) {
          return failure(resolved.error.code, resolved.error.message);
        }
        appId = resolved.value;
      } else {
        appId = request.source;
      }
      source = { kind: "app", app: appId };
    }
    // 서로 다른 flow instance가 같은 subscription_id("sub_1")를 써도 registry에서 덮어쓰지 않게 instance를 앞에 붙인다.
    const registrySubId = `${instance}:${request.subscription_id}`;
    registry.subscribe({
      instance,
      project,
      source,
      event: request.event,
      subscriptionId: registrySubId,
      onEvent(delivery) {
        if (entry.exited || closing) return;
        entry.sendEvent({
          type: "event",
          subscription_id: request.subscription_id,
          source: delivery.source,
          event: delivery.event,
          payload: (delivery.payload === undefined
            ? null
            : delivery.payload) as JsonValue,
        });
      },
    });
    return { ok: true, result: null };
  }

  function handle(
    instance: Id<"wfi">,
    project: Id<"prj">,
    creator: AgentAtWorkspace,
    entry: Entry,
  ) {
    const origin: InstanceOrigin = { instance, creator };
    return (request: FlowRequest) => {
      if (entry.exited) return;

      switch (request.type) {
        case "step_begin": {
          void guard(
            async (): Promise<FlowOutcome> => {
              const done = await deps.workflows.upsertCheckpoint({
                instance,
                key: request.key,
                kind: "step",
                state: "started",
                handle_ref: null,
              });
              return done.ok
                ? { ok: true, result: null }
                : failure(done.error.code, done.error.message);
            },
            (message) => failure("internal", message),
          ).then((outcome) => entry.respond(request.id, outcome));
          return;
        }

        case "step_end": {
          void guard(
            async (): Promise<FlowOutcome> => {
              const done = request.outcome.ok
                ? await deps.workflows.upsertCheckpoint({
                    instance,
                    key: request.key,
                    kind: "step",
                    state: "completed",
                    output: request.outcome.result,
                  })
                : await deps.workflows.upsertCheckpoint({
                    instance,
                    key: request.key,
                    kind: "step",
                    state: "failed",
                    error: {
                      reason: request.outcome.reason,
                      message: request.outcome.message,
                      ...(request.outcome.session !== undefined
                        ? { session: request.outcome.session }
                        : {}),
                    },
                  });
              return done.ok
                ? { ok: true, result: null }
                : failure(done.error.code, done.error.message);
            },
            (message) => failure("internal", message),
          ).then((outcome) => entry.respond(request.id, outcome));
          return;
        }

        case "agent": {
          const { controller, release } = trackController(
            entry,
            request.cancel_id,
          );
          void guard(
            async (): Promise<FlowOutcome | null> => {
              try {
                const outcome = await deps.workflows.runAgentCall({
                  instance,
                  step: request.step ?? request.key,
                  key: request.key,
                  agent: request.agent,
                  prompt: request.prompt,
                  ...(request.input !== undefined
                    ? { input: request.input }
                    : {}),
                  ...(request.schema !== undefined
                    ? { schema: request.schema }
                    : {}),
                  ...(request.mode !== undefined ? { mode: request.mode } : {}),
                  ...(request.session !== undefined
                    ? { session: request.session as "new" | "same" | Id<"ses"> }
                    : {}),
                  ...(request.on !== undefined ? { on: request.on } : {}),
                  signal: controller.signal,
                });
                return closing ? null : toFlowOutcome(outcome);
              } finally {
                release();
              }
            },
            (message) => failure("internal", message),
          ).then((outcome) => {
            if (outcome !== null) entry.respond(request.id, outcome);
          });
          return;
        }

        case "human": {
          const { controller, release } = trackController(
            entry,
            request.cancel_id,
          );
          void guard(
            async (): Promise<FlowOutcome | null> => {
              try {
                const outcome = await deps.workflows.runHumanStep({
                  instance,
                  step: request.step ?? request.key,
                  key: request.key,
                  with: request.with,
                  prompt: request.prompt,
                  ...(request.input !== undefined
                    ? { input: request.input }
                    : {}),
                  ...(request.session !== undefined
                    ? { session: request.session as "new" | "same" | Id<"ses"> }
                    : {}),
                  signal: controller.signal,
                });
                return closing ? null : toFlowOutcome(outcome);
              } finally {
                release();
              }
            },
            (message) => failure("internal", message),
          ).then((outcome) => {
            if (outcome !== null) entry.respond(request.id, outcome);
          });
          return;
        }

        case "workflow": {
          const { controller, release } = trackController(
            entry,
            request.cancel_id,
          );
          void guard(
            async (): Promise<FlowOutcome | null> => {
              try {
                const outcome = await deps.workflows.runSubWorkflow({
                  parentInstance: instance,
                  key: request.key,
                  workflow: request.workflow,
                  input: request.input ?? "",
                  ...(request.inputs !== undefined
                    ? { inputs: request.inputs }
                    : {}),
                  signal: controller.signal,
                });
                return closing ? null : toFlowOutcome(outcome);
              } finally {
                release();
              }
            },
            (message) => failure("internal", message),
          ).then((outcome) => {
            if (outcome !== null) entry.respond(request.id, outcome);
          });
          return;
        }

        case "tool": {
          void guard(
            () => runToolCall(instance, entry, request, origin),
            (message) => failure("internal", message),
          ).then((outcome) => {
            if (outcome !== null) entry.respond(request.id, outcome);
          });
          return;
        }

        case "cancel": {
          const controller = entry.controllersByCancelId.get(request.cancel_id);
          if (controller !== undefined && !controller.signal.aborted) {
            controller.abort("cancelled");
          }
          entry.respond(request.id, { ok: true, result: null });
          return;
        }

        case "subscribe": {
          void guard(
            () => handleSubscribe(instance, project, entry, request),
            (message) => failure("internal", message),
          ).then((outcome) => entry.respond(request.id, outcome));
          return;
        }

        case "unsubscribe": {
          deps
            .flowEvents?.()
            ?.unsubscribe(`${instance}:${request.subscription_id}`);
          entry.respond(request.id, { ok: true, result: null });
          return;
        }

        case "report": {
          entry.reports = entry.reports.then(async () => {
            // lophn은 report를 믿고 기록할 뿐이다. 판정을 더하지 않는다.
            const outcome = await guard(
              async (): Promise<FlowOutcome> => {
                const done = await deps.workflows.report(
                  {
                    instance,
                    step: request.step,
                    text: request.text,
                    ...(request.refs !== undefined
                      ? { refs: request.refs }
                      : {}),
                    ...(request.data !== undefined
                      ? { data: request.data }
                      : {}),
                    ...(request.next !== undefined
                      ? { next: request.next }
                      : {}),
                  },
                  { kind: "program" },
                );
                return done.ok
                  ? { ok: true, result: null }
                  : failure(done.error.code, done.error.message);
              },
              (message) => failure("internal", message),
            );
            entry.respond(request.id, outcome);
          });
          return;
        }

        case "escalate": {
          entry.reports = entry.reports.then(async () => {
            const outcome = await guard(
              async (): Promise<FlowOutcome> => {
                const done = await deps.workflows.escalate({
                  instance,
                  step: request.step ?? null,
                  reason: request.reason,
                });
                return done.ok
                  ? { ok: true, result: null }
                  : failure(done.error.code, done.error.message);
              },
              (message) => failure("internal", message),
            );
            entry.respond(request.id, outcome);
          });
          return;
        }
      }
    };
  }

  async function launch(start: FlowLaunchStart): Promise<Result<void>> {
    const { instance, project } = start;
    const unavailable = (message: string) =>
      err({ code: "unavailable" as const, message });
    const resolved = deps.resolveAgent({
      agent: start.agent,
      workspace: { project },
    });
    if (!resolved.ok) {
      return err({
        code: resolved.error.code,
        message: `workflow agent ${start.agent}: ${resolved.error.message}`,
      });
    }
    const creator = resolved.value;
    const installed = packageInstallPath(FLOW_SDK_NAME, FLOW_SDK_VERSION);
    if (!installed.ok) return installed;
    try {
      await ensureLogs();
    } catch (e) {
      return unavailable(`flow log folder is not ready: ${messageOf(e)}`);
    }
    const linked = await linkFlowSdk({
      dataRoot,
      installPath: installed.value,
    });
    if (!linked.ok) return linked;
    if (closing) return unavailable("flow host is closing");
    if (processes.has(instance)) {
      return err({ code: "conflict", message: "flow is already running" });
    }

    let runFolder: string;
    let snapshotDir: string | null = null;
    if (start.codeSnapshot !== undefined && start.codeSnapshot !== null) {
      const prepared = await prepareFlowRunDir({
        dataRoot,
        instance,
        runId: `${clock.nowMs()}-${++launchSeq}`,
        manifestJson: start.codeSnapshot,
        ...(deps.readSnapshotBlob !== undefined
          ? { readBlob: deps.readSnapshotBlob }
          : {}),
      });
      if (!prepared.ok) return prepared;
      runFolder = prepared.value.dir;
      snapshotDir = prepared.value.dir;
    } else {
      runFolder = workflowFolder(dataRoot, project, start.workflow);
    }

    const command = flowCommand(
      `${dataRoot}/${installed.value}/${FLOW_ENTRY_FILE}`,
      `${runFolder}/${WORKFLOW_FLOW_FILE}`,
    );

    let child: Spawned;
    try {
      child = spawn({
        command: command.command,
        args: command.args,
        // flow code가 볼 env는 wiring이 정한 것뿐이다. ELECTRON_RUN_AS_NODE는 runtime이 Node로 뜨는 표시다.
        env: { ...deps.env, ...command.env },
      });
    } catch (e) {
      if (snapshotDir !== null) await cleanupFlowRunDir(snapshotDir);
      return unavailable(`flow process did not start: ${messageOf(e)}`);
    }
    const writer = createWriter(child.stdin);
    const entry: Entry = {
      child,
      respond(id, outcome) {
        if (entry.exited || closing) return;
        void writer.response({ type: "response", id, outcome });
      },
      sendEvent(message) {
        if (entry.exited || closing) return;
        void writer.event(message);
      },
      reports: Promise.resolve(),
      controllersByCancelId: new Map(),
      allControllers: new Set(),
      snapshotDir,
      tail: [],
      exited: false,
      quiet: false,
      logBytes: 0,
      logFull: false,
      logChain: Promise.resolve(),
    };
    processes.set(instance, entry);

    const closeChannel = (reason: string) => {
      stderrLine(instance, entry, `[lophn] channel closed: ${reason}`);
      void child.terminate();
    };
    const reading = readRequests(child.stdout, {
      request: handle(instance, project, creator, entry),
      invalid: (id, message) =>
        entry.respond(id, failure("invalid_input", message)),
      bad: closeChannel,
    }).then(async () => {
      // stdout이 먼저 끝났는데 process가 살아 있으면 끝낸다. 이미 끝나는 중이면 사유를 남기지 않는다.
      if (!(await settledWithin(child.exited, EXIT_GRACE_MS))) {
        closeChannel("stdout closed");
      }
    });
    const errReading = drain(
      child.stderr,
      createStreamDecoder({
        onLine: (line) => stderrLine(instance, entry, line),
        onDropped: () => {},
      }),
    );

    void child.exited.then(async (code) => {
      entry.exited = true;
      deps.flowEvents?.()?.unsubscribeInstance(instance);
      // 종료 중(closing)이 아니면 진행 중인 primitive를 모두 취소한다. 종료 중에는 checkpoint를 건드리지 않아 다음 기동 reconcile이 interrupted로 확정한다.
      if (!closing) {
        abortEntryControllers(entry, "flow process exited");
      }
      // exit이 마지막 data보다 먼저 올 수 있어 두 pipe가 끝난 뒤에 본다. 마지막 report가 program_exited 앞에 남는다.
      await Promise.all([reading, errReading]);
      await entry.reports;
      processes.delete(instance);
      if (entry.snapshotDir !== null) {
        await cleanupFlowRunDir(entry.snapshotDir);
        entry.snapshotDir = null;
      }
      if (closing || entry.quiet) return;
      await guard(
        () => deps.runs.cancelOfInstance(instance),
        (message) =>
          stderrLine(instance, entry, `[lophn] cancel failed: ${message}`),
      );
      await guard(
        async () => {
          const done = await deps.workflows.programExited({
            instance,
            code,
            stderr_tail: entry.tail.join("\n"),
          });
          if (!done.ok) {
            stderrLine(
              instance,
              entry,
              `[lophn] program_exited failed: ${done.error.message}`,
            );
          }
        },
        (message) =>
          stderrLine(
            instance,
            entry,
            `[lophn] program_exited failed: ${message}`,
          ),
      );
    });

    try {
      await writer.start(startMessage(start));
    } catch (e) {
      entry.quiet = true;
      deps.flowEvents?.()?.unsubscribeInstance(instance);
      abortEntryControllers(entry, "flow start failed");
      processes.delete(instance);
      await child.terminate();
      if (entry.snapshotDir !== null) {
        await cleanupFlowRunDir(entry.snapshotDir);
        entry.snapshotDir = null;
      }
      return unavailable(
        `flow process did not take its start: ${messageOf(e)}`,
      );
    }
    return ok(undefined);
  }

  return {
    launch,

    async stop(instance) {
      deps.flowEvents?.()?.unsubscribeInstance(instance);
      const entry = processes.get(instance);
      if (entry === undefined) return ok(undefined);
      abortEntryControllers(entry, "workflow stopped");
      const gone = await entry.child.terminate();
      await guard(
        () => deps.runs.cancelOfInstance(instance),
        () => {},
      );
      return gone
        ? ok(undefined)
        : err({ code: "unavailable", message: "flow process did not end" });
    },

    // programExited와 cancelOfInstance를 부르지 않는다. 꺼지는 중인 ledger에 쓰지 않고, instance는 running으로
    // 남아 다음 기동 때 reconcile이 checkpoint를 interrupted로 확정하고 replay한다.
    async close() {
      closing = true;
      const entries = [...processes.entries()];
      for (const [instance] of entries) {
        deps.flowEvents?.()?.unsubscribeInstance(instance);
      }
      await Promise.all(entries.map(([, entry]) => entry.child.terminate()));
      await Promise.all(
        entries.map(async ([, entry]) => {
          if (entry.snapshotDir !== null) {
            await cleanupFlowRunDir(entry.snapshotDir);
            entry.snapshotDir = null;
          }
        }),
      );
    },
  };
}
