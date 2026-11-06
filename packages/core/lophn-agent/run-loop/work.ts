import { err, ok, type Result } from "../../../base/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import { textBlocks } from "../../../protocol/lophn-agent/content-block.ts";
import type { InputTransport, RoutedInput } from "../../router/ports.ts";
import type { Queue } from "./queue.ts";
import type { SteeringInput, TurnSource } from "./ports.ts";
import type { AgentEvent } from "../../../protocol/events/mod.ts";
import {
  afterCommit,
  type CommitAction,
} from "../../storage/ledger/after-commit.ts";
import {
  AGENT_EVENT_TOPIC,
  QUEUE_CLEAR_TOPIC,
  QUEUE_PUT_TOPIC,
} from "./topics.ts";

// queue에서 시작할 turn을 고른다. 입력 하나가 turn 하나이고, session이 idle이면 맨 앞 입력으로
// 시작한다. 읽기 route로 DB를 훑지 않는다: queue가 메모리 정본이다.

export type TurnStart = { session: Id<"ses">; input: RoutedInput };

type TurnStarter = {
  // 지금 시작할 turn 하나. 없으면 null이다. 입력은 꺼내지 않는다.
  next(): TurnStart | null;
  // turn이 시작됐다(StartTurn 확정 뒤). StartTurn이 기록한 입력을 꺼내고 session을 도는 중으로 둔다. 그 입력이
  // 없으면 아무것도 하지 않는다.
  began(session: Id<"ses">, message: Id<"msg">): RoutedInput | undefined;
  // 입력은 그대로 두고 session을 도는 중으로 잡는다. 이미 도는 중이면 false다.
  hold(session: Id<"ses">): boolean;
  // turn이 끝났다. 반영하지 못한 steer는 다음 turn 입력이 된다.
  ended(session: Id<"ses">): void;
};

// 사람 메시지가 맨 앞인 session이 먼저이고 그 안에서는 먼저 들어온 session이 먼저다(`Queue.waiting`).
export function createTurnStarter(deps: { queue: Queue }): TurnStarter {
  const { queue } = deps;
  return {
    next() {
      for (const session of queue.waiting()) {
        if (queue.isRunning(session)) continue;
        const input = queue.next(session);
        if (input !== undefined) return { session, input };
      }
      return null;
    },
    began(session, message) {
      const input = queue.take(session, message);
      if (input !== undefined) queue.setRunning(session, true);
      return input;
    },
    hold(session) {
      if (queue.isRunning(session)) return false;
      queue.setRunning(session, true);
      return true;
    },
    ended(session) {
      queue.setRunning(session, false);
    },
  };
}

// queue와 turn starter를 `TurnSource` 한 입구로 묶는다. runtime child가 감독 pipe로 부르는 core 쪽 구현이다.
export function createTurnSource(deps: {
  queue: Queue;
  starter: TurnStarter;
}): TurnSource {
  const { queue, starter } = deps;
  return {
    next: () => Promise.resolve(ok(starter.next())),
    began: (session, message) =>
      Promise.resolve(ok(starter.began(session, message) ?? null)),
    hold: (session) => Promise.resolve(ok(starter.hold(session))),
    ended(session) {
      starter.ended(session);
      return Promise.resolve(ok(undefined));
    },
    steering: (session) =>
      Promise.resolve(
        ok(
          queue.pendingSteering(session).map(
            (input): SteeringInput => ({
              id: input.message as string,
              input,
            }),
          ),
        ),
      ),
    settled(session, count) {
      queue.settleSteering(session, count);
      return Promise.resolve(ok(undefined));
    },
  };
}

// lophn session 쪽 `InputTransport`다. writer Worker 안에서 돌아 queue(main thread 메모리)에 바로 닿지 못한다.
// 그래서 입력은 "commit 뒤 할 일"로 모아 두고 main thread의 `createQueueApplier`가 commit 뒤에 queue에 넣는다.
// harness session의 transport는 session/harness.ts에 따로 있고 둘을 묶는 것은 router의 transportBySession이다.
export function createLophnInputTransport(deps: {
  // `message`가 null인 입력(call·reply·reaction·notice·step)을 받는 session 기록에 쓴다. 배달하는 tx에서
  // 부르고 wiring이 workspaces-sessions 쪽 쓰기 helper를 끼운다.
  record(tx: Tx, session: Id<"ses">, input: RoutedInput): Result<Id<"msg">>;
}): InputTransport {
  function put(tx: Tx, session: Id<"ses">, input: RoutedInput): Result<void> {
    let message = input.message;
    if (message === null) {
      const written = deps.record(tx, session, input);
      if (!written.ok) return written;
      message = written.value;
    }
    tx.port(afterCommit).push(QUEUE_PUT_TOPIC, {
      session,
      input: { ...input, message },
      at: tx.now(),
    });
    return ok(undefined);
  }

  return {
    deliver(tx, target, input) {
      if (target.transport !== "lophn") {
        return err({
          code: "invalid_input",
          message: "not a lophn session",
        });
      }
      return put(tx, target.session, input);
    },
    cancel(tx, target, call, unattended) {
      if (target === null || target.transport !== "lophn") {
        return ok(undefined);
      }
      return put(tx, target.session, {
        kind: "notice",
        from: { kind: "program" },
        call,
        reply_to: call,
        body: textBlocks(""),
        refs: [],
        delivery: "next_turn",
        message: null,
        reply: null,
        outcome: null,
        event: null,
        notice: "call_cancelled",
        step: null,
        unattended,
      });
    },
  };
}

type QueuePut = { session: Id<"ses">; input: RoutedInput; at: string };

// main thread 쪽이다. commit된 tx가 모은 일을 queue와 Bus에 적용한다.
export function createQueueApplier(deps: {
  queue: Queue;
  publish(event: AgentEvent): void;
}): (actions: readonly CommitAction[]) => void {
  const { queue } = deps;
  return (actions) => {
    for (const action of actions) {
      if (action.topic === QUEUE_PUT_TOPIC) {
        const { session, input, at } = action.data as QueuePut;
        // steer인지는 넣기 전에 정한다. 도는 turn이 없으면 다음 turn 입력이다.
        const steer = input.delivery === "steer" && queue.isRunning(session);
        queue.put(session, input);
        deps.publish({
          session,
          type: "MessageReceived",
          at,
          payload: {
            message: input.message,
            body: input.body,
            from: input.from,
            call: input.call,
            reply_to: input.reply_to,
            steer,
          },
        } as AgentEvent);
      } else if (action.topic === QUEUE_CLEAR_TOPIC) {
        queue.clear((action.data as { session: Id<"ses"> }).session);
      } else if (action.topic === AGENT_EVENT_TOPIC) {
        deps.publish(action.data as AgentEvent);
      }
    }
  };
}
