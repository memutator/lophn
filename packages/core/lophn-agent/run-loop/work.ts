import { err, ok, type Result } from "../../../base/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import {
  blocksText,
  textBlocks,
} from "../../../protocol/lophn-agent/content-block.ts";
import type { InputTransport, RoutedInput } from "../../router/ports.ts";
import type { Inbox } from "./inbox.ts";
import type { SteeringInput, TurnSource } from "./ports.ts";
import type { AgentEvent } from "../../../protocol/events/mod.ts";
import {
  afterCommit,
  type CommitAction,
} from "../../storage/ledger/after-commit.ts";
import {
  AGENT_EVENT_TOPIC,
  INBOX_CLEAR_TOPIC,
  INBOX_PUT_TOPIC,
} from "./topics.ts";

// 입력함에서 시작할 turn을 고른다. 입력 하나가 turn 하나이고, session이 idle이면 맨 앞 입력으로
// 시작한다. 읽기 route로 DB를 훑지 않는다: 입력함이 메모리 정본이다.

export type TurnStart = { session: Id<"ses">; input: RoutedInput };

type TurnStarter = {
  // 지금 시작할 turn 하나. 없으면 null이다. 입력은 꺼내지 않는다.
  next(): TurnStart | null;
  // turn이 시작됐다(StartTurn 확정 뒤). 입력을 꺼내고 session을 도는 중으로 둔다.
  began(session: Id<"ses">): RoutedInput | undefined;
  // turn이 끝났다. 반영하지 못한 steer는 다음 turn 입력이 된다.
  ended(session: Id<"ses">): void;
};

// 사람 메시지가 맨 앞인 session이 먼저이고 그 안에서는 먼저 들어온 session이 먼저다(`Inbox.waiting`).
export function createTurnStarter(deps: { inbox: Inbox }): TurnStarter {
  const { inbox } = deps;
  return {
    next() {
      for (const session of inbox.waiting()) {
        if (inbox.isRunning(session)) continue;
        const input = inbox.next(session);
        if (input !== undefined) return { session, input };
      }
      return null;
    },
    began(session) {
      const input = inbox.take(session);
      if (input !== undefined) inbox.setRunning(session, true);
      return input;
    },
    ended(session) {
      inbox.setRunning(session, false);
    },
  };
}

// 입력함과 turn starter를 `TurnSource` 한 입구로 묶는다. runtime child가 감독 pipe로 부르는 core 쪽 구현이다.
export function createTurnSource(deps: {
  inbox: Inbox;
  starter: TurnStarter;
}): TurnSource {
  const { inbox, starter } = deps;
  return {
    next: () => Promise.resolve(ok(starter.next())),
    began: (session) => Promise.resolve(ok(starter.began(session) ?? null)),
    ended(session) {
      starter.ended(session);
      return Promise.resolve(ok(undefined));
    },
    steering: (session) =>
      Promise.resolve(
        ok(
          inbox.pendingSteering(session).map(
            (input): SteeringInput => ({
              id: input.message as string,
              input,
            }),
          ),
        ),
      ),
    settled(session, count) {
      inbox.settleSteering(session, count);
      return Promise.resolve(ok(undefined));
    },
  };
}

// lophn session 쪽 `InputTransport`다. writer Worker 안에서 돌아 입력함(main thread 메모리)에 바로 닿지 못한다.
// 그래서 입력은 "commit 뒤 할 일"로 모아 두고 main thread의 `createInboxApplier`가 commit 뒤에 입력함에 넣는다.
// harness session은 coding-agent 단위의 구현이 맡고 둘을 묶는 것은 wiring이다.
export function createLophnInputTransport(deps: {
  // `message`가 null인 입력(call·reply·reaction·notice·step)을 받는 session 기록에 쓴다. 배달하는 tx에서
  // 부르고 wiring이 places-sessions 쪽 쓰기 helper를 끼운다.
  record(tx: Tx, session: Id<"ses">, input: RoutedInput): Result<Id<"msg">>;
}): InputTransport {
  function put(tx: Tx, session: Id<"ses">, input: RoutedInput): Result<void> {
    let message = input.message;
    if (message === null) {
      const written = deps.record(tx, session, input);
      if (!written.ok) return written;
      message = written.value;
    }
    tx.port(afterCommit).push(INBOX_PUT_TOPIC, {
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

type InboxPut = { session: Id<"ses">; input: RoutedInput; at: string };

// main thread 쪽이다. commit된 tx가 모은 일을 입력함과 Bus에 적용한다.
export function createInboxApplier(deps: {
  inbox: Inbox;
  publish(event: AgentEvent): void;
}): (actions: readonly CommitAction[]) => void {
  const { inbox } = deps;
  return (actions) => {
    for (const action of actions) {
      if (action.topic === INBOX_PUT_TOPIC) {
        const { session, input, at } = action.data as InboxPut;
        // steer인지는 넣기 전에 정한다. 도는 turn이 없으면 다음 turn 입력이다.
        const steer = input.delivery === "steer" && inbox.isRunning(session);
        inbox.put(session, input);
        deps.publish({
          session,
          type: "MessageReceived",
          at,
          payload: {
            message: input.message,
            body: blocksText(input.body),
            from: input.from,
            call: input.call,
            reply_to: input.reply_to,
            steer,
          },
        } as AgentEvent);
      } else if (action.topic === INBOX_CLEAR_TOPIC) {
        inbox.clear((action.data as { session: Id<"ses"> }).session);
      } else if (action.topic === AGENT_EVENT_TOPIC) {
        deps.publish(action.data as AgentEvent);
      }
    }
  };
}
