// core events port. type만 있고 구현은 없다.
import type { BusEvent, EventCondition } from "../../protocol/events/mod.ts";

export interface BusSink {
  send(event: BusEvent): void;
  close(reason: "slow_consumer" | "credential_revoked" | "shutdown"): void;
}

// 쓰는 곳: run-loop(agent event), harness adapter(agent event), apps·kinds wiring(남지 않는
// event), Gateway(구독). agent runtime child의 agent event는 감독 pipe로 core에 오고 core가 publish한다.
export interface Bus {
  // 메모리, 동기. 느린 구독자 때문에 막히지 않고 놓칠 수 있다.
  publish(event: BusEvent): void;
  // 해제 함수를 돌려준다. 같은 event는 sink에 한 번만 간다.
  subscribe(
    conditions: readonly EventCondition[],
    sink: BusSink,
  ): () => void;
}
