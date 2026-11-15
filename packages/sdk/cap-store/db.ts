// 앱이 쓰는 SQLite의 모양이다. `node:sqlite`의 DB 연결과 폰 host가 주는 driver가 같이 채운다.
// SDK가 정한 이 모양 밖의 method(`backup`, `loadExtension` 등)는 앱이 쓰지 못한다.

export type StoreValue = null | number | bigint | string | Uint8Array;

export type StoreStatement = {
  get(...params: StoreValue[]): Record<string, unknown> | undefined;
  all(...params: StoreValue[]): Record<string, unknown>[];
  run(...params: StoreValue[]): {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  };
};

export type StoreDb = {
  exec(sql: string): void;
  prepare(sql: string): StoreStatement;
};

// 바깥에 열린 transaction이 있어도 되도록 SAVEPOINT로 묶는다(컴퓨터 runtime과 폰 host는 호출 하나를 이미 transaction
// 안에서 돌린다). 이름이 같아도 rollback to와 release는 가장 안쪽 것을 잡으므로 겹쳐도 된다.
export function inSavepoint<T>(db: StoreDb, work: () => T): T {
  db.exec("savepoint lophn_sp");
  try {
    const result = work();
    db.exec("release lophn_sp");
    return result;
  } catch (error) {
    try {
      db.exec("rollback to lophn_sp");
      db.exec("release lophn_sp");
    } catch {
      // 이미 끝난 transaction이다.
    }
    throw error;
  }
}
