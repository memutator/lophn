// release worker job. supervisor가 준비 요청마다 띄우고 부모와 stdio JSON으로
// 이야기한다. 플랫폼 credential은 받지 않는다.
// kind와 root는 환경으로만 받는다.
import type { WorkerRequest } from "../../../../protocol/supervision/mod.ts";
import {
  type ChildSession,
  type ChildStreams,
  startChild,
} from "../../../supervision/responsiveness/mod.ts";
import { prepareRelease, type PrepareReleaseInput } from "../mod.ts";

const RELEASE_WORKER_KIND = "apps/release";

// supervisor ↔ worker stdio JSON job. request envelope은 supervision의
// workerRequestEnvelopeSchema이고 op별 payload는 소유 contracts가 다시 검사한다.

type ReleaseWorkerOptions = {
  root: string;
  streams: ChildStreams;
  // op별 실행. op 이름은 release worker 경계에서 contracts schema로 다시 검사한다.
  accept(request: WorkerRequest): Promise<unknown>;
  // worker 종료·취소면 true. 부분 bundle은 확정하지 않는다.
  cancelled?: () => boolean;
};

function createReleaseWorker(
  options: ReleaseWorkerOptions,
): ChildSession {
  const session = startChild(options.streams, {
    onHello(hello) {
      if (hello.kind !== RELEASE_WORKER_KIND) {
        throw new Error("invalid worker kind");
      }
      return session.send({ type: "ready" });
    },
    onStop() {
      options.cancelled?.();
      return session.send({ type: "stopped" });
    },
    async onParent(message) {
      if (message.type !== "worker_request") return;
      const parsed = (message as unknown as { request_id?: string })
          .request_id !== undefined
        ? { success: true as const, data: message as WorkerRequest }
        : { success: false as const };
      if (!parsed.success) {
        await session.send({
          type: "worker_response",
          request_id: "unknown",
          ok: false,
          error: { code: "invalid_input", message: "invalid request body" },
        });
        return;
      }
      try {
        const payload = await options.accept(parsed.data as WorkerRequest);
        await session.send({
          type: "worker_response",
          request_id: message.request_id,
          ok: true,
          payload,
        });
      } catch {
        // release worker 내부 실패는 unavailable이다. 본문·경로를 응답에 넣지 않는다.
        await session.send({
          type: "worker_response",
          request_id: message.request_id,
          ok: false,
          error: { code: "unavailable", message: "release preparation failed" },
        });
      }
    },
  });
  return session;
}

function isPrepareInput(value: unknown): value is PrepareReleaseInput {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.app === "string" &&
    typeof record.sourceRoot === "string" &&
    typeof record.commit === "string" &&
    typeof record.entrypoint === "string" &&
    typeof record.blueprintSource === "string" &&
    Array.isArray(record.screens) && Array.isArray(record.dependencies);
}

async function acceptRelease(
  root: string,
  request: WorkerRequest,
  cancelled?: () => boolean,
): Promise<unknown> {
  if (request.op !== "release.prepare") {
    throw new Error("unknown release op");
  }
  if (!isPrepareInput(request.payload)) {
    throw new Error("invalid release input");
  }
  const prepared = await prepareRelease(
    { ...request.payload, dataRoot: root },
    { cancelled },
  );
  if (!prepared.ok) {
    throw new Error(prepared.error.reason);
  }
  return {
    bundle_hash: prepared.value.bundleHash,
    copy_path: prepared.value.copyPath,
    blueprint_hash: prepared.value.blueprintHash,
  };
}

export async function runReleaseWorker(root: string): Promise<void> {
  // Only the entry owns console routing. Helper modules never change global console.
  console.log = console.info = console.debug = (...args: unknown[]) =>
    console.error(...args);
  let stopped = false;
  const session = await createReleaseWorker({
    root,
    streams: { stdin: Deno.stdin, stdout: Deno.stdout, stderr: Deno.stderr },
    cancelled: () => {
      stopped = true;
      return true;
    },
    accept: (request) => acceptRelease(root, request, () => stopped),
  });
  await session.run();
}
