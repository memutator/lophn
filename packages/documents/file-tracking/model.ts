// 작업 배분의 값과 상태 전이. 순수 함수만 둔다. 시각·난수·파일 시스템은 인자로 받는다.
// architecture/documents 2.3: root별 iterator와 후보 큐, round-robin 128 entry 배분,
// 후보 10,000 초과는 rescan_required, 준비 동시 2 slot(사람 요청 우선), 결과 제출 동시 2.
import type { DirectoryEntry } from "../projects/mod.ts";

// 준비 worker에 한 번에 넘기는 directory entry 묶음. architecture 2.3의 고정 한도다.
export const DISPATCH_BATCH = 128;

// 한 root의 후보가 이 수를 넘으면 개별 후보 대신 rescan_required 하나만 남긴다.
export const CANDIDATE_LIMIT = 10_000;

// 준비 worker 동시 slot 수. architecture/documents 2.1의 고정 값이다.
export const PREPARATION_SLOTS = 2;

// 결과 command 동시 제출 한도. platform command 접수 한도에 맞춘 고정 값이다.
export const SUBMIT_CONCURRENCY = 2;

// 안정 읽기 관측까지의 조용한 구간과 재시도 한도(R4).
export const QUIET_MS = 750;
export const STABLE_READ_RETRIES = 3;

// slot의 우선순위. 사람이 기다리는 요청은 하나의 slot을 독점하고, 없으면 둘 다 background다.
export type SlotPriority = "human" | "background";

export type SlotState = "idle" | "busy" | "closed";

export type PrepareSlot = {
  // worker 프로세스와 대응하는 slot 식별. crash refill은 같은 이름의 새 프로세스다.
  name: string;
  priority: SlotPriority;
  state: SlotState;
};

export type ScanRoot = {
  path: string;
  // root 순회가 끝났는지. 끝난 root는 라운드 로빈에서 건너뛴다.
  exhausted: boolean;
};

export type Candidate = {
  root: string;
  // root 기준 `/` 상대 경로다.
  path: string;
  observedAt: string;
};

export type CandidateOutcome =
  | { kind: "observed"; candidate: Candidate }
  | { kind: "unverified"; candidate: Candidate }
  | { kind: "rescan_required"; root: string };

export type ScanBudget = {
  // 이 후보 배분에서 소비한 directory entry 수.
  entries: number;
  exceeded: boolean;
};

// 후보 큐 하나. root별로 두고 round-robin으로 비운다.
export type CandidateQueue = {
  root: string;
  items: Candidate[];
  // 이 root에서 예산을 초과했는지. 초과하면 개별 후보를 더 받지 않는다.
  rescanRequired: boolean;
};

export function emptyQueue(root: string): CandidateQueue {
  return { root, items: [], rescanRequired: false };
}

// 후보를 큐에 넣는다. root당 CANDIDATE_LIMIT를 넘는 분은 rescan_required로 합친다.
export function enqueueCandidate(
  queue: CandidateQueue,
  candidate: Candidate,
): CandidateOutcome | undefined {
  if (queue.rescanRequired) {
    return { kind: "rescan_required", root: queue.root };
  }
  queue.items.push(candidate);
  if (queue.items.length > CANDIDATE_LIMIT) {
    queue.items = [];
    queue.rescanRequired = true;
    return { kind: "rescan_required", root: queue.root };
  }
  return undefined;
}

// 여러 root의 후보 큐 가운데 하나의 배분을 고른다.
// round-robin: 줄 선 root를 순서대로 돌고, 각 root는 최대 DISPATCH_BATCH entry씩 내보낸다.
export function dispatchBatch(
  queues: readonly CandidateQueue[],
  /** 마지막 배분에서 마지막으로 쓴 queue의 index. 없으면 -1. */
  lastServed: number,
): { batch: Candidate[]; root: string; next: number } | undefined {
  if (queues.length === 0) return undefined;
  for (let step = 1; step <= queues.length; step++) {
    const index = (lastServed + step) % queues.length;
    const queue = queues[index];
    if (queue.rescanRequired || queue.items.length === 0) continue;
    const batch = queue.items.splice(0, DISPATCH_BATCH);
    return { batch, root: queue.root, next: index };
  }
  return undefined;
}

// 준비 slot을 고른다. 사람이 기다리는 요청은 human slot을 먼저 차지하고,
// 기다리는 요청이 없으면 idle slot(둘 다 background)에 배분한다.
export function pickSlot(
  slots: readonly PrepareSlot[],
  humanWaited: boolean,
): PrepareSlot | undefined {
  if (humanWaited) {
    const human = slots.find((slot) =>
      slot.priority === "human" && slot.state === "idle"
    );
    // human slot이 busy여도 요청은 background slot으로 흘린다. 줄을 새로 만들지 않는다.
    if (human) return human;
  }
  return slots.find((slot) => slot.state === "idle");
}

// 진행 중인 준비가 있으면 같은 경로의 새 준비를 시작하지 않는다(architecture 2.3).
export type InFlight = {
  root: string;
  path: string;
};

export function isSamePath(a: InFlight, b: InFlight): boolean {
  return a.root === b.root && a.path === b.path;
}

// 안정 읽기 재시도 판정. QUIET_MS 안에 신호가 또 오면 재시도를 쓴다.
export function stableReadsLeft(retried: number): number {
  return Math.max(0, STABLE_READ_RETRIES - retried);
}

// 결과 command 제출 slot. 동시 2개만 열리고 나머지는 기다린다.
export type SubmitSlotState = "open" | "taken";

export function takeSubmitSlots(
  count: number,
  taken: number,
): { allowed: number; waitlisted: number } {
  const allowed = Math.max(0, Math.min(count, SUBMIT_CONCURRENCY - taken));
  return { allowed, waitlisted: count - allowed };
}

export function directoryBatch(
  entries: readonly DirectoryEntry[],
  start: number,
): { batch: readonly DirectoryEntry[]; next: number; exhausted: boolean } {
  const batch = entries.slice(start, start + DISPATCH_BATCH);
  const next = start + batch.length;
  return { batch, next, exhausted: next >= entries.length };
}

// coordinator가 주입받는 부수 효과. 시각과 request id는 밖에서 온다.
export type CoordinatorDepsLike = {
  nowIso(): string;
  newRequestId(): string;
};
