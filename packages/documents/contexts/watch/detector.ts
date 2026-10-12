import { folderCovers, mergeFolders, watchFolders } from "./folders.ts";
import type {
  ActiveContext,
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
// signal(paths): paths 중 하나라도 어떤 활성 context의 감시 폴더에 들면 그 context를 대기 집합에
// 더하고, 창이 열려 있지 않으면 window_ms 짜리 창을 연다. 창은 첫 신호로 열리고 뒤 신호가 늘이지
// 않는다(계속 바뀌어도 window_ms마다 rescan한다). 창이 닫히면 rescan을 한 번 부르고 집합을 비운다.
// 변화 목록·이력·event를 남기지 않는다. 힌트일 뿐이라 놓쳐도 다음 검색·열기의 훑기가 따라잡는다.
export function createChangeDetector(
  deps: ChangeDetectorDeps,
): ChangeDetector {
  const windowMs = deps.window_ms ?? DEFAULT_WINDOW_MS;
  let contextFolders = new Map<string, WatchFolder[]>();
  let merged: WatchFolder[] = [];
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
    const contexts = [...pending].sort();
    pending.clear();
    deps.rescan(contexts);
  }

  return {
    apply(active) {
      const before = new Map(merged.map((folder) => [keyOf(folder), folder]));
      contextFolders = new Map(
        active.map((
          item: ActiveContext,
        ) => [item.context, watchFolders(item.contract)]),
      );
      merged = mergeFolders([...contextFolders.values()].flat());
      const after = new Map(merged.map((folder) => [keyOf(folder), folder]));
      for (const context of [...pending]) {
        if (!contextFolders.has(context)) pending.delete(context);
      }
      if (pending.size === 0) disarm();
      return {
        start: merged.filter((folder) => !before.has(keyOf(folder))),
        stop: [...before.values()].filter((folder) =>
          !after.has(keyOf(folder))
        ),
      };
    },
    folders: () => merged.map((folder) => ({ ...folder })),
    signal(paths) {
      for (const [context, folders] of contextFolders) {
        if (
          paths.some((path) =>
            folders.some((folder) => folderCovers(folder, path))
          )
        ) pending.add(context);
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
