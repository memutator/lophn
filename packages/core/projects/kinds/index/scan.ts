import { type Clock, err, ok, type Result } from "../../../../base/mod.ts";
import {
  type Kind,
  type KindsStatus,
  type KindWatchFolder,
  kindWatchFolders,
} from "../../../../protocol/projects/mod.ts";
import { applyKindsFile, kindsOfText } from "../check/kinds-file.ts";
import { checkItems } from "../check/fields.ts";
import { kindsFileViolation, sortViolations } from "../check/violations.ts";
import { kindMatcher } from "../extract/glob.ts";
import {
  type Extracted,
  extractItems,
  type ProjectFiles,
} from "../extract/items.ts";
import { sha256Text } from "./hash.ts";
import {
  type IndexedFile,
  type IndexStore,
  readApplied,
  readIndexedFiles,
  readState,
  replaceRows,
  writeApplied,
  writeState,
} from "./store.ts";

// 훑을 domain 파일의 보기. 글을 읽지 않는 stat이 더해진다.
export type IndexFiles = ProjectFiles & {
  stat(path: string): { size: number; mtime_ms: number } | null;
};

// 직전 scan이 끝난 뒤 이 시간 안이면 stat도 하지 않는다(초기 구현값).
const FRESH_MS = 2_000;

export type ScanInput = {
  domain: string;
  kinds_file: string;
  // 훑을 폴더 아래 파일의 보기. 폴더 밖은 담지 않는다.
  open(folders: KindWatchFolder[]): IndexFiles;
  clock: Clock;
  // 직전 scan 뒤 2초 안이어도 다시 훑는다.
  force?: boolean;
};

// 훑는 중 파일 쪽이 던진 오류. 이것만 `unavailable`로 바꾸고 다른 오류는 그대로 던진다.
class FileFailure extends Error {}

function guarded<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    throw new FileFailure(
      error instanceof Error ? error.message : String(error),
    );
  }
}

function readKindsText(path: string): string | null {
  try {
    return Deno.readTextFileSync(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}

// domain 하나의 index를 kinds 파일 글과 파일 stat으로 갱신한다.
//
// 1. 직전 scan이 2초 안이면(force가 아니면) 아무것도 보지 않는다.
// 2. kinds 파일 글의 hash가 직전과 다르면 검사해 쓸 kind를 다시 정한다(틀리면 앞의 맞던 것을 그대로 쓴다).
// 3. 쓸 kind의 glob에 맞는 파일의 (size, mtime_ms)와 kinds 파일 hash가 직전과 같으면 다시 추출하지 않고
//    scanned_ms만 갱신한다.
// 4. 다르면 그 domain 전체를 다시 추출·검사해 한 transaction으로 바꾼다. 파일 쪽이 던지면 `unavailable`이고
//    store를 건드리지 않는다.
export function scanProject(
  store: IndexStore,
  input: ScanInput,
): Result<{ changed: boolean }> {
  try {
    return ok(scan(store, input));
  } catch (error) {
    if (error instanceof FileFailure) {
      return err({
        code: "unavailable",
        message: `domain files cannot be scanned: ${error.message}`,
      });
    }
    throw error;
  }
}

function scan(store: IndexStore, input: ScanInput): { changed: boolean } {
  const { domain, clock } = input;
  const state = readState(store.sql, domain);
  if (
    !input.force && state !== undefined &&
    clock.nowMs() - state.scanned_ms < FRESH_MS
  ) {
    return { changed: false };
  }

  const text = guarded(() => readKindsText(input.kinds_file));
  const hash = text === null ? "none" : sha256Text(text);
  const applied = readApplied(store.sql, domain);
  const sameKinds = state !== undefined && state.kinds_hash === hash;

  let status: KindsStatus;
  let kinds: Kind[] | null;
  // undefined는 그대로 둔다는 뜻이다.
  let nextApplied: { hash: string; text: string } | null | undefined;
  if (sameKinds) {
    status = state.status;
    kinds = status.using === "none" || applied === undefined
      ? null
      : kindsOfText(applied.text);
  } else {
    const previous = applied === undefined
      ? null
      : { hash: applied.hash, kinds: kindsOfText(applied.text) };
    const application = applyKindsFile({
      text,
      previous: previous?.kinds
        ? { hash: previous.hash, kinds: previous.kinds }
        : null,
      files: (candidate) => {
        const files = guarded(() => input.open(kindWatchFolders(candidate)));
        const matching = kindMatcher(candidate);
        return guarded(() => files.paths()).filter((path) =>
          matching(path).length > 0
        );
      },
    });
    status = {
      file: input.kinds_file,
      state: application.state,
      using: application.using,
      errors: application.errors,
      applied_hash: application.hash,
    };
    kinds = application.kinds;
    nextApplied = application.state === "valid"
      ? { hash: application.hash!, text: text! }
      : application.state === "none"
      ? null
      : undefined;
  }

  const stats = new Map<string, { size: number; mtime_ms: number }>();
  let files: IndexFiles | undefined;
  if (kinds !== null) {
    const opened = guarded(() => input.open(kindWatchFolders(kinds)));
    files = opened;
    const matching = kindMatcher(kinds);
    for (const path of guarded(() => opened.paths())) {
      if (matching(path).length === 0) continue;
      const stat = guarded(() => opened.stat(path));
      if (stat !== null) stats.set(path, stat);
    }
  }

  const indexed = readIndexedFiles(store.sql, domain);
  const unchanged = state !== undefined && sameKinds &&
    indexed.length === stats.size &&
    indexed.every((file) => {
      const stat = stats.get(file.path);
      return stat !== undefined && stat.size === file.size &&
        stat.mtime_ms === file.mtime_ms;
    });
  if (unchanged) {
    store.transaction((sql) =>
      writeState(sql, domain, { ...state, scanned_ms: clock.nowMs() })
    );
    return { changed: false };
  }

  const extracted: Extracted = kinds === null || files === undefined
    ? { items: [], files: new Map(), violations: [] }
    : extractItems(kinds, {
      paths: () => [...stats.keys()],
      read: (path) => guarded(() => files.read(path)),
    });
  const violations = sortViolations([
    ...status.errors.map(kindsFileViolation),
    ...extracted.violations,
    ...(kinds === null ? [] : checkItems(kinds, extracted.items)),
  ]);
  const rows: IndexedFile[] = [...stats].map(([path, stat]) => ({
    path,
    ...stat,
    ...(extracted.files.get(path) ?? { kind: null, status: "ok" as const }),
  }));
  store.transaction((sql) => {
    replaceRows(sql, domain, {
      files: rows,
      items: extracted.items,
      violations,
    });
    if (nextApplied !== undefined) writeApplied(sql, domain, nextApplied);
    writeState(sql, domain, {
      kinds_hash: hash,
      scanned_ms: clock.nowMs(),
      status,
    });
  });
  return { changed: true };
}
