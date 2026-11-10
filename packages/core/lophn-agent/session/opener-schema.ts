import type { SchemaStep } from "../../../protocol/server/mod.ts";

// `sessions.opened_by_app`는 앱이 연 session의 표시다(앱이 보낸 call로 열린 session 포함). 앱은 자기가 연 session만 끝낼 수 있고 알림 규칙이
// turn 끝 알림을 거르는 데 이 표시를 본다. 열 때 정해 바뀌지 않는다. 낸 때 step 목록의 끝에 붙어야 해서(schema-steps.lock.json)
// WIRINGS 맨 뒤 wiring(domains-retire)의 schemaStepsAfterTeams에서 messages step, 앱 보낸 쪽 call step(`router/app-sender-schema.ts`), session 표시 step 순서로 잇는다.
// - messages.origin_app: 앱 화면이 보낸 사람 메시지의 표시(`<앱 id>|<slug>`, 보낼 때의 slug를 얼린다). 보낸 쪽(from)은 그대로 human이고 model이 받는
//   글과 권한은 그대로다(이름표일 뿐이다). 사람 메시지에만 있고 한 번 쓰면 바뀌지 않는다.
// messages는 FK 자식(checkpoints, reverts)이 `on delete restrict`로 걸려 있어 FK를 끄고 다시 짠다(`foreignKeys: "off"`). 표를 다시
// 짜면 index 둘과 trigger 다섯이 같이 사라져 지금 모양 그대로 다시 만든다. 행은 열 이름으로 옮긴다.
const MESSAGES_COLUMNS = `id, session, from_kind, from_ref, call, reply_to, refs, reply, event, fail_reason, delivery,
  unattended, step_instance, step_name, turn, body, created_seq, created_at, state_seq, shell`;

export const appMessagesSchemaSteps: readonly SchemaStep[] = [
  {
    id: "router.app-sender.messages",
    foreignKeys: "off",
    sql: `
create table messages_new (
  id text primary key,
  session text not null references sessions (id) on delete restrict,
  from_kind text not null check (from_kind in ('human', 'program', 'agent', 'app')),
  from_ref text,
  call text,
  reply_to text,
  refs text not null default '[]' check (json_valid(refs)),
  reply text check (reply in ('none', 'result', 'conversation')),
  event text,
  fail_reason text check (fail_reason in ('not_found', 'closed', 'receiver_ended', 'lophn_restarted')),
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
];

export const sessionOpenerSchemaSteps: readonly SchemaStep[] = [
  {
    id: "router.app-sender.session-opener",
    sql: `
alter table sessions add column opened_by_app text;
create trigger sessions_opened_by_app_immutable
before update of opened_by_app on sessions
begin
  select raise(abort, 'session opener is immutable');
end;`,
  },
];
