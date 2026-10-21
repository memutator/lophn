import type { SchemaStep } from "../../../protocol/server/mod.ts";

// ledger 공통 표. turn FK는 turns 표가 생길 때 더한다.
// 적용기가 한 번만 돌리므로 if not exists를 두지 않는다.
// blob-refs step은 registered_seq의 events FK를 뺀 내용으로 고쳤다(step hash가 바뀐다). 개발 DB는
// 지우고 새로 만든다. events.turn 칸은 쓰는 곳이 남아 있어 아직 둔다.

const IMMUTABLE = (table: string) => `
create trigger ${table}_no_update
before update on ${table}
begin
  select raise(abort, 'immutable');
end;
create trigger ${table}_no_delete
before delete on ${table}
begin
  select raise(abort, 'immutable');
end;`;

export const LEDGER_SCHEMA_STEPS: SchemaStep[] = [
  {
    id: "common-tables",
    sql: `
create table events (
  seq integer primary key autoincrement,
  type text not null,
  subject text,
  actor text not null,
  turn text,
  payload text not null,
  at text not null
);
create index events_subject_seq on events (subject, seq);
create index events_turn_seq on events (turn, seq);
create index events_type_seq on events (type, seq);
${IMMUTABLE("events")}
create table command_results (
  principal text not null,
  idempotency_key text not null,
  fingerprint text not null,
  result text not null,
  first_seq integer,
  last_seq integer,
  at text not null,
  primary key (principal, idempotency_key),
  foreign key (first_seq) references events (seq),
  foreign key (last_seq) references events (seq),
  check (
    (first_seq is null and last_seq is null) or
    (first_seq is not null and last_seq is not null and last_seq >= first_seq)
  )
);
create index command_results_at on command_results (at);
${IMMUTABLE("command_results")}`,
  },
  {
    id: "immutable-insert-guards",
    sql: `
create trigger events_no_duplicate_insert
before insert on events
when exists (select 1 from events where seq = new.seq)
begin
  select raise(abort, 'immutable');
end;
create trigger command_results_no_duplicate_insert
before insert on command_results
when exists (
  select 1 from command_results
  where principal = new.principal and idempotency_key = new.idempotency_key
)
begin
  select raise(abort, 'immutable');
end;
create trigger if not exists schema_migrations_no_duplicate_insert
before insert on schema_migrations
when exists (select 1 from schema_migrations where version = new.version)
begin
  select raise(abort, 'immutable');
end;`,
  },
  {
    // 사람이 요청한 session delete만 지운 session의 기록을 지운다. ledger 기록을 지우는 것은 이
    // 경우뿐이다. 지우는 쪽이 같은 transaction 안에서 표 이름을 열었다가 닫는다(erase.ts). 열려
    // 있는 표의 delete trigger만 통과시킨다. 정리·만료는 열지 않는다.
    id: "erase-windows",
    sql: `
create table erase_windows (
  table_name text primary key
);`,
  },
  {
    // blob 영구 참조. 소유 변경과 같은 transaction에서만 넣고,
    // 등록된 참조는 바꾸지 않으며 지우는 것은 session delete의 erase 창 안에서만이다.
    // hash 대상은 파일이므로 FK가 없다. registered_seq도 FK가 없다. 대부분의 변경은 event를
    // 남기지 않으니 event 없는 변경도 참조를 등록한다.
    id: "blob-refs",
    sql: `
create table blob_refs (
  owner_kind text not null,
  owner_key text not null,
  field text not null,
  hash text not null,
  size_bytes integer not null check (size_bytes >= 0),
  registered_seq integer not null,
  primary key (owner_kind, owner_key, field, hash)
);
create index blob_refs_hash on blob_refs (hash);
create index blob_refs_owner on blob_refs (owner_kind, owner_key);
create index blob_refs_seq on blob_refs (registered_seq);
create trigger blob_refs_no_update
before update on blob_refs
begin
  select raise(abort, 'immutable');
end;
create trigger blob_refs_no_delete
before delete on blob_refs
when not exists (select 1 from erase_windows where table_name = 'blob_refs')
begin
  select raise(abort, 'immutable');
end;`,
  },
];
