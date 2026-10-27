// `<data root>/settings.json`. 사람이 고른 값만 담고, 읽고 쓰고 바뀜을 지켜본다.
//
// - 하나라도 틀리면 파일 전체를 거절한다. 시작할 때 거절되면 모두 기본값으로 시작하고,
//   이미 읽은 뒤의 변경이 거절되면 이전 값을 그대로 쓴다. log에는 key와 reason만 남긴다.
//   시작 때 거절된 파일은 다음 update가 덮어 손으로 고친 틀린 값이 사라진다. 막지 않기로 정했다.
// - 쓰기는 같은 폴더의 임시 파일(0600)에 쓰고 rename한다. 실패하면 파일은 그대로다.
// - watch는 폴더를 보고 settings.json 이벤트만 timer로 묶어 한 번 다시 읽는다. 내용이
//   마지막으로 읽거나 쓴 것과 같으면 무시한다(자기 쓰기에 반응하지 않는다).
import {
  type FSWatcher,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  watch,
  writeFileSync,
} from "node:fs";
import { err, errorCode, ok, type Result } from "../../base/mod.ts";
import {
  type SettingRejection,
  SETTINGS_FILE_NAME,
  settingsFileSchema,
} from "../../protocol/config/mod.ts";
import type { SettingChange, SettingsRegistry } from "./registry.ts";

const SETTINGS_FILE_MODE = 0o600;
const WATCH_DEBOUNCE_MS = 100;

type SettingsTimer = {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
};
const systemTimer: SettingsTimer = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as number),
};

type UpdateResult = {
  changed: string[];
  rejected: SettingRejection[];
};

export interface SettingsStore {
  readonly registry: SettingsRegistry;
  /** 사람이 고른 값. 기본값과 합치지 않는다. */
  chosen(): Readonly<Record<string, unknown>>;
  /** 하나라도 거절이면 아무것도 쓰지 않는다. 값이 같은 set과 없는 unset은 changed에 넣지 않는다. */
  update(changes: readonly SettingChange[]): Result<UpdateResult>;
  /** 폴더 watch를 시작한다. */
  watch(): void;
  close(): void;
}

export function createSettingsStore(options: {
  /** data root 폴더. 파일은 `<root>/settings.json`이다. */
  root: string;
  registry: SettingsRegistry;
  /** 값이 달라진 key 목록을 알린다(Bus의 SettingsChanged). */
  publish: (keys: string[]) => void;
  log: (message: string) => void;
  timer?: SettingsTimer;
}): SettingsStore {
  const { root, registry, publish, log } = options;
  const timer = options.timer ?? systemTimer;
  const path = `${root}/${SETTINGS_FILE_NAME}`;
  let chosen: Record<string, unknown> = {};
  let lastText: string | undefined;
  let watcher: FSWatcher | undefined;
  let pending: unknown;
  let closed = false;

  const readText = (): string => {
    try {
      return readFileSync(path, "utf8");
    } catch (error) {
      if (errorCode(error) === "ENOENT") return "";
      throw error;
    }
  };

  // 파일 내용을 선택으로 바꾼다. 틀리면 undefined다.
  const parse = (text: string): Record<string, unknown> | undefined => {
    if (text.trim() === "") return {};
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      log("settings: settings.json is not valid JSON");
      return undefined;
    }
    const shaped = settingsFileSchema.safeParse(json);
    if (!shaped.success) {
      log("settings: settings.json is not a flat object");
      return undefined;
    }
    const rejected = registry.validate(
      Object.entries(shaped.data).map(([key, value]) => ({
        key,
        action: "set" as const,
        value,
      })),
    );
    for (const { key, reason } of rejected) {
      log(`settings: rejected ${key} (${reason})`);
    }
    return rejected.length === 0 ? shaped.data : undefined;
  };

  const differing = (
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ): string[] =>
    [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter(
        (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
      )
      .sort();

  // 시작할 때와 watch가 부른다. 거절이면 이전 값을 그대로 둔다.
  const reload = (): void => {
    let text: string;
    try {
      text = readText();
    } catch {
      log("settings: settings.json could not be read");
      return;
    }
    if (text === lastText) return;
    const first = lastText === undefined;
    lastText = text;
    const next = parse(text);
    if (next === undefined) return;
    const changed = differing(chosen, next);
    chosen = next;
    if (!first && changed.length > 0) publish(changed);
  };
  reload();

  const write = (next: Record<string, unknown>): boolean => {
    const sorted = Object.fromEntries(
      Object.keys(next)
        .sort()
        .map((key) => [key, next[key]]),
    );
    const text = `${JSON.stringify(sorted, null, 2)}\n`;
    const temp = `${path}.${crypto.randomUUID()}.tmp`;
    try {
      writeFileSync(temp, text, { flag: "wx", mode: SETTINGS_FILE_MODE });
      renameSync(temp, path);
    } catch {
      try {
        rmSync(temp);
      } catch {
        // 임시 파일이 없으면 지울 것이 없다.
      }
      return false;
    }
    lastText = text;
    return true;
  };

  return {
    registry,
    chosen: () => chosen,
    update(changes) {
      const rejected = registry.validate(changes);
      if (rejected.length > 0) return ok({ changed: [], rejected });
      const next = { ...chosen };
      for (const change of changes) {
        if (change.action === "set") next[change.key] = change.value;
        else delete next[change.key];
      }
      const changed = differing(chosen, next);
      if (changed.length === 0) return ok({ changed: [], rejected: [] });
      if (!write(next)) {
        return err({
          code: "unavailable",
          message: "settings could not be written",
        });
      }
      chosen = next;
      publish(changed);
      return ok({ changed, rejected: [] });
    },
    watch() {
      if (watcher !== undefined || closed) return;
      let events: FSWatcher;
      try {
        // Deno의 node:fs watch는 없는 폴더를 비동기 error event로 알리므로, Node와 같이 동기적으로 던지게 한다.
        statSync(root);
        events = watch(root, { recursive: false }, (_kind, filename) => {
          // 어느 file인지 모르는 신호도 다시 읽는다. 내용이 같으면 reload가 무시한다.
          if (filename !== null && filename !== SETTINGS_FILE_NAME) return;
          if (pending !== undefined) timer.clear(pending);
          pending = timer.set(() => {
            pending = undefined;
            reload();
          }, WATCH_DEBOUNCE_MS);
        });
      } catch {
        log("settings: the settings folder could not be watched");
        return;
      }
      // 오류로 끝난 감시는 더 신호를 주지 않는다. listener가 없으면 error event가 process를 끝낸다.
      events.on("error", () => events.close());
      watcher = events;
    },
    close() {
      closed = true;
      if (pending !== undefined) timer.clear(pending);
      pending = undefined;
      watcher?.close();
      watcher = undefined;
    },
  };
}
