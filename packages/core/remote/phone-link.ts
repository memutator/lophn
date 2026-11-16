// core가 폰에 묻는 길. 기기의 열린 연결에 `request`를 보내고 같은 연결에서 온 같은 `id`의 `response`, deadline, 연결 닫힘 가운데
// 먼저 온 것으로 끝낸다. link는 kind를 모른다: 입력·출력 검사는 부르는 쪽이 한다. 연결은 host가 붙이고 떼며 알린다.
import { err, ok, type RandomSource, type Result } from "../../base/mod.ts";
import type {
  PhoneRequestFrame,
  PhoneResponseFrame,
  PhoneUnavailableReason,
} from "../../protocol/phone/mod.ts";
import type { RemoteTimers } from "./host.ts";

// 기기로 붙은 연결 하나. host가 만들고 같은 값으로 `received`·`closed`를 부른다.
export type PhoneConnection = {
  device: string;
  // 폰이 `hello.capabilities`에 적은 kind.
  capabilities: readonly string[];
  send(frame: PhoneRequestFrame): Result<void>;
};

export type PhoneCall = {
  device: string;
  kind: string;
  input: unknown;
  deadline_ms: number;
};

export type PhoneLink = {
  call(request: PhoneCall): Promise<Result<unknown>>;
  attached(connection: PhoneConnection): void;
  received(connection: PhoneConnection, frame: PhoneResponseFrame): void;
  closed(connection: PhoneConnection): void;
};

const unavailable = (reason: PhoneUnavailableReason, message: string) =>
  err({ code: "unavailable" as const, message, details: { reason } });

export function createPhoneLink(deps: {
  timers: RemoteTimers;
  random: RandomSource;
}): PhoneLink {
  // 붙은 차례. 같은 기기가 여럿이면 마지막 것에 묻는다.
  const connections: PhoneConnection[] = [];
  const pending = new Map<
    string,
    {
      connection: PhoneConnection;
      timer: unknown;
      resolve(result: Result<unknown>): void;
    }
  >();

  function newId(): string {
    const bytes = new Uint8Array(16);
    deps.random.fill(bytes);
    return `prq_${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }

  function settle(id: string, result: Result<unknown>) {
    const waiting = pending.get(id);
    if (!waiting) return;
    pending.delete(id);
    deps.timers.clear(waiting.timer);
    waiting.resolve(result);
  }

  return {
    call({ device, kind, input, deadline_ms }) {
      const connection = connections.findLast((each) => each.device === device);
      if (!connection) {
        return Promise.resolve(
          unavailable("phone_unreachable", "the phone is not connected"),
        );
      }
      if (!connection.capabilities.includes(kind)) {
        return Promise.resolve(
          unavailable("unsupported", `the phone does not answer ${kind}`),
        );
      }
      const id = newId();
      return new Promise((resolve) => {
        const timer = deps.timers.set(
          () =>
            settle(
              id,
              unavailable("timeout", "the phone did not answer in time"),
            ),
          deadline_ms,
        );
        pending.set(id, { connection, timer, resolve });
        const sent = connection.send({
          type: "request",
          id,
          kind,
          input,
          deadline_ms,
        });
        if (!sent.ok) settle(id, sent);
      });
    },
    attached(connection) {
      connections.push(connection);
    },
    received(connection, frame) {
      // 다른 연결(다른 기기)이 같은 id로 답해도 이 요청을 채우지 못한다.
      if (pending.get(frame.id)?.connection !== connection) return;
      settle(
        frame.id,
        frame.ok
          ? ok(frame.value)
          : err({
              code: frame.error.code,
              message: frame.error.message,
              ...(frame.error.details ? { details: frame.error.details } : {}),
            }),
      );
    },
    closed(connection) {
      const at = connections.indexOf(connection);
      if (at !== -1) connections.splice(at, 1);
      for (const [id, waiting] of [...pending]) {
        if (waiting.connection !== connection) continue;
        settle(id, unavailable("phone_unreachable", "the phone disconnected"));
      }
    },
  };
}
