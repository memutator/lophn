import type { SchemaStep } from "../../../contracts/platform/mod.ts";

// domain-model lophn-agent/harness/model의 표. 새 preset 생성용 judgment·organizing
// 기본값만 담는다. 실행 선택 정본은 Preset이므로 이 표에 복사본을 두지 않는다.
// 선택이 null인 기본값은 행을 남겨 설정 seq를 유지하고 선택 열만 null로 둔다.
// provider 삭제는 RESTRICT다(기본값이 참조하는 provider를 통째로 없애지 않는다).

export const modelSchemaSteps: readonly SchemaStep[] = [
  {
    id: "lophn-agent.harness-model.tables",
    sql: `
create table agent_model_defaults (
  purpose text primary key check (purpose in ('judgment', 'organizing')),
  provider text references providers (id) on delete restrict,
  credentials text not null,
  model_name text check (model_name is null or length(trim(model_name)) > 0),
  reasoning_level text check (reasoning_level is null or reasoning_level in
    ('off', 'minimal', 'low', 'medium', 'high', 'very_high', 'maximum', 'provider_default')),
  options text not null,
  settings_seq text not null check (length(settings_seq) > 0),
  check ((provider is not null) = (model_name is not null)),
  check ((provider is not null) = (reasoning_level is not null))
) strict;
create trigger agent_model_defaults_no_identity_change
before update of purpose on agent_model_defaults
begin
  select raise(abort, 'purpose identity is immutable');
end;`,
  },
];
