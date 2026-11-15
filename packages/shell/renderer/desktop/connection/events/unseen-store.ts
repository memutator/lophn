// 못 본 turn 끝(finished 점). 정본은 core(`unseen/list`)이고 창마다 같은 것을 읽는다. 서고 꺼질 때 core가 내는
// `StateChanged{unseen}`에 다시 읽는다. 탭을 보거나(main이 presence로 알린다) 폰에서 읽으면 core가 끈다.
import type { z } from "zod";
import {
  unseenDismiss,
  unseenList,
} from "../../../../../protocol/attention/mod.ts";
import type { BusEvent } from "../../../../../protocol/events/mod.ts";
import type { EventClient } from "./client.ts";
import { createValueStore, syncOnReady } from "./store.ts";

export type UnseenMark = z.infer<typeof unseenList.output>["items"][number];

export interface UnseenState {
  /** session 참조(`ses_…`, 터미널은 `term:<탭>`)마다 못 본 끝. */
  readonly marks: ReadonlyMap<string, UnseenMark>;
}

export interface UnseenStore {
  get(): UnseenState;
  subscribe(listener: () => void): () => void;
  start(): () => void;
  /** 열지 않고 지운다(본 것과 같다). core가 끄면 `StateChanged{unseen}`이 다시 읽게 한다. */
  dismiss(session: string): void;
}

export function createUnseenStore(client: EventClient): UnseenStore {
  const state = createValueStore<UnseenState>({ marks: new Map() });
  // 늦게 끝난 읽기가 새 값을 덮지 않게 한다.
  let serial = 0;

  async function read(): Promise<UnseenMark[] | null> {
    const reply = await client.core
      .call({
        kind: unseenList.kind,
        resource: unseenList.resource,
        method: unseenList.method,
        body: {},
      })
      .catch(() => null);
    if (!reply?.ok) return null;
    const parsed = unseenList.output.safeParse(reply.value);
    return parsed.success ? parsed.data.items : null;
  }

  function replace(items: UnseenMark[]) {
    state.set({ marks: new Map(items.map((item) => [item.session, item])) });
  }

  async function refresh() {
    const mine = ++serial;
    const items = await read();
    if (items !== null && mine === serial) replace(items);
  }

  return {
    get: state.get,
    subscribe: state.subscribe,
    start() {
      return client.subscribe(
        { types: ["StateChanged"] },
        syncOnReady({
          read: async () => {
            ++serial;
            return await read();
          },
          replace,
          apply(event: BusEvent) {
            if (
              event.type === "StateChanged" &&
              event.payload.changes.some((change) => change.name === "unseen")
            ) {
              void refresh();
            }
          },
        }),
      );
    },
    dismiss(session) {
      void client.core
        .call({
          kind: unseenDismiss.kind,
          resource: unseenDismiss.resource,
          method: unseenDismiss.method,
          body: { session },
        })
        .catch(() => null);
    },
  };
}
