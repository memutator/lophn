import { folderCovers } from "../../../../../protocol/projects/mod.ts";
import type {
  ActiveWatch,
  ChangeDetector,
  ChangeDetectorDeps,
  TimerHandle,
  WatchFolder,
} from "./types.ts";

const DEFAULT_WINDOW_MS = 500;

const keyOf = (folder: WatchFolder) =>
  `${folder.recursive ? "r" : "f"}:${folder.path}`;

// 변화 감지의 순수 core. 시각과 timer는 deps로 받는다.
//
// signal(paths): paths 중 하나라도 어떤 대상의 감시 폴더에 들면 그 대상을 대기 집합에 더하고, 창이 열려
// 있지 않으면 window_ms 짜리 창을 연다. 창은 첫 신호로 열리고 뒤 신호가 늘이지 않는다(계속 바뀌어도
// window_ms마다 rescan한다). 창이 닫히면 rescan을 한 번 부르고 집합을 비운다. 힌트일 뿐이라 놓쳐도
// 다음 sync가 따라잡는다.
export function createChangeDetector(
  deps: ChangeDetectorDeps,
): ChangeDetector {
  const windowMs = deps.window_ms ?? DEFAULT_WINDOW_MS;
  let targets = new Map<string, readonly WatchFolder[]>();
  let merged = new Map<string, WatchFolder>();
  const pending = new Set<string>();
  let handle: TimerHandle | undefined;
  let armed = false;

  function disarm() {
    if (!armed) return;
    deps.timer.clear(handle);
    armed = false;
    handle = undefined;
  }

  function fire() {
    armed = false;
    handle = undefined;
    if (pending.size === 0) return;
    const keys = [...pending].sort();
    pending.clear();
    deps.rescan(keys);
  }

  return {
    apply(active: readonly ActiveWatch[]) {
      const before = merged;
      targets = new Map(active.map((item) => [item.key, item.folders]));
      merged = new Map(
        [...targets.values()].flat().map((folder) => [keyOf(folder), folder]),
      );
      for (const key of [...pending]) {
        if (!targets.has(key)) pending.delete(key);
      }
      if (pending.size === 0) disarm();
      return {
        start: [...merged].filter(([key]) => !before.has(key)).map(([, f]) =>
          f
        ),
        stop: [...before].filter(([key]) => !merged.has(key)).map(([, f]) => f),
      };
    },
    signal(paths) {
      for (const [key, folders] of targets) {
        if (
          paths.some((path) =>
            folders.some((folder) => folderCovers(folder, path))
          )
        ) pending.add(key);
      }
      if (pending.size > 0 && !armed) {
        armed = true;
        handle = deps.timer.set(windowMs, fire);
      }
    },
    close() {
      pending.clear();
      disarm();
    },
  };
}
