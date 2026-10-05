import type { SchemaStep } from "../../contracts/platform/mod.ts";

// domain-model lophn-agent/presets의 표. 실제 담당 대상·주기·세션·run 상태는
// assignment의 몫이므로 이 표에 두지 않는다(presets#R1). 현재 판과 새 판을 같은
// transaction에 확정하고 과거 판은 불변이다(presets#R12).
// user 판은 대소문자·공백을 접은 name_key로 unique다(presets#R3).

export const presetSchemaSteps: readonly SchemaStep[] = [
  {
    id: "lophn-agent.presets.tables",
    sql: `
create table presets (
  id text primary key,
  kind text not null check (kind in ('lophn', 'app_engineer', 'context_engineer', 'operator')),
  origin text not null check (origin in ('product', 'user')),
  name text not null check (length(trim(name)) > 0 and name not like '%*%'),
  name_key text not null check (length(name_key) > 0),
  prompt text not null check (length(trim(prompt)) > 0),
  revision integer not null check (revision >= 1),
  check (origin = 'user' or kind is not null)
) strict;
create unique index presets_user_name_key
  on presets (name_key) where origin = 'user';
create unique index presets_product_kind
  on presets (kind) where origin = 'product';
create index presets_kind_id on presets (kind, id);
create trigger presets_no_identity_change
before update of id on presets
begin
  select raise(abort, 'preset identity is immutable');
end;
create trigger presets_kind_immutable
before update of kind, origin on presets
begin
  select raise(abort, 'preset kind and origin are immutable');
end;
create trigger presets_no_delete
before delete on presets
begin
  select raise(abort, 'past runs keep their preset, presets are kept');
end;
create table preset_revisions (
  preset_id text not null references presets (id) on delete restrict,
  revision integer not null check (revision >= 1),
  definition text not null,
  definition_hash text not null check (length(definition_hash) = 64),
  prompt_hash text not null check (length(prompt_hash) = 64),
  decided_by text not null check (length(decided_by) > 0),
  proposed_by text not null check (length(proposed_by) > 0),
  reason text not null check (length(trim(reason)) > 0),
  before_revision integer,
  before_hash text,
  created_at text not null check (length(created_at) > 0),
  primary key (preset_id, revision),
  check ((before_revision is null) = (before_hash is null))
) strict;
create index preset_revisions_preset on preset_revisions (preset_id);
create trigger preset_revisions_no_update
before update on preset_revisions
begin
  select raise(abort, 'past preset revisions are immutable');
end;
create trigger preset_revisions_no_delete
before delete on preset_revisions
begin
  select raise(abort, 'past preset revisions are kept');
end;`,
  },
];
