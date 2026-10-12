// 파일 관측의 순수 규칙. 후보 합치기, 안정 판정, FileStatus, 관측 근거 비교.
// 파일 읽기는 여기 없다. scan·hash는 work.ts와 준비 worker가 한다.
import { CANDIDATE_LIMIT, QUIET_MS } from "./model.ts";

export const SCAN_INTERVAL_MS = 60_000;

export const FILE_STATUS_STATES = [
  "not_tracked",
  "tracked",
  "version_pending",
  "validation_failed",
  "source_missing",
  "unverified",
] as const;

export type FileStatusState = (typeof FILE_STATUS_STATES)[number];

// 한 canonical 경로의 관측 후보. 연속 변화는 하나로 합치고, 삭제·재생성·이름 변경은 남긴다.
export type ObservationFact = "modified" | "deleted" | "recreated" | "renamed";

export type ObservationCandidate = {
  root: string;
  // canonical 절대 경로. 합치기의 기준이다.
  canonical: string;
  relative: string;
  fact: ObservationFact;
  // 마지막 힌트가 온 시각(ms). 750ms 조용하면 관측한다.
  lastSignalMs: number;
  // 안정 읽기 실패 횟수. STABLE_READ_RETRIES를 넘기면 unverified다.
  retries: number;
};

export type ObservationQueue = {
  root: string;
  items: ObservationCandidate[];
  rescanRequired: boolean;
};

export function emptyObservation(root: string): ObservationQueue {
  return { root, items: [], rescanRequired: false };
}

// 같은 canonical 경로의 후보는 하나로 합친다. 삭제 뒤의 생성은 재생성으로 남기고
// 단순 수정으로 덮지 않는다. 한도를 넘으면 rescan_required 하나만 남긴다.
export function mergeCandidate(
  queue: ObservationQueue,
  next: ObservationCandidate,
  // root당 후보 한도. 호출자가 작게 넣어 한도 초과를 재현한다.
  limit: number = CANDIDATE_LIMIT,
): { kind: "merged" } | { kind: "rescan_required"; root: string } {
  if (queue.rescanRequired) {
    return { kind: "rescan_required", root: queue.root };
  }
  const found = queue.items.find((item) => item.canonical === next.canonical);
  if (found) {
    // 같은 파일의 새 신호는 조용함 시각을 다시 시작한다. 덮어쓰지 않으면 대조가
    // 담은 후보가 그 뒤 신호의 조용함을 가로채 신호가 제출되지 않는다.
    found.lastSignalMs = Math.max(found.lastSignalMs, next.lastSignalMs);
    found.retries = next.retries;
    if (found.fact === "deleted" && next.fact === "modified") {
      found.fact = "recreated";
    } else if (next.fact === "deleted" || next.fact === "renamed") {
      found.fact = next.fact;
    }
    return { kind: "merged" };
  }
  if (queue.items.length >= limit) {
    queue.items = [];
    queue.rescanRequired = true;
    return { kind: "rescan_required", root: queue.root };
  }
  queue.items.push(next);
  return { kind: "merged" };
}

// 750ms 동안 새 신호가 없는 후보만 관측한다. 아직 조용하지 않으면 남긴다.
export function dueCandidates(
  queue: ObservationQueue,
  nowMs: number,
): ObservationCandidate[] {
  if (queue.rescanRequired) return [];
  return queue.items.filter((item) => nowMs - item.lastSignalMs >= QUIET_MS);
}

export function dropCandidate(
  queue: ObservationQueue,
  canonical: string,
): void {
  queue.items = queue.items.filter((item) => item.canonical !== canonical);
}

// 주기 scan. 이전 scan이 아직 진행 중이면 하나로 합친다.
export function scheduleScan(
  pending: boolean,
  _nowMs: number,
): { pending: boolean; merged: boolean } {
  if (pending) return { pending: true, merged: true };
  return { pending: true, merged: false };
}

// 열기 전과 읽기 뒤가 같아야 같은 파일이다. 하나라도 다르면 다시 읽거나 미확인이다.
export type FileIdentity = {
  realPath: string;
  device: number;
  inode: number;
  size: number;
  mtimeMs: number;
};

export function identityMatches(
  before: FileIdentity,
  after: FileIdentity,
): boolean {
  return before.realPath === after.realPath && before.device === after.device &&
    before.inode === after.inode && before.size === after.size &&
    before.mtimeMs === after.mtimeMs;
}

export type StatusInput = {
  tracked: boolean;
  missing: boolean;
  unverified: boolean;
  validationFailed: boolean;
  observedHash: string | null;
  latestHash: string | null;
};

// FileStatus는 ledger 열이 아니다. 조회 때 이 규칙으로 계산한다.
export function fileStatusOf(input: StatusInput): FileStatusState {
  if (!input.tracked) return "not_tracked";
  if (input.unverified) return "unverified";
  if (input.missing) return "source_missing";
  if (input.validationFailed) return "validation_failed";
  if (
    input.observedHash !== null && input.latestHash !== null &&
    input.observedHash === input.latestHash
  ) {
    return "tracked";
  }
  return "version_pending";
}

// 관측 제출의 비교 기준. 하나라도 다르면 그 제출은 conflict고 다시 관측한다.
export type ObservationBasisCheck = {
  project: string;
  projectRevision: string;
  path: string;
  documentRevision: string | null;
  active: boolean;
  archived: boolean;
  rootPresent: boolean;
};

export function basisChanged(
  submitted: ObservationBasisCheck,
  current: ObservationBasisCheck,
): boolean {
  return submitted.project !== current.project ||
    submitted.projectRevision !== current.projectRevision ||
    submitted.path !== current.path ||
    submitted.documentRevision !== current.documentRevision ||
    submitted.active !== current.active ||
    submitted.archived !== current.archived ||
    submitted.rootPresent !== current.rootPresent;
}
