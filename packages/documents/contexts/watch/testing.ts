// watch 시험이 함께 쓰는 fake. 제품 코드는 import하지 않는다.
import type {
  Contract,
  ContractSource,
} from "../../../contracts/documents/mod.ts";
import { bundleOf, fieldOf, typeWith } from "../extract/testing.ts";
import type {
  FsEventLike,
  FsWatcherLike,
  Timer,
  TimerHandle,
  WatchFs,
} from "./types.ts";

export type FakeTimer = Timer & {
  // ms만큼 시계를 앞으로 보내며 도래한 timer를 시각 순으로 부른다.
  advance(ms: number): void;
  pending(): number;
};

export function fakeTimer(): FakeTimer {
  let now = 0;
  let next = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  return {
    set(ms, run) {
      const id = next++;
      timers.set(id, { at: now + ms, run });
      return id;
    },
    clear(handle: TimerHandle) {
      timers.delete(handle as number);
    },
    pending: () => timers.size,
    advance(ms) {
      const target = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (due === undefined) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].run();
      }
      now = target;
    },
  };
}

export type FakeWatcher = FsWatcherLike & {
  path: string;
  recursive: boolean;
  closed: boolean;
  emit(event: FsEventLike): void;
};

export type FakeWatchFs = WatchFs & { watchers: FakeWatcher[] };

export function fakeWatchFs(): FakeWatchFs {
  const watchers: FakeWatcher[] = [];
  const open: WatchFs = (path, options) => {
    const queue: FsEventLike[] = [];
    let wake: (() => void) | undefined;
    const watcher: FakeWatcher = {
      path,
      recursive: options.recursive,
      closed: false,
      emit(event) {
        queue.push(event);
        wake?.();
      },
      close() {
        watcher.closed = true;
        wake?.();
      },
      async *[Symbol.asyncIterator]() {
        while (!watcher.closed) {
          const event = queue.shift();
          if (event !== undefined) {
            yield event;
            continue;
          }
          await new Promise<void>((resolve) => wake = resolve);
        }
      },
    };
    watchers.push(watcher);
    return watcher;
  };
  return Object.assign(open, { watchers });
}

// source마다 type 하나(T0, T1 …)를 가진 계약.
export function contractOf(sources: readonly ContractSource[]): Contract {
  return bundleOf(
    sources.map((source, index) => ({
      ...typeWith(`T${index}`, source),
      fields: [fieldOf("id", "string")],
    })),
  ).contract;
}
