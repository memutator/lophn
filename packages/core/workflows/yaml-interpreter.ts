import type { Id } from "../../protocol/base/mod.ts";
import type {
  HandResult,
  WorkflowCheckpoint,
  WorkflowInstance,
  WorkflowLine,
  WorkflowSoftOutput,
} from "../../protocol/workflows/mod.ts";
import type { WorkflowStore } from "./ports.ts";

// flow.ts가 없는 YAML 축약형 workflow의 내장 interpreter checkpoint 관리다.
// workflow_lines와 나란히 workflow_checkpoints에 started / completed / interrupted를 남긴다.

export function isFlowInstance(
  instance: Pick<WorkflowInstance, "code_snapshot">,
  lines: readonly WorkflowLine[],
): boolean {
  if (instance.code_snapshot !== undefined && instance.code_snapshot !== null) {
    return true;
  }
  const started = lines.find((l) => l.kind === "started");
  return started?.kind === "started" && started.step === null;
}

function isStepCheckpointKey(key: string, step: string): boolean {
  return key === step || key.startsWith(`${step}#`);
}

// 같은 step이 루프나 hand_now로 다시 넘겨질 때는 고유 순번 key(`<step>#2`, `<step>#3`)를 부여한다.
export function nextYamlCheckpointKey(
  existing: readonly WorkflowCheckpoint[],
  step: string,
): string {
  const matching = existing.filter((cp) => isStepCheckpointKey(cp.key, step));
  if (matching.length === 0) return step;
  return `${step}#${matching.length + 1}`;
}

// 지금 활성(started 또는 interrupted) 상태인 그 step의 가장 최근 checkpoint를 찾는다.
export function activeYamlCheckpointForStep(
  checkpoints: readonly WorkflowCheckpoint[],
  step: string,
): WorkflowCheckpoint | null {
  for (let i = checkpoints.length - 1; i >= 0; i--) {
    const cp = checkpoints[i]!;
    if (
      isStepCheckpointKey(cp.key, step) &&
      (cp.state === "started" || cp.state === "interrupted")
    ) {
      return cp;
    }
  }
  return null;
}

async function loadCurrentCheckpoints(
  store: WorkflowStore,
  instance: Id<"wfi">,
): Promise<WorkflowCheckpoint[]> {
  if (store.checkpoints !== undefined) {
    const loaded = await store.checkpoints(instance);
    if (loaded.ok) return loaded.value;
  }
  const read = await store.read(instance);
  return read.ok ? (read.value.checkpoints ?? []) : [];
}

// YAML step이 담당 session(또는 원격 call)에 넘겨질 때 started checkpoint를 기록한다.
export async function recordYamlHandoffCheckpoint(
  store: WorkflowStore,
  input: {
    instance: Id<"wfi">;
    handed: HandResult | null;
    remoteCall?: string | null;
  },
): Promise<void> {
  if (store.upsertCheckpoint === undefined) return;
  if (input.handed === null || input.handed.outcome !== "handed") return;
  const existing = await loadCurrentCheckpoints(store, input.instance);
  const key = nextYamlCheckpointKey(existing, input.handed.step);
  const handleRef = input.handed.receiver ?? input.remoteCall ?? null;
  await store.upsertCheckpoint({
    instance: input.instance,
    key,
    kind: input.handed.human_turn ? "human" : "agent",
    state: "started",
    handle_ref: handleRef,
  });
}

// YAML step의 명시적 report가 도착했을 때 해당 step의 checkpoint를 completed로 확정한다.
export async function recordYamlReportCheckpoint(
  store: WorkflowStore,
  input: {
    instance: Id<"wfi">;
    step: string;
    humanTurn: boolean;
    session?: string | null;
    output: WorkflowSoftOutput;
  },
): Promise<void> {
  if (store.upsertCheckpoint === undefined) return;
  const existing = await loadCurrentCheckpoints(store, input.instance);
  const active = activeYamlCheckpointForStep(existing, input.step);
  const key = active?.key ?? input.step;
  const kind = active?.kind ?? (input.humanTurn ? "human" : "agent");
  await store.upsertCheckpoint({
    instance: input.instance,
    key,
    kind,
    state: "completed",
    ...(input.session !== undefined ? { handle_ref: input.session } : {}),
    output: input.output,
  });
}

// [Retry]가 같은 session 이어가기를 수행할 때 interrupted였던 checkpoint를 다시 started로 되돌린다.
export async function recordYamlRetryCheckpoint(
  store: WorkflowStore,
  input: {
    instance: Id<"wfi">;
    step: string;
    session: Id<"ses">;
    humanTurn: boolean;
  },
): Promise<void> {
  if (store.upsertCheckpoint === undefined) return;
  const existing = await loadCurrentCheckpoints(store, input.instance);
  const active = activeYamlCheckpointForStep(existing, input.step);
  const key = active?.key ?? input.step;
  const kind = active?.kind ?? (input.humanTurn ? "human" : "agent");
  await store.upsertCheckpoint({
    instance: input.instance,
    key,
    kind,
    state: "started",
    handle_ref: input.session,
  });
}

// join: any 합류 등으로 취소된 병렬 형제 YAML step의 활성 checkpoint를 interrupted(cancelled)로 닫는다.
export async function recordYamlCancelCheckpoint(
  store: WorkflowStore,
  input: {
    instance: Id<"wfi">;
    step: string;
    message?: string;
  },
): Promise<void> {
  if (store.upsertCheckpoint === undefined) return;
  const existing = await loadCurrentCheckpoints(store, input.instance);
  const active = activeYamlCheckpointForStep(existing, input.step);
  if (active === null) return;
  await store.upsertCheckpoint({
    instance: input.instance,
    key: active.key,
    kind: active.kind,
    state: "interrupted",
    handle_ref: active.handle_ref,
    error: {
      reason: "cancelled",
      message: input.message ?? "superseded by parallel join (any)",
    },
  });
}
