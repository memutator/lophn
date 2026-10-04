// 준비 worker entry. coordinator가 넘긴 stdio로 preparation child를 연다.
// kind와 root는 환경으로만 받는다. 권한은 root·working copy·staging의 read와
// 필요한 write만이다(architecture/documents 2.2).
import {
  type WorkerRequest,
} from "../../../packages/contracts/platform/mod.ts";
import {
  type ChildSession,
  type ChildStreams,
  startChild,
} from "../../../packages/platform/responsiveness/mod.ts";

export type PreparationOptions = {
  root: string;
  streams: ChildStreams;
  // op별 실행. op 이름은 준비 worker 경계에서 contracts schema로 다시 검사한다.
  // T2 뼈대는 배분을 받아 echo한다. 실제 scan·hash·diff는 T11이 채운다.
  accept(request: WorkerRequest): Promise<unknown>;
};

export function createPreparation(
  options: PreparationOptions,
): ChildSession {
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
        // 준비 worker 내부 실패는 unavailable이다. 본문·경로를 응답에 넣지 않는다.
        await session.send({
          type: "worker_response",
          request_id: message.request_id,
          ok: false,
          error: { code: "unavailable", message: "preparation failed" },
        });
      }
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
    accept: (request) => Promise.resolve({ op: request.op, accepted: true }),
  });
  await session.run();
}
