import { ok, type Result } from "../../base/mod.ts";
import type { Tx } from "../../contracts/platform/mod.ts";

// session을 delete할 때 그 session의 질문 묶음을 지운다(conversation#R20, questions 관계표:
// "session을 delete하면 그 session의 묶음도 함께 지운다"). 묶음의 session은 선택이라 세션의 run이
// 낸 묶음까지 함께 지워야 run 기록을 지울 수 있다(묶음이 run을 가리킨다). 진행 중인 run의 묶음은
// 표의 trigger가 막는다. 묶음 안의 글 blob 참조는 hash만 남는 불변 기록이라 그대로 둔다.
// 질문은 묶음보다 먼저 지운다.
export function deleteSessionQuestions(
  tx: Tx,
  session: string,
): Result<void> {
  const scope = `"group" in (select id from question_groups where session = ?
       or run in (select id from runs where session = ?))`;
  tx.sql.run(`delete from questions where ${scope}`, [session, session]);
  tx.sql.run(
    `delete from question_groups where session = ?
       or run in (select id from runs where session = ?)`,
    [session, session],
  );
  return ok(undefined);
}
