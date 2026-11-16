import type { SqlParam, SyncDb } from "./db.ts";
import { hlcLiteral } from "./sql.ts";

// 숨은 표. 이름은 모두 `lophn_sync_`로 시작한다(cap-store session과 폰 guest authorizer가 이 접두사로 거른다).
// - row: (표, PK)마다 마지막 insert나 delete의 clock. 그 row의 칸 clock이 따로 없으면 이것이 칸 clock이다.
// - col: insert 뒤에 바뀐 칸만. 늘 그 row의 row clock보다 크다(작거나 같아지면 지운다).
// - outbox: 폰에서만 쓴다. native module이 guest 호출의 changeset을 그 write와 같은 transaction에서 앞 네 칸으로
//   쓰고, host가 나중에 hlc를 찍는다. 칸 이름과 뜻을 바꾸면 native module도 같이 바꾼다.
export const SYNC_TABLES_SQL = `
create table if not exists lophn_sync_row (tbl text not null, pk blob not null, hlc integer not null, deleted integer not null, primary key (tbl, pk)) without rowid;
create table if not exists lophn_sync_col (tbl text not null, pk blob not null, col integer not null, hlc integer not null, primary key (tbl, pk, col)) without rowid;
create table if not exists lophn_sync_state (key text primary key, value text not null);
create table if not exists lophn_sync_outbox (id text primary key, operation text not null, started_at text not null, changeset blob not null, hlc integer);
`;

// horizon: 흔적 정리(`dropTombstones`)로 지운 가장 큰 clock. 폰은 정리하지 않아 없다.
export type StateKey = "node" | "hlc" | "cursor" | "release" | "horizon";

/**
 * 숨은 표를 만들고, node가 아직 없으면 이 replica의 node를 적는다(snapshot을 받은 DB는 adoptSnapshot이 바꾼다).
 */
export function ensureSyncTables(db: SyncDb, node: string): void {
  db.exec(SYNC_TABLES_SQL);
  db.run(
    "insert into lophn_sync_state (key, value) values ('node', ?) on conflict (key) do nothing",
    [node],
  );
}

export function getState(db: SyncDb, key: StateKey): string | null {
  const row = db.all("select value from lophn_sync_state where key = ?", [
    key,
  ])[0];
  return row === undefined ? null : String(row["value"]);
}

export function setState(db: SyncDb, key: StateKey, value: string): void {
  db.run(
    "insert into lophn_sync_state (key, value) values (?, ?) on conflict (key) do update set value = excluded.value",
    [key, value],
  );
}

export type RowClock = { hlc: bigint; deleted: boolean };

export function rowClock(
  db: SyncDb,
  table: string,
  pk: Uint8Array,
): RowClock | null {
  const row = db.all(
    "select cast(hlc as text) as hlc, deleted from lophn_sync_row where tbl = ? and pk = ?",
    [table, pk],
  )[0];
  if (row === undefined) return null;
  return {
    hlc: BigInt(String(row["hlc"])),
    deleted: Number(row["deleted"]) !== 0,
  };
}

export function setRowClock(
  db: SyncDb,
  table: string,
  pk: Uint8Array,
  hlc: bigint,
  deleted: boolean,
): void {
  db.run(
    `insert into lophn_sync_row (tbl, pk, hlc, deleted) values (?, ?, ${hlcLiteral(hlc)}, ${deleted ? 1 : 0})
     on conflict (tbl, pk) do update set hlc = excluded.hlc, deleted = excluded.deleted`,
    [table, pk],
  );
}

export function columnClock(
  db: SyncDb,
  table: string,
  pk: Uint8Array,
  column: number,
): bigint | null {
  const row = db.all(
    "select cast(hlc as text) as hlc from lophn_sync_col where tbl = ? and pk = ? and col = ?",
    [table, pk, column],
  )[0];
  return row === undefined ? null : BigInt(String(row["hlc"]));
}

export function setColumnClock(
  db: SyncDb,
  table: string,
  pk: Uint8Array,
  column: number,
  hlc: bigint,
): void {
  db.run(
    `insert into lophn_sync_col (tbl, pk, col, hlc) values (?, ?, ?, ${hlcLiteral(hlc)})
     on conflict (tbl, pk, col) do update set hlc = excluded.hlc`,
    [table, pk, column],
  );
}

// upTo가 없으면 그 row의 칸 clock을 다 지운다. 있으면 그 값 이하만 지운다(row clock이 그만큼 올라 덮는다).
export function dropColumnClocks(
  db: SyncDb,
  table: string,
  pk: Uint8Array,
  upTo?: bigint,
): void {
  const params: SqlParam[] = [table, pk];
  db.run(
    `delete from lophn_sync_col where tbl = ? and pk = ?${upTo === undefined ? "" : ` and hlc <= ${hlcLiteral(upTo)}`}`,
    params,
  );
}

export type OutboxRow = {
  id: string;
  operation: string;
  started_at: string;
  changeset: Uint8Array;
  // null이면 host가 아직 clock을 찍지 않은 줄이다.
  hlc: bigint | null;
};

/**
 * outbox 줄을 commit된 순서(rowid)로 읽는다. push와 clock 찍기가 이 순서를 쓴다.
 */
export function readOutbox(db: SyncDb): OutboxRow[] {
  return db
    .all(
      "select id, operation, started_at, changeset, cast(hlc as text) as hlc from lophn_sync_outbox order by rowid",
    )
    .map((row) => ({
      id: String(row["id"]),
      operation: String(row["operation"]),
      started_at: String(row["started_at"]),
      changeset: row["changeset"] as Uint8Array,
      hlc: row["hlc"] === null ? null : BigInt(String(row["hlc"])),
    }));
}

export function writeOutbox(db: SyncDb, row: OutboxRow): void {
  db.run(
    `insert into lophn_sync_outbox (id, operation, started_at, changeset, hlc) values (?, ?, ?, ?, ${row.hlc === null ? "NULL" : hlcLiteral(row.hlc)})`,
    [row.id, row.operation, row.started_at, row.changeset],
  );
}
