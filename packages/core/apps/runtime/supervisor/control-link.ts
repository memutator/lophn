// core ↔ supervisor 제어. platform 신뢰 child 감독 pipe의 길이 prefix frame 위다.
// 부모가 platform hello(machine credential·core API port)를 한 번 주면 supervisor는
// `ready`로 답하고, 그 뒤 worker_request의 apps op를 처리한다. core 연결 EOF·protocol
// 위반이면 새 호출을 닫고 자식을 끝낸다. 요청 처리는 읽기 loop를 막지 않는다: 시작 중인 앱이
// core의 관측 질의를 기다리는 동안에도 다음 frame을 읽어야 한다.
import {
  appCredentialResponseSchema,
  encodeFrame,
  FrameDecoder,
  helloSchema,
  stopSchema,
  workerRequestEnvelopeSchema,
} from "../../../../protocol/supervision/mod.ts";
import type { ErrorCode } from "../../../../base/mod.ts";
import type { z } from "zod";
import type { Supervisor } from "./supervisor.ts";

type AppCredentialResponse = z.infer<typeof appCredentialResponseSchema>;

export type ControlReader = {
  read(buffer: Uint8Array): Promise<number | null>;
};

// op 처리기가 던지는 오류. code가 worker_response의 error.code가 된다.
export class OpError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export type OpHandlers = Record<string, (payload: unknown) => Promise<unknown>>;

export type ControlHello = {
  credential: string;
  apiPort: number;
  coreEpoch: string;
  // 앱 서명 검증 공개 key(raw 32byte의 base64url). hello의 scope.targets로 온다. 감독이
  // supervisor를 다시 띄워도 hello가 다시 오므로 key를 다시 알릴 별도 통로가 없다.
  verifyKey: string | undefined;
};

export type ControlLinkOptions = {
  // core로 frame 하나를 보낸다. 쓰기는 호출 순서대로 이어져야 한다.
  send: (message: unknown) => Promise<void> | void;
  ops: OpHandlers;
  // hello를 받은 직후, `ready`를 보내기 전에 부른다.
  onHello?: (hello: ControlHello) => void;
  // core가 supervisor의 app_credential_request에 준 답.
  onCredential?: (response: AppCredentialResponse) => void;
};

export type ControlLink = {
  credential: () => string | undefined;
  apiPort: () => number | undefined;
  closed: Promise<void>;
};

// stdin을 읽어 supervisor에 반영한다. EOF·위반이면 supervisor.coreClosed()를 부른다.
export function attachControlLink(
  supervisor: Supervisor,
  input: ControlReader,
  options: ControlLinkOptions,
): ControlLink {
  let credential: string | undefined;
  let apiPort: number | undefined;
  let stopped = false;
  const frames = new FrameDecoder();
  const inflight = new Set<Promise<void>>();

  function track(work: Promise<void>): void {
    inflight.add(work);
    void work.finally(() => inflight.delete(work));
  }

  async function answer(request: {
    request_id: string;
    op: string;
    payload: unknown;
  }): Promise<void> {
    const handler = credential === undefined
      ? undefined
      : options.ops[request.op];
    if (!handler) {
      await options.send({
        type: "worker_response",
        request_id: request.request_id,
        ok: false,
        error: {
          code: credential === undefined ? "unavailable" : "not_found",
          message: "unknown op",
        },
      });
      return;
    }
    try {
      const payload = await handler(request.payload);
      await options.send({
        type: "worker_response",
        request_id: request.request_id,
        ok: true,
        payload,
      });
    } catch (error) {
      const code = error instanceof OpError ? error.code : "internal";
      await options.send({
        type: "worker_response",
        request_id: request.request_id,
        ok: false,
        error: {
          code,
          message: error instanceof OpError ? error.message : "op failed",
        },
      });
    }
  }

  const closed = (async () => {
    const buffer = new Uint8Array(64 * 1024);
    try {
      while (!stopped) {
        const count = await input.read(buffer);
        if (count === null) break;
        for (const frame of frames.push(buffer.subarray(0, count))) {
          if (frame.kind !== "json") continue;
          const hello = helloSchema.safeParse(frame.payload);
          if (hello.success) {
            // credential은 한 번만 온다. 두 번째 hello는 protocol 위반이다.
            if (credential !== undefined) throw new Error("second hello");
            credential = hello.data.credential;
            apiPort = hello.data.api_port;
            const key = hello.data.scope.targets.verify_key;
            options.onHello?.({
              credential,
              apiPort,
              coreEpoch: hello.data.core_epoch,
              verifyKey: typeof key === "string" ? key : undefined,
            });
            await options.send({ type: "ready" });
            continue;
          }
          const issued = appCredentialResponseSchema.safeParse(frame.payload);
          if (issued.success) {
            // hello 전의 답은 요청한 적이 없는 것이다.
            if (credential === undefined) throw new Error("early credential");
            options.onCredential?.(issued.data);
            continue;
          }
          if (stopSchema.safeParse(frame.payload).success) {
            stopped = true;
            await supervisor.stop();
            await options.send({ type: "stopped" });
            break;
          }
          const request = workerRequestEnvelopeSchema.safeParse(frame.payload);
          if (!request.success) throw new Error("unknown control message");
          track(answer(request.data));
        }
      }
    } catch {
      // frame 오류·protocol 위반도 core가 끊긴 것과 같이 자식을 끝낸다.
    }
    if (!stopped) await supervisor.coreClosed();
    await Promise.allSettled([...inflight]);
  })();
  return {
    credential: () => credential,
    apiPort: () => apiPort,
    closed,
  };
}

export function encodeControl(message: unknown): Uint8Array {
  return encodeFrame({ kind: "json", channel: 0, payload: message });
}
