import type { SchemaStep } from "../../../protocol/server/mod.ts";

// domain-model lophn-agent/harness/model의 표. role별 기본 model과 요약용 model, 즐겨찾기다.
// 기본값은 slot마다 한 줄이고 바꾸지 않은 slot은 줄이 없다(= 처음 값 null). 선택이 null인
// 줄은 선택 열만 비우고 설정 seq를 남겨 CAS 근거를 유지한다. option 값은 고른 시점의
// 설정 snapshot이라 catalog가 바뀌어도 고쳐 쓰지 않는다(R12).
// 즐겨찾기의 설정 seq는 ModelFavoritesChanged event의 seq이므로 이 표에 두지 않는다.
// provider는 FK가 아니다: Disconnect가 provider를 지워도 고른 선택은 남고, 그 provider를 고른 agent는
// 다시 Connect하기 전까지 일을 시작하지 않는다(provider#R28). 저장할 때 provider가 있는지는 command가 본다.

export const modelSchemaSteps: readonly SchemaStep[] = [
  {
    id: "lophn-agent.harness-model.tables",
    sql: `
create table agent_model_defaults (
  slot text primary key check (slot in
    ('lophn', 'context_engineer', 'app_engineer', 'operator', 'summaries')),
  provider text,
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
  provider text not null,
  model_name text not null check (length(trim(model_name)) > 0),
  rank integer not null check (rank >= 0),
  primary key (provider, model_name),
  unique (rank)
) strict;`,
  },
];
