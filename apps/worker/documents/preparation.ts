// 준비 worker entry. coordinator가 넘긴 stdio로 preparation child를 연다.
// kind와 root는 환경으로만 받는다. 권한은 root·working copy·staging의 read와
// 필요한 write만이다(architecture/documents 2.2).
import { type LophnError } from "../../../packages/base/mod.ts";
import {
  projectPreviewTracking,
  projectPreviewTrackingInputSchema,
} from "../../../packages/contracts/documents/mod.ts";
import {
  type WorkerRequest,
  type WorkerResponse,
} from "../../../packages/contracts/platform/mod.ts";
import {
  type ChildSession,
  type ChildStreams,
  startChild,
} from "../../../packages/platform/responsiveness/mod.ts";
import { previewTracking } from "../../../packages/documents/projects/work.ts";
import { directoryScanner } from "../../../packages/documents/projects/scan.ts";
import { seriesNext } from "../../../packages/documents/series/mod.ts";
import {
  fileReadPort,
  fileScanPort,
} from "../../../packages/documents/file-tracking/fs.ts";
import {
  readStably,
  scanRoot,
} from "../../../packages/documents/file-tracking/mod.ts";
import type { TrackingPattern } from "../../../packages/contracts/documents/mod.ts";
import { PREPARATION_OPS } from "../../../packages/documents/file-tracking/ipc.ts";
import { type ByteInbox, createByteInbox } from "./byte-inbox.ts";
import { acceptFileOp } from "./file-requests.ts";

export type PreparationOptions = {
  root: string;
  streams: ChildStreams;
  // op별 실행. op 이름과 payload는 준비 worker 경계에서 contracts schema로 다시
  // 검사한다. inbox는 요청 앞에 도착한 byte chunk(사람 파일 쓰기 내용)다.
  accept(request: WorkerRequest, inbox: ByteInbox): Promise<unknown>;
};

// accept가 내는 경계 오류. code는 공통 7개 안의 LophnError고, 이 밖의 실패는
// unavailable로 중계한다.
class PreparationFailure extends Error {
  constructor(readonly failure: LophnError) {
    super(failure.message);
  }
}

// preview_tracking의 실제 실행. 입력을 contracts schema로 다시 검사하고 현재 폴더를
// 깊이 우선으로 돌려 TrackingPreview page를 만든다. observed_at은 응답 때의 관측 시각이다.
export async function acceptPreparation(
  request: WorkerRequest,
  inbox: ByteInbox = createByteInbox(),
): Promise<unknown> {
  const filed = acceptFileOp(request, inbox);
  if (filed !== undefined) {
    const answered = await filed;
    if (!answered.ok) throw new PreparationFailure(answered.error);
    return answered.value;
  }
  if (request.op === PREPARATION_OPS.hashBatch) {
    return hashBatchObserved(request.payload);
  }
  if (request.op === "documents.scan_root") {
    return scanObserved(request.payload);
  }
  if (request.op === "documents.hash_file") {
    return hashObserved(request.payload);
  }
  if (request.op === "documents.diff_bytes") {
    return diffObserved(request.payload);
  }
  if (request.op === "documents.series_next") {
    return seriesNextObserved(request.payload);
  }
  if (request.op !== projectPreviewTracking.name) {
    return { op: request.op, accepted: true };
  }
  const parsed = projectPreviewTrackingInputSchema.safeParse(request.payload);
  if (!parsed.success) {
    throw new PreparationFailure({
      code: "invalid_input",
      message: "invalid preview input",
    });
  }
  const preview = previewTracking(directoryScanner(), {
    project: parsed.data.project,
    baseRevision: parsed.data.base_revision,
    folders: parsed.data.folders,
    tracking: parsed.data.tracking,
    observedAt: new Date().toISOString(),
    cursor: parsed.data.cursor,
  });
  if (!preview.ok) throw new PreparationFailure(preview.error);
  return preview.value;
}

// 활성 root 하나를 규칙대로 순회한다. 결과는 추적 파일의 상대 경로와 실제 경로다.
async function scanObserved(payload: unknown): Promise<unknown> {
  const body = payload as {
    root?: unknown;
    patterns?: unknown;
    use_gitignore?: unknown;
    enabled?: unknown;
  };
  if (typeof body?.root !== "string" || !Array.isArray(body.patterns)) {
    throw new PreparationFailure({
      code: "invalid_input",
      message: "invalid scan input",
    });
  }
  const scanned = await scanRoot(fileScanPort(), {
    root: body.root,
    patterns: body.patterns as TrackingPattern[],
    useGitignore: body.use_gitignore === true,
    enabled: body.enabled !== false,
  });
  if (!scanned.ok) throw new PreparationFailure(scanned.error);
  return { files: scanned.value };
}

// 한 파일을 안정 읽기한다. hash와 보존 바이트는 같은 stream에서 나온다.
async function hashObserved(payload: unknown): Promise<unknown> {
  const path = (payload as { path?: unknown })?.path;
  if (typeof path !== "string") {
    throw new PreparationFailure({
      code: "invalid_input",
      message: "invalid hash input",
    });
  }
  const read = await readStably(fileReadPort(), path);
  if (!read.ok) throw new PreparationFailure(read.error);
  if (read.value.kind === "unverified") {
    return { kind: "unverified", reason: read.value.reason };
  }
  return {
    kind: "stable",
    hash: read.value.read.hash,
    size: read.value.read.bytes.length,
    real_path: read.value.read.identity.realPath,
  };
}

// 후보 배분 묶음의 안정 읽기. 후보마다 hash와 크기를 내고, 읽는 동안 흔들리면 이유와
// 함께 unverified다. 결과 순서는 후보 순서다. 본문은 응답에 싣지 않는다.
async function hashBatchObserved(payload: unknown): Promise<unknown> {
  const body = payload as {
    root?: unknown;
    batch?: unknown;
  };
  if (
    typeof body?.root !== "string" || !Array.isArray(body.batch) ||
    !body.batch.every((entry) =>
      typeof (entry as { path?: unknown })?.path === "string"
    )
  ) {
    throw new PreparationFailure({
      code: "invalid_input",
      message: "invalid batch input",
    });
  }
  const results: unknown[] = [];
  for (const entry of body.batch as { path: string }[]) {
    const read = await readStably(fileReadPort(), `${body.root}/${entry.path}`);
    if (!read.ok || read.value.kind === "unverified") {
      results.push({
        path: entry.path,
        kind: "unverified",
        reason: read.ok && read.value.kind === "unverified"
          ? read.value.reason
          : "unreadable",
      });
      continue;
    }
    results.push({
      path: entry.path,
      kind: "stable",
      hash: read.value.read.hash,
      size: read.value.read.bytes.length,
      real_path: read.value.read.identity.realPath,
    });
  }
  return { results };
}

// 두 바이트 열의 줄 단위 diff. 준비 worker가 계산하고 core는 결과를 받기만 한다.
function diffObserved(payload: unknown): unknown {
  const body = payload as { before?: unknown; after?: unknown };
  if (typeof body?.before !== "string" || typeof body?.after !== "string") {
    throw new PreparationFailure({
      code: "invalid_input",
      message: "invalid diff input",
    });
  }
  const diff = lineDiff(body.before, body.after);
  if (diff === null) return { kind: "diff_too_large" };
  return { kind: "diff", changes: diff };
}

// series-next 계산. 가족 상태로 다음 제안을 내는 순수 계산이며 저장은 없다.
// payload가 어긋나면 잘못된 입력이다.
function seriesNextObserved(payload: unknown): unknown {
  const suggestion = seriesNext(payload);
  if (suggestion === null) {
    throw new PreparationFailure({
      code: "invalid_input",
      message: "invalid series next input",
    });
  }
  return { suggestion };
}

// 줄 단위 Myers diff. 대각선 탐색이 이 횟수를 넘으면 계산을 멈추고 diff를 내지 않는다.
// 전체 표(O(줄 수²))를 만들지 않는다.
const DIFF_STEP_LIMIT = 100_000;

export type LineChange = { kind: "same" | "removed" | "added"; line: string };

function linesOf(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function lineDiff(before: string, after: string): LineChange[] | null {
  const left = linesOf(before);
  const right = linesOf(after);
  const trace = myersTrace(left, right);
  if (trace === null) return null;
  return replay(left, right, trace);
}

function myersTrace(left: string[], right: string[]): Int32Array[] | null {
  const width = left.length;
  const height = right.length;
  const max = width + height;
  const furthest = new Int32Array(2 * max + 1);
  const trace: Int32Array[] = [furthest.slice()];
  let steps = 0;
  for (let depth = 0; depth <= max; depth++) {
    for (let diagonal = -depth; diagonal <= depth; diagonal += 2) {
      const down = diagonal === -depth ||
        (diagonal !== depth &&
          furthest[offset(diagonal - 1, max)] <
            furthest[offset(diagonal + 1, max)]);
      let row = down
        ? furthest[offset(diagonal + 1, max)]
        : furthest[offset(diagonal - 1, max)] + 1;
      let column = row - diagonal;
      while (
        row < width && column < height && left[row] === right[column]
      ) {
        row += 1;
        column += 1;
      }
      furthest[offset(diagonal, max)] = row;
      steps += 1;
      if (steps > DIFF_STEP_LIMIT) return null;
      if (row >= width && column >= height) {
        trace.push(furthest.slice());
        return trace;
      }
    }
    trace.push(furthest.slice());
  }
  return trace;
}

function offset(diagonal: number, max: number): number {
  return diagonal + max;
}

function replay(
  left: string[],
  right: string[],
  trace: readonly Int32Array[],
): LineChange[] {
  const changes: LineChange[] = [];
  let row = left.length;
  let column = right.length;
  const max = left.length + right.length;
  for (let depth = trace.length - 2; depth >= 0; depth--) {
    const furthest = trace[depth]!;
    const diagonal = row - column;
    const down = diagonal === -depth ||
      (diagonal !== depth &&
        furthest[offset(diagonal - 1, max)] <
          furthest[offset(diagonal + 1, max)]);
    const previousDiagonal = down ? diagonal + 1 : diagonal - 1;
    const previousRow = furthest[offset(previousDiagonal, max)]!;
    const startRow = down ? previousRow : previousRow + 1;
    const startColumn = startRow - diagonal;
    while (row > startRow && column > startColumn) {
      row -= 1;
      column -= 1;
      changes.push({ kind: "same", line: left[row]! });
    }
    if (row === 0 && column === 0) break;
    if (down) {
      column -= 1;
      changes.push({ kind: "added", line: right[column]! });
    } else {
      row -= 1;
      changes.push({ kind: "removed", line: left[row]! });
    }
  }
  changes.reverse();
  return changes;
}

// accept 실행을 worker_response envelope로 감싼다. accept가 공통 code 오류를 내면
// 그 code로 중계하고, 나머지 내부 실패는 unavailable이다. 본문·경로를 응답에 넣지 않는다.
// notify는 accept가 끊긴 그 순간 같은 continuation에서 부른다. .then으로 늦추면 stop frame이
// 먼저 관측되어 terminal 세션에서 응답 send가 거절된다(platform/responsiveness dispatch 경계).
export async function respondTo(
  request: WorkerRequest,
  accept: (request: WorkerRequest) => Promise<unknown>,
  notify: (response: WorkerResponse) => Promise<void>,
): Promise<void> {
  try {
    const payload = await accept(request);
    await notify({
      type: "worker_response",
      request_id: request.request_id,
      ok: true,
      payload,
    });
  } catch (error) {
    const failure = error instanceof PreparationFailure
      ? error.failure
      : { code: "unavailable" as const, message: "preparation failed" };
    await notify({
      type: "worker_response",
      request_id: request.request_id,
      ok: false,
      error: failure,
    });
  }
}

export function createPreparation(options: PreparationOptions): ChildSession {
  const inbox = createByteInbox();
  const session = startChild(options.streams, {
    onFrame(frame) {
      inbox.collect(frame);
    },
    onHello(hello) {
      if (hello.kind !== "documents/preparation") {
        throw new Error("invalid worker kind");
      }
      return session.send({ type: "ready" });
    },
    onStop() {
      return session.send({ type: "stopped" });
    },
    onParent(message) {
      if (message.type !== "worker_request") return;
      const parsed = (message as unknown as { request_id?: string })
          .request_id !== undefined
        ? { success: true as const, data: message as WorkerRequest }
        : { success: false as const };
      if (!parsed.success) {
        return session.send({
          type: "worker_response",
          request_id: "unknown",
          ok: false,
          error: { code: "invalid_input", message: "invalid request body" },
        });
      }
      return respondTo(
        parsed.data as WorkerRequest,
        (request) => options.accept(request, inbox),
        (response) => session.send(response),
      );
    },
  });
  return session;
}

export async function runPreparation(root: string): Promise<void> {
  // Only the entry owns console routing. Helper modules never change global console.
  console.log = console.info = console.debug = (...args: unknown[]) =>
    console.error(...args);
  const session = await createPreparation({
    root,
    streams: { stdin: Deno.stdin, stdout: Deno.stdout, stderr: Deno.stderr },
    accept: acceptPreparation,
  });
  await session.run();
}
