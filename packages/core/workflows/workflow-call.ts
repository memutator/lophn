import type { z } from "zod";
import type { Result } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/mod.ts";
import {
  minPermissionMode,
  type PermissionMode,
} from "../../protocol/lophn-agent/mod.ts";
import type { Output } from "../../protocol/server/mod.ts";
import type {
  ReportLine,
  StartedBy,
  WorkflowCheckpoint,
  WorkflowInstance,
  WorkflowSoftOutput,
  workflowInstanceRead,
  workflowStart,
} from "../../protocol/workflows/mod.ts";
import type { WorkflowOutcome } from "./agent-primitive.ts";
import { checkpointToOutcome } from "./checkpoints.ts";
import type { WorkflowProjects, WorkflowStore } from "./ports.ts";

// sub-workflow 최대 중첩 깊이(root = 0, child 1..5 허용, 6 이상 conflict).
export const MAX_SUBWORKFLOW_DEPTH = 5;

type ReadState = Output<typeof workflowInstanceRead>;

export type SubWorkflowRequest = {
  parentInstance: Id<"wfi">;
  key: string;
  // "<workflow>"(같은 project) 또는 "<project>/<workflow>"(같은 project인지 검증)
  workflow: string;
  input: string;
  inputs?: Record<string, unknown>;
  // sub-workflow를 호출한 부모 참가자 key나 명시적 부모 권한 단계(없으면 부모 instance에서 계산).
  callingParticipant?: string;
  parentMode?: PermissionMode;
  signal?: AbortSignal;
};

// 부모 instance에서 sub-workflow가 넘을 수 없는 권한 상한을 구한다.
// 현재 실행 step의 단계(또는 호출 참가자의 단계)를 우선 보고,
// 없으면(flow 등) 부모 step·participant 단계 가운데 가장 좁은 단계다.
export function parentPermissionCeiling(
  parent: Pick<
    WorkflowInstance,
    "current" | "steps" | "participants" | "participant_modes"
  >,
  callingParticipant?: string,
): PermissionMode | undefined {
  const modes = parent.participant_modes;
  if (parent.current !== null) {
    const step = parent.steps.find((s) => s.name === parent.current!.step);
    if (step !== undefined) {
      if (step.permission_mode !== undefined) {
        return step.permission_mode;
      }
      if (modes !== undefined) {
        const by = parent.participants[step.by];
        const key =
          by !== undefined && "kind" in by && by.kind === "human"
            ? step.with
            : step.by;
        if (key !== null && modes[key] !== undefined) {
          return modes[key];
        }
      }
    }
  }
  if (
    callingParticipant !== undefined &&
    modes?.[callingParticipant] !== undefined
  ) {
    return modes[callingParticipant];
  }
  const values: PermissionMode[] = [];
  if (modes !== undefined) values.push(...Object.values(modes));
  for (const step of parent.steps) {
    if (step.permission_mode !== undefined) values.push(step.permission_mode);
  }
  if (values.length === 0) return undefined;
  let narrowest = values[0]!;
  for (let i = 1; i < values.length; i++) {
    narrowest = minPermissionMode(narrowest, values[i]!);
  }
  return narrowest;
}

export type SubWorkflowDeps = {
  store: WorkflowStore;
  projects: WorkflowProjects;
  start(
    input: {
      workflow: string;
      text: string;
      inputs?: Record<string, unknown>;
    },
    by: StartedBy,
    options?: { maxMode?: PermissionMode },
  ): Promise<Result<z.output<typeof workflowStart.output>>>;
  stop(
    input: { instance: Id<"wfi"> },
    by: { kind: "user" },
  ): Promise<Result<{ instance: WorkflowInstance }>>;
  subscribeInstanceUpdated(instance: Id<"wfi">, fn: () => void): () => void;
  loadCheckpoints(instance: Id<"wfi">): Promise<Result<WorkflowCheckpoint[]>>;
};

function abortMessage(signal: AbortSignal): string {
  const reason: unknown = signal.reason;
  if (reason instanceof Error && reason.message !== "") return reason.message;
  if (typeof reason === "string" && reason !== "") return reason;
  return "cancelled";
}

// 끝난 자식 sub-workflow에서 최종 SoftOutput을 추출한다.
// 가장 마지막 report 줄(text, refs, data)을 우선 쓰고, 없으면 마지막 완료 checkpoint의 summary를 쓴다.
export function extractFinalSoftOutput(state: ReadState): WorkflowSoftOutput {
  const lastReport = state.lines.findLast(
    (l): l is ReportLine => l.kind === "report",
  );
  if (lastReport !== undefined) {
    return {
      summary: lastReport.text,
      ...(lastReport.refs !== undefined ? { refs: lastReport.refs } : {}),
      ...(lastReport.data !== undefined ? { data: lastReport.data } : {}),
    };
  }
  const checkpoints = state.checkpoints ?? [];
  for (let i = checkpoints.length - 1; i >= 0; i--) {
    const cp = checkpoints[i]!;
    if (
      cp.state === "completed" &&
      cp.output !== null &&
      typeof cp.output === "object" &&
      "summary" in cp.output &&
      typeof (cp.output as { summary?: unknown }).summary === "string"
    ) {
      const out = cp.output as WorkflowSoftOutput;
      return {
        summary: out.summary,
        ...(out.refs !== undefined ? { refs: out.refs } : {}),
        ...(out.data !== undefined ? { data: out.data } : {}),
      };
    }
  }
  return { summary: "" };
}

async function resolveTargetWorkflow(
  projects: WorkflowProjects,
  parentProject: Id<"prj">,
  rawWorkflow: string,
): Promise<
  | { ok: true; workflowName: string }
  | {
      ok: false;
      reason: "forbidden" | "invalid_input" | "not_found" | "unavailable";
      message: string;
    }
> {
  if (!rawWorkflow.includes("/")) {
    return { ok: true, workflowName: rawWorkflow };
  }
  const parts = rawWorkflow.split("/");
  if (parts.length !== 2 || parts[0] === "" || parts[1] === "") {
    return {
      ok: false,
      reason: "invalid_input",
      message: "workflow must be <name> or <project>/<name>",
    };
  }
  const [projectRef, workflowName] = parts as [string, string];
  if (projectRef === parentProject) {
    return { ok: true, workflowName };
  }
  const resolved = await projects.resolve(projectRef);
  if (!resolved.ok) {
    // 다른 project를 가리키려다 못 풀었거나 project 이름이 일치하지 않는 경우 구분:
    // 존재하지 않는 project라도 parent의 project 이름과 다르면 cross-project이므로 forbidden 또는 not_found.
    if (resolved.error.code === "not_found") {
      return {
        ok: false,
        reason: "forbidden",
        message: "sub-workflow must be in the same project",
      };
    }
    return {
      ok: false,
      reason:
        resolved.error.code === "invalid_input"
          ? "invalid_input"
          : "unavailable",
      message: resolved.error.message,
    };
  }
  if (resolved.value.id !== parentProject) {
    return {
      ok: false,
      reason: "forbidden",
      message: "sub-workflow must be in the same project",
    };
  }
  return { ok: true, workflowName };
}

async function checkAncestorsAndDepth(
  store: WorkflowStore,
  parent: WorkflowInstance,
  targetWorkflow: string,
): Promise<
  | { ok: true }
  | {
      ok: false;
      reason: "conflict" | "internal" | "unavailable";
      message: string;
    }
> {
  const seenIds = new Set<string>();
  let current: WorkflowInstance | null = parent;
  let workflowHops = 0;

  while (current !== null) {
    if (seenIds.has(current.id)) {
      return {
        ok: false,
        reason: "conflict",
        message: `sub-workflow cycle detected: ${targetWorkflow}`,
      };
    }
    seenIds.add(current.id);

    if (
      current.project === parent.project &&
      current.workflow === targetWorkflow
    ) {
      return {
        ok: false,
        reason: "conflict",
        message: `sub-workflow cycle detected: ${targetWorkflow}`,
      };
    }

    if (current.started_by.kind !== "workflow") break;
    workflowHops += 1;
    if (workflowHops >= MAX_SUBWORKFLOW_DEPTH) {
      return {
        ok: false,
        reason: "conflict",
        message: `maximum sub-workflow nesting depth (${MAX_SUBWORKFLOW_DEPTH}) exceeded`,
      };
    }
    const up = await store.read(current.started_by.instance as Id<"wfi">);
    if (!up.ok) {
      return {
        ok: false,
        reason: up.error.code === "not_found" ? "internal" : "unavailable",
        message: up.error.message,
      };
    }
    current = up.value.instance;
  }

  return { ok: true };
}

async function awaitChildCompletion(
  deps: SubWorkflowDeps,
  childId: Id<"wfi">,
  signal: AbortSignal | undefined,
): Promise<WorkflowOutcome<WorkflowSoftOutput>> {
  const checkOnce =
    async (): Promise<WorkflowOutcome<WorkflowSoftOutput> | null> => {
      const read = await deps.store.read(childId);
      if (!read.ok) {
        return {
          ok: false,
          reason: read.error.code,
          message: read.error.message,
        };
      }
      if (read.value.instance.state === "ended") {
        return { ok: true, result: extractFinalSoftOutput(read.value) };
      }
      if (read.value.instance.state === "stopped") {
        return {
          ok: false,
          reason: "cancelled",
          message: "sub-workflow was stopped",
        };
      }
      return null;
    };

  if (signal?.aborted) {
    const msg = abortMessage(signal);
    await deps.stop({ instance: childId }, { kind: "user" }).catch(() => {});
    return { ok: false, reason: "cancelled", message: msg };
  }

  const immediate = await checkOnce();
  if (immediate !== null) return immediate;

  return new Promise<WorkflowOutcome<WorkflowSoftOutput>>((resolve) => {
    let settled = false;
    let checking = false;
    let recheck = false;
    let unsub: (() => void) | undefined;

    const finish = (outcome: WorkflowOutcome<WorkflowSoftOutput>) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      unsub?.();
      resolve(outcome);
    };

    const runCheck = () => {
      if (settled) return;
      if (checking) {
        recheck = true;
        return;
      }
      checking = true;
      void checkOnce()
        .then((outcome) => {
          checking = false;
          if (outcome !== null) {
            finish(outcome);
            return;
          }
          if (recheck && !settled) {
            recheck = false;
            runCheck();
          }
        })
        .catch((e) => {
          checking = false;
          finish({
            ok: false,
            reason: "internal",
            message: e instanceof Error ? e.message : String(e),
          });
        });
    };

    const onAbort = () => {
      if (settled) return;
      const msg = abortMessage(signal!);
      unsub?.();
      signal?.removeEventListener("abort", onAbort);
      void deps
        .stop({ instance: childId }, { kind: "user" })
        .catch(() => {})
        .finally(() => {
          finish({ ok: false, reason: "cancelled", message: msg });
        });
    };

    if (signal !== undefined) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
    unsub = deps.subscribeInstanceUpdated(childId, runCheck);
    // 구독 등록 직전 전이를 놓치지 않게 한 번 더 확인한다.
    runCheck();
  });
}

// workflow() sub-workflow 호출 primitive.
// - 같은 project만 허용(다른 project는 forbidden)
// - 조상 chain cycle 및 최대 중첩 깊이 5 초과 시 conflict
// - completed/failed replay는 자식 재실행 없이 저장 결과 반환, started + handle_ref는 기존 자식에 재부착
export async function runSubWorkflowCall(
  deps: SubWorkflowDeps,
  req: SubWorkflowRequest,
): Promise<WorkflowOutcome<WorkflowSoftOutput>> {
  const existingList = await deps.loadCheckpoints(req.parentInstance);
  if (existingList.ok) {
    const existing = existingList.value.find((cp) => cp.key === req.key);
    if (existing !== undefined) {
      const replayed = checkpointToOutcome<WorkflowSoftOutput>(existing);
      if (replayed !== null) return replayed;
      // started + handle_ref(자식 instance id): 재시작 replay 시 기존 자식에 다시 붙는다.
      if (existing.state === "started" && existing.handle_ref !== null) {
        const childId = existing.handle_ref as Id<"wfi">;
        const outcome = await awaitChildCompletion(deps, childId, req.signal);
        await recordSubWorkflowResult(
          deps.store,
          req.parentInstance,
          req.key,
          childId,
          outcome,
        );
        return outcome;
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

  const parentRead = await deps.store.read(req.parentInstance);
  if (!parentRead.ok) {
    return {
      ok: false,
      reason: parentRead.error.code,
      message: parentRead.error.message,
    };
  }
  const parent = parentRead.value.instance;
  if (parent.state === "stopped") {
    return {
      ok: false,
      reason: "cancelled",
      message: "parent workflow instance is stopped",
    };
  }

  const target = await resolveTargetWorkflow(
    deps.projects,
    parent.project as Id<"prj">,
    req.workflow,
  );
  if (!target.ok) {
    return { ok: false, reason: target.reason, message: target.message };
  }

  const checked = await checkAncestorsAndDepth(
    deps.store,
    parent,
    target.workflowName,
  );
  if (!checked.ok) {
    return { ok: false, reason: checked.reason, message: checked.message };
  }

  if (deps.store.upsertCheckpoint !== undefined) {
    await deps.store.upsertCheckpoint({
      instance: req.parentInstance,
      key: req.key,
      kind: "workflow",
      state: "started",
      handle_ref: null,
    });
  }

  const maxMode =
    req.parentMode ?? parentPermissionCeiling(parent, req.callingParticipant);
  const started = await deps.start(
    {
      workflow: `${parent.project}/${target.workflowName}`,
      text: req.input,
      ...(req.inputs !== undefined ? { inputs: req.inputs } : {}),
    },
    { kind: "workflow", instance: req.parentInstance },
    maxMode !== undefined ? { maxMode } : undefined,
  );
  if (!started.ok) {
    const failed: WorkflowOutcome<WorkflowSoftOutput> = {
      ok: false,
      reason: started.error.code,
      message: started.error.message,
    };
    await recordSubWorkflowResult(
      deps.store,
      req.parentInstance,
      req.key,
      null,
      failed,
    );
    return failed;
  }

  const childId = started.value.instance.id as Id<"wfi">;
  if (deps.store.upsertCheckpoint !== undefined) {
    await deps.store.upsertCheckpoint({
      instance: req.parentInstance,
      key: req.key,
      kind: "workflow",
      state: "started",
      handle_ref: childId,
    });
  }

  const outcome = await awaitChildCompletion(deps, childId, req.signal);
  await recordSubWorkflowResult(
    deps.store,
    req.parentInstance,
    req.key,
    childId,
    outcome,
  );
  return outcome;
}

async function recordSubWorkflowResult(
  store: WorkflowStore,
  parentInstance: Id<"wfi">,
  key: string,
  childId: Id<"wfi"> | null,
  outcome: WorkflowOutcome<WorkflowSoftOutput>,
): Promise<void> {
  if (store.upsertCheckpoint === undefined) return;
  if (outcome.ok) {
    await store.upsertCheckpoint({
      instance: parentInstance,
      key,
      kind: "workflow",
      state: "completed",
      handle_ref: childId,
      output: outcome.result,
    });
  } else {
    await store.upsertCheckpoint({
      instance: parentInstance,
      key,
      kind: "workflow",
      state: "failed",
      handle_ref: childId,
      error: {
        reason: outcome.reason,
        message: outcome.message,
      },
    });
  }
}
