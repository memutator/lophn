// 화면이 core를 읽는 공통 길. route의 `reads`에 맞는 `StateChanged`나 ready가 오면 다시 읽는다.
// 끊기면 옛 값을 stale로 두고, 다시 붙어 ready가 오면 읽어 맞춘다.
import { useCallback, useEffect, useRef, useState } from "react";
import type { z } from "zod";

import type {
  MemoryRoute,
  ReadRoute,
  RouteRead,
} from "../../../../protocol/base/route.ts";
import type { BusEvent } from "../../../../protocol/events/mod.ts";
import type { EventClient } from "./events/client.ts";
import { useEventClient } from "./events/hooks.tsx";
import { syncOnReady } from "./events/store.ts";

export type Loaded<T> =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | {
      readonly state: "ready";
      readonly value: T;
      /** 끊겼거나 마지막 읽기가 실패했으면 그 값을 확인한 시각이다. */
      readonly staleSince: Date | null;
    };

export interface ReadHandle<T> {
  readonly loaded: Loaded<T>;
  reload(): void;
}

type CoreReadRoute = ReadRoute | MemoryRoute;

/** 일치 규칙: 이름이 같고, event의 id나 읽기의 id가 null이거나 둘이 같다. */
export function readsChanged(
  reads: readonly RouteRead[] | undefined,
  input: unknown,
  event: BusEvent,
): boolean {
  if (event.type !== "StateChanged" || !reads) return false;
  return reads.some((read) => {
    const name = typeof read === "string" ? read : read.name;
    const id = typeof read === "string" ? null : read.id(input);
    return event.payload.changes.some(
      (change) =>
        change.name === name &&
        (change.id === null || id === null || change.id === id),
    );
  });
}

/**
 * route를 읽고 따라간다. 읽는 중에 맞는 변경이 여럿 와도 읽기가 끝난 뒤 한 번만 다시 읽는다.
 * 반환의 stop이 구독을 푼다.
 */
export function followCoreRead<T>(
  client: EventClient,
  route: CoreReadRoute,
  input: unknown,
  onLoaded: (loaded: Loaded<T>) => void,
  now: () => Date,
): { reload(): void; stop(): void } {
  let last: { value: T; at: Date } | null = null;
  let reading = false;
  let dirty = false;
  let stopped = false;

  const show = (loaded: Loaded<T>) => {
    if (!stopped) onLoaded(loaded);
  };
  const stale = () => {
    if (last !== null) {
      show({ state: "ready", value: last.value, staleSince: last.at });
    }
  };

  const handle = syncOnReady<T>({
    async read() {
      const reply = await client.core.call({
        kind: route.kind,
        resource: route.resource,
        method: route.method,
        body: input,
      });
      if (reply.ok) return reply.value as T;
      if (last === null) show({ state: "failed" });
      else stale();
      return null;
    },
    replace(value) {
      last = { value, at: now() };
      show({ state: "ready", value, staleSince: null });
    },
    apply(event) {
      if (readsChanged(route.reads, input, event)) again();
    },
    onStatus(status) {
      reading = status === "syncing";
      if (status === "synced") flush();
      if (status === "disconnected") {
        dirty = false;
        stale();
      }
    },
  });

  function flush() {
    if (!dirty || stopped) return;
    dirty = false;
    handle({ kind: "ready" });
  }

  function again() {
    dirty = true;
    if (!reading) flush();
  }

  const unsubscribe = client.subscribe({ types: ["StateChanged"] }, handle);
  return {
    reload: again,
    stop() {
      stopped = true;
      unsubscribe();
    },
  };
}

/**
 * read route 하나를 읽고 `reads`에 맞는 변경과 다시 붙음에 다시 읽는다. input은 값으로 비교한다.
 * EventsProvider 안에서만 쓴다.
 */
export function useCoreRead<R extends CoreReadRoute>(
  route: R,
  input: z.input<R["input"]>,
): ReadHandle<z.output<R["output"]>> {
  const client = useEventClient();
  const [loaded, setLoaded] = useState<Loaded<z.output<R["output"]>>>({
    state: "loading",
  });
  const follower = useRef<{ reload(): void } | null>(null);
  const key = JSON.stringify(input ?? null);

  useEffect(() => {
    setLoaded({ state: "loading" });
    const follow = followCoreRead<z.output<R["output"]>>(
      client,
      route,
      JSON.parse(key),
      setLoaded,
      () => new Date(),
    );
    follower.current = follow;
    return () => {
      follower.current = null;
      follow.stop();
    };
  }, [client, route, key]);

  const reload = useCallback(() => follower.current?.reload(), []);
  return { loaded, reload };
}
