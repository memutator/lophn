// context ledger 시험용 SQLite fixture다. 임시 파일 DB(WAL)에 projects·context ledger 표와 ledger events 표를
// 만들고, platform Tx와 읽기 snapshot의 모양(tx.sql, tx.emit, tx.now, tx.newId)을 흉내 낸다.
// transaction이 err를 돌려주면 ROLLBACK하고 던지면 ROLLBACK 뒤 다시 던진다(platform runTransaction과 같다).
//
// 같은 시나리오를 메모리 handler(api/testing.ts)와 돌려 값을 견줄 수 있게 맞춘 것:
//   - seq는 head(기본 100)에서 시작한다. api/testing.ts의 newState().seq와 같다.
//   - newId는 api/testing.ts의 testDeps와 같은 ID를 낸다(접두사마다 100번부터 센다).
//   - 시계는 transaction마다 1초 늘어나고 한 transaction 안에서는 tx.now()와 event의 at이 같다.
//   - emit은 platform처럼 event의 payload schema로 검사한다. 어긋나면 던진다.
import { DatabaseSync } from "node:sqlite";
import type { Result } from "../../../base/mod.ts";
import type {
  PortKey,
  RequestContext,
  Sql,
  SqlRow,
  Tx,
} from "../../../contracts/platform/mod.ts";
import { addressingSchemaSteps } from "../../addressing/mod.ts";
import { projectsSchemaSteps } from "../../projects/mod.ts";
import { id, T0 } from "../api/testing.ts";
import { contextsLedgerSchemaSteps } from "./schema.ts";

export type Emitted = {
  type: string;
  subject: string | null;
  payload: unknown;
  actor: string;
  seq: string;
  at: string;
};

export type LedgerFixtureOptions = {
  // 시작할 때 마지막 event의 seq. 기본 100.
  head?: number;
};

export const LEDGER_TABLES = [
  "contexts",
  "context_bundles",
  "context_checks",
  "saved_views",
  "glossary_entries",
] as const;

export function ledgerFixture(options: LedgerFixtureOptions = {}) {
  const head = options.head ?? 100;
  const directory = Deno.makeTempDirSync({ prefix: "contexts-ledger-test-" });
  const db = new DatabaseSync(`${directory}/ledger.sqlite`);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON;",
  );
  for (
    const step of [
      ...addressingSchemaSteps,
      ...projectsSchemaSteps,
      ...contextsLedgerSchemaSteps,
    ]
  ) {
    db.exec(step.sql);
  }
  // platform ledger의 events 표와 같은 열이다(seq는 integer autoincrement).
  db.exec(
    `CREATE TABLE events (
       seq INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, subject TEXT,
       actor TEXT NOT NULL, run TEXT, payload TEXT NOT NULL, at TEXT NOT NULL
     )`,
  );
  db.prepare(
    "INSERT INTO events (seq, type, subject, actor, payload, at) VALUES (?, 'Seeded', NULL, 'machine', '{}', ?)",
  ).run(head, T0);

  let clock = 0;
  const now = () => {
    clock += 1;
    return new Date(Date.parse(T0) + clock * 1000).toISOString();
  };
  const minted: Record<string, number> = {};
  const emitted: Emitted[] = [];
  // tx.sql.run으로 나간 쓰기 문장이다(event 삽입은 빠진다). 거절한 command가 쓰지 않았는지 본다.
  const writes: string[] = [];

  const sqlOf = (active: () => void, record: boolean): Sql => ({
    run: (statement, params) => {
      active();
      if (record) writes.push(statement);
      return db.prepare(statement).run(...params);
    },
    get: (statement, params) => {
      active();
      return db.prepare(statement).get(...params) as SqlRow | undefined;
    },
    all: (statement, params) => {
      active();
      return db.prepare(statement).all(...params) as SqlRow[];
    },
  });

  const headSeq = () =>
    Number(
      (db.prepare("SELECT COALESCE(max(seq), 0) AS head FROM events")
        .get() as { head: number | bigint }).head,
    );

  return {
    db,
    emitted,
    writes,
    path: `${directory}/ledger.sqlite`,
    sql: sqlOf(() => {}, false),
    head: headSeq,
    now,

    // command 하나를 transaction에서 돌린다. actor는 event의 actor로 남는다.
    transaction<T>(
      handle: (tx: Tx) => Result<T>,
      actor = "user",
    ): Result<T> {
      let open = true;
      const guard = () => {
        if (!open) throw new Error("transaction is closed");
      };
      const mark = emitted.length;
      // 시각은 transaction 하나에 하나다. tx.now()와 event의 at이 같다(핸들러가 본 시각이 event 시각이다).
      const txNow = now();
      db.exec("BEGIN IMMEDIATE");
      // 거절된 command가 어떤 문장을 시도했는지는 writes에 남겨 둔다(시험이 본다). 시계와 ID 발급은
      // platform처럼 되돌리지 않는다.
      const rewind = () => emitted.splice(mark);
      const tx = {
        sql: sqlOf(guard, true),
        emit(
          event: { type: string; payload: { safeParse(v: unknown): unknown } },
          subject: string | null,
          payload: unknown,
        ) {
          guard();
          const parsed = event.payload.safeParse(payload) as
            | { success: true; data: unknown }
            | { success: false; error: unknown };
          if (!parsed.success) {
            throw new Error(`event payload differs from schema: ${event.type}`);
          }
          const at = txNow;
          const inserted = db.prepare(
            "INSERT INTO events (type, subject, actor, payload, at) VALUES (?, ?, ?, ?, ?)",
          ).run(
            event.type,
            subject,
            actor,
            JSON.stringify(parsed.data),
            at,
          );
          const seq = String(inserted.lastInsertRowid);
          emitted.push({
            type: event.type,
            subject,
            payload: parsed.data,
            actor,
            seq,
            at,
          });
          return seq;
        },
        now: () => {
          guard();
          return txNow;
        },
        // api/testing.ts의 testDeps와 같은 ID를 낸다.
        newId: (prefix: string) => {
          guard();
          minted[prefix] = (minted[prefix] ?? 0) + 1;
          return id(prefix, 100 + minted[prefix]!);
        },
        port<T>(_key: PortKey<T>): T {
          guard();
          throw new Error("context ledger uses no platform port");
        },
        registerBlobRef: () => {
          throw new Error("unused");
        },
        advanceSubscriberCursor: () => {
          throw new Error("unused");
        },
        useApproval: () => {
          throw new Error("unused");
        },
        call: () => {
          throw new Error("unused");
        },
      } as unknown as Tx;
      try {
        const result = handle(tx);
        db.exec(result.ok ? "COMMIT" : "ROLLBACK");
        if (!result.ok) rewind();
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        rewind();
        throw error;
      } finally {
        open = false;
      }
    },

    // 읽기 snapshot. as_of_seq는 지금 head다.
    snapshot() {
      return {
        sql: sqlOf(() => {}, false),
        as_of_seq: String(headSeq()),
        port<T>(_key: PortKey<T>): T {
          throw new Error("context ledger uses no platform port");
        },
      };
    },

    // 프로젝트 행을 심는다. context.create와 context.list가 project를 본다.
    seedProject(projectId: string, status: "active" | "archived" = "active") {
      db.prepare(
        `INSERT INTO projects
           (id, name, title, purpose, tracking_enabled, use_gitignore, revision, status)
         VALUES (?, ?, ?, '', 0, 0, '1', ?)`,
      ).run(projectId, `name-${projectId}`, "Project", status);
    },

    // project의 폴더를 등록 순서대로 심는다.
    seedFolders(projectId: string, paths: readonly string[]) {
      const insert = db.prepare(
        `INSERT INTO project_folders (project, position, path, description)
         VALUES (?, ?, ?, '')`,
      );
      paths.forEach((path, position) => insert.run(projectId, position, path));
    },

    // project를 보관한 것으로 바꾼다(test는 project command를 거치지 않는다).
    archiveProject(projectId: string) {
      db.prepare("UPDATE projects SET status = 'archived' WHERE id = ?")
        .run(projectId);
    },

    // 다섯 표의 모든 행을 id 순으로 돌려준다. 거절한 command 앞뒤를 견준다.
    dump(): Record<string, SqlRow[]> {
      const out: Record<string, SqlRow[]> = {};
      for (const table of LEDGER_TABLES) {
        out[table] = db.prepare(`SELECT * FROM ${table} ORDER BY id`)
          .all() as SqlRow[];
      }
      return out;
    },

    close() {
      db.close();
      Deno.removeSync(directory, { recursive: true });
    },
  };
}
export type LedgerFixture = ReturnType<typeof ledgerFixture>;

// 요청 자격(RequestContext)을 만든다.
export function requestContext(
  actor: string,
  operations: readonly string[] = [],
): RequestContext {
  return {
    principal: actor === "user" ? "person" : actor,
    actor,
    scope: { operations: [...operations], targets: {} },
    conditions: {},
    credential_ref: "current",
  } as RequestContext;
}
