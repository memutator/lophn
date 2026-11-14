// `<data root>/settings.json`. 사람이 고른 값만 담고, 읽고 쓰고 바뀜을 지켜본다.
//
// - 읽을 때 key 하나씩 판정한다. 모르는 key와 틀린 값은 그 key만 무시(기본값)하고 나머지는
//   적용한다. log에는 key와 reason만 남긴다.
// - 쓸 때는 쓰기 직전에 파일을 다시 읽고(못 읽으면 unavailable) 그 raw object에서 시작해
//   바꾼 key만 덮는다. 무시한 key는 사람이 직접 바꾸지 않는 한 파일에 남는다(선언을 지운
//   뒤에도 값이 사라지지 않게).
// - JSON이 깨진 파일은 쓰기가 덮지 않는다(unavailable). 사람이 고칠 때까지 그대로 둔다.
// - 쓰기는 같은 폴더의 임시 파일(0600)에 쓰고 rename한다. 실패하면 파일은 그대로다.
// - watch는 폴더를 보고 settings.json 이벤트만 timer로 묶어 한 번 다시 읽는다. 내용이
//   마지막으로 읽거나 쓴 것과 같으면 무시한다(자기 쓰기에 반응하지 않는다).
//
// folder 설정(`<data root>/<folder>/<id>.json`, 항목마다 file 하나)도 여기서 읽고 쓰고 지켜본다.
// - 항목의 key는 `<folder key>.<id>`다. 읽지 못한 file(이름, 크기, JSON, 모양)은 항목이 되지 않고
//   이유와 함께 unreadable에 남는다. 사람이 둔 file이라 고치거나 지우지 않는다.
// - 쓰기는 같은 folder의 임시 file에 쓰고 rename한다. unset은 그 file을 지운다.
import {
  type FSWatcher,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  watch,
  writeFileSync,
} from "node:fs";
import type { z } from "zod";
import { err, errorCode, ok, type Result } from "../../base/mod.ts";
import {
  SETTING_ENTRY_ID,
  SETTING_ENTRY_MAX_BYTES,
  SETTINGS_FILE_NAME,
  type SettingDeclaration,
  type SettingFolder,
  type SettingFolderDeclaration,
  type SettingNote,
  type SettingRejection,
  type SettingsView,
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
  notes: SettingNote[];
};

type Unreadable = SettingFolder["unreadable"];
type FolderState = { values: Record<string, unknown>; unreadable: Unreadable };
const ENTRY_SUFFIX = ".json";

export interface SettingsStore {
  readonly registry: SettingsRegistry;
  /** 사람이 고른 값. 기본값과 합치지 않는다. folder 설정의 항목은 들지 않는다. */
  chosen(): Readonly<Record<string, unknown>>;
  /** folder 설정의 항목(id → 값)과 읽지 못한 file. */
  folder(declaration: SettingFolderDeclaration): {
    readonly values: Readonly<Record<string, unknown>>;
    readonly unreadable: Unreadable;
  };
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
  /** 값이 달라진 key 목록을 알린다(Bus의 `StateChanged` `settings`, id는 key). */
  publish: (keys: string[]) => void;
  log: (message: string) => void;
  timer?: SettingsTimer;
}): SettingsStore {
  const { root, registry, publish, log } = options;
  const timer = options.timer ?? systemTimer;
  const path = `${root}/${SETTINGS_FILE_NAME}`;
  let chosen: Record<string, unknown> = {};
  // 파일의 모든 key. 파일이 깨졌으면 undefined이고 쓰기는 거절한다.
  let raw: Record<string, unknown> | undefined = {};
  let lastText: string | undefined;
  let watcher: FSWatcher | undefined;
  let pending: unknown;
  let closed = false;
  const folders = new Map<string, FolderState>();
  const folderWatchers = new Map<string, FSWatcher>();
  const folderPending = new Map<string, unknown>();
  const folderPath = (folder: SettingFolderDeclaration) =>
    `${root}/${folder.folder}`;
  const entryKey = (folder: SettingFolderDeclaration, id: string) =>
    `${folder.key}.${id}`;

  const readText = (): string => {
    try {
      return readFileSync(path, "utf8");
    } catch (error) {
      if (errorCode(error) === "ENOENT") return "";
      throw error;
    }
  };

  // 파일 내용을 raw object로 바꾼다. JSON이 깨졌거나 object가 아니면 undefined다.
  const parse = (text: string): Record<string, unknown> | undefined => {
    if (text.trim() === "") return {};
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      log("settings: settings.json is not valid JSON");
      return undefined;
    }
    if (typeof json !== "object" || json === null || Array.isArray(json)) {
      log("settings: settings.json is not an object");
      return undefined;
    }
    return json as Record<string, unknown>;
  };

  // raw에서 선언대로 통과한 key만 고른다.
  const choose = (
    raw: Record<string, unknown>,
  ): { chosen: Record<string, unknown>; rejected: SettingRejection[] } => {
    const rejected = registry.validate(
      Object.entries(raw).map(([key, value]) => ({
        key,
        action: "set" as const,
        value,
      })),
    );
    const skip = new Set(rejected.map(({ key }) => key));
    return {
      chosen: Object.fromEntries(
        Object.entries(raw).filter(([key]) => !skip.has(key)),
      ),
      rejected,
    };
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

  // 읽은 내용을 raw와 chosen에 반영한다. 파일이 깨졌으면 chosen은 이전 값 그대로다.
  const apply = (text: string): void => {
    if (text === lastText) return;
    const first = lastText === undefined;
    lastText = text;
    raw = parse(text);
    if (raw === undefined) return;
    const next = choose(raw);
    for (const { key, reason } of next.rejected) {
      log(`settings: ignored ${key} (${reason})`);
    }
    const changed = differing(chosen, next.chosen);
    chosen = next.chosen;
    if (!first && changed.length > 0) publish(changed);
  };

  // 시작할 때와 watch가 부른다. 못 읽으면 이전 값을 그대로 둔다.
  const reload = (): void => {
    try {
      apply(readText());
    } catch {
      log("settings: settings.json could not be read");
    }
  };
  reload();

  // folder의 file을 모두 읽는다. folder가 없으면 만든다(사람이 file을 둘 자리다). 읽지 못하면 undefined다.
  const readFolder = (
    folder: SettingFolderDeclaration,
  ): FolderState | undefined => {
    const dir = folderPath(folder);
    const values: Record<string, unknown> = {};
    const unreadable: Unreadable = [];
    let names: string[];
    try {
      mkdirSync(dir, { recursive: true });
      names = readdirSync(dir).sort();
    } catch {
      log(`settings: ${folder.folder} could not be read`);
      return undefined;
    }
    for (const file of names) {
      if (!file.endsWith(ENTRY_SUFFIX)) continue;
      const name = file.slice(0, -ENTRY_SUFFIX.length);
      if (!SETTING_ENTRY_ID.test(name)) {
        unreadable.push({ name, reason: "bad_id" });
        continue;
      }
      try {
        if (statSync(`${dir}/${file}`).size > SETTING_ENTRY_MAX_BYTES) {
          unreadable.push({ name, reason: "too_large" });
          continue;
        }
        const json: unknown = JSON.parse(
          readFileSync(`${dir}/${file}`, "utf8"),
        );
        if (folder.type.safeParse(json).success) values[name] = json;
        else unreadable.push({ name, reason: "bad_shape" });
      } catch {
        unreadable.push({ name, reason: "not_json" });
      }
    }
    return { values, unreadable };
  };

  // 다시 읽고 달라진 항목의 key를 돌려준다. 읽지 못한 file 목록이 달라지면 folder key도 든다.
  // folder를 읽지 못하면 undefined이고 지금 값을 둔다.
  const reloadFolder = (
    folder: SettingFolderDeclaration,
  ): string[] | undefined => {
    const before = folders.get(folder.key) ?? { values: {}, unreadable: [] };
    const next = readFolder(folder);
    if (next === undefined) return undefined;
    folders.set(folder.key, next);
    const changed = differing(before.values, next.values).map((id) =>
      entryKey(folder, id),
    );
    if (JSON.stringify(before.unreadable) !== JSON.stringify(next.unreadable)) {
      changed.push(folder.key);
    }
    return changed;
  };
  for (const folder of registry.folders()) reloadFolder(folder);

  const writeEntry = (
    folder: SettingFolderDeclaration,
    id: string,
    value: unknown,
  ): boolean => {
    const dir = folderPath(folder);
    // 임시 file은 `.json`으로 끝나지 않아 항목으로 읽히지 않는다.
    const temp = `${dir}/.${id}.${crypto.randomUUID()}.tmp`;
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, {
        flag: "wx",
      });
      renameSync(temp, `${dir}/${id}${ENTRY_SUFFIX}`);
      return true;
    } catch {
      try {
        rmSync(temp);
      } catch {
        // 임시 파일이 없으면 지울 것이 없다.
      }
      return false;
    }
  };

  const viewOf = (
    nextChosen: Record<string, unknown>,
    nextFolders: ReadonlyMap<string, Record<string, unknown>>,
  ): SettingsView => ({
    get<S extends z.ZodType>(
      setting: SettingDeclaration<S>,
    ): z.output<S> | undefined {
      const picked = nextChosen[setting.key] ?? setting.default;
      return picked === undefined ? undefined : setting.type.parse(picked);
    },
    entries: (folder) => nextFolders.get(folder.key) ?? {},
  });

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
    folder: (declaration) =>
      folders.get(declaration.key) ?? { values: {}, unreadable: [] },
    update(changes) {
      const rejected = registry.validate(changes);
      if (rejected.length > 0) return ok({ changed: [], rejected, notes: [] });
      // watch debounce 안의 손 편집이나 읽기 실패로 raw가 낡았을 수 있다. 쓰기 직전에 다시 읽는다.
      try {
        apply(readText());
      } catch {
        return err({
          code: "unavailable",
          message: "settings.json could not be read",
        });
      }
      if (raw === undefined) {
        return err({
          code: "unavailable",
          message: "settings.json is not valid JSON; fix it first",
        });
      }
      const nextRaw = { ...raw };
      // 항목 변경이 닿는 folder는 손으로 둔 file을 놓치지 않게 다시 읽고 그 위에 변경을 얹는다.
      const stale: string[] = [];
      const nextFolders = new Map<string, Record<string, unknown>>();
      const entryChanges: {
        folder: SettingFolderDeclaration;
        id: string;
        key: string;
        change: SettingChange;
      }[] = [];
      for (const change of changes) {
        const ref = registry.entry(change.key);
        if (ref === undefined) {
          if (change.action === "set") nextRaw[change.key] = change.value;
          else delete nextRaw[change.key];
          continue;
        }
        if (!nextFolders.has(ref.folder.key)) {
          const reloaded = reloadFolder(ref.folder);
          // 지금 file을 모르는 채로 쓰면 보지 못한 file을 덮을 수 있다.
          if (reloaded === undefined) {
            return err({
              code: "unavailable",
              message: `${ref.folder.folder} could not be read`,
            });
          }
          stale.push(...reloaded);
          nextFolders.set(ref.folder.key, {
            ...folders.get(ref.folder.key)?.values,
          });
        }
        const values = nextFolders.get(ref.folder.key)!;
        if (change.action === "set") values[ref.id] = change.value;
        else delete values[ref.id];
        entryChanges.push({ ...ref, key: change.key, change });
      }
      if (stale.length > 0) publish(stale);
      for (const folder of registry.folders()) {
        if (!nextFolders.has(folder.key)) {
          nextFolders.set(folder.key, folders.get(folder.key)?.values ?? {});
        }
      }
      // 사람이 둔 file을 덮지 않는다: 그 id의 file이 있는데 읽지 못했거나(JSON이 깨졌다 등), 대소문자만 다른 이름의
      // file이 있으면(대소문자를 가리지 않는 file system에서 같은 file이다) 쓰지 않는다.
      const refused: SettingRejection[] = [];
      for (const { folder, id, key, change } of entryChanges) {
        if (change.action !== "set") continue;
        const blocking = folders
          .get(folder.key)
          ?.unreadable.find((one) => one.name.toLowerCase() === id);
        if (blocking !== undefined) {
          refused.push({
            key,
            reason: "invalid_value",
            message: `${folder.folder}/${blocking.name}.json already exists and could not be read (${blocking.reason}); the person must fix or remove that file first`,
          });
        } else if (
          Buffer.byteLength(JSON.stringify(change.value, null, 2)) >
          SETTING_ENTRY_MAX_BYTES
        ) {
          refused.push({
            key,
            reason: "out_of_range",
            message: `an entry is at most ${SETTING_ENTRY_MAX_BYTES / 1024} KB`,
          });
        }
      }
      if (refused.length > 0) {
        return ok({ changed: [], rejected: refused, notes: [] });
      }
      const checked = registry.check(
        changes,
        viewOf(choose(nextRaw).chosen, nextFolders),
      );
      if (checked.rejected.length > 0) {
        return ok({ changed: [], rejected: checked.rejected, notes: [] });
      }
      // 쓰는 순서는 항목 쓰기, settings.json, 항목 지우기다. 중간에 실패해도 settings.json이 없는 항목을
      // 가리키지 않게 하려는 것이다(새 theme을 고르는 값은 그 theme이 쓰인 뒤에, theme은 그것을 고른 값이 바뀐 뒤에 지운다).
      const changed: string[] = [];
      const failed = (message: string) => {
        if (changed.length > 0) publish(changed.sort());
        return err({ code: "unavailable" as const, message });
      };
      const applyEntry = ({
        folder,
        id,
        key,
        change,
      }: (typeof entryChanges)[number]): boolean => {
        const state = folders.get(folder.key) ?? { values: {}, unreadable: [] };
        const before = state.values[id];
        const values = { ...state.values };
        if (change.action === "set") {
          if (JSON.stringify(before) === JSON.stringify(change.value)) {
            return true;
          }
          if (!writeEntry(folder, id, change.value)) return false;
          values[id] = change.value;
        } else {
          if (before === undefined) return true;
          try {
            rmSync(`${folderPath(folder)}/${id}${ENTRY_SUFFIX}`, {
              force: true,
            });
          } catch {
            return false;
          }
          delete values[id];
        }
        folders.set(folder.key, { ...state, values });
        changed.push(key);
        return true;
      };
      for (const one of entryChanges) {
        if (one.change.action === "set" && !applyEntry(one)) {
          return failed(
            `${one.folder.folder}/${one.id}.json could not be written`,
          );
        }
      }
      if (differing(raw, nextRaw).length > 0) {
        if (!write(nextRaw)) return failed("settings could not be written");
        raw = nextRaw;
        const next = choose(nextRaw).chosen;
        changed.push(...differing(chosen, next));
        chosen = next;
      }
      for (const one of entryChanges) {
        if (one.change.action === "unset" && !applyEntry(one)) {
          return failed(
            `${one.folder.folder}/${one.id}.json could not be removed`,
          );
        }
      }
      changed.sort();
      if (changed.length > 0) publish(changed);
      return ok({ changed, rejected: [], notes: checked.notes });
    },
    watch() {
      if (watcher !== undefined || closed) return;
      const reloadFolderSoon = (folder: SettingFolderDeclaration) => {
        const waiting = folderPending.get(folder.key);
        if (waiting !== undefined) timer.clear(waiting);
        folderPending.set(
          folder.key,
          timer.set(() => {
            folderPending.delete(folder.key);
            const changed = reloadFolder(folder);
            if (changed !== undefined && changed.length > 0) publish(changed);
          }, WATCH_DEBOUNCE_MS),
        );
      };
      // folder를 지웠다 다시 만들면 옛 감시는 신호를 주지 않는다. root의 신호로 다시 건다.
      const watchFolder = (folder: SettingFolderDeclaration) => {
        folderWatchers.get(folder.key)?.close();
        folderWatchers.delete(folder.key);
        try {
          mkdirSync(folderPath(folder), { recursive: true });
          const events = watch(folderPath(folder), { recursive: false }, () =>
            reloadFolderSoon(folder),
          );
          events.on("error", () => events.close());
          folderWatchers.set(folder.key, events);
        } catch {
          log(`settings: ${folder.folder} could not be watched`);
        }
      };
      let events: FSWatcher;
      try {
        events = watch(root, { recursive: false }, (_kind, filename) => {
          const folder = registry
            .folders()
            .find((one) => one.folder === filename);
          if (folder !== undefined) {
            watchFolder(folder);
            reloadFolderSoon(folder);
            return;
          }
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
      for (const folder of registry.folders()) watchFolder(folder);
    },
    close() {
      closed = true;
      if (pending !== undefined) timer.clear(pending);
      pending = undefined;
      watcher?.close();
      watcher = undefined;
      for (const waiting of folderPending.values()) timer.clear(waiting);
      folderPending.clear();
      for (const one of folderWatchers.values()) one.close();
      folderWatchers.clear();
    },
  };
}
