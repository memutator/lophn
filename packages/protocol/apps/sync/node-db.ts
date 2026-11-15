// node:sqlite `DatabaseSync` 위의 SyncDb(컴퓨터 app runtime과 test). 폰이 import하지 않게 따로 둔다.
// node:sqlite를 import하지 않고 꼴만 받는다: protocol은 node: module을 import하지 않는다.
import type { SqlParam, SyncDb } from "./db.ts";

type NodeStatement = {
  all(...params: SqlParam[]): unknown[];
  run(...params: SqlParam[]): unknown;
  setReadBigInts(enabled: boolean): unknown;
};

type NodeSession = { changeset(): Uint8Array; close(): void };

export type NodeDatabase = {
  exec(sql: string): void;
  prepare(sql: string): NodeStatement;
  createSession(options?: { table?: string }): NodeSession;
};

export function nodeSyncDb(db: NodeDatabase): SyncDb {
  const statements = new Map<string, NodeStatement>();
  const prepared = (sql: string): NodeStatement => {
    let statement = statements.get(sql);
    if (statement === undefined) {
      statement = db.prepare(sql);
      // 63 bit HLC와 64-bit 끝값이 number로 오면 잘린다.
      statement.setReadBigInts(true);
      statements.set(sql, statement);
    }
    return statement;
  };
  return {
    exec: (sql) => db.exec(sql),
    all: (sql, params = []) =>
      prepared(sql).all(...params) as Record<string, unknown>[],
    run: (sql, params = []) => void prepared(sql).run(...params),
    session() {
      // 표마다 session을 걸어 숨은 표를 뺀다. 표마다 뜬 changeset을 이어도 한 changeset이다.
      const sessions = db
        .prepare(
          "select name from sqlite_master where type = 'table' and name not glob 'sqlite_*' and name not glob 'lophn_*'",
        )
        .all()
        .map((row) =>
          db.createSession({ table: String((row as { name: unknown }).name) }),
        );
      return {
        changeset() {
          const parts = sessions.map((session) => session.changeset());
          const out = new Uint8Array(
            parts.reduce((sum, part) => sum + part.length, 0),
          );
          let offset = 0;
          for (const part of parts) {
            out.set(part, offset);
            offset += part.length;
          }
          return out;
        },
        close() {
          for (const session of sessions) session.close();
        },
      };
    },
  };
}
