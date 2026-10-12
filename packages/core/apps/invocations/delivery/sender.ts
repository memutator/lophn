// supervisor 쪽 invocation 후행 전달 조립(apps/invocations#R1, R5, R19). 앱이 broker로 보낸 기록 사실을
// 유한한 메모리 목록에 두고 machine credential로 core의 record_* command에 보낸다. 업무 응답은 이 전달을
// 기다리지 않는다. 한도 초과와 반복하지 않는 실패는 redaction된 손실 진단 frame으로 core에 알린다.
import type { Clock } from "../../../../base/mod.ts";
import {
  type Diagnostic,
  encodeFrame,
} from "../../../../protocol/supervision/mod.ts";
import {
  type CoreRecord,
  createInvocationBroker,
  type InvocationBroker,
} from "../../permissions/broker/invocations.ts";
import {
  createDeliveryQueue,
  type DeliveryLimits,
  type DeliveryMessage,
  type DeliveryOutcome,
  type DeliveryQueue,
  type LossReport,
} from "./queue.ts";
import { deliveryKey } from "../mod.ts";

// core 응답을 전달 결과로 읽는다. 닿지 않거나 5xx면 unavailable이고 그 밖의 거절은 core가 말한 code다.
function outcomeOf(status: number, body: unknown): DeliveryOutcome {
  if (status >= 200 && status < 300) return { ok: true };
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  if (typeof code === "string" && status < 500) return { ok: false, code };
  if (status === 401) return { ok: false, code: "unauthorized" };
  if (status === 403) return { ok: false, code: "forbidden" };
  if (status === 409) return { ok: false, code: "conflict" };
  if (status >= 400 && status < 500) {
    return { ok: false, code: "invalid_input" };
  }
  return { ok: false, code: "unavailable" };
}

export function createCoreSender(deps: {
  // core API 위치는 감독 hello가 와야 알 수 있어 호출 때 읽는다.
  baseUrl: string | (() => string);
  token: () => string;
  fetch?: typeof fetch;
}): (message: DeliveryMessage) => Promise<DeliveryOutcome> {
  const request = deps.fetch ?? fetch;
  return async (message) => {
    const record = message.body as CoreRecord;
    let response: Response;
    try {
      response = await request(
        `${
          typeof deps.baseUrl === "string" ? deps.baseUrl : deps.baseUrl()
        }/v1/invocations/${record.method}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${deps.token()}`,
          },
          // (inv ID, 사실)이 같은 재전송은 core의 공통 idempotency가 같은 결과로 묶는다.
          body: JSON.stringify({
            input: record.input,
            idempotency_key: deliveryKey(message.invocation, message.fact),
            compare: {},
            prepared: [],
          }),
        },
      );
    } catch {
      return { ok: false, code: "unavailable" };
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return outcomeOf(response.status, body);
  };
}

// 손실 진단은 숫자와 ID만 담는다. 잃은 메시지의 내용·오류 원문은 싣지 않는다.
export function lossDiagnostic(
  report: LossReport,
  observedAt: string,
): Diagnostic {
  return {
    type: "diagnostic",
    kind: "app_invocation_delivery_loss",
    payload: {
      component: "apps/supervisor",
      observed_at: observedAt,
      app: report.app,
      lost_messages: report.lost_messages,
      lost_bytes: report.lost_bytes,
      first_lost_at: report.first_lost_at,
      reason: report.reason,
    },
  };
}

export type SupervisorDelivery = {
  queue: DeliveryQueue;
  // broker의 `/invocations/submit` 구현이 쓴다.
  broker: InvocationBroker;
  // supervisor가 자식 종료를 관측했을 때 부른다.
  childExited(processNonce: string): void;
};

export function createSupervisorDelivery(deps: {
  clock: Clock;
  send: (message: DeliveryMessage) => Promise<DeliveryOutcome>;
  // core로 가는 감독 pipe(stdout)에 frame을 쓴다.
  write: (frame: Uint8Array) => void;
  limits?: DeliveryLimits;
  // 시험이 timer를 대신한다. 운영은 setTimeout이다.
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}): SupervisorDelivery {
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ??
    ((handle) => clearTimeout(handle as number));
  let timer: { handle: unknown; atMs: number } | undefined;
  const queue: DeliveryQueue = createDeliveryQueue({
    send: deps.send,
    clock: deps.clock,
    limits: deps.limits,
    report(report) {
      try {
        deps.write(
          encodeFrame({
            kind: "json",
            channel: 0,
            payload: lossDiagnostic(report, deps.clock.now()),
          }),
        );
      } catch {
        // 진단 통로가 막혀도 앱 응답과 전달은 계속한다.
      }
    },
    // 가장 이른 깨움 하나만 둔다. 깨어나 pump하면 필요한 다음 깨움을 다시 알린다.
    wake(delayMs) {
      const atMs = deps.clock.nowMs() + delayMs;
      if (timer !== undefined && timer.atMs <= atMs) return;
      if (timer !== undefined) clearTimer(timer.handle);
      timer = {
        atMs,
        handle: setTimer(() => {
          timer = undefined;
          void queue.pump();
        }, delayMs),
      };
    },
  });
  const broker = createInvocationBroker({ queue, clock: deps.clock });
  return {
    queue,
    broker,
    childExited(processNonce) {
      broker.childExited(processNonce);
    },
  };
}
