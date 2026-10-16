// Gateway는 renderer가 건 조건으로 Bus를 걸러 보내는 WebSocket 한 연결의 session이다.
// 재생도 ack도 없다. 놓치거나 끊기면 붙은 쪽이 snapshot부터 다시 읽는다.
import { err, ok, type Result } from "../../base/mod.ts";
import {
  GATEWAY_CLOSE_SLOW_CONSUMER,
  type GatewayServerFrame,
  parseGatewayClientFrame,
} from "../../protocol/events/mod.ts";
import type { Bus } from "./ports.ts";

// 한도는 옛 구독의 BUFFER_BYTES와 같다.
export const GATEWAY_BUFFER_LIMIT = 1024 * 1024;
const CLOSE_POLICY_VIOLATION = 1008;

// 실제 WebSocket과 test fake가 둘 다 맞춘다.
interface GatewaySocket {
  send(text: string): void;
  close(code: number): void;
  bufferedAmount(): number;
}

type GatewaySession = {
  // client가 보낸 text frame을 처리한다.
  receive(text: string): void;
  // 연결이 끊겼다. 구독을 푼다.
  closed(): void;
  // Bus 밖 frame을 이 연결로 보낸다.
  send(frame: GatewayServerFrame): void;
  // 서버가 내려갈 때 `closed(shutdown)`을 보내고 닫는다.
  shutdown(): void;
};

export function createGatewaySession(
  socket: GatewaySocket,
  bus: Bus,
): GatewaySession {
  let unsubscribe: (() => void) | undefined;
  let done = false;

  function release() {
    unsubscribe?.();
    unsubscribe = undefined;
  }

  function write(frame: GatewayServerFrame) {
    try {
      socket.send(JSON.stringify(frame));
    } catch { /* 연결이 이미 닫혔다 */ }
  }

  function terminate(code: number, reason?: "slow_consumer" | "shutdown") {
    if (done) return;
    done = true;
    release();
    if (reason) write({ type: "closed", reason });
    try {
      socket.close(code);
    } catch { /* 연결이 이미 닫혔다 */ }
  }

  return {
    receive(text) {
      if (done) return;
      const frame = parseGatewayClientFrame(text);
      if (!frame.ok) return terminate(CLOSE_POLICY_VIOLATION);
      // 조건 검사(eventConditionSchema)는 parse가 한다. 틀리면 closed 없이 끊는다.
      release();
      unsubscribe = bus.subscribe(frame.value.conditions, {
        send(event) {
          if (done) return;
          write({ type: "event", event });
          if (socket.bufferedAmount() > GATEWAY_BUFFER_LIMIT) {
            terminate(GATEWAY_CLOSE_SLOW_CONSUMER, "slow_consumer");
          }
        },
        close(reason) {
          if (reason === "slow_consumer") {
            return terminate(GATEWAY_CLOSE_SLOW_CONSUMER, reason);
          }
          if (reason === "shutdown") return terminate(1001, reason);
          if (done) return;
          done = true;
          release();
          write({ type: "closed", reason });
          try {
            socket.close(CLOSE_POLICY_VIOLATION);
          } catch { /* 연결이 이미 닫혔다 */ }
        },
      });
      write({ type: "ready" });
    },
    closed() {
      done = true;
      release();
    },
    send(frame) {
      if (!done) write(frame);
    },
    shutdown() {
      terminate(1001, "shutdown");
    },
  };
}

// 연결된 Gateway client 하나에 Bus 밖 frame을 보낸다. 사람 token으로 접속한 client는 하나다.
export type GatewayFrames = {
  add(session: GatewaySession): () => void;
  // 연결이 없으면 `unavailable`이다.
  send(frame: GatewayServerFrame): Result<void>;
  shutdown(): void;
};

export function createGatewayFrames(): GatewayFrames {
  const sessions = new Set<GatewaySession>();
  return {
    add(session) {
      sessions.add(session);
      return () => {
        sessions.delete(session);
      };
    },
    send(frame) {
      if (sessions.size === 0) {
        return err({
          code: "unavailable",
          message: "gateway client not connected",
        });
      }
      for (const session of sessions) session.send(frame);
      return ok(undefined);
    },
    shutdown() {
      for (const session of [...sessions]) session.shutdown();
    },
  };
}
