import type {
  ChangeDetector,
  FsWatcherLike,
  WatchDiff,
  WatchFolder,
  WatchFs,
} from "./types.ts";

export type FsWatch = {
  // 감시 폴더의 차이를 반영한다(열고 닫는다).
  update(diff: WatchDiff): void;
  // 모든 watcher를 닫는다.
  close(): void;
};

const keyOf = (folder: WatchFolder) =>
  `${folder.recursive ? "r" : "f"}:${folder.path}`;

// 얇은 Deno.watchFs 어댑터. 폴더마다 watcher 하나를 `join(root, folder)`에 `recursive` 그대로 열고,
// `access`를 뺀 event의 경로를 root 기준 상대 경로(`/` 구분)로 바꿔 detector.signal에 넘긴다.
// event를 저장하지 않고, watcher가 오류로 끝나면 그 폴더만 닫는다(힌트를 놓칠 뿐이다).
// watchFs는 시험이 바꿔 끼운다(제품은 Deno.watchFs).
export function startFsWatch(
  options: { root: string; detector: ChangeDetector; watchFs: WatchFs },
): FsWatch {
  const root = options.root.length > 1
    ? options.root.replace(/\/+$/, "")
    : options.root;
  const prefix = root.endsWith("/") ? root : `${root}/`;
  const watchers = new Map<string, FsWatcherLike>();

  const relative = (path: string) =>
    path.startsWith(prefix) ? path.slice(prefix.length) : undefined;

  async function pump(key: string, watcher: FsWatcherLike) {
    try {
      for await (const event of watcher) {
        if (event.kind === "access") continue;
        const paths = event.paths.map(relative).filter((path) =>
          path !== undefined
        );
        if (paths.length > 0) options.detector.signal(paths);
      }
    } catch {
      // 오류로 끝난 폴더만 닫는다. 힌트를 놓칠 뿐이다.
    }
    if (watchers.get(key) === watcher) close(key);
  }

  function close(key: string) {
    const watcher = watchers.get(key);
    if (watcher === undefined) return;
    watchers.delete(key);
    try {
      watcher.close();
    } catch {
      // 이미 닫혔다.
    }
  }

  return {
    update(diff) {
      for (const folder of diff.stop) close(keyOf(folder));
      for (const folder of diff.start) {
        const key = keyOf(folder);
        if (watchers.has(key)) continue;
        const absolute = folder.path === "" ? root : `${prefix}${folder.path}`;
        let watcher: FsWatcherLike;
        try {
          watcher = options.watchFs(absolute, { recursive: folder.recursive });
        } catch {
          continue; // 폴더가 없는 등. 힌트를 놓칠 뿐이다.
        }
        watchers.set(key, watcher);
        void pump(key, watcher);
      }
    },
    close() {
      for (const key of [...watchers.keys()]) close(key);
    },
  };
}
