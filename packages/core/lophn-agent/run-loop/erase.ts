import { err, ok, type Result } from "../../../base/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";

// 본문 참조를 지우는 platform 함수다. core가 넘긴다(concern 사이는 contracts만 거친다).
type EraseBlobRefs = (
  tx: Tx,
  ownerKind: string,
  ownerKeys: readonly string[],
) => Result<void>;

// session의 turn id다. 다른 concern의 지움이 turn 기준으로 행을 찾을 때 core가 쓴다.
function sessionTurnIds(tx: Tx, session: string): string[] {
  return tx.sql.all("select id from turns where session = ?", [session]).map((
    row,
  ) => String(row["id"]));
}

// session을 delete할 때 그 session의 turn 기록과 turn의 근거·결과 본문 참조를 지운다. 끝난 turn만
// 지운다: 도는 turn은 부른 쪽이 먼저 interrupted로 닫아야 한다. 다른 concern이 turn을 가리키는
// 행(질문·call 등)을 지우는 일은 그 concern의 몫이고 turn보다 먼저 지워야 한다. turn이 만든 앱
// 변경은 이 기록 밖이라 그대로 남는다.
export function deleteSessionTurns(
  tx: Tx,
  session: string,
  eraseBlobRefs: EraseBlobRefs,
): Result<void> {
  if (
    tx.sql.get(
      "select 1 as found from turns where session = ? and state != 'finished' limit 1",
      [session],
    ) !== undefined
  ) {
    return err({
      code: "conflict",
      message: "a turn of the session is not finished",
    });
  }
  const refs = eraseBlobRefs(tx, "turn", sessionTurnIds(tx, session));
  if (!refs.ok) return refs;
  tx.sql.run("delete from turns where session = ?", [session]);
  return ok(undefined);
}
