create table todo (
  id integer primary key,
  title text not null check (length(title) between 1 and 200),
  done integer not null default 0 check (done in (0, 1)),
  created_at text not null,
  completed_at text,
  private_note text not null default '',
  version integer not null default 0
);
create index todo_created on todo (created_at desc, id desc);
create table todo_hint (
  id integer primary key,
  todo integer not null references todo (id) on delete cascade,
  text text not null check (length(text) between 1 and 500),
  created_at text not null
);
create index todo_hint_todo on todo_hint (todo, id);
-- 되돌림이 읽는 변경 기록이다. receipt는 이 표의 id고 revert 대상 상태의 revision은 되돌리지 않은 가장 큰 id다.
create table change (
  id integer primary key,
  kind text not null check (kind in ('add', 'complete', 'import')),
  todo integer,
  invocation text,
  before text,
  reverted integer not null default 0 check (reverted in (0, 1))
);
