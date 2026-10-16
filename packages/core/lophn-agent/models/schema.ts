import type { SchemaStep } from "../../../protocol/server/mod.ts";

// model 선택과 즐겨찾기의 표.
// model_choices는 층마다 한 줄이다: scope가 'global'이면 전역 기본 하나, project id면 그 project 층이다.
// 고르지 않은 층은 줄이 없다(= null). option 값은 고른 시점의 snapshot이라 catalog가 바뀌어도 고쳐 쓰지 않는다.
// provider는 FK가 아니다: Disconnect가 provider를 지워도 고른 선택은 남고, 그 provider를 고른 agent는
// 다시 Connect하기 전까지 일을 시작하지 않는다. 저장할 때 provider가 있는지는 command가 본다.
// 즐겨찾기 목록의 compare 기준은 model_favorites_seq 한 줄이다. 목록을 바꿀 때마다 하나 올린다.

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
create table model_favorites (
  provider text not null,
  model_name text not null check (length(trim(model_name)) > 0),
  rank integer not null check (rank >= 0),
  primary key (provider, model_name),
  unique (rank)
) strict;
create table model_favorites_seq (
  one integer primary key check (one = 1),
  seq integer not null check (seq >= 0)
) strict;`,
  },
];
