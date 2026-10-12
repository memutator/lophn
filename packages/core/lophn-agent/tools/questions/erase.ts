import { ok, type Result } from "../../../../base/mod.ts";
import { QUESTION_BLOB_OWNER_KIND } from "../../../../protocol/lophn-agent/mod.ts";
import type { Tx } from "../../../../protocol/platform/mod.ts";

// 본문 참조를 지우는 platform 함수다. core가 넘긴다(concern 사이는 contracts만 거친다).
type EraseBlobRefs = (
  tx: Tx,
  ownerKind: string,
  ownerKeys: readonly string[],
) => Result<void>;

// session을 delete할 때 그 session의 질문 묶음을 지운다(conversation#R20, questions 관계표:
// "session을 delete하면 그 session의 묶음도 함께 지운다"). 묶음의 session은 선택이라 세션의 run이
// 낸 묶음까지 함께 지워야 run 기록을 지울 수 있다(묶음이 run을 가리킨다). 진행 중인 run의 묶음은
// 표의 trigger가 막는다. 묶음 안의 글 blob 참조(owner는 묶음)도 함께 지운다. 질문은 묶음보다
// 먼저 지운다.
export function deleteSessionQuestions(
  tx: Tx,
  session: string,
  eraseBlobRefs: EraseBlobRefs,
): Result<void> {
  const groups = tx.sql.all(
    `select id from question_groups where session = ?
       or run in (select id from runs where session = ?)`,
    [session, session],
  ).map((row) => String(row["id"]));
  const refs = eraseBlobRefs(tx, QUESTION_BLOB_OWNER_KIND, groups);
  if (!refs.ok) return refs;
  for (const group of groups) {
    tx.sql.run(`delete from questions where "group" = ?`, [group]);
    tx.sql.run("delete from question_groups where id = ?", [group]);
  }
  return ok(undefined);
}
