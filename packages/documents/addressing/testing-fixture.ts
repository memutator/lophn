import { DatabaseSync } from "node:sqlite";
import type { Result } from "../../base/mod.ts";
import type { Sql, SqlRow, Tx } from "../../protocol/platform/mod.ts";
import { addressingSchemaSteps } from "./schema.ts";

// core harness가 생기기 전, public Sql contract만 주입하는 leaf 테스트 fixture다.
export function reservationFixture() {
  const directory = Deno.makeTempDirSync({
    dir: Deno.env.get("TMPDIR"),
    prefix: "addressing-test-",
  });
  const path = `${directory}/ledger.sqlite`;
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA recursive_triggers=OFF;");
  for (const step of addressingSchemaSteps) db.exec(step.sql);
  const sql: Sql = {
    run: (statement, params) => db.prepare(statement).run(...params),
    get: (statement, params) =>
      db.prepare(statement).get(...params) as SqlRow | undefined,
    all: (statement, params) =>
      db.prepare(statement).all(...params) as SqlRow[],
  };
  return {
    db,
    sql,
    path,
    transaction<T>(handle: (tx: Pick<Tx, "sql">) => Result<T>): Result<T> {
      let active = true;
      const guard = () => {
        if (!active) throw new Error("transaction is closed");
      };
      const guarded: Sql = {
        run(statement, params) {
          guard();
          return sql.run(statement, params);
        },
        get(statement, params) {
          guard();
          return sql.get(statement, params);
        },
        all(statement, params) {
          guard();
          return sql.all(statement, params);
        },
      };
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = handle({ sql: guarded });
        db.exec(result.ok ? "COMMIT" : "ROLLBACK");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      } finally {
        active = false;
      }
    },
    close() {
      db.close();
      Deno.removeSync(directory, { recursive: true });
    },
  };
}
