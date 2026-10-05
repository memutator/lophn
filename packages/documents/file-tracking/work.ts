// 파일 관측의 실제 읽기. scan·hash·blob은 core 밖 준비 worker가 하고, 여기 함수는
// 그 worker가 주입한 port만 부른다. 동기 file API는 쓰지 않는다.
import { ok, type Result } from "../../base/mod.ts";
import { decideTracking, type GitignoreRule } from "../projects/mod.ts";
import type { TrackingPattern } from "../../contracts/documents/mod.ts";
import { CANDIDATE_LIMIT, QUIET_MS, STABLE_READ_RETRIES } from "./model.ts";
import {
  dropCandidate,
  dueCandidates,
  emptyObservation,
  type FileIdentity,
  identityMatches,
  mergeCandidate,
  type ObservationBasisCheck,
  type ObservationCandidate,
  type ObservationFact,
  SCAN_INTERVAL_MS,
  scheduleScan,
} from "./observation.ts";

export type ScanEntry = {
  name: string;
  kind: "file" | "directory" | "symlink" | "other";
  // symlink가 가리키는 실제 경로. 없으면 경계 밖으로 본다.
  realPath?: string;
  targetKind?: "file" | "directory";
};

// 준비 worker가 채우는 비동기 순회. 한 번에 한 디렉터리만 연다.
export type ScanPort = {
  list(root: string, directory: string): Promise<Result<readonly ScanEntry[]>>;
  gitignore(root: string, directory: string): Promise<Result<string | null>>;
};

export type ScanRequest = {
  root: string;
  patterns: readonly TrackingPattern[];
  useGitignore: boolean;
  enabled: boolean;
};

export type ScannedFile = {
  relative: string;
  realPath: string;
};

// root를 깊이 우선으로 돈다. `.git`·lophn data·root 밖 symlink는 순회와 최종 파일
// 둘 다에서 빠지고, 규칙에 맞는 파일만 남긴다.
export async function scanRoot(
  port: ScanPort,
  request: ScanRequest,
): Promise<Result<readonly ScannedFile[]>> {
  const found: ScannedFile[] = [];
  const gitignore: GitignoreRule[] = [];
  const pending = [""];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    if (request.useGitignore) {
      const text = await port.gitignore(request.root, directory);
      if (!text.ok) return text;
      if (text.value !== null) {
        gitignore.push({ directory, text: text.value });
      }
    }
    const listed = await port.list(request.root, directory);
    if (!listed.ok) return listed;
    for (const entry of listed.value) {
      const relative = directory === ""
        ? entry.name
        : `${directory}/${entry.name}`;
      const escapes = entry.kind === "symlink" &&
        (entry.realPath === undefined ||
          !insideRoot(request.root, entry.realPath));
      const decision = decideTracking({
        relativePath: relative,
        patterns: request.patterns,
        useGitignore: request.useGitignore,
        gitignore,
        escapesRoot: escapes,
        enabled: request.enabled,
      });
      if (!decision.ok) return decision;
      if (entry.kind === "directory") {
        // 제외된 디렉터리는 내려가지 않는다. 미일치는 아직 판정이 없으므로 내려간다.
        if (decision.value.reason !== "unmatched" && !decision.value.included) {
          continue;
        }
        pending.push(relative);
        continue;
      }
      if (entry.kind === "symlink" && entry.targetKind === "directory") {
        continue;
      }
      if (!decision.value.included) continue;
      const real = entry.kind === "symlink" ? entry.realPath : undefined;
      if (entry.kind === "symlink" && real === undefined) continue;
      found.push({ relative, realPath: real ?? `${request.root}/${relative}` });
    }
  }
  return ok(found);
}

// 문자열 접두사로는 `/work`이 `/work2`를 안으로 본다. 경로 구분자에서만 비교한다.
// relative()가 `..`를 내면 root 밖이다. symlink의 실제 경로에 쓴다.
function insideRoot(root: string, realPath: string): boolean {
  const relative = relativePath(root, realPath);
  return relative !== null && !relative.split("/").includes("..");
}

function relativePath(root: string, target: string): string | null {
  if (root === target) return "";
  const rootParts = root.split("/");
  const targetParts = target.split("/");
  if (rootParts[0] !== targetParts[0]) return null;
  let shared = 0;
  while (
    shared < rootParts.length && shared < targetParts.length &&
    rootParts[shared] === targetParts[shared]
  ) {
    shared += 1;
  }
  const up = rootParts.length - shared;
  const down = targetParts.slice(shared);
  return [...Array<string>(up).fill(".."), ...down].join("/");
}

export type StableRead = {
  hash: string;
  bytes: Uint8Array;
  identity: FileIdentity;
};

// 한 파일을 여는 port. 열기 전과 읽기 뒤의 identity를 같이 돌려준다.
export type StableReadPort = {
  open(path: string): Promise<
    Result<{ before: FileIdentity; read(): Promise<Result<Uint8Array>> }>
  >;
  identity(path: string): Promise<Result<FileIdentity>>;
  hash(bytes: Uint8Array): Promise<string>;
};

export type StableOutcome =
  | { kind: "stable"; read: StableRead }
  | { kind: "unverified"; reason: string };

// 같은 stream에서 hash와 보존 바이트를 만든다. 열기 전·후 identity가 다르면
// 최대 3번 다시 읽고, 그래도 흔들리면 unverified로 둔다.
// ── 관측 루프 ────────────────────────────────────────────────────────────
// watch 신호는 힌트다. 750ms 조용한 후보만 안정 읽기하고, 60초마다 root를 다시
// 대조한다. 시작·watch 넘침·단절·규칙 변경은 전체 대조로 들어온다. 파일 읽기는
// 주입한 port만 부른다.

export type WatchSignal =
  | {
    kind: "changed";
    canonical: string;
    relative: string;
    fact: ObservationFact;
  }
  | { kind: "overflow" }
  | { kind: "closed" };

// root 하나의 watch. 신호는 async iterator로 온다. overflow·closed는 전체 대조다.
export type WatchPort = {
  // signal이 중단되면 watch를 닫는다. 관측 loop가 멈추면 열린 watcher를 남기지 않는다.
  watch(root: string, signal?: AbortSignal): AsyncIterable<WatchSignal>;
  // 지금 바로 꺼낼 수 있는 신호 수. 없으면 0으로 본다. 전체 대조 전에 이미
  // 도착한 신호를 빠짐없이 거두는 데 쓴다.
  ready?(root: string): number;
};

export type ObserveRoot = {
  root: string;
  patterns: readonly TrackingPattern[];
  useGitignore: boolean;
  enabled: boolean;
};

// 관측 하나의 제출. basis는 제출 시점의 근거이고, 확정 때 다시 비교한다.
export type ObservationSubmit = {
  candidate: ObservationCandidate;
  basis: ObservationBasisCheck;
  outcome: StableOutcome;
};

export type ObserveDeps = {
  watch: WatchPort;
  scan: ScanPort;
  read: StableReadPort;
  nowMs(): number;
  // 제출은 machine document.save다. 실패는 그 후보를 다시 관측하게 한다.
  submit(submission: ObservationSubmit): Promise<Result<void>>;
  basisFor(candidate: ObservationCandidate): ObservationBasisCheck;
  // 테스트가 루프를 멈추는 자리. 없으면 신호와 scan만으로 돈다.
  stop?: { stopped: boolean };
  // 신호 대기와 조용함 확인 사이의 한 간격. 테스트가 직접 밀어 벽시계와
  // 무관하게 진행한다. 없으면 50ms다.
  waitTick?: () => Promise<void>;
  // root당 후보 한도. 없으면 10,000이다. 테스트가 작게 넣어 한도 초과를 재현한다.
  candidateLimit?: number;
};

const QUIET_POLL_MS = 50;

// 한 root의 관측. watch 힌트를 후보로 합치고, 조용해진 후보를 안정 읽기해 제출한다.
// 60초 scan과 overflow·closed·시작은 전체 대조다. 이전 scan이 진행 중이면 합친다.
export async function observeRoot(
  deps: ObserveDeps,
  request: ObserveRoot,
): Promise<void> {
  const limit = deps.candidateLimit ?? CANDIDATE_LIMIT;
  const queue = emptyObservation(request.root);
  let scanPending = false;
  // 한도 초과로 시작한 전체 대조 동안 도착한 신호. 대조가 끝난 뒤 한 번에 합쳐
  // 같은 넘침의 신호가 대조를 반복하지 않게 한다.
  const deferred: WatchSignal[] = [];
  let rescanning = false;
  const runScan = async () => {
    const scheduled = scheduleScan(scanPending, deps.nowMs());
    if (scheduled.merged) return;
    scanPending = true;
    const scanned = await scanRoot(deps.scan, request);
    scanPending = false;
    if (!scanned.ok) return;
    for (const file of scanned.value) {
      mergeCandidate(
        queue,
        signalCandidate(request.root, file, deps.nowMs()),
        limit,
      );
    }
  };
  const drainDue = async () => {
    for (const dueItem of dueCandidates(queue, deps.nowMs())) {
      const outcome = await readStably(deps.read, dueItem.canonical);
      if (!outcome.ok) {
        dropCandidate(queue, dueItem.canonical);
        continue;
      }
      const submitted = await deps.submit({
        candidate: dueItem,
        basis: deps.basisFor(dueItem),
        outcome: outcome.value,
      });
      dropCandidate(queue, dueItem.canonical);
      // 근거가 바뀌어 거절되면 다음 scan이 다시 관측한다.
      if (!submitted.ok) queue.rescanRequired = false;
    }
  };
  await runScan();
  let nextScanAt = deps.nowMs() + SCAN_INTERVAL_MS;
  const closing = new AbortController();
  const signals = deps.watch.watch(request.root, closing.signal);
  const incoming = signals[Symbol.asyncIterator]();
  let pending: Promise<IteratorResult<WatchSignal>> | undefined;
  try {
    await observeLoop();
  } finally {
    // 멈춘 loop가 watcher를 쥐고 있지 않게 한다.
    closing.abort();
  }
  async function observeLoop(): Promise<void> {
    while (!deps.stop?.stopped) {
      pending ??= incoming.next();
      const slice = await Promise.race([
        pending.then((result) => ({ kind: "signal" as const, result })),
        (deps.waitTick ?? (() => sleep(QUIET_POLL_MS)))().then(() => ({
          kind: "tick" as const,
        })),
      ]);
      if (slice.kind === "signal") {
        pending = undefined;
        // 신호 하나를 처리한 뒤 양보한다. 동기적으로 풀리는 watch는 다음 신호를
        // 이미 도착한 상태로 두어, 전체 대조 중에 받은 신호를 가드가 못 가린다.
        await Promise.resolve();
        if (rescanning) {
          if (!slice.result.done) deferred.push(slice.result.value);
          continue;
        }
        if (slice.result.done) {
          await drainDue();
          break;
        }
        const signal = slice.result.value;
        if (signal.kind === "overflow" || signal.kind === "closed") {
          queue.items = [];
          queue.rescanRequired = false;
          await runScan();
          continue;
        }
        // 한도를 이미 넘긴 상태의 신호는 개별 후보로 남기지 않는다. 같은 넘침의
        // 나머지 신호마다 전체를 다시 대조하지 않게 한 번으로 합친다.
        if (queue.rescanRequired) continue;
        const merged = mergeCandidate(queue, {
          root: request.root,
          canonical: signal.canonical,
          relative: signal.relative,
          fact: signal.fact,
          lastSignalMs: deps.nowMs(),
          retries: 0,
        }, limit);
        if (merged.kind === "rescan_required") {
          // 한도 초과가 flag를 세운 채로 두면 다음 scan의 합치기가 전부 거절되어
          // 제출이 영영 멈춘다. flag를 내리고 전체를 한 번만 새로 대조한다.
          rescanning = true;
          // 한도를 넘긴 이 신호와 대조 동안 도착한 신호는 후보로 남기지 않는다.
          // 전체 대조만 현재 상태를 담는다.
          deferred.push(signal);
          // 대조의 await 전에 이미 도착한 신호를 먼저 거둔다. 거두지 않으면 그
          // 신호가 대조가 담은 후보가 제출된 뒤에야 합쳐져, 조용함 판정을 놓치고
          // 제출이 부하에 따라 빠진다. ready가 세어 준 만큼만 기다려 없는 신호에
          // 멈추지 않는다.
          const waiting = deps.watch.ready?.(request.root) ?? 0;
          for (let index = 0; index < waiting; index++) {
            const result = await incoming.next();
            if (result.done) break;
            deferred.push(result.value);
          }
          pending = undefined;
          queue.items = [];
          queue.rescanRequired = false;
          await runScan();
          rescanning = false;
          // 대조 동안 쌓인 넘침·단절은 방금 담은 후보를 무효로 한다. 변경 신호는
          // 후보로 다시 합친다. 대조가 담은 파일과 같으면 하나로 합쳐지고, 대조
          // 뒤에야 생긴 파일은 여기서만 후보가 된다.
          const missed = deferred.splice(0);
          for (const queued of missed) {
            if (queued.kind === "overflow" || queued.kind === "closed") {
              queue.items = [];
              queue.rescanRequired = false;
              await runScan();
              break;
            }
            mergeCandidate(queue, {
              root: request.root,
              canonical: queued.canonical,
              relative: queued.relative,
              fact: queued.fact,
              lastSignalMs: deps.nowMs(),
              retries: 0,
            }, limit);
          }
        }
      }
      if (deps.nowMs() >= nextScanAt) {
        nextScanAt = deps.nowMs() + SCAN_INTERVAL_MS;
        await runScan();
      }
      // 신호가 연속으로 풀리는 동안은 제출하지 않는다. 제출이 끼어들면 한도에
      // 닿기 전에 후보가 빠져 넘침을 못 모은다. 제출은 신호 사이의 tick에서 한다.
      if (slice.kind === "tick") await drainDue();
    }
  }
}

function signalCandidate(
  root: string,
  file: ScannedFile,
  nowMs: number,
): ObservationCandidate {
  return {
    root,
    canonical: file.realPath,
    relative: file.relative,
    fact: "modified",
    lastSignalMs: nowMs - QUIET_MS,
    retries: 0,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function readStably(
  port: StableReadPort,
  path: string,
): Promise<Result<StableOutcome>> {
  let last = "file changed while reading";
  for (let attempt = 0; attempt < STABLE_READ_RETRIES; attempt++) {
    const opened = await port.open(path);
    if (!opened.ok) return opened;
    const body = await opened.value.read();
    if (!body.ok) return body;
    const after = await port.identity(path);
    if (!after.ok) return after;
    if (!identityMatches(opened.value.before, after.value)) {
      last = "file changed while reading";
      continue;
    }
    const hash = await port.hash(body.value);
    return ok({
      kind: "stable",
      read: { hash, bytes: body.value, identity: after.value },
    });
  }
  return ok({ kind: "unverified", reason: last });
}
