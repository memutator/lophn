import type { Id } from "../../../protocol/base/ids.ts";
import type { AppIntake } from "../ports.ts";
import type { WriteQueue } from "./queue.ts";

// 도는 호출 하나. 메모리 표에만 있다(core를 다시 켜면 사라진다).
export type Flight = {
  id: Id<"inv">;
  app: Id<"app">;
  release: Id<"rel">;
  mode: "live" | "preview";
  parent: Id<"inv"> | null;
  project: Id<"prj"> | null;
  // 결과 모름으로 닫아 부른 쪽에 돌려준다.
  abandon(): Promise<void>;
};

export type Timers = {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
};

export const systemTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as number),
};

type CallIntake = AppIntake & {
  // 접수가 닫혀 있으면 열릴 때까지 붙잡는다.
  admit(app: Id<"app">): Promise<void>;
  enter(flight: Flight): void;
  leave(id: Id<"inv">): void;
  flight(id: Id<"inv">): Flight | undefined;
  // 부른 invocation부터 위로 올라간 앱 목록.
  chainApps(parent: Id<"inv"> | null): Id<"app">[];
};

export function createIntake(
  deps: { queue: WriteQueue; timers: Timers },
): CallIntake {
  const closed = new Set<Id<"app">>();
  const held = new Map<Id<"app">, (() => void)[]>();
  const flights = new Map<Id<"inv">, Flight>();
  const idleWatchers = new Set<() => void>();

  // preview 호출은 운영 앱의 drain과 정지에 걸리지 않는다.
  function liveOf(app: Id<"app">): Flight[] {
    return [...flights.values()].filter((f) =>
      f.app === app && f.mode === "live"
    );
  }

  return {
    close(app) {
      closed.add(app);
    },
    open(app) {
      closed.delete(app);
      for (const release of held.get(app) ?? []) release();
      held.delete(app);
    },
    heldCount: (app) => held.get(app)?.length ?? 0,
    admit(app) {
      if (!closed.has(app)) return Promise.resolve();
      return new Promise((resolve) => {
        const list = held.get(app) ?? [];
        list.push(resolve);
        held.set(app, list);
      });
    },
    whenIdle(app, graceMs) {
      if (liveOf(app).length === 0) return Promise.resolve({ idle: true });
      return new Promise((resolve) => {
        const finish = (
          value: { idle: true } | { idle: false; running: Id<"inv">[] },
        ) => {
          idleWatchers.delete(watch);
          deps.timers.clear(timer);
          resolve(value);
        };
        const watch = () => {
          if (liveOf(app).length === 0) finish({ idle: true });
        };
        const timer = deps.timers.set(
          () => finish({ idle: false, running: liveOf(app).map((f) => f.id) }),
          graceMs,
        );
        idleWatchers.add(watch);
      });
    },
    async abandon(app) {
      await Promise.all(liveOf(app).map((f) => f.abandon()));
      deps.queue.reset(app);
    },
    enter(flight) {
      flights.set(flight.id, flight);
    },
    leave(id) {
      flights.delete(id);
      for (const watch of [...idleWatchers]) watch();
    },
    flight: (id) => flights.get(id),
    chainApps(parent) {
      const apps: Id<"app">[] = [];
      let cursor = parent === null ? undefined : flights.get(parent);
      while (cursor) {
        apps.push(cursor.app);
        cursor = cursor.parent === null
          ? undefined
          : flights.get(cursor.parent);
      }
      return apps;
    },
  };
}
