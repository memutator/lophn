// 폴더 변경을 지켜보다 debounce 뒤 한 번 알린다. watch와 timer는 인자로 받는다.
export type FolderWatcher = {
  close(): void;
  on(event: "error", listener: () => void): unknown;
};

export type WatchDeps = {
  watch(
    dir: string,
    options: { recursive: boolean },
    listener: () => void,
  ): FolderWatcher;
  timer: {
    set(fn: () => void, ms: number): unknown;
    clear(handle: unknown): void;
  };
};

export function watchFolder(
  input: { dir: string; recursive: boolean; debounceMs: number },
  deps: WatchDeps,
  onChange: () => void,
): { stop(): void } {
  let pending: unknown;
  let watcher: FolderWatcher | undefined;

  function stop() {
    if (pending !== undefined) deps.timer.clear(pending);
    pending = undefined;
    watcher?.close();
    watcher = undefined;
  }

  try {
    watcher = deps.watch(input.dir, { recursive: input.recursive }, () => {
      if (pending !== undefined) return;
      pending = deps.timer.set(() => {
        pending = undefined;
        onChange();
      }, input.debounceMs);
    });
    // 폴더가 사라지거나 watch가 깨지면 조용히 멈춘다.
    watcher.on("error", stop);
  } catch {
    stop();
  }
  return { stop };
}
