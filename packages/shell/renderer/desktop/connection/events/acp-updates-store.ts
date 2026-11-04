// 열어 둔 대화 탭의 session별 ACP 갱신. `AcpUpdated`는 subject가 없어 session 조건에 걸리지 않으므로 type으로
// 걸고 payload의 session을 골라 log에 쌓는다. 쓰는 쪽은 snapshot을 읽기 시작할 때의 개수를 표시해 두고 그 뒤만
// `since`로 읽어 접는다(delta가 초당 여럿 와도 배열을 복사하지 않는다). 갱신은 저장하지 않으니 끊긴 사이는
// 쓰는 쪽이 snapshot을 다시 읽어 맞춘다.
import type { AcpUpdate } from "../../../../../protocol/acp/mod.ts";
import type { EventClient } from "./client.ts";
import { createValueStore } from "./store.ts";

export interface AcpUpdatesState {
  /** 이 session을 연 뒤 받은 갱신 수. */
  readonly count: number;
  /** `from`번째부터 이 state의 `count` 전까지. log는 탭이 열린 동안 남는다. */
  readonly since: (from: number) => readonly AcpUpdate[];
  readonly status: "loading" | "live" | "reconnecting";
  /** 조건이 걸려 ready를 받은 횟수. 끊김 없이 다시 걸린 ready도 센다. */
  readonly synced: number;
}

export const NO_ACP_UPDATES: AcpUpdatesState = {
  count: 0,
  since: () => [],
  status: "loading",
  synced: 0,
};

interface AcpUpdatesStore {
  get(): ReadonlyMap<string, AcpUpdatesState>;
  subscribe(listener: () => void): () => void;
  /** 대화 탭을 연다. 반환 함수가 닫는다. 같은 session을 여럿이 열어도 구독은 하나다. */
  open(session: string): () => void;
}

export function createAcpUpdatesStore(client: EventClient): AcpUpdatesStore {
  const state = createValueStore<ReadonlyMap<string, AcpUpdatesState>>(
    new Map(),
  );
  const opened = new Map<string, { count: number; stop: () => void }>();

  function update(session: string, patch: Partial<AcpUpdatesState>) {
    const current = state.get().get(session);
    if (!current) return;
    state.set(new Map(state.get()).set(session, { ...current, ...patch }));
  }

  function start(session: string) {
    state.set(new Map(state.get()).set(session, NO_ACP_UPDATES));
    const log: AcpUpdate[] = [];
    return client.subscribe({ types: ["AcpUpdated"] }, (message) => {
      if (message.kind === "ready") {
        update(session, {
          status: "live",
          synced: (state.get().get(session)?.synced ?? 0) + 1,
        });
      } else if (message.kind === "disconnected") {
        update(session, { status: "reconnecting" });
      } else if (
        message.event.type === "AcpUpdated" &&
        message.event.payload.session === session
      ) {
        log.push(message.event.payload.update);
        const count = log.length;
        update(session, { count, since: (from) => log.slice(from, count) });
      }
    });
  }

  return {
    get: state.get,
    subscribe: state.subscribe,
    open(session) {
      let entry = opened.get(session);
      if (!entry) {
        entry = { count: 0, stop: start(session) };
        opened.set(session, entry);
      }
      entry.count++;
      const mine = entry;
      return () => {
        if (--mine.count > 0) return;
        mine.stop();
        opened.delete(session);
        const next = new Map(state.get());
        next.delete(session);
        state.set(next);
      };
    },
  };
}
