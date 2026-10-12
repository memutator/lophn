import { DatabaseSync } from "node:sqlite";
import { err, ok } from "../../base/mod.ts";
import {
  derivedProvenanceSchema,
  seqSchema,
} from "../../protocol/platform/mod.ts";
import { READER_BUSY_TIMEOUT_MS } from "../storage/ledger/reads.ts";

const self = globalThis as unknown as {
  onmessage: (event: MessageEvent) => void;
  postMessage(message: unknown): void;
};
let db: DatabaseSync;
self.onmessage = async (event) => {
  try {
    const { directory, ledgerId } = event.data as {
      directory: string;
      ledgerId: string;
    };
    await Deno.mkdir(directory, { recursive: true });
    // busy_timeout=0은 기동 직후 create table재시도나 다른 코어 종료 뒤의
    // 잠깐의 잠금에 바로 실패한다. derived writer도 bounded 대기를 둔다.
    db = new DatabaseSync(`${directory}/subscriptions.db`);
    db.exec(
      `pragma journal_mode=WAL; pragma synchronous=FULL; pragma busy_timeout=${READER_BUSY_TIMEOUT_MS};
      create table if not exists positions(principal text not null, name text not null,
        through_seq text not null, primary key(principal,name));
      create table if not exists provenance(principal text not null, name text not null,
        value text not null, primary key(principal,name));
      create table if not exists meta(key text primary key, value text not null);`,
    );
    // 기록한 ledger 식별이 현재와 다르면 위치를 모두 버린다. 위치와 식별 갱신은 한 transaction이다.
    if (!ledgerId) throw new Error("ledger id is required");
    const recorded = db.prepare(
      "select value from meta where key = 'ledger_id'",
    )
      .get();
    if (recorded?.value !== ledgerId) {
      db.exec("begin immediate");
      db.exec("delete from positions; delete from provenance;");
      db.prepare(
        "insert into meta values('ledger_id', ?) on conflict(key) do update set value=excluded.value",
      ).run(ledgerId);
      db.exec("commit");
    }
    if (
      db.prepare("pragma journal_mode").get()?.journal_mode !== "wal" ||
      db.prepare("pragma synchronous").get()?.synchronous !== 2
    ) throw new Error("derived durability differs");
    self.onmessage = (request) => {
      const { id, action, principal, name, through, sourceFrom } = request
        .data as {
          id: number;
          action: "get" | "ack";
          principal: string;
          name: string;
          through?: string;
          sourceFrom?: string;
        };
      try {
        if (!principal || !name) throw new Error("invalid binding");
        if (action === "get") {
          const row = db.prepare(
            `select p.through_seq, v.value from positions p left join provenance v
             on p.principal=v.principal and p.name=v.name where p.principal=? and p.name=?`,
          ).get(principal, name);
          const value = row ? seqSchema.parse(row.through_seq) : null;
          if (row) {
            const provenance = derivedProvenanceSchema.parse(
              JSON.parse(String(row.value)),
            );
            if (
              provenance.indexed_through_seq !== value ||
              provenance.source_seq_through !== value
            ) {
              throw new Error("ack provenance differs");
            }
          }
          self.postMessage({ id, result: ok(value) });
          return;
        }
        const seq = seqSchema.parse(through);
        db.exec("begin immediate");
        const row = db.prepare(
          `select p.through_seq, v.value from positions p left join provenance v
           on p.principal=v.principal and p.name=v.name where p.principal=? and p.name=?`,
        ).get(principal, name);
        if (row) {
          const prior = derivedProvenanceSchema.parse(
            JSON.parse(String(row.value)),
          );
          if (
            prior.indexed_through_seq !== row.through_seq ||
            prior.source_seq_through !== row.through_seq
          ) {
            throw new Error("ack provenance differs");
          }
        }
        if (row && BigInt(String(row.through_seq)) > BigInt(seq)) {
          db.exec("rollback");
          self.postMessage({
            id,
            result: err({
              code: "conflict",
              message: "ack 위치는 줄일 수 없다",
            }),
          });
          return;
        }
        const provenance = derivedProvenanceSchema.parse({
          source_versions: [],
          source_seq_from: seqSchema.parse(sourceFrom ?? "0"),
          source_seq_through: seq,
          method: "event-ack/1",
          indexed_through_seq: seq,
        });
        db.prepare(
          `insert into positions values(?,?,?) on conflict(principal,name)
          do update set through_seq=excluded.through_seq`,
        ).run(principal, name, seq);
        db.prepare(
          `insert into provenance values(?,?,?) on conflict(principal,name)
          do update set value=excluded.value`,
        ).run(principal, name, JSON.stringify(provenance));
        db.exec("commit");
        self.postMessage({ id, result: ok(undefined) });
      } catch {
        try {
          if (db.isTransaction) db.exec("rollback");
        } catch {
          db.close();
        }
        self.postMessage({
          id,
          result: err({
            code: "unavailable",
            message: "ack 저장소를 사용할 수 없다",
          }),
        });
      }
    };
    self.postMessage({ ready: true });
  } catch {
    try {
      db?.close();
    } catch { /* Worker termination owns remaining cleanup */ }
    self.postMessage({ ready: false });
  }
};
