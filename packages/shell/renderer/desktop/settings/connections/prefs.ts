// 기계마다의 coding agent 설정(`shell.coding_agents`): 즐겨찾기(`favorites`)와 실행 명령어(`commands`).
// 각 컴퓨터에 설치된 CLI와 내장 coding agent 목록(`shownCodingIds`)에 묶이므로 빠른 실행(`QuickPrefs`)과 따로
// 기계 범위(`MachineScope`)마다 읽고 쓴다.
import type { HarnessId } from "../../../../../protocol/coding-agent/harness-id.ts";
import { HARNESS_IDS } from "../../../../../protocol/coding-agent/harness-id.ts";
import type { CoreSource } from "../../connection/connection.ts";
import { chooseSetting, readEffective } from "../declared.ts";
import type { SourceResult } from "../source.ts";

// packages/core/config/shell-settings.ts의 key와 같은 글자다(shell은 core를 import하지 못한다).
export const CODING_AGENTS_SETTING_KEY = "shell.coding_agents";

export interface CodingPrefs {
  /** 빠른 실행 Terminal hover, workspace +의 hover 목록, 내장 coding agent 목록의 harness id. 고른 순서다. */
  readonly favorites: readonly HarnessId[];
  /** 사람이 바꾼 실행 명령어. 없으면 adapter의 첫 명령어다. */
  readonly commands: Readonly<Partial<Record<HarnessId, string>>>;
}

export interface CodingPrefsSource {
  read(): Promise<SourceResult<CodingPrefs>>;
  write(value: CodingPrefs): Promise<SourceResult<null>>;
}

export const DEFAULT_CODING_PREFS: CodingPrefs = {
  favorites: ["claude", "codex", "opencode"],
  commands: {},
};

const isHarness = (value: unknown): value is HarnessId =>
  typeof value === "string" &&
  (HARNESS_IDS as readonly string[]).includes(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// core가 이미 모양을 검사했다. 여기서는 shell이 모르는 harness id와 빈 명령만 버린다.
export function codingFromValue(value: unknown): CodingPrefs {
  if (!isRecord(value)) return DEFAULT_CODING_PREFS;
  const favorites = Array.isArray(value.favorites)
    ? value.favorites.filter(
        (id, at, all): id is HarnessId =>
          isHarness(id) && all.indexOf(id) === at,
      )
    : DEFAULT_CODING_PREFS.favorites;
  const commands: Partial<Record<HarnessId, string>> = {};
  if (isRecord(value.commands)) {
    for (const [id, command] of Object.entries(value.commands)) {
      if (
        isHarness(id) &&
        typeof command === "string" &&
        command.trim() !== ""
      ) {
        commands[id] = command;
      }
    }
  }
  return { favorites, commands };
}

export function coreCodingPrefsSource(core: CoreSource): CodingPrefsSource {
  return {
    async read() {
      const read = await readEffective(core, [CODING_AGENTS_SETTING_KEY]);
      if (!read.ok) return read;
      return {
        ok: true,
        value: codingFromValue(read.value.get(CODING_AGENTS_SETTING_KEY)),
      };
    },
    write: (value) => chooseSetting(core, CODING_AGENTS_SETTING_KEY, value),
  };
}

export function memoryCodingPrefsSource(
  initial: CodingPrefs = DEFAULT_CODING_PREFS,
): CodingPrefsSource {
  let value = initial;
  return {
    read: () => Promise.resolve({ ok: true, value }),
    write(next) {
      value = next;
      return Promise.resolve({ ok: true, value: null });
    },
  };
}

export interface CodingPrefsStore {
  snapshot(): CodingPrefs;
  subscribe(listener: () => void): () => void;
  set(value: CodingPrefs): void;
  /** core에서 다시 읽는다. */
  reload(): void;
}

export function createCodingPrefsStore(
  source: CodingPrefsSource,
): CodingPrefsStore {
  let value = DEFAULT_CODING_PREFS;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  // 쓰기 전에 떠난 읽기가 늦게 와서 새 값을 덮지 않게 한다.
  let generation = 0;
  const reload = () => {
    const at = ++generation;
    void source.read().then((read) => {
      if (!read.ok || at !== generation) return;
      value = read.value;
      emit();
    });
  };
  return {
    snapshot: () => value,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      generation++;
      value = next;
      emit();
      void source.write(next).then((result) => {
        if (!result.ok) reload();
      });
    },
    reload,
  };
}
