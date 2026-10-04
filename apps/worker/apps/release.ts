// release worker job. supervisor가 준비 요청마다 띄우고 부모와 stdio JSON으로
// 이야기한다(apps/plan apps#T6). 플랫폼 credential은 받지 않는다
// (architecture/apps 2.1). kind와 root는 환경으로만 받는다.
import type {
  WorkerRequest,
} from "../../../packages/contracts/platform/mod.ts";
import {
  type ChildSession,
  type ChildStreams,
  startChild,
} from "../../../packages/platform/responsiveness/mod.ts";

export const RELEASE_WORKER_KIND = "apps/release";

// supervisor ↔ worker stdio JSON job. request envelope은 supervision의
// workerRequestEnvelopeSchema이고 op별 payload는 소유 contracts가 다시 검사한다.
export type ReleaseJobRequest = {
  op: string;
  payload: unknown;
};

export type ReleaseJobResponse = {
  accepted: boolean;
};

export type ReleaseWorkerOptions = {
  root: string;
  streams: ChildStreams;
  // op별 실행. op 이름은 release worker 경계에서 contracts schema로 다시 검사한다.
  accept(request: WorkerRequest): Promise<unknown>;
};

export function createReleaseWorker(
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

export async function runReleaseWorker(root: string): Promise<void> {
  // Only the entry owns console routing. Helper modules never change global console.
  console.log = console.info = console.debug = (...args: unknown[]) =>
    console.error(...args);
  const session = await createReleaseWorker({
    root,
    streams: { stdin: Deno.stdin, stdout: Deno.stdout, stderr: Deno.stderr },
    accept: (request) => Promise.resolve({ op: request.op, accepted: true }),
  });
  await session.run();
}
