import { err, ok, type Result } from "../../../base/mod.ts";
import type { AgentEvent } from "../../../protocol/events/mod.ts";
import type {
  ChildMessage,
  ParentMessage,
  TurnSourceRequest,
} from "../../../protocol/supervision/mod.ts";
import type {
  AgentEventSink,
  SteeringInput,
  TurnSource,
} from "../../lophn-agent/run-loop/ports.ts";
import type { TurnStart } from "../../lophn-agent/run-loop/work.ts";
import type { RoutedInput } from "../../router/ports.ts";

// 입력함과 Bus는 core 메모리에 있다. runtime은 감독 pipe로 입력함을 읽고(`turn_source_request`) agent event를
// core Bus로 보낸다(`agent_event`). core 쪽 handler는 `run-loop/turn-pipe.ts`다. 응답이 없으면 읽지 못한 것이고
// 새 turn을 고르지 않는다. event는 놓칠 수 있다(Bus는 메모리다).

type TurnSourceLink = {
  source: TurnSource;
  events: AgentEventSink;
  // 감독 pipe에서 받은 parent message. 이 link의 응답이면 true다.
  onParent(message: ParentMessage): boolean;
};

type Answer = Extract<ParentMessage, { type: "turn_source_response" }>;

export function createTurnSourceLink(options: {
  send(message: ChildMessage): Promise<void>;
  // 응답을 기다리는 기한. 지나면 읽지 못한 것이다.
  timeoutMs?: number;
}): TurnSourceLink {
  const pending = new Map<string, {
    resolve(answer: Answer | null): void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  const timeoutMs = options.timeoutMs ?? 10_000;
  let sequence = 0;

  async function request(
    op: TurnSourceRequest["op"],
    fields: { session?: string; count?: number } = {},
  ): Promise<Result<unknown>> {
    const id = `turn-source-${++sequence}`;
    const answered = new Promise<Answer | null>((resolve) => {
      const timer = setTimeout(() => {
        if (pending.delete(id)) resolve(null);
      }, timeoutMs);
      pending.set(id, { resolve, timer });
    });
    try {
      await options.send({
        type: "turn_source_request",
        request_id: id,
        op,
        ...fields,
      } as ChildMessage);
    } catch {
      clearTimeout(pending.get(id)?.timer);
      pending.delete(id);
      return err({
        code: "unavailable",
        message: "supervision pipe is closed",
      });
    }
    const answer = await answered;
    if (answer === null) {
      return err({ code: "unavailable", message: "the inbox did not answer" });
    }
    return answer.ok ? ok(answer.value) : err(answer.error);
  }

  const done = async (call: Promise<Result<unknown>>) => {
    const result = await call;
    return result.ok ? ok(undefined) : result;
  };

  return {
    source: {
      async next() {
        const result = await request("next");
        return result.ok ? ok(result.value as TurnStart | null) : result;
      },
      async began(session) {
        const result = await request("began", { session });
        return result.ok ? ok(result.value as RoutedInput | null) : result;
      },
      ended: (session) => done(request("ended", { session })),
      async steering(session) {
        const result = await request("steering", { session });
        return result.ok
          ? ok(result.value as readonly SteeringInput[])
          : result;
      },
      settled: (session, count) => done(request("settled", { session, count })),
    },
    events: {
      publish(event: AgentEvent) {
        void options.send({
          type: "agent_event",
          event: event as Record<string, unknown>,
        }).catch(() => {});
      },
    },
    onParent(message) {
      if (message.type !== "turn_source_response") return false;
      const waiting = pending.get(message.request_id);
      if (waiting === undefined) return true;
      pending.delete(message.request_id);
      clearTimeout(waiting.timer);
      waiting.resolve(message);
      return true;
    },
  };
}
