// sync core가 SQLite에 닿는 유일한 길. 컴퓨터는 node:sqlite(`node-db.ts`), 폰은 native module이 이 꼴을 채운다.
//
// 값 규칙(두 driver가 같아야 한다):
// - params: number는 REAL로, bigint는 INTEGER로, Uint8Array는 BLOB으로 bind한다.
// - all(): TEXT는 string, BLOB은 Uint8Array, REAL은 number, NULL은 null. INTEGER는 number나 bigint 어느 쪽이어도
//   된다. sync core는 INTEGER를 늘 `cast(... as text)`로 읽어 driver의 정수 처리에 기대지 않는다.
// - session(): `sqlite_`와 `lophn_`로 시작하지 않는 표 전부에 거는 SQLite session.

export type SqlParam = null | number | bigint | string | Uint8Array;

export type SyncSession = {
  changeset(): Uint8Array;
  close(): void;
};

export type SyncDb = {
  exec(sql: string): void;
  all(sql: string, params?: SqlParam[]): Record<string, unknown>[];
  run(sql: string, params?: SqlParam[]): void;
  session(): SyncSession;
};
