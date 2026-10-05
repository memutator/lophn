// 전역 읽기 폭 선택을 platform settings에 둔다(shell/design-system#R23). 화면은 design의
// ReadingWidthSetting interface로만 읽고 쓴다. localStorage를 따로 정본으로 두지 않는다.
import {
  DEFAULT_READING_WIDTH,
  readingWidthOf,
  type ReadingWidth,
  type ReadingWidthSetting,
} from "@lophn/design/components";

import type { CoreSource } from "../desktop/connection/connection.ts";

/** shell이 등록하는 설정 항목 key(apps/core/shell.ts). */
export const READING_WIDTH_KEY = "shell.reading_width";

// platform settings.get·settings.apply 응답에서 읽는 field. main이 schema로 검사했다.
interface SettingsGet {
  settings: { key: string; value: unknown }[];
  revision: number;
}

interface ApplyReply {
  result: { revision: number };
}

export interface ReadingWidthStore extends ReadingWidthSetting {
  /** 저장된 선택을 읽는다. 모르는 값은 기본 폭이다. */
  load(): Promise<void>;
  /** 마지막 저장이 실패했는지. 실패하면 앞의 폭으로 돌아간다. */
  failed(): boolean;
}

export interface SettingsPort {
  get(): Promise<{ value: unknown; revision: number } | null>;
  apply(width: ReadingWidth, revision: number): Promise<
    { ok: true; revision: number } | { ok: false; conflict: boolean }
  >;
}

/** core의 settings.get·settings.apply로 만든 port. */
export function coreSettingsPort(
  core: CoreSource,
  idempotencyKey: () => string,
): SettingsPort {
  return {
    async get() {
      const reply = await core.call({
        kind: "read",
        resource: "settings",
        method: "get",
        body: { keys: [READING_WIDTH_KEY] },
      });
      if (!reply.ok) return null;
      const value = reply.value as SettingsGet;
      const setting = value.settings.find((item) =>
        item.key === READING_WIDTH_KEY
      );
      return { value: setting?.value ?? null, revision: value.revision };
    },
    async apply(width, revision) {
      const reply = await core.call({
        kind: "command",
        resource: "settings",
        method: "apply",
        body: {
          input: {
            changes: [{
              layer: "common",
              key: READING_WIDTH_KEY,
              action: "set",
              value: width,
            }],
          },
          idempotency_key: idempotencyKey(),
          compare: { revision },
          prepared: [],
        },
      });
      if (!reply.ok) {
        return { ok: false, conflict: reply.error?.code === "conflict" };
      }
      return { ok: true, revision: (reply.value as ApplyReply).result.revision };
    },
  };
}

/** 읽기 폭 store. 고른 폭은 바로 보이고, 저장이 실패하면 앞의 폭으로 돌아간다. */
export function readingWidthStore(port: SettingsPort): ReadingWidthStore {
  let width: ReadingWidth = DEFAULT_READING_WIDTH;
  let revision: number | null = null;
  let failed = false;
  let pending = 0;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };

  const refresh = async (adopt: boolean): Promise<boolean> => {
    const read = await port.get();
    if (read === null) return false;
    revision = read.revision;
    if (adopt) width = readingWidthOf(read.value);
    return true;
  };

  return {
    read: () => width,
    failed: () => failed,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async load() {
      if (await refresh(true)) notify();
    },
    write(next) {
      const before = width;
      if (next === before) return;
      width = next;
      failed = false;
      pending += 1;
      const mine = pending;
      notify();
      void (async () => {
        // 다른 창이 먼저 바꿨으면 판을 다시 읽고 한 번 더 시도한다(CAS).
        for (let attempt = 0; attempt < 2; attempt += 1) {
          if (revision === null && !(await refresh(false))) break;
          const result = await port.apply(next, revision!);
          if (result.ok) {
            revision = result.revision;
            return;
          }
          if (!result.conflict) break;
          revision = null;
        }
        if (mine !== pending) return;
        width = before;
        failed = true;
        notify();
      })();
    },
  };
}
