// 화면이 core를 읽는 공통 길. 읽기가 기대는 변경(`{name, id}` 목록)에 맞는 `StateChanged`나 ready가 오면 다시 읽는다.
// 끊기면 옛 값을 stale로 두고, 다시 붙어 ready가 오면 읽어 맞춘다. route 하나든 여러 route를 엮은 읽기든 같은 길이다.
import { useCallback, useEffect, useRef, useState } from "react";
import type { z } from "zod";

import type {
  MemoryRoute,
  ReadRoute,
  RouteRead,
} from "../../../../protocol/base/route.ts";
import type {
  ChangeName,
  StateChange,
} from "../../../../protocol/events/changes.ts";
import type { BusEvent } from "../../../../protocol/events/mod.ts";
import type { CoreSource } from "./connection.ts";
import type { EventClient } from "./events/client.ts";
import { useEventClient, useOptionalEventClient } from "./events/hooks.tsx";
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

export type Read<T> = Promise<
  | { readonly ok: true; readonly value: T }
  /** code는 core가 준 오류 code다. 모르면 없다. */
  | { readonly ok: false; readonly code?: string }
>;

// 처음 읽기가 unavailable이면(core가 막 뜨며 동시 요청 한도를 넘었다) 이만큼 기다리며 몇 번 더 읽은 뒤에 실패를 보인다.
const FIRST_READ_RETRY_MS = [200, 500, 1000];

type CoreReadRoute = ReadRoute | MemoryRoute;

/** 따라갈 변경. 이름만 적으면 그 이름 전체다. */
export type Watched = readonly (ChangeName | StateChange)[];

/** route의 `reads`를 그 입력으로 푼다. id가 null이면 그 이름 전체를 따라간다. */
export function readsOf(
  route: { readonly reads?: readonly RouteRead[] },
  input: unknown,
): StateChange[] {
  return (route.reads ?? []).map((read) =>
    typeof read === "string"
      ? { name: read, id: null }
      : { name: read.name, id: read.id(input) },
  );
}

/** 일치 규칙: 이름이 같고, event의 id나 따라가는 id가 null이거나 둘이 같다. */
export function readsChanged(watched: Watched, event: BusEvent): boolean {
  if (event.type !== "StateChanged") return false;
  return watched.some((item) => {
    const read = typeof item === "string" ? { name: item, id: null } : item;
    return event.payload.changes.some(
      (change) =>
        change.name === read.name &&
        (change.id === null || read.id === null || change.id === read.id),
    );
  });
}

export async function readRoute<R extends CoreReadRoute>(
  core: CoreSource,
  route: R,
  input: z.input<R["input"]>,
): Read<z.output<R["output"]>> {
  const reply = await core.call({
    kind: route.kind,
    resource: route.resource,
    method: route.method,
    body: input,
  });
  return reply.ok
    ? { ok: true, value: reply.value as z.output<R["output"]> }
    : {
        ok: false,
        ...(reply.error?.code === undefined ? {} : { code: reply.error.code }),
      };
}

/**
 * read를 부르고 따라간다. 읽는 중에 맞는 변경이 여럿 와도 읽기가 끝난 뒤 한 번만 다시 읽는다.
 * 반환의 stop이 구독을 푼다.
 */
export function followRead<T>(
  client: EventClient,
  read: (core: CoreSource) => Read<T>,
  watched: Watched,
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
      for (const wait of [...FIRST_READ_RETRY_MS, null]) {
        const result = await read(client.core).catch(
          (): { ok: false; code?: string } => ({ ok: false }),
        );
        if (result.ok) return result.value;
        if (
          last === null &&
          wait !== null &&
          !stopped &&
          result.code === "unavailable"
        ) {
          await new Promise((resolve) => setTimeout(resolve, wait));
          continue;
        }
        break;
      }
      if (last === null) show({ state: "failed" });
      else stale();
      return null;
    },
    replace(value) {
      last = { value, at: now() };
      show({ state: "ready", value, staleSince: null });
    },
    apply(event) {
      if (readsChanged(watched, event)) again();
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

/** route 하나를 따라간다(hook 밖에서 쓰는 쪽). */
export function followCoreRead<T>(
  client: EventClient,
  route: CoreReadRoute,
  input: unknown,
  onLoaded: (loaded: Loaded<T>) => void,
  now: () => Date,
): { reload(): void; stop(): void } {
  return followRead(
    client,
    (core) => readRoute(core, route, input as never) as Read<T>,
    readsOf(route, input),
    onLoaded,
    now,
  );
}

/**
 * read를 읽고 watched에 맞는 변경과 다시 붙음에 다시 읽는다. route 하나로 끝나지 않는 읽기(여러 route를 엮거나
 * page를 끝까지 모으는 것)는 read 안에서 `readRoute`를 여럿 부르고 watched에 각 route의 `readsOf`를 모은다.
 * 하나라도 처음 읽기가 실패하면 failed다. key가 바뀌면 처음부터 다시 읽는다. read는 마지막으로 준 것을 부른다.
 * EventsProvider 안에서만 쓴다.
 */
export function useFollowedRead<T>(
  read: (core: CoreSource) => Read<T>,
  watched: Watched,
  key: string,
): ReadHandle<T> {
  const client = useEventClient();
  const latest = useRef(read);
  latest.current = read;
  const [loaded, setLoaded] = useState<Loaded<T>>({ state: "loading" });
  const follower = useRef<{ reload(): void } | null>(null);
  const watchKey = JSON.stringify(watched);

  useEffect(() => {
    setLoaded({ state: "loading" });
    const follow = followRead<T>(
      client,
      (core) => latest.current(core),
      JSON.parse(watchKey) as Watched,
      setLoaded,
      () => new Date(),
    );
    follower.current = follow;
    return () => {
      follower.current = null;
      follow.stop();
    };
  }, [client, key, watchKey]);

  const reload = useCallback(() => follower.current?.reload(), []);
  return { loaded, reload };
}

/**
 * read route 하나를 읽고 `reads`에 맞는 변경과 다시 붙음에 다시 읽는다. input은 값으로 비교한다.
 * EventsProvider 안에서만 쓴다.
 */
export function useCoreRead<R extends CoreReadRoute>(
  route: R,
  input: z.input<R["input"]>,
): ReadHandle<z.output<R["output"]>> {
  return useFollowedRead(
    (core) => readRoute(core, route, input),
    readsOf(route, input),
    `${route.kind}:${route.resource}/${route.method}:${JSON.stringify(input ?? null)}`,
  );
}

/**
 * 값을 store에 두는 쪽(설정을 적용하는 자리)이 쓴다. ready와 watched에 맞는 변경에 listener를 부른다.
 * EventsProvider 밖(event가 없는 화면)에서는 아무것도 하지 않는다.
 */
export function useStateChanged(watched: Watched, listener: () => void): void {
  const client = useOptionalEventClient();
  const latest = useRef(listener);
  latest.current = listener;
  const watchKey = JSON.stringify(watched);
  useEffect(() => {
    if (client === null) return;
    const follow = followRead(
      client,
      () => {
        latest.current();
        return Promise.resolve({ ok: true, value: null });
      },
      JSON.parse(watchKey) as Watched,
      () => {},
      () => new Date(),
    );
    return () => follow.stop();
  }, [client, watchKey]);
}
