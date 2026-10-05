// report collector worker. core 감독이 띄우고 이 모듈이 보고 접수 통로를
// 조립한다(problems/reporting#R1, R2, R8, R16; plan problems T3). credential에서
// 출처를 정하고 본문 주장은 따르지 않는다. redaction은 apps layer에서 하는 몫이다.
import { err, ok, type Result } from "../../../packages/base/mod.ts";
import type {
  WorkerRequest,
} from "../../../packages/contracts/platform/mod.ts";
import { reportProblemInputSchema } from "../../../packages/contracts/problems/mod.ts";
import type {
  RecordReportInput,
} from "../../../packages/contracts/problems/mod.ts";
import {
  type ChildSession,
  type ChildStreams,
  startChild,
} from "../../../packages/platform/responsiveness/mod.ts";
import {
  createKnownSecretRegistry,
  createRedactionEngine,
} from "../../../packages/platform/redaction/mod.ts";
import {
  COLLECTOR_CAPS,
  createCollectorQueue,
} from "../../../packages/problems/reporting/mod.ts";

export const COLLECTOR_KIND = "problems/report-collector";

export type CollectorWorkerOptions = {
  streams: ChildStreams;
  // op별 접수. 출처 확인·redaction·조립·제출은 이 함수 몫이다.
  accept(request: WorkerRequest): Promise<unknown>;
  cancelled?: () => boolean;
};

// hello의 kind는 이 worker 경계가 다시 본다. 다른 kind면 protocol 위반이다.
// hello message는 startChild가 helloSchema로 검사한 뒤 넘긴다.
export function acceptCollectorHello(kind: string): boolean {
  return kind === COLLECTOR_KIND;
}

// 등록 시점 kind 검사(T8의 runnerReady와 같은 모양).
export function collectorReady(kind: string): Result<true> {
  if (kind !== COLLECTOR_KIND) {
    return err({ code: "invalid_input", message: "unknown worker kind" });
  }
  return ok(true);
}

export function createCollectorWorker(
  options: CollectorWorkerOptions,
): ChildSession {
  const session = startChild(options.streams, {
    onHello(hello) {
      if (hello.kind !== COLLECTOR_KIND) {
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
      const parsed = workerRequest(message);
      if (!parsed.ok) {
        await session.send({
          type: "worker_response",
          request_id: "unknown",
          ok: false,
          error: { code: "invalid_input", message: "invalid request body" },
        });
        return;
      }
      try {
        const payload = await options.accept(parsed.value);
        await session.send({
          type: "worker_response",
          request_id: message.request_id,
          ok: true,
          payload,
        });
      } catch {
        // collector 내부 실패는 unavailable이다. 본문·경로를 응답에 넣지 않는다.
        await session.send({
          type: "worker_response",
          request_id: message.request_id,
          ok: false,
          error: { code: "unavailable", message: "report collector failed" },
        });
      }
    },
  });
  return session;
}

function workerRequest(
  message: unknown,
): Result<WorkerRequest, { code: "invalid_input"; message: string }> {
  if (typeof message !== "object" || message === null) {
    return err({ code: "invalid_input", message: "not an envelope" });
  }
  const record = message as Record<string, unknown>;
  if (
    record["type"] !== "worker_request" ||
    typeof record["request_id"] !== "string"
  ) {
    return err({ code: "invalid_input", message: "not a worker request" });
  }
  return ok(message as WorkerRequest);
}

// 보고 접수. 본문은 contract가 다시 본다(R1).
export function acceptReportPayload(
  payload: unknown,
): Result<
  RecordReportInput["report"],
  { code: "invalid_input"; message: string }
> {
  const parsed = reportProblemInputSchema.safeParse(payload);
  if (!parsed.success) {
    return err({ code: "invalid_input", message: "invalid report body" });
  }
  return ok(parsed.data as unknown as RecordReportInput["report"]);
}

export async function runCollectorWorker(): Promise<void> {
  // Only the entry owns console routing. Helper modules never change global console.
  console.log = console.info = console.debug = (...args: unknown[]) =>
    console.error(...args);
  let stopped = false;
  // redaction engine과 대기 큐는 apps layer가 쥔다. 접수 통로 연결은 T3 뒤 몫이다.
  const known = createKnownSecretRegistry();
  const redaction = createRedactionEngine({ registry: known });
  const queue = createCollectorQueue({
    pending_count: COLLECTOR_CAPS.pending_count,
    pending_bytes: COLLECTOR_CAPS.pending_bytes,
  });
  void redaction;
  void queue;
  const session = await createCollectorWorker({
    streams: { stdin: Deno.stdin, stdout: Deno.stdout, stderr: Deno.stderr },
    cancelled: () => {
      stopped = true;
      return stopped;
    },
    accept: () => Promise.reject(new Error("collector accept is not wired")),
  });
  await session.run();
}
