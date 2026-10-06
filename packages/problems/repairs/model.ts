import { parseSeq, type Result } from "../../base/mod.ts";
import {
  defineBlobField,
  defineBlobPurpose,
  type Tx,
} from "../../contracts/platform/mod.ts";

// 같은 문제의 최신 변경 seq. 문제마다 별도 counter가 없어 subject event에서 읽는다.
// event 없는 문제는 0이다. seq는 삭제 trigger가 있어 빈 번호가 생기지 않는다.
export function latestEventSeq(
  sql: Pick<Tx["sql"], "get">,
  problem: string,
): string {
  const row = sql.get(
    `select cast(max(seq) as text) as seq from events where subject = ?`,
    [problem],
  );
  const seq = row?.seq;
  return seq === undefined || seq === null ? "0" : String(seq);
}

// 수리 출처 비교 기준은 문제의 최신 변경 seq다(R3). 제출 때 문제 상태를 읽고,
// 늦은 제출은 현재 seq와 어긋난다.
export function staleSeq(submitted: string, current: string): boolean {
  const submittedSeq = parseSeq(submitted);
  const currentSeq = parseSeq(current);
  if (!submittedSeq.ok || !currentSeq.ok) return false;
  return submittedSeq.value !== currentSeq.value;
}
