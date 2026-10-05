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

export type PreparationOptions = {
  root: string;
  streams: ChildStreams;
  // op별 실행. op 이름과 payload는 준비 worker 경계에서 contracts schema로 다시
  // 검사한다. preview_tracking은 실제 폴더 scan을 돌린다. 실제 scan_batch·hash·diff는
  // T11이 채운다.
  accept(request: WorkerRequest): Promise<unknown>;
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
// deno-lint-ignore require-await -- accept 시그니처가 Promise를 요구한다.
export async function acceptPreparation(
  request: WorkerRequest,
): Promise<unknown> {
  if (request.op !== projectPreviewTracking.name) {
    // T2 뼈대 echo. 실제 scan_batch·hash·diff는 T11이 채운다.
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
  const session = startChild(options.streams, {
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
        options.accept,
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
