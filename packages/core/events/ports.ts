// core events port. type만 있고 구현은 없다.
import type { Result } from "../../base/mod.ts";
import type {
  BusEvent,
  DomainEvent,
  DomainEventType,
  EventCondition,
} from "../../protocol/events/mod.ts";

export interface BusSink {
  send(event: BusEvent): void;
  close(reason: "slow_consumer" | "credential_revoked" | "shutdown"): void;
}

// 쓰는 곳: run-loop(agent event), harness adapter(agent event), approvals command 층(commit 뒤
// domain event와 남지 않는 event), Gateway(구독). agent runtime child의 agent event는 감독 pipe로
// core에 오고 core가 publish한다.
export interface Bus {
  // 메모리, 동기. 느린 구독자 때문에 막히지 않고 놓칠 수 있다.
  publish(event: BusEvent): void;
  // 해제 함수를 돌려준다. 같은 event는 sink에 한 번만 간다.
  subscribe(
    conditions: readonly EventCondition[],
    sink: BusSink,
  ): () => void;
}

export interface ReactorContext {
  // 같은 (handler 이름, seq, reaction)으로 두 번 일해도 효과가 한 번이게 하는 key.
  idempotencyKey(reaction: string): Promise<string>;
}

// handler 이름은 idempotency key의 일부다.
export interface ReactorHandler<T extends DomainEventType> {
  readonly name: string;
  handle(
    event: Extract<DomainEvent, { type: T }>,
    context: ReactorContext,
  ): Promise<Result<void>>;
}

// 종류마다 handler 여럿을 둘 수 있고 이름으로 구별한다. 시작·정지는 조립이 맡는다.
export interface Reactor {
  on<T extends DomainEventType>(type: T, handler: ReactorHandler<T>): void;
}
