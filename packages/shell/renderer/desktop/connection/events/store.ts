import type { EventMessage } from "./client.ts";
import type { BusEvent } from "../../../../../protocol/events/mod.ts";

// useSyncExternalStore가 읽는 가장 작은 store. 값은 바뀔 때마다 새 객체로 갈아 끼운다.
export interface ValueStore<T> {
  get(): T;
  set(next: T): void;
  subscribe(listener: () => void): () => void;
}

export function createValueStore<T>(initial: T): ValueStore<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      value = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export interface SyncOptions<R> {
  read(): Promise<R | null>;
  /** snapshot으로 지금 상태를 통째로 맞춘다. */
  replace(snapshot: R): void;
  apply(event: BusEvent): void;
  onStatus?(status: "syncing" | "synced" | "disconnected"): void;
}

/**
 * ready를 받으면 snapshot을 읽어 통째로 맞춘다. 읽는 동안 온 event는 모았다가 맞춘 뒤에 차례로 적용한다.
 * 같은 event를 두 번 적용해도 같은 결과여야 한다(store가 id로 한 번만 든다).
 */
export function syncOnReady<R>(options: SyncOptions<R>) {
  let generation = 0;
  let syncing = false;
  let buffered: BusEvent[] = [];

  async function sync() {
    const mine = ++generation;
    syncing = true;
    buffered = [];
    options.onStatus?.("syncing");
    const snapshot = await options.read();
    if (mine !== generation) return;
    if (snapshot !== null) options.replace(snapshot);
    syncing = false;
    const pending = buffered;
    buffered = [];
    for (const event of pending) options.apply(event);
    options.onStatus?.("synced");
  }

  return (message: EventMessage) => {
    if (message.kind === "ready") void sync();
    else if (message.kind === "event") {
      if (syncing) buffered.push(message.event);
      else options.apply(message.event);
    } else {
      generation++;
      syncing = false;
      buffered = [];
      options.onStatus?.("disconnected");
    }
  };
}
