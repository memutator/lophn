import type { SchemaStep } from "../../protocol/server/mod.ts";

// 앱이 call의 보낸 쪽이 된다(app-sdk의 A2A). 낸 step의 SQL은 고치지 않고 새 step으로 더한다. 낸 때 step 목록의 끝에 붙어야 해서
// (schema-steps.lock.json) WIRINGS 맨 뒤 wiring(domains-retire)의 schemaStepsAfterTeams에서 잇는다.
//
// - messages(`lophn-agent/session/opener-schema.ts`, 같은 순서로 이 앞에 이어진다): `from_kind`에 `app`을 더한다. 앱이 보낸 message의 `from_ref`는 `<앱 id>|<slug>`다(slug는 보낼 때의 것으로 얼려
//   이력 재생의 `<lophn-call from="app:<slug>">` tag가 항상 같은 bytes다).
// - agent_calls: 보낸 쪽이 session이거나 앱이다(`from_app`은 message와 같은 `<앱 id>|<slug>`). 앱이 받은 답(result 하나)은 call 행에 글로 둔다.
//   앱에는 보낸 session 같은 queue가 없어 답이 갈 곳이 이 행이고, 앱이 `calls.read`로 읽는다.
// - sessions: `opened_by_app`는 앱이 연 session의 표시다(`lophn-agent/session/opener-schema.ts`, 같은 순서로 이 뒤에 이어진다).

export const appSenderSchemaSteps: readonly SchemaStep[] = [
  {
    id: "router.app-sender.agent-calls",
    sql: `
create table agent_calls_new (
  call text primary key,
  from_session text,
  "to" text not null,
  receiver_session text,
  reply text not null check (reply in ('none', 'result', 'conversation')),
  state text not null check (state in ('accepted', 'done', 'failed', 'cancelled')),
  fail_reason text check (fail_reason is null or fail_reason in ('not_found', 'closed', 'receiver_ended', 'lophn_restarted')),
  dedup text,
  consumed integer not null default 0 check (consumed in (0, 1)),
  unattended integer not null default 0 check (unattended in (0, 1)),
  created_at text not null,
  state_at text not null,
  ask text check (ask is null or ask in ('question', 'approval')),
  from_app text,
  result text,
  check ((state = 'failed') = (fail_reason is not null)),
  check ((from_session is null) != (from_app is null)),
  check (result is null or from_app is not null)
);
insert into agent_calls_new (call, from_session, "to", receiver_session, reply, state, fail_reason, dedup,
  consumed, unattended, created_at, state_at, ask)
select call, from_session, "to", receiver_session, reply, state, fail_reason, dedup,
  consumed, unattended, created_at, state_at, ask from agent_calls;
drop table agent_calls;
alter table agent_calls_new rename to agent_calls;
create unique index agent_calls_dedup on agent_calls (from_session, dedup)
  where dedup is not null;
create unique index agent_calls_app_dedup on agent_calls (from_app, dedup)
  where dedup is not null;
create index agent_calls_receiver on agent_calls (receiver_session)
  where state = 'accepted';
create index agent_calls_unconsumed on agent_calls (consumed)
  where state = 'accepted';
create trigger agent_calls_finished_stays before update on agent_calls
  when old.state <> 'accepted'
begin
  select raise(abort, 'a finished call does not change');
end;`,
  },
];
