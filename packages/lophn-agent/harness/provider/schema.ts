import type { SchemaStep } from "../../../contracts/platform/mod.ts";

// domain-model lophn-agent/harness/provider의 표. credential 값은 열에 없다.
// secret_ref는 참조만 담는다(platform/secrets). credential은 회수 대신 state로 남기므로
// provider 삭제는 RESTRICT다.

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
  protocol text not null check (protocol in ('anthropic-messages', 'openai-responses', 'openai-chat-completions')),
  enabled integer not null check (enabled in (0, 1)),
  last_check text,
  revision integer not null check (revision >= 1)
) strict;
create index providers_enabled_id on providers (enabled, id);
create index providers_definition_key_id on providers (definition_key, id);
create trigger providers_no_delete
before delete on providers
begin
  select raise(abort, 'provider credentials exist, providers are kept');
end;
create table provider_credentials (
  provider text not null references providers (id) on delete restrict,
  key text not null,
  kind text not null check (kind in ('api_key', 'oauth', 'none')),
  label text not null check (length(trim(label)) > 0),
  secret_name text,
  secret_sealed_ref text,
  secret_revision integer,
  revision integer not null check (revision >= 1),
  order_index integer not null check (order_index >= 0),
  enabled integer not null check (enabled in (0, 1)),
  account text,
  organization text,
  plan text,
  dedup_fingerprint text,
  dedup_product text,
  state text not null check (state in ('available', 'rejected', 'usage_wait', 'revoked')),
  unavailable_reason text check (unavailable_reason in ('authentication', 'quota', 'plan_access', 'refresh_revoked')),
  until text,
  expires_at text,
  logged_in_at text,
  refreshed_at text,
  primary key (provider, key),
  unique (provider, order_index),
  check (
    (kind in ('api_key', 'oauth')) =
    (secret_name is not null and secret_sealed_ref is not null and secret_revision is not null)
  ),
  check (
    (state = 'usage_wait') = (until is not null)
  ),
  check (
    (state = 'available') = (unavailable_reason is null)
  )
) strict;
create index provider_credentials_state_until_order
  on provider_credentials (provider, state, until, order_index);
create trigger provider_credentials_no_update_identity
before update of provider, key, kind on provider_credentials
begin
  select raise(abort, 'credential identity is immutable');
end;
create table provider_credential_model_blocks (
  provider text not null,
  credential_key text not null,
  model_name text not null check (length(trim(model_name)) > 0),
  reason text not null check (reason in ('not_found', 'retired', 'account_model_access')),
  until text,
  primary key (provider, credential_key, model_name),
  foreign key (provider, credential_key)
    references provider_credentials (provider, key) on delete restrict
) strict;
create index provider_credential_model_blocks_until
  on provider_credential_model_blocks (provider, credential_key, until);
create trigger provider_credential_model_blocks_no_delete
before delete on provider_credential_model_blocks
begin
  select raise(abort, 'model blocks are replaced, not deleted');
end;`,
  },
];
