import type { SchemaStep } from "../../protocol/platform/mod.ts";

// 선택 원본은 ledger 하나다(R2). setting_choices는 현재 선택만 담는다.
// setting_revisions는 불변 판이며 UPDATE·DELETE가 금지된다(domain model).
// settings_state는 현재 적용 판 singleton이다.
export const SETTINGS_SCHEMA_STEPS: SchemaStep[] = [
  {
    id: "settings",
    sql: `
create table setting_choices (
  layer text not null check (layer = 'common'),
  key text not null check (length(key) > 0),
  value json not null,
  primary key (layer, key)
);
create index setting_choices_key on setting_choices (key);
create table setting_revisions (
  revision integer primary key check (revision >= 0),
  previous_revision integer,
  changes json not null,
  affected_concerns json not null,
  defaults_revision text not null check (length(defaults_revision) > 0),
  actor text not null,
  at text not null,
  foreign key (previous_revision) references setting_revisions (revision)
);
create index setting_revisions_at on setting_revisions (at);
create trigger setting_revisions_no_update before update on setting_revisions
begin
  select raise(abort, 'setting_revisions는 불변이다');
end;
create trigger setting_revisions_no_delete before delete on setting_revisions
begin
  select raise(abort, 'setting_revisions는 불변이다');
end;
create table settings_state (
  key integer primary key check (key = 1),
  revision integer not null check (revision >= 0),
  defaults_revision text not null check (length(defaults_revision) > 0)
);`,
  },
];
