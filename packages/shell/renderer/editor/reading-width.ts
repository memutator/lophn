// 전역 읽기 폭 선택을 설정 선언 `shell.reading_width`에 둔다. 화면은 design의
// ReadingWidthSetting interface로만 읽고 쓴다. localStorage를 따로 정본으로 두지 않는다.
import {
  DEFAULT_READING_WIDTH,
  type ReadingWidth,
  readingWidthOf,
  type ReadingWidthSetting,
} from "@lophn/ui/layout";

import type { CoreSource } from "../desktop/connection/connection.ts";

/** core가 선언하는 설정 key(packages/core/config/shell-settings.ts). */
const READING_WIDTH_KEY = "shell.reading_width";

// settings/list 응답에서 읽는 field. 사람이 고른 값이 있으면 chosen, 없으면 선언의 default다.
interface SettingsList {
  settings: { key: string; default?: unknown; chosen?: unknown }[];
}

export interface ReadingWidthStore extends ReadingWidthSetting {
  /** 저장된 선택을 읽는다. 모르는 값은 기본 폭이다. */
  load(): Promise<void>;
  /** 마지막 저장이 실패했는지. 실패하면 앞의 폭으로 돌아간다. */
  failed(): boolean;
}

interface SettingsPort {
  get(): Promise<unknown | null>;
  set(width: ReadingWidth): Promise<boolean>;
}

/** core의 settings/list·settings/update로 만든 port. */
export function coreSettingsPort(core: CoreSource): SettingsPort {
  return {
    async get() {
      const reply = await core.call({
        kind: "memory",
        resource: "settings",
        method: "list",
        body: { keys: [READING_WIDTH_KEY] },
      });
      if (!reply.ok) return null;
      const setting = (reply.value as SettingsList).settings.find((item) =>
        item.key === READING_WIDTH_KEY
      );
      return setting?.chosen ?? setting?.default ?? null;
    },
    async set(width) {
      const reply = await core.call({
        kind: "memory",
        resource: "settings",
        method: "update",
        body: {
          changes: [{ key: READING_WIDTH_KEY, action: "set", value: width }],
        },
      });
      if (!reply.ok) return false;
      const rejected = (reply.value as { rejected?: unknown[] }).rejected;
      return rejected === undefined || rejected.length === 0;
    },
  };
}

/** 읽기 폭 store. 고른 폭은 바로 보이고, 저장이 실패하면 앞의 폭으로 돌아간다. */
export function readingWidthStore(port: SettingsPort): ReadingWidthStore {
  let width: ReadingWidth = DEFAULT_READING_WIDTH;
  let failed = false;
  let pending = 0;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    read: () => width,
    failed: () => failed,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async load() {
      const value = await port.get();
      if (value === null) return;
      width = readingWidthOf(value);
      notify();
    },
    write(next) {
      const before = width;
      if (next === before) return;
      width = next;
      failed = false;
      pending += 1;
      const mine = pending;
      notify();
      void port.set(next).then((saved) => {
        if (saved || mine !== pending) return;
        width = before;
        failed = true;
        notify();
      });
    },
  };
}
