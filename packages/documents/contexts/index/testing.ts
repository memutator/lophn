// index 시험이 함께 쓰는 fake. 제품 코드는 import하지 않는다.
import { manualClock } from "../../../base/mod.ts";
import type { BundleContent } from "../../../contracts/documents/mod.ts";
import type { Sql } from "../../../contracts/platform/mod.ts";
import { loadContract, loadFixture } from "../extract/testing.ts";
import type { ProjectFiles } from "../extract/types.ts";
import type { IndexStore } from "./store.ts";
import type { IndexFiles, ScanInput } from "./types.ts";

export const T0 = Date.UTC(2026, 9, 12, 0, 0, 0);
export const CONTEXT = "ctx_00000000000000000000000001";
export const BUNDLE_HASH = "a".repeat(64);
export const OTHER_BUNDLE_HASH = "b".repeat(64);
const MTIME = 1_700_000_000_000;

export type MemoryFiles = IndexFiles & {
  // 호출 기록(시험이 "글을 읽지 않았다"를 확인한다)
  readonly reads: string[];
  readonly stats: string[];
  // 글을 바꾼다(size와 mtime도 바뀐다)
  write(path: string, text: string): void;
  // 글은 그대로 두고 mtime만 바꾼다
  touch(path: string): void;
  remove(path: string): void;
};

// base 파일(기본은 eval-project fixture)을 메모리에 올린다. 모든 파일의 mtime은 같고 결정적이다.
export function memoryFiles(
  base: ProjectFiles = loadFixture("eval-project"),
): MemoryFiles {
  const files = new Map<string, { text: string; mtime_ms: number }>();
  for (const path of base.paths()) {
    files.set(path, { text: base.read(path) ?? "", mtime_ms: MTIME });
  }
  let clock = MTIME;
  const reads: string[] = [];
  const stats: string[] = [];
  return {
    reads,
    stats,
    paths: () => [...files.keys()].sort(),
    read(path) {
      reads.push(path);
      return files.get(path)?.text ?? null;
    },
    stat(path) {
      stats.push(path);
      const file = files.get(path);
      return file === undefined ? null : {
        size: new TextEncoder().encode(file.text).length,
        mtime_ms: file.mtime_ms,
      };
    },
    write(path, text) {
      files.set(path, { text, mtime_ms: clock += 1000 });
    },
    touch(path) {
      const file = files.get(path);
      if (file !== undefined) file.mtime_ms = clock += 1000;
    },
    remove(path) {
      files.delete(path);
    },
  };
}

export function fixtureBundle(): BundleContent {
  return loadContract("eval-project");
}

// 파일 보기를 바꿔 끼우며 scan 입력을 만든다. clock은 호출마다 새 manual clock이다.
export function scanInput(
  files: IndexFiles,
  overrides: Partial<ScanInput> = {},
): ScanInput {
  return {
    context: CONTEXT,
    bundle: fixtureBundle(),
    bundle_hash: BUNDLE_HASH,
    files,
    clock: manualClock(T0),
    recorded_count: 0,
    ...overrides,
  };
}

// store의 모든 SQL 문장을 기록한다(쓰기 여부를 확인하는 시험용).
export function recordStatements(
  store: IndexStore,
): { store: IndexStore; statements: string[] } {
  const statements: string[] = [];
  const wrap = (sql: Sql): Sql => ({
    run(text, params) {
      statements.push(text);
      return sql.run(text, params);
    },
    get: (text, params) => sql.get(text, params),
    all: (text, params) => sql.all(text, params),
  });
  return {
    statements,
    store: {
      sql: wrap(store.sql),
      transaction: (handle) => store.transaction((sql) => handle(wrap(sql))),
      close: () => store.close(),
    },
  };
}

// index_files·index_entities·index_violations에 쓰는 문장인가.
export const writesIndexRows = (statement: string): boolean =>
  /^\s*(INSERT|UPDATE|DELETE|REPLACE)[\s\S]*\bindex_(files|entities|violations)\b/i
    .test(statement);
