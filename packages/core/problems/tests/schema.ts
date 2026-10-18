import type { SchemaStep } from "../../../protocol/server/mod.ts";

// 적용기가 한 번만 돌리므로 if not exists를 두지 않는다.
// cross-owner FK(apps, releases, problems, reports, tickets)는 그 표가
// 아직 없으므로 여기서 만들지 않는다. 존재·범위는 신뢰 prepared proof가 검사한다.
const IMMUTABLE = (table: string) => `
create trigger ${table}_no_update
before update on ${table}
begin
  select raise(abort, 'immutable');
end;
create trigger ${table}_no_delete
before delete on ${table}
begin
  select raise(abort, 'immutable');
end;`;

export const TEST_SCHEMA_STEPS: SchemaStep[] = [
  {
    id: "test-requests",
    sql: `
create table test_requests (
  seq integer primary key,
  request_principal text not null,
  request_key text not null,
  request_hash text not null,
  phase text not null check (phase in (
    'accepted', 'preparation_failed', 'start_attempt', 'actual_started',
    'start_unknown', 'recovery', 'result_ref'
  )),
  accepted integer not null check (accepted in (0, 1)),
  preparation_failed integer not null check (preparation_failed in (0, 1)),
  at text,
  start_unknown integer not null check (start_unknown in (0, 1)),
  result_ref text,
  runner_principal text,
  previous_runner text,
  reason text not null,
  payload text not null,
  check (
    phase <> 'result_ref' or result_ref is not null
  ),
  check (
    phase not in ('start_attempt', 'actual_started', 'recovery') or at is not null
  )
);
create index test_requests_key on test_requests (
  request_principal, request_key, seq
);
${IMMUTABLE("test_requests")}
create trigger test_requests_no_replace
before insert on test_requests
when exists (
  select 1 from test_requests existing
  where existing.seq = new.seq
    or (
      existing.request_principal = new.request_principal
      and existing.request_key = new.request_key
      and existing.phase = 'accepted' and new.phase = 'accepted'
    )
)
begin
  select raise(abort, 'immutable');
end;
create table test_side_starts (
  seq integer primary key,
  request_principal text not null,
  request_key text not null,
  request_hash text not null,
  runner_principal text not null,
  side text not null check (side = 'single'),
  bundle_hash text not null,
  test_hash text not null,
  started_at text not null,
  unique (request_principal, request_key, request_hash, side)
);
create index test_side_starts_key on test_side_starts (
  request_principal, request_key, request_hash, seq
);
${IMMUTABLE("test_side_starts")}
create trigger test_side_starts_no_replace
before insert on test_side_starts
when exists (
  select 1 from test_side_starts existing
  where existing.seq = new.seq or (existing.request_principal = new.request_principal
    and existing.request_key = new.request_key
    and existing.request_hash = new.request_hash
    and existing.side = new.side)
)
begin
  select raise(abort, 'immutable');
end;`,
  },
  {
    id: "verifications",
    sql: `
create table verifications (
  id text primary key,
  request_principal text not null,
  request_key text not null,
  request_hash text not null,
  kind text not null check (kind in ('app_test', 'examples')),
  app text not null,
  target_bundle_hash text not null,
  target_release text,
  ticket text,
  ticket_check_index integer,
  ticket_check_hash text,
  ticket_completion_seq text,
  test text not null,
  execution text not null,
  result text not null check (result in ('pass', 'fail', 'inconclusive')),
  reason text not null,
  observations text not null,
  recorded_seq text not null,
  verification_canonical text not null,
  unique (request_principal, request_key)
);
create index verifications_app on verifications (
  app, kind, target_bundle_hash, result, recorded_seq
);
create index verifications_ticket on verifications (
  ticket, ticket_completion_seq, ticket_check_index
);
${IMMUTABLE("verifications")}
create trigger verifications_no_replace
before insert on verifications
when exists (
  select 1 from verifications existing where existing.id = new.id
    or (existing.request_principal = new.request_principal
      and existing.request_key = new.request_key)
)
begin
  select raise(abort, 'immutable');
end;`,
  },
  {
    id: "test-evidence",
    sql: `
create table test_evidence (
  request_principal text not null,
  request_key text not null,
  request_hash text not null,
  runner_principal text not null,
  evidence text not null,
  primary key (request_principal, request_key, runner_principal)
);
${IMMUTABLE("test_evidence")}
create trigger test_evidence_no_replace
before insert on test_evidence
when exists (
  select 1 from test_evidence existing
  where existing.request_principal = new.request_principal
    and existing.request_key = new.request_key
    and existing.runner_principal = new.runner_principal
)
begin
  select raise(abort, 'immutable');
end;`,
  },
];
