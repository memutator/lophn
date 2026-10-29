import type { SchemaStep } from "../../../protocol/server/mod.ts";

// model 선택과 켠 model의 표.
// model_choices는 층마다 한 줄이다: scope가 'global'이면 전역 기본 하나, project id면 그 project 층이다.
// 고르지 않은 층은 줄이 없다(= null). option 값은 고른 시점의 snapshot이라 catalog가 바뀌어도 고쳐 쓰지 않는다.
// provider는 FK가 아니다: Disconnect가 provider를 지워도 고른 선택은 남고, 그 provider를 고른 agent는
// 다시 Connect하기 전까지 일을 시작하지 않는다. 저장할 때 provider가 있는지는 command가 본다.
// 켠 model 목록의 compare 기준은 model_shown_seq 한 줄이다. 목록을 바꿀 때마다 하나 올린다.
// 기본이 "끔"이라 켠 것만 적는다. model을 고르면 그 model도 목록에 들어간다.
// model_user_info는 사람이 custom provider model에 적은 정보다. 열쇠는 catalog와 같은 (provider 정의 key,
// model 이름)이고 info는 CatalogEntry 모양으로 합칠 칸의 JSON이다. provider를 끊어도 지우지 않는다: 같은
// 정의 key로 다시 붙이면 적은 정보가 다시 보인다. compare 기준은 model_user_info_seq 한 줄이다.

export const modelSchemaSteps: readonly SchemaStep[] = [
  {
    id: "lophn-agent.harness-model.tables",
    sql: `
create table model_choices (
  scope text primary key check (length(scope) > 0),
  provider text not null,
  model_name text not null check (length(trim(model_name)) > 0),
  option_values text not null
) strict;
create table model_shown (
  provider text not null,
  model_name text not null check (length(trim(model_name)) > 0),
  primary key (provider, model_name)
) strict;
create table model_shown_seq (
  one integer primary key check (one = 1),
  seq integer not null check (seq >= 0)
) strict;
create table model_user_info (
  provider_definition text not null check (length(trim(provider_definition)) > 0),
  model_name text not null check (length(trim(model_name)) > 0),
  info text not null,
  saved_at text not null,
  primary key (provider_definition, model_name)
) strict;
create table model_user_info_seq (
  one integer primary key check (one = 1),
  seq integer not null check (seq >= 0)
) strict;`,
  },
];
