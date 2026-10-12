import type { SchemaStep } from "../../protocol/server/mod.ts";

// notifications는 source 사실 하나당 행 하나다(R4). source_seq UNIQUE가 같은 사실의
// 재전달·재시작 중복을 막고, read_at만 읽음 표시로 바꾼다(R5). 행은 지우지 않는다(R8).
export const NOTIFICATIONS_SCHEMA_STEPS: SchemaStep[] = [
  {
    id: "notifications",
    sql: `
create table notifications (
  id text primary key,
  source_seq integer not null unique references events (seq),
  read_at text
);
create index notifications_read_at on notifications (read_at);
create trigger notifications_no_update
before update on notifications
when old.id is not new.id or old.source_seq is not new.source_seq
begin
  select raise(abort, 'notifications는 id·source_seq를 바꾸지 않는다');
end;
create trigger notifications_no_delete
before delete on notifications
begin
  select raise(abort, 'notifications는 지우지 않는다');
end;
create trigger notifications_no_duplicate_insert
before insert on notifications
when exists (select 1 from notifications where source_seq = new.source_seq)
begin
  select raise(abort, '같은 source 사실의 notification은 하나다');
end;`,
  },
];
