// core 설정(`settings/list`)의 살아 있는 사본. core가 준비되면 전체를 읽고, 설정이 바뀌었다는 event(`StateChanged`의 `settings`)가
// 오면 다시 읽는다. 누가 바꿨는지 가리지 않는다: Settings 화면, `lophn settings set`, agent, 손으로 고친 file이 같은 길로 온다.
// 설정을 화면에 적용하는 영역은 `watch`로 듣고 `get`으로 읽는다. 설정마다 IPC를 두지 않는다.
import type {
  SettingEntry,
  SettingFolder,
} from "../../../../protocol/config/mod.ts";

type CallResult = { ok: true; value: unknown } | { ok: false; error: unknown };

export interface ShellSettings {
  /** 고른 값, 없으면 기본값. 아직 읽지 못했거나 없는 key면 undefined다. */
  get(key: string): unknown;
  /** folder 설정(`shell.themes`)의 항목과 읽지 못한 file. 아직 읽지 못했으면 undefined다. */
  folder(key: string): SettingFolder | undefined;
  /** 값을 처음 읽었을 때와 다시 읽었을 때 부른다. 이미 읽었으면 바로 한 번 부른다. 해제는 반환 함수다. */
  watch(listener: () => void): () => void;
  /** core가 준비됐거나 설정이 바뀌었다. 다시 읽는다. */
  refresh(): void;
}

export function createShellSettings(
  list: () => Promise<CallResult>,
): ShellSettings {
  let settings: ReadonlyMap<string, SettingEntry> | undefined;
  let folders: ReadonlyMap<string, SettingFolder> = new Map();
  const listeners = new Set<() => void>();
  let latest = 0;
  return {
    get(key) {
      const entry = settings?.get(key);
      return entry?.chosen !== undefined ? entry.chosen : entry?.default;
    },
    folder: (key) => folders.get(key),
    watch(listener) {
      listeners.add(listener);
      if (settings !== undefined) listener();
      return () => listeners.delete(listener);
    },
    refresh() {
      const seq = ++latest;
      void list().then((listed) => {
        // 늦게 온 옛 답은 버린다. 읽지 못하면 지금 값을 둔다(다음 준비나 event가 다시 읽는다).
        if (seq !== latest || !listed.ok) return;
        const value = listed.value as {
          settings: SettingEntry[];
          folders: SettingFolder[];
        };
        settings = new Map(value.settings.map((one) => [one.key, one]));
        folders = new Map(value.folders.map((one) => [one.key, one]));
        for (const listener of listeners) listener();
      });
    },
  };
}
