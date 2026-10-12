import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { err, ok, type Result } from "../../../../base/mod.ts";
import type {
  ReadSnapshot,
  Sql,
  SqlRow,
  Tx,
} from "../../../../protocol/platform/mod.ts";
import { TargetAuthorization } from "../../../../protocol/platform/mod.ts";
import { schemaSql, strictTargetAuthorizer } from "../mod.ts";

// T59 writer 전에는 contract Sql과 rollback 경계만 probe한다.
export function fileLedger() {
  const root = fileURLToPath(new URL("./", import.meta.url));
  const directory = Deno.makeTempDirSync({
    dir: root,
    prefix: "ledger-probe-",
  });
  const db = new DatabaseSync(directory + "/ledger.sqlite");
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA recursive_triggers=ON; PRAGMA foreign_keys=ON;",
  );
  db.exec(schemaSql());
  db.exec(
    "create table probe_events(seq integer primary key, subject text, payload text); create table probe_refs(binding text primary key, hash text);",
  );
  const prepare = (statement: string) => {
    const prepared = db.prepare(statement);
    prepared.setReadBigInts(true);
    return prepared;
  };
  const sql: Sql = {
    run: (statement, params) => prepare(statement).run(...params),
    get: (statement, params) =>
      prepare(statement).get(...params) as SqlRow | undefined,
    all: (statement, params) => prepare(statement).all(...params) as SqlRow[],
  };
  let failBlob = false;
  const tx: Tx = {
    sql,
    now: () => "2026-10-04T00:00:00.000Z",
    newId: () => "vrf_01ary8h2z3n4p5q6r7s8t9v0wx",
    port<T>(key: { readonly name: string }): T {
      if (key === TargetAuthorization) return strictTargetAuthorizer() as T;
      throw new Error("no port");
    },
    emit(_event, subject, payload) {
      const seq = String(
        sql.get(
          "select coalesce(max(seq), 0) + 1 as seq from probe_events",
          [],
        )!.seq,
      );
      sql.run("insert into probe_events values (?, ?, ?)", [
        BigInt(seq),
        subject,
        JSON.stringify(payload),
      ]);
      return seq;
    },
    registerBlobRef(reference) {
      if (failBlob) {
        return err({ code: "forbidden", message: "blob preparation rejected" });
      }
      const hash = reference.source.kind === "prepared"
        ? reference.source.blob.hash
        : reference.source.reference.hash;
      sql.run("insert into probe_refs values (?, ?)", [
        JSON.stringify([
          reference.owner_kind,
          reference.owner_key,
          reference.field,
        ]),
        hash,
      ]);
      return ok({
        owner_kind: reference.owner_kind,
        owner_key: reference.owner_key,
        field: reference.field,
        hash,
        registered_seq: reference.registered_seq,
      });
    },
    advanceSubscriberCursor: () => ok(undefined),
    useApproval: () => {
      throw new Error("no approval");
    },
    call: () => {
      throw new Error("no dispatch");
    },
  };
  function transaction<T>(run: (tx: Tx) => Result<T>): Result<T> {
    db.exec("begin immediate");
    try {
      const result = run(tx);
      db.exec(result.ok ? "commit" : "rollback");
      return result;
    } catch (error) {
      db.exec("rollback");
      throw error;
    }
  }
  const snapshot = (as_of_seq = "0"): ReadSnapshot => ({
    sql,
    as_of_seq,
    port: tx.port,
  });
  return {
    db,
    sql,
    tx,
    transaction,
    snapshot,
    failBlobs: (fail: boolean) => {
      failBlob = fail;
    },
    close() {
      db.close();
      Deno.removeSync(directory, { recursive: true });
    },
  };
}
