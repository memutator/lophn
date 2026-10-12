import { z } from "zod";
import { err, ok, type Result } from "../../base/mod.ts";
import {
  definePort,
  defineRead,
  type ReadSnapshot,
  withReadCommon,
} from "../../protocol/platform/mod.ts";
import { KNOWN_SECRETS } from "./known-secrets.ts";
import {
  executeRead,
  type ReaderRegistration,
  ReaderStorageError,
} from "./reads.ts";
import {
  createReaderConnection,
  type ReaderConnection,
  readerStorage,
} from "./reader-connection.ts";
import { DatabaseSync } from "node:sqlite";
import type { RequestContext } from "../../protocol/platform/mod.ts";

export function storageRegression(ctx: RequestContext): Result<unknown>[] {
  const results: Result<unknown>[] = [];
  for (const errcode of [5, 6, 8, 10, 11, 13, 14, 15, 26, 10 | (3 << 8)]) {
    let failRead = true;
    let transaction = false;
    const connection: ReaderConnection = {
      sql: {
        get() {
          return readerStorage(() => {
            if (failRead) {
              throw Object.assign(new Error("private storage path"), {
                errcode,
              });
            }
            return { value: "safe" };
          });
        },
        all() {
          return [];
        },
      },
      begin() {
        transaction = true;
        return "1";
      },
      end() {
        transaction = false;
      },
      close() {},
    };
    const definition = createReaderRegistration().reads[0];
    results.push(
      executeRead(connection, definition, new Map(), ctx, { action: "unsafe" }),
    );
    if (transaction) throw new Error("snapshot was not closed");
    failRead = false;
    results.push(
      executeRead(connection, definition, new Map(), ctx, { action: "unsafe" }),
    );
    connection.end = () => {
      throw new Error("private rollback path");
    };
    results.push(
      executeRead(connection, definition, new Map(), ctx, { action: "unsafe" }),
    );
    failRead = true;
    results.push(
      executeRead(connection, definition, new Map(), ctx, { action: "unsafe" }),
    );
  }
  for (const closeFails of [false, true]) {
    const db = new DatabaseSync(":memory:");
    db.exec(
      "create table events(seq integer primary key); insert into events values(1)",
    );
    const close = db.close.bind(db);
    let closes = 0;
    const exec = db.exec.bind(db);
    db.exec = (sql) => {
      if (sql === "rollback") throw new Error("private rollback failure");
      exec(sql);
    };
    db.close = () => {
      closes++;
      // close 실패는 실제 native handle을 열어 둔다. adapter guard가 막아야 한다.
      if (closeFails) throw new Error("private close failure");
      close();
    };
    try {
      const connection = createReaderConnection(db);
      const definition = createReaderRegistration().reads[0];
      results.push(
        executeRead(connection, definition, new Map(), ctx, { action: "rows" }),
      );
      if (closes !== 1) throw new Error("failed snapshot was not closed");
      if (db.isOpen !== closeFails) throw new Error("native close differs");
      results.push(
        executeRead(connection, definition, new Map(), ctx, { action: "rows" }),
      );
      for (
        const operation of [
          () => connection.begin(),
          () => connection.sql.get("select 1", []),
          () => connection.sql.all("select 1", []),
        ]
      ) {
        try {
          operation();
          throw new Error("unusable SQL ran");
        } catch (error) {
          if (!(error instanceof ReaderStorageError)) throw error;
          if (error.message.includes("private")) {
            throw new Error("unsafe error");
          }
        }
      }
      connection.end();
      connection.close();
      connection.close();
      if (closes !== 1) throw new Error("cleanup repeated close");
    } finally {
      // 남아 있는 native handle은 테스트만 가진 원래 close로 정리한다.
      if (db.isOpen) close();
    }
  }
  return results;
}

export const fixtureRead = defineRead({
  resource: "fixture",
  method: "read",
  name: "Reader fixture",
  input: z.object({
    action: z.enum([
      "probe",
      "snapshot",
      "page",
      "page_meta",
      "sql_limit",
      "rows",
      "bytes",
      "slow",
      "invalid_output",
      "failure",
      "hold",
      "expired",
      "port",
      "known",
      "unsafe",
      "large_seq",
      "invalid_result",
      "comment",
    ]),
    count: z.number().int().nonnegative().optional(),
    query: z.string().optional(),
    gate: z.custom<SharedArrayBuffer>((value) =>
      value instanceof SharedArrayBuffer
    ).optional(),
  }),
  output: withReadCommon(z.object({ data: z.unknown() })),
  actors: ["user"],
  errors: ["invalid_input", "internal"],
});

export function createReaderRegistration(): ReaderRegistration {
  const workerId = crypto.randomUUID();
  const fixturePort = definePort<string>("fixture");
  let retained: ReadSnapshot | undefined;
  return {
    ports: new Map([[fixturePort, workerId]]),
    reads: [{
      route: fixtureRead,
      handle(snapshot, _ctx, input) {
        const { action, count = 0, gate, query } = fixtureRead.input.parse(
          input,
        );
        let data: unknown;
        let nextCursor: string | null = null;
        if (action === "probe") {
          let writeBlocked = false;
          try {
            snapshot.sql.get(
              "insert into items(value) values ('forbidden') returning value",
              [],
            );
          } catch {
            writeBlocked = true;
          }
          data = {
            workerId,
            writeBlocked,
            queryOnly: String(
              snapshot.sql.get("select * from pragma_query_only", [])
                ?.query_only,
            ),
            transactionBlocked: false,
          };
          try {
            snapshot.sql.get("commit", []);
          } catch {
            (data as Record<string, unknown>).transactionBlocked = true;
          }
        } else if (action === "snapshot") {
          const first = snapshot.sql.get(
            "select value from items where id=1",
            [],
          )?.value;
          if (gate) {
            const signal = new Int32Array(gate);
            Atomics.store(signal, 0, 1);
            Atomics.notify(signal, 0);
            Atomics.wait(signal, 1, 0, 1500);
          }
          const second = snapshot.sql.get(
            "select value from items where id=1",
            [],
          )?.value;
          const head = snapshot.sql.get(
            "select max(seq) as seq from events",
            [],
          )?.seq;
          data = { first, second, head: String(head) };
        } else if (
          action === "page" || action === "page_meta" || action === "sql_limit"
        ) {
          if (action === "page_meta") {
            snapshot.sql.get("select count(*) as count from items", []);
          }
          data = snapshot.sql.all(
            "select value from items order by id limit ?",
            [count],
          );
          if (action !== "sql_limit") nextCursor = "next";
        } else if (action === "rows") {
          data = Array.from({ length: count }, () => ({ value: "row" }));
        } else if (action === "bytes") {
          data = "é".repeat(count);
        } else if (action === "slow") {
          if (gate) Atomics.store(new Int32Array(gate), 0, 1);
          // hardware 속도와 상관없이 종료되지 않는 native SQL을 parent가 격리한다.
          data = snapshot.sql.get(
            "with recursive n(x) as (values(0) union all select x+1 from n) select count(*) from n",
            [],
          );
        } else if (action === "hold") {
          if (gate) {
            const signal = new Int32Array(gate);
            Atomics.store(signal, 0, 1);
            Atomics.wait(signal, 1, 0, 1500);
          }
          data = workerId;
        } else if (action === "expired") {
          let blocked = false;
          try {
            retained?.sql.get("select value from items where id=1", []);
          } catch {
            blocked = true;
          }
          retained = snapshot;
          data = { blocked };
        } else if (action === "port") {
          data = snapshot.port(fixturePort);
        } else if (action === "known") {
          // 알려진 secret 일치 검사. 값이 아니라 일치 위치만 낸다.
          const known = snapshot.port(KNOWN_SECRETS);
          data = {
            workerId,
            ready: known.ready,
            match: known.match(query ?? "") ?? null,
          };
        } else if (action === "unsafe") {
          data = snapshot.sql.get(query ?? "commit", []);
        } else if (action === "large_seq") {
          data = String(
            snapshot.sql.get("select max(seq) as seq from events", [])?.seq,
          );
        } else if (action === "comment") {
          data = snapshot.sql.all("select value from items -- comment", []);
        } else if (action === "invalid_result") {
          if (count === 10) {
            return Promise.reject(
              new Error("private async handler failure"),
            ) as unknown as Result<never>;
          }
          const invalid: unknown[] = [
            Promise.resolve(ok({ data: "wrong" })),
            { then() {} },
            null,
            { ok: "false" },
            { ok: true },
            { ok: false },
            { ok: true, value: { data: { fn() {} }, next_cursor: null } },
            { ok: false, error: { code: "custom", message: "wrong" } },
            { ok: false, error: { code: "internal", message: 1 } },
            {
              ok: false,
              error: {
                code: "internal",
                message: "wrong",
                details: { fn() {} },
              },
            },
          ];
          return invalid[count] as Result<never>;
        } else if (action === "failure") {
          return err({ code: "invalid_input", message: "fixture failure" });
        } else {
          return ok({ wrong: true });
        }
        return ok({ data, as_of_seq: "999", next_cursor: nextCursor });
      },
    }],
  };
}
