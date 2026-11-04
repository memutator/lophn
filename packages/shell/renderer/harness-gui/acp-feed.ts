// harness-gui 창이 받은 ACP 갱신을 쌓아 접는 곳. 창의 대화 화면은 core 없이 갱신만 보므로 이 feed가 화면의 두 길에 답한다:
// `AcpUpdated` event를 구독하는 event client(`useAcpUpdates`)와 snapshot을 읽는 source(`acp()`).
// snapshot은 받은 갱신을 `EMPTY_ACP_STATE`에서 접은 값이다. 갱신은 main의 handle이 처음부터 보내 주므로 늦게 열린 창도
// 같은 상태가 된다. 순번이 빠지면 `reread`가 서지만 다시 읽을 곳이 없어 받은 대로 그린다(빈틈 없는 `seq`는 adapter의 몫).
import {
  type AcpState,
  type AcpUpdate,
  EMPTY_ACP_STATE,
  reduceAcp,
} from "../../../protocol/acp/mod.ts";
import type { BusEvent } from "../../../protocol/events/mod.ts";
import { newId } from "../prefixed-id.ts";
import type { CoreSource } from "../desktop/connection/connection.ts";
import type {
  EventClient,
  EventMessage,
} from "../desktop/connection/events/client.ts";

export interface AcpFeed {
  /** 이 창의 session id(`ses_…`). adapter는 보지 않고 화면과 입력이 쓴다. */
  readonly session: string;
  readonly client: EventClient;
  state(): AcpState;
  push(update: AcpUpdate): void;
}

// 대기 목록·session 상태 같은 core 쪽 구독은 이 창에 없다. 그 store들이 읽으러 와도 읽을 것이 없다.
const NO_CORE: CoreSource = {
  subscribe: () => () => {},
  call: () =>
    Promise.resolve({
      ok: false,
      error: { code: "unavailable", message: "this window has no core" },
    }),
};

export function createAcpFeed(now: () => number = Date.now): AcpFeed {
  const session = newId("ses", now());
  let state = EMPTY_ACP_STATE;
  const listeners = new Set<(message: EventMessage) => void>();
  return {
    session,
    state: () => state,
    push(update) {
      state = reduceAcp(state, update);
      const event = {
        type: "AcpUpdated",
        subject: null,
        at: new Date(now()).toISOString(),
        payload: { session, update },
      } as BusEvent;
      for (const listener of [...listeners]) listener({ kind: "event", event });
    },
    client: {
      core: NO_CORE,
      subscribe(condition, onMessage) {
        // 붙을 수 있는 것은 ACP 갱신뿐이다. 다른 구독에는 ready도 event도 가지 않는다.
        if (condition.types?.includes("AcpUpdated") !== true) return () => {};
        listeners.add(onMessage);
        queueMicrotask(() => {
          if (listeners.has(onMessage)) onMessage({ kind: "ready" });
        });
        return () => void listeners.delete(onMessage);
      },
    },
  };
}
