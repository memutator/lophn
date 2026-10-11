import type { SchemaStep } from "../../../contracts/platform/mod.ts";

// domain-model lophn-agent/harness/model의 표. role별 기본 model과 요약용 model, 즐겨찾기다.
// 기본값은 slot마다 한 줄이고 바꾸지 않은 slot은 줄이 없다(= 처음 값 null). 선택이 null인
// 줄은 선택 열만 비우고 설정 seq를 남겨 CAS 근거를 유지한다. option 값은 고른 시점의
// 설정 snapshot이라 catalog가 바뀌어도 고쳐 쓰지 않는다(R12).
// 즐겨찾기의 설정 seq는 ModelFavoritesChanged event의 seq이므로 이 표에 두지 않는다.
// provider 삭제는 RESTRICT다(기본값·즐겨찾기가 참조하는 provider를 통째로 없애지 않는다).

export const modelSchemaSteps: readonly SchemaStep[] = [
  {
    id: "lophn-agent.harness-model.tables",
    sql: `
create table agent_model_defaults (
  slot text primary key check (slot in
    ('lophn', 'context_engineer', 'app_engineer', 'operator', 'summaries')),
  provider text references providers (id) on delete restrict,
  model_name text check (model_name is null or length(trim(model_name)) > 0),
  option_values text not null,
  settings_seq text not null check (length(settings_seq) > 0),
  check ((provider is not null) = (model_name is not null))
) strict;
create trigger agent_model_defaults_no_identity_change
before update of slot on agent_model_defaults
begin
  select raise(abort, 'slot identity is immutable');
end;
create table model_favorites (
  provider text not null references providers (id) on delete restrict,
  model_name text not null check (length(trim(model_name)) > 0),
  rank integer not null check (rank >= 0),
  primary key (provider, model_name),
  unique (rank)
) strict;`,
  },
];
