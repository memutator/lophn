import { statSync, watch } from "node:fs";
import { join } from "node:path";
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

// .gitignore는 보지 않는다: kinds가 경로로 명시한 폴더라 ignore된 파일도 바뀌면 알린다.
// 폴더마다 `node:fs` watch 하나를 `join(root, folder)`에 `recursive` 그대로 열고, event의 경로를 root 기준
// 상대 경로(`/` 구분)로 바꿔 detector.signal에 넘긴다. event를 저장하지 않고, watcher가 오류로 끝나면
// 그 폴더만 닫는다(힌트를 놓칠 뿐이다).
// watchFs는 시험이 바꿔 끼운다(제품은 `nodeWatchFs`).

// node:fs watch를 async iterator로 바꾼다. filename은 감시한 폴더 기준 상대 경로라 절대 경로로 만든다.
export const nodeWatchFs: WatchFs = (absolutePath, options) => {
  // Deno의 node:fs watch는 없는 폴더를 비동기 error event로 알리므로, Node와 같이 동기적으로 던지게 한다.
  // 그래야 부르는 쪽이 이 폴더를 incomplete로 두고 다음에 다시 연다.
  statSync(absolutePath);
  const events: { paths: readonly string[] }[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  const watcher = watch(
    absolutePath,
    { recursive: options.recursive },
    (_kind, filename) => {
      // 어느 file인지 모르는 신호는 경로를 만들 수 없다. 힌트일 뿐이라 놓친다.
      if (filename === null) return;
      events.push({ paths: [join(absolutePath, filename)] });
      wake?.();
      wake = undefined;
    },
  );
  const close = () => {
    if (closed) return;
    closed = true;
    watcher.close();
    wake?.();
    wake = undefined;
  };
  // 오류로 끝난 감시는 그 폴더의 신호를 더 보내지 않는다. listener가 없으면 error event가 process를 끝낸다.
  watcher.on("error", close);
  return {
    async *[Symbol.asyncIterator]() {
      while (!closed) {
        const event = events.shift();
        if (event !== undefined) {
          yield event;
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
    close,
  };
};

export function startFsWatch(options: {
  root: string;
  detector: ChangeDetector;
  watchFs: WatchFs;
}): FsWatch {
  const root =
    options.root.length > 1 ? options.root.replace(/\/+$/, "") : options.root;
  const prefix = root.endsWith("/") ? root : `${root}/`;
  const watchers = new Map<string, FsWatcherLike>();

  const relative = (path: string) =>
    path.startsWith(prefix) ? path.slice(prefix.length) : undefined;

  async function pump(key: string, watcher: FsWatcherLike) {
    try {
      for await (const event of watcher) {
        const paths = event.paths
          .map(relative)
          .filter((path) => path !== undefined);
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
