import type { SchemaStep } from "../../protocol/server/mod.ts";

// 다른 컴퓨터의 agent가 call의 보낸 쪽이 되고, 이 기계의 agent가 다른 컴퓨터로 call을 보낸다(machine-a2a). 낸 step의 SQL은 고치지 않고
// 새 step으로 더한다. 순서: 이 step, messages(`lophn-agent/session/remote-sender-schema.ts`), sessions의 표시, mail 표(`mail-schema.ts`).
//
// - `from_machine`: 다른 컴퓨터에서 받은 call의 보낸 쪽(`callFromRef` 글: kind를 뺀 canonical JSON). 받는 기계의 행에만 있다.
// - `delivery`: 다른 컴퓨터로 보낸 행의 배달 상태(pending·unknown·held·running). 보낸 기계의 행에만 있다.
// - `remote_session`: 다른 컴퓨터로 보낸 call을 그 기계에서 받은 session(알면).
// - `fail_reason`에 expired·skipped·old_version.
// - 보낸 쪽 칸이 셋 다 빈 행은 workflow가 다른 컴퓨터로 넘긴 step뿐이다(보낸 쪽 program, `to`는 remote).
// 표를 다시 짜면 index와 trigger가 같이 사라져 지금 모양 그대로 다시 만든다. 행은 칸 이름으로 옮긴다.
const AGENT_CALLS_COLUMNS = `call, from_session, "to", receiver_session, reply, state, fail_reason, dedup,
  consumed, unattended, created_at, state_at, ask, from_app, result`;

export const remoteSenderCallsSchemaSteps: readonly SchemaStep[] = [
  {
    id: "router.remote-sender.agent-calls",
    sql: `
create table agent_calls_new (
  call text primary key,
  from_session text,
  "to" text not null,
  receiver_session text,
  reply text not null check (reply in ('none', 'result', 'conversation')),
  state text not null check (state in ('accepted', 'done', 'failed', 'cancelled')),
  fail_reason text check (fail_reason is null or fail_reason in ('not_found', 'closed', 'receiver_ended', 'lophn_restarted', 'expired', 'skipped', 'old_version')),
  dedup text,
  consumed integer not null default 0 check (consumed in (0, 1)),
  unattended integer not null default 0 check (unattended in (0, 1)),
  created_at text not null,
  state_at text not null,
  ask text check (ask is null or ask in ('question', 'approval')),
  from_app text,
  result text,
  from_machine text,
  delivery text check (delivery is null or delivery in ('pending', 'unknown', 'held', 'running')),
  remote_session text,
  check ((state = 'failed') = (fail_reason is not null)),
  check (((from_session is not null) + (from_app is not null) + (from_machine is not null)) = 1
    or (from_session is null and from_app is null and from_machine is null and json_extract("to", '$.kind') = 'remote')),
  check (result is null or from_app is not null)
);
insert into agent_calls_new (${AGENT_CALLS_COLUMNS})
select ${AGENT_CALLS_COLUMNS} from agent_calls;
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
