import type { SchemaStep } from "../../../protocol/server/mod.ts";

// provider 표. credential 값은 열에 없다.
// secret_ref는 secrets.json의 이름만 담는다(platform/secrets). provider당 credential은 하나(PK가 provider)이고
// Disconnect는 model block·credential·provider를 함께 지운다.

export const providerSchemaSteps: readonly SchemaStep[] = [
  {
    id: "lophn-agent.harness-provider.tables",
    sql: `
create table providers (
  id text primary key,
  name text not null check (length(trim(name)) > 0),
  definition_key text not null check (length(trim(definition_key)) > 0),
  definition text not null,
  endpoint text not null,
  protocol text not null check (protocol in ('anthropic-messages', 'openai-responses', 'openai-chat-completions', 'cloud-code-assist')),
  revision integer not null check (revision >= 1)
) strict;
create index providers_definition_key_id on providers (definition_key, id);
create trigger providers_no_identity_change
before update of id on providers
begin
  select raise(abort, 'provider identity is immutable');
end;
create table provider_credentials (
  provider text primary key references providers (id) on delete restrict,
  kind text not null check (kind in ('api_key', 'oauth', 'none')),
  secret_name text,
  revision integer not null check (revision >= 1),
  state text not null check (state in ('available', 'rejected', 'usage_wait', 'revoked')),
  unavailable_reason text check (unavailable_reason in ('authentication', 'quota', 'plan_access', 'refresh_revoked')),
  until text,
  expires_at text,
  logged_in_at text,
  refreshed_at text,
  reported_models text,
  account text,
  check ((kind in ('api_key', 'oauth')) = (secret_name is not null)),
  check (
    (state = 'usage_wait') = (until is not null)
  ),
  check (
    (state = 'available') = (unavailable_reason is null)
  )
) strict;
create index provider_credentials_state_until on provider_credentials (state, until);
create trigger provider_credentials_identity_immutable
before update of provider, kind on provider_credentials
begin
  select raise(abort, 'credential identity is immutable');
end;
create table provider_credential_model_blocks (
  provider text not null references provider_credentials (provider) on delete restrict,
  model_name text not null check (length(trim(model_name)) > 0),
  reason text not null check (reason in ('not_found', 'retired', 'account_model_access')),
  until text,
  primary key (provider, model_name)
) strict;
create index provider_credential_model_blocks_until
  on provider_credential_model_blocks (until);`,
  },
  // ChatGPT 구독 로그인을 공식 Sign in with ChatGPT에서 Codex client로 바꿨다. 저장한 정의는 옛 모양이라 읽히지 않고,
  // 옛 token은 다른 client의 것이라 Codex backend가 받지 않는다. 정의와 endpoint를 새 내장 정의로 바꾸고 credential을
  // revoked(refresh_revoked)로 둔다. 사람은 Disconnect 뒤 다시 로그인한다. 그 provider를 고른 agent의 선택은 남는다.
  {
    id: "lophn-agent.harness-provider.chatgpt-codex-login",
    sql: `
update providers
set definition = json_set(
      definition,
      '$.oauth',
      json('{"product":"chatgpt","client_id":"app_EMoamEEZ73f0CkXaXp7hrann","authorization_endpoint":"https://auth.openai.com/oauth/authorize","token_endpoint":"https://auth.openai.com/oauth/token","redirect_uri":"http://localhost:1455/auth/callback","inference_endpoint":"https://chatgpt.com/backend-api/codex","scopes":["openid","profile","email","offline_access","api.connectors.read","api.connectors.invoke"]}')
    ),
    endpoint = 'https://chatgpt.com/backend-api/codex',
    revision = revision + 1
where json_extract(definition, '$.oauth.product') = 'chatgpt';
update provider_credentials
set state = 'revoked',
    unavailable_reason = 'refresh_revoked',
    until = null,
    reported_models = null,
    revision = revision + 1
where kind = 'oauth'
  and provider in (
    select id from providers
    where json_extract(definition, '$.oauth.product') = 'chatgpt'
  );`,
  },
];

// provider가 model 목록과 함께 알려 준 model별 token 한도를 그대로 저장한다. 옛 row는 null이고, 다음 목록 읽기가
// 채우거나 지운다. 목록과 따로 두어 model 호출 기록의 credential 판(revision)을 흔들지 않는다.
// 이미 나간 providerSchemaSteps 가운데에 끼우지 않는다: 조립이 이 단계를 맨 뒤에 등록한다.
export const providerReportedModelLimitsSchemaSteps: readonly SchemaStep[] = [
  {
    id: "lophn-agent.harness-provider.reported-model-limits",
    sql: `
alter table provider_credentials add column reported_model_limits text;`,
  },
];

// OpenCode Go 정의에 Gemini API wire를 더했다. provider row는 연결할 때의 정의를 담으므로 저장된 정의의 protocols를
// 새 내장 정의와 맞춘다. 그래야 turn이 Gemini model을 그 wire로 부른다. 낸 step 목록의 끝에 붙는다(domains-retire).
export const providerOpencodeGoGeminiSchemaSteps: readonly SchemaStep[] = [
  {
    id: "lophn-agent.harness-provider.opencode-go-gemini",
    sql: `
update providers
set definition = json_set(
      definition,
      '$.protocols',
      json('["openai-chat-completions","openai-responses","anthropic-messages","gemini-generate-content"]')
    ),
    revision = revision + 1
where definition_key = 'opencode-go';`,
  },
];

// provider당 여러 credential(다계정 OAuth + 다중 API key)을 두고 활성 1개를 선택한다.
// PK를 provider에서 고유 id(crd_…)로 옮기고 active·label·key_hint를 더한다. 기존 row는
// crd_<provider ULID>·active=1로 옮기고 secret_name도 provider.crd_<ULID>로 맞춘다
// (secrets.json 파일 키 옮기기는 dataStep이 기동 직후 이어서 한다).
export const providerMultiCredentialsSchemaSteps: readonly SchemaStep[] = [
  {
    id: "lophn-agent.harness-provider.multi-credentials",
    foreignKeys: "off",
    sql: `
create table provider_credentials_new (
  id text primary key,
  provider text not null references providers (id) on delete restrict,
  active integer not null check (active in (0, 1)),
  kind text not null check (kind in ('api_key', 'oauth', 'none')),
  secret_name text,
  label text,
  key_hint text,
  revision integer not null check (revision >= 1),
  state text not null check (state in ('available', 'rejected', 'usage_wait', 'revoked')),
  unavailable_reason text check (unavailable_reason in ('authentication', 'quota', 'plan_access', 'refresh_revoked')),
  until text,
  expires_at text,
  logged_in_at text,
  refreshed_at text,
  reported_models text,
  reported_model_limits text,
  account text,
  check ((kind in ('api_key', 'oauth')) = (secret_name is not null)),
  check (
    (state = 'usage_wait') = (until is not null)
  ),
  check (
    (state = 'available') = (unavailable_reason is null)
  )
) strict;
insert into provider_credentials_new (
  id, provider, active, kind, secret_name, label, key_hint, revision,
  state, unavailable_reason, until, expires_at, logged_in_at, refreshed_at,
  reported_models, reported_model_limits, account
)
select
  'crd_' || substr(provider, 5),
  provider,
  1,
  kind,
  case when secret_name is not null then 'provider.crd_' || substr(provider, 5) else null end,
  null,
  null,
  revision,
  state,
  unavailable_reason,
  until,
  expires_at,
  logged_in_at,
  refreshed_at,
  reported_models,
  reported_model_limits,
  account
from provider_credentials;

create table provider_credential_model_blocks_new (
  credential text not null references provider_credentials_new (id) on delete restrict,
  model_name text not null check (length(trim(model_name)) > 0),
  reason text not null check (reason in ('not_found', 'retired', 'account_model_access')),
  until text,
  primary key (credential, model_name)
) strict;
insert into provider_credential_model_blocks_new (credential, model_name, reason, until)
select 'crd_' || substr(provider, 5), model_name, reason, until
from provider_credential_model_blocks;

drop table provider_credential_model_blocks;
drop table provider_credentials;
alter table provider_credentials_new rename to provider_credentials;
alter table provider_credential_model_blocks_new rename to provider_credential_model_blocks;

create unique index provider_credentials_one_active
  on provider_credentials (provider) where active = 1;
create index provider_credentials_provider
  on provider_credentials (provider);
create index provider_credentials_state_until
  on provider_credentials (state, until);
create trigger provider_credentials_identity_immutable
before update of id, provider, kind on provider_credentials
begin
  select raise(abort, 'credential identity is immutable');
end;
create index provider_credential_model_blocks_until
  on provider_credential_model_blocks (until);`,
  },
];
