import type { SchemaStep } from "../../../protocol/server/mod.ts";

// 다른 컴퓨터의 agent가 보낸 call과 답이 session 기록에 들어간다(machine-a2a). `router/remote-sender-schema.ts`의 agent_calls step 뒤에
// 이 순서로 잇는다.
// - messages: `from_kind`에 `remote`(from_ref는 `callFromRef`의 canonical JSON), `fail_reason`에 expired·skipped·old_version.
//   messages는 FK 자식(checkpoints, reverts)이 `on delete restrict`로 걸려 있어 FK를 끄고 다시 짠다(`foreignKeys: "off"`). 표를 다시 짜면
//   index 둘과 trigger 다섯이 같이 사라져 지금 모양 그대로 다시 만든다. 행은 칸 이름으로 옮긴다.
// - sessions.opened_by_machine: 다른 컴퓨터에서 온 mail이 연 session이면 그 기계(`mch_`). 열 때 정해 바뀌지 않는다. 그 session은 다른
//   컴퓨터로 보내지 못하고, 다른 컴퓨터의 mail은 그 기계의 mail이 연 session에만 이어 들어간다.
const MESSAGES_COLUMNS = `id, session, from_kind, from_ref, call, reply_to, refs, reply, event, fail_reason, delivery,
  unattended, step_instance, step_name, turn, body, created_seq, created_at, state_seq, shell, origin_app`;

export const remoteSenderMessagesSchemaSteps: readonly SchemaStep[] = [
  {
    id: "lophn-agent.remote-sender.messages",
    foreignKeys: "off",
    sql: `
create table messages_new (
  id text primary key,
  session text not null references sessions (id) on delete restrict,
  from_kind text not null check (from_kind in ('human', 'program', 'agent', 'app', 'remote')),
  from_ref text,
  call text,
  reply_to text,
  refs text not null default '[]' check (json_valid(refs)),
  reply text check (reply in ('none', 'result', 'conversation')),
  event text,
  fail_reason text check (fail_reason in ('not_found', 'closed', 'receiver_ended', 'lophn_restarted', 'expired', 'skipped', 'old_version')),
  delivery text not null default 'next_turn' check (delivery in ('next_turn', 'steer')),
  unattended integer not null default 0 check (unattended in (0, 1)),
  step_instance text,
  step_name text,
  turn text,
  body text not null check (length(body) = 64),
  created_seq integer not null unique check (created_seq >= 1),
  created_at text not null,
  state_seq integer not null check (state_seq >= created_seq),
  shell integer not null default 0 check (shell in (0, 1)),
  origin_app text,
  check (origin_app is null or from_kind = 'human'),
  check ((from_kind in ('human', 'program')) = (from_ref is null)),
  check (delivery = 'next_turn' or from_kind = 'human'),
  check (unattended = 0 or from_kind = 'human'),
  check ((step_instance is null) = (step_name is null)),
  check (step_instance is null or from_kind = 'program')
) strict;
insert into messages_new (${MESSAGES_COLUMNS})
select ${MESSAGES_COLUMNS} from messages;
drop table messages;
alter table messages_new rename to messages;
create index messages_session_created on messages (session, created_seq);
create index messages_turn on messages (turn);
create trigger messages_body_fixed
before update of body on messages
when old.turn is not null or old.from_kind != 'human' or old.delivery != 'next_turn' or old.shell = 1
begin
  select raise(abort, 'a consumed message body is fixed');
end;
create trigger messages_content_immutable
before update of id, session, from_kind, from_ref, call, reply_to, refs,
  reply, event, fail_reason, delivery, unattended, step_instance, step_name, shell, origin_app, created_at on messages
begin
  select raise(abort, 'a confirmed message is never overwritten');
end;
create trigger messages_created_seq_fixed
before update of created_seq on messages
when old.turn is not null or old.from_kind != 'human' or old.delivery != 'next_turn' or old.shell = 1
begin
  select raise(abort, 'the order of a consumed message is fixed');
end;
create trigger messages_shell_human_only
before insert on messages
when new.shell = 1 and (new.from_kind != 'human' or new.delivery != 'next_turn')
begin
  select raise(abort, 'only a human next-turn message can be a shell record');
end;
create trigger messages_turn_fixed
before update of turn on messages
when old.turn is not null
begin
  select raise(abort, 'the turn that took a message is fixed');
end;`,
  },
  {
    id: "lophn-agent.remote-sender.sessions",
    sql: `
alter table sessions add column opened_by_machine text;
create trigger sessions_opened_by_machine_immutable
before update of opened_by_machine on sessions
begin
  select raise(abort, 'session opener is immutable');
end;`,
  },
];

// 다른 컴퓨터에 연 팀원(`team spawn --on`)의 행이다. 그 session의 turn은 `runs_on` 기계에서 돌고 이 기계에는 팀 tree의 자리만
// 있다(같은 session id). 열 때 정해 바뀌지 않는다.
export const memberRunsOnSchemaSteps: readonly SchemaStep[] = [
  {
    id: "lophn-agent.member.runs-on",
    sql: `
alter table sessions add column runs_on text;
create trigger sessions_runs_on_immutable
before update of runs_on on sessions
begin
  select raise(abort, 'where a member runs is immutable');
end;`,
  },
];
