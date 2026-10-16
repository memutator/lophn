import type { SchemaStep } from "../../protocol/server/mod.ts";
import {
  CALL_FAIL_REASONS,
  CALL_REPLIES,
  CALL_STATES,
} from "../../protocol/lophn-agent/calls.ts";

const list = (values: readonly string[]) =>
  values.map((value) => `'${value}'`).join(", ");

// agent가 보낸 call 한 행. 사람 메시지와 program 입력은 행이 없다.
// - `to`는 풀린 받는 곳(JSON). 이름을 못 푼 call은 행이 없다.
// - `consumed`는 받는 session의 turn이 이 입력을 가져갔는지다. lophn을 켤 때 입력함(메모리)과 함께 잃어버린 call을
//   가린다.
// - 끝난 행은 다시 바뀌지 않는다. 배달 실패는 accepted를 거치지 않고 바로 failed로 생긴다.
export const ROUTER_SCHEMA_STEPS: SchemaStep[] = [
  {
    id: "router.agent-calls.tables",
    sql: `
create table agent_calls (
  call text primary key,
  from_session text not null,
  "to" text not null,
  receiver_session text,
  reply text not null check (reply in (${list(CALL_REPLIES)})),
  state text not null check (state in (${list(CALL_STATES)})),
  fail_reason text check (fail_reason is null or fail_reason in (${
      list(CALL_FAIL_REASONS)
    })),
  dedup text,
  consumed integer not null default 0 check (consumed in (0, 1)),
  created_at text not null,
  state_at text not null,
  check ((state = 'failed') = (fail_reason is not null))
);
create unique index agent_calls_dedup on agent_calls (from_session, dedup)
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
