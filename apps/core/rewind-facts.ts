import type { Sql } from "../../packages/contracts/platform/mod.ts";
import type { PreviewFact } from "../../packages/lophn-agent/revert/mod.ts";

// rewind로 되돌려지지 않는 질문 답과 승인 결정이다(lophn-agent/revert "남는 사실", `answered_fact`). 숨기는
// 구간에서 사람이 답한 질문 묶음과 허락·거절한 approval request가 있으면 한 줄씩 알린다. 질문과 approval의
// 표는 다른 concern의 것이라 core 조립이 읽어 revert에 넘긴다. 읽기 전용이고 reader Worker에서도 쓴다.
export function answeredFacts(
  lookup: { sql: Pick<Sql, "all"> },
  input: { session: string; from_seq: string },
): PreviewFact[] {
  const from = Number(input.from_seq);
  const facts: PreviewFact[] = [];
  const questions = lookup.sql.all(
    `select 1 as found from question_groups
      where session = ? and status = 'answered' and closed_seq >= ? limit 1`,
    [input.session, from],
  );
  if (questions.length > 0) {
    facts.push({
      target: "answered_question",
      reason: "answered_fact",
      source: [],
    });
  }
  const decisions = lookup.sql.all(
    `select 1 as found from approval_requests a join runs r on r.id = a.run
      where r.session = ? and a.status in ('granted', 'rejected')
        and a.closed_seq >= ? limit 1`,
    [input.session, from],
  );
  if (decisions.length > 0) {
    facts.push({
      target: "approval_decision",
      reason: "answered_fact",
      source: [],
    });
  }
  return facts;
}
