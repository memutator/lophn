// session의 지금 상태를 정하는 한 곳이다. 도는 turn이 있으면 running이고, 사람의 동의나 질문 답을 기다리면 waiting, 아니면 idle이다.
// 기다림을 어디서 아는지만 부르는 쪽마다 다르다: core 메인 스레드(snapshot·session 목록·lifecycle event)는 메모리의 대기 요청과
// 질문(`memory`)으로, writer·reader Worker(Router의 call 대상 상태)는 ledger의 tool call 행으로 본다. 같은 뜻의 두 출처다.
import type { Sql } from "../../../protocol/server/mod.ts";

export type SessionWaitingFor = "approval" | "question";
export type SessionDerivedState = {
  state: "running" | "waiting" | "idle";
  waiting_for: SessionWaitingFor | null;
};

type Query = Pick<Sql, "get">;

export function sessionStateOf(
  sql: Query,
  session: string,
  memory?: { approval: boolean; question: boolean },
): SessionDerivedState {
  if (memory !== undefined) {
    const waiting_for = memory.approval
      ? "approval"
      : memory.question
        ? "question"
        : null;
    if (waiting_for !== null) return { state: "waiting", waiting_for };
  }
  const running =
    sql.get(
      "select 1 as found from turns where session = ? and state = 'running' limit 1",
      [session],
    ) !== undefined;
  if (!running) return { state: "idle", waiting_for: null };
  if (memory !== undefined) return { state: "running", waiting_for: null };
  // 사람의 동의를 기다리는 call(판정 전의 confirm call)이나 답을 기다리는 질문(시작한 ask)이 있으면 waiting이다.
  const approval =
    sql.get(
      `select 1 as found from tool_calls c join turns t on t.id = c.turn
        where t.session = ? and t.state = 'running'
          and c.state = 'requested' and c.decision is null and c.confirm = 1`,
      [session],
    ) !== undefined;
  if (approval) return { state: "waiting", waiting_for: "approval" };
  const question =
    sql.get(
      `select 1 as found from tool_calls c join turns t on t.id = c.turn
        where t.session = ? and t.state = 'running'
          and c.state = 'started' and c.tool = 'ask'`,
      [session],
    ) !== undefined;
  return question
    ? { state: "waiting", waiting_for: "question" }
    : { state: "running", waiting_for: null };
}
