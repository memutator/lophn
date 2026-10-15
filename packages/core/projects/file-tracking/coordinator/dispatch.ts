// core 비동기 dispatch. documents worker로 넘기는 일은 core의 writer·API 처리
// 흐름을 붙잡지 않는다. 요청은 큐에 넣고 바로 돌아오며,
// 결과는 호출자가 준 콜백으로 나중에 도착한다. 동시 제출은 고정 한도까지다.
import type { Frame } from "../../../../protocol/base/mod.ts";
import {
  type RequestPayload,
  sendPreparationRequest,
  SUBMIT_CONCURRENCY,
} from "../mod.ts";

export type DispatchRequest = {
  request_id: string;
  payload: RequestPayload;
  batch: readonly { root: string; path: string; observedAt: string }[];
};

export type DispatchResult =
  | { request_id: string; ok: true }
  | {
    request_id: string;
    ok: false;
    error: { code: "unavailable"; message: string };
  };

export type DispatchWriter = {
  write(frame: Frame): Promise<void>;
};

export type DocumentsDispatch = {
  // 큐에 넣고 바로 돌아온다. 이 반환을 기다리는 동안 writer 흐름을 붙잡지 않는다.
  dispatch(request: DispatchRequest): void;
  // 아직 보내지 못한 요청 수.
  readonly pending: number;
  // 진행 중인 요청을 결과 없이 끝낸다. IPC 종료는 성공이 아니다.
  stop(): void;
};

export type DispatchOptions = {
  writer: DispatchWriter;
  onResult(result: DispatchResult): void;
  // 테스트가 한도를 줄일 때만 쓴다.
  concurrency?: number;
};

export function createDocumentsDispatch(
  options: DispatchOptions,
): DocumentsDispatch {
  const concurrency = options.concurrency ?? SUBMIT_CONCURRENCY;
  const queued: DispatchRequest[] = [];
  let running = 0;
  let stopped = false;

  function pump() {
    while (!stopped && running < concurrency && queued.length > 0) {
      const request = queued.shift();
      if (!request) return;
      running += 1;
      // 보낸 뒤의 결과만 콜백으로 알린다. 이 promise를 아무도 기다리지 않는다.
      void send(request).then((result) => {
        running -= 1;
        if (!stopped) options.onResult(result);
        pump();
      });
    }
  }

  async function send(request: DispatchRequest): Promise<DispatchResult> {
    try {
      await sendPreparationRequest(options.writer, request, request.batch);
      return { request_id: request.request_id, ok: true };
    } catch {
      return {
        request_id: request.request_id,
        ok: false,
        error: { code: "unavailable", message: "documents dispatch failed" },
      };
    }
  }

  return {
    dispatch(request) {
      if (stopped) return;
      queued.push(request);
      pump();
    },
    get pending() {
      return queued.length + running;
    },
    stop() {
      stopped = true;
      for (const request of queued.splice(0)) {
        options.onResult({
          request_id: request.request_id,
          ok: false,
          error: { code: "unavailable", message: "documents dispatch stopped" },
        });
      }
    },
  };
}
