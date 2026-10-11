import type { Sql } from "../../../contracts/platform/mod.ts";
import type { CheckViolation } from "../check/types.ts";
import type { IndexedEntity, IndexedFile, IndexState } from "./types.ts";

export type IndexStore = {
  sql: Sql;
  // handle 안의 쓰기는 한 SQLite transaction이다. throw하면 되돌린다.
  transaction<T>(handle: (sql: Sql) => T): T;
  close(): void;
};

// derived sqlite를 연다(`:memory:` 가능). 없으면 만들고 indexSchemaSteps를 적용한다.
// WAL, synchronous=FULL. context worker가 유일한 writer다.
export function openIndexStore(_path: string): IndexStore {
  throw new Error("not implemented");
}

// 개체는 추출 순서(ord), 위반은 path·kind·rule(null은 "")·section(null이 먼저) 순서로 읽는다.
export function readEntities(_sql: Sql, _context: string): IndexedEntity[] {
  throw new Error("not implemented");
}

export function readViolations(_sql: Sql, _context: string): CheckViolation[] {
  throw new Error("not implemented");
}

// path의 code unit 순
export function readIndexedFiles(_sql: Sql, _context: string): IndexedFile[] {
  throw new Error("not implemented");
}

// scan한 적이 없으면 undefined
export function readIndexState(
  _sql: Sql,
  _context: string,
): IndexState | undefined {
  throw new Error("not implemented");
}
