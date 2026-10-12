import type { SchemaStep } from "../../../protocol/server/mod.ts";

// domain-model lophn-agent/harness/provider의 표. credential 값은 열에 없다.
// secret_ref는 참조만 담는다(platform/secrets). provider당 credential은 하나(PK가 provider)이고
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
  protocol text not null check (protocol in ('anthropic-messages', 'openai-responses', 'openai-chat-completions')),
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
  secret_sealed_ref text,
  secret_revision integer,
  revision integer not null check (revision >= 1),
  state text not null check (state in ('available', 'rejected', 'usage_wait', 'revoked')),
  unavailable_reason text check (unavailable_reason in ('authentication', 'quota', 'plan_access', 'refresh_revoked')),
  until text,
  expires_at text,
  logged_in_at text,
  refreshed_at text,
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
];
