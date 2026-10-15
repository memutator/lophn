import { err, ok, type Result } from "../../../base/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { InputTransport, RoutedInput } from "../../router/ports.ts";
import type { Inbox } from "./inbox.ts";
import type { SteeringInput, TurnSource } from "./ports.ts";
import type { AgentEvent } from "../../../protocol/events/mod.ts";

// 입력함에서 시작할 turn을 고른다. 입력 하나가 turn 하나이고, session이 idle이면 맨 앞 입력으로
// 시작한다. 읽기 route로 DB를 훑지 않는다: 입력함이 메모리 정본이다.

export type TurnStart = { session: Id<"ses">; input: RoutedInput };

export type TurnStarter = {
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
export function createTurnSource(
  deps: { inbox: Inbox; starter: TurnStarter },
): TurnSource {
  const { inbox, starter } = deps;
  return {
    next: () => Promise.resolve(ok(starter.next())),
    began: (session) => Promise.resolve(ok(starter.began(session) ?? null)),
    ended(session) {
      starter.ended(session);
      return Promise.resolve(ok(undefined));
    },
    steering: (session) =>
      Promise.resolve(ok(
        inbox.pendingSteering(session).map((input): SteeringInput => ({
          id: input.message as string,
          input,
        })),
      )),
    settled(session, count) {
      inbox.settleSteering(session, count);
      return Promise.resolve(ok(undefined));
    },
  };
}

// lophn session 쪽 `InputTransport`다. harness session은 coding-agent 단위의 구현이 맡고 둘을 묶는 것은
// wiring이다. `startTurn`은 turn을 시작해 보라는 신호일 뿐이고 시작은 turn starter가 한다.
export function createLophnInputTransport(deps: {
  inbox: Inbox;
  startTurn(session: Id<"ses">): void;
  // `message`가 null인 입력(call·reply·reaction·notice)을 받는 session 기록에 쓴다. 배달하는 tx에서
  // 부르고 wiring이 places-sessions 쪽 쓰기 helper를 끼운다.
  record(
    tx: Tx,
    session: Id<"ses">,
    input: RoutedInput,
  ): Result<Id<"msg">>;
  // 받은 입력을 `MessageReceived`로 Bus에 낸다. steer면 도는 turn 안의 메시지다. 없으면 버린다.
  publish?: (event: AgentEvent) => void;
}): InputTransport {
  const { inbox } = deps;

  function put(tx: Tx, session: Id<"ses">, input: RoutedInput): Result<void> {
    let message = input.message;
    if (message === null) {
      const written = deps.record(tx, session, input);
      if (!written.ok) return written;
      message = written.value;
    }
    inbox.put(session, { ...input, message });
    deps.publish?.({
      session,
      type: "MessageReceived",
      at: tx.now(),
      payload: {
        message,
        body: input.body,
        from: input.from,
        call: input.call,
        reply_to: input.reply_to,
        steer: input.delivery === "steer" && inbox.isRunning(session),
      },
    } as AgentEvent);
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
      const idle = !inbox.isRunning(target.session);
      const stored = put(tx, target.session, input);
      if (!stored.ok) return stored;
      if (!idle) return ok("queued" as const);
      deps.startTurn(target.session);
      return ok("delivered" as const);
    },
    cancel(tx, target, call) {
      if (target === null || target.transport !== "lophn") {
        return ok(undefined);
      }
      // 취소 알림은 어느 event에서 온 것이 아니라 근거 seq가 없다.
      const stored = put(tx, target.session, {
        kind: "notice",
        from: { kind: "program", event_seq: "0" },
        call,
        reply_to: call,
        body: "",
        refs: [],
        delivery: "next_turn",
        message: null,
        reply: null,
        outcome: null,
        event: null,
        notice: "call_cancelled",
      });
      if (!stored.ok) return stored;
      if (!inbox.isRunning(target.session)) deps.startTurn(target.session);
      return ok(undefined);
    },
    queued() {
      return [];
    },
  };
}
