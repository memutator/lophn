import { err, ok, type Result } from "../../../base/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";

// 본문 참조를 지우는 platform 함수다. core가 넘긴다(concern 사이는 contracts만 거친다).
type EraseBlobRefs = (
  tx: Tx,
  ownerKind: string,
  ownerKeys: readonly string[],
) => Result<void>;

// session의 run id다. 다른 concern의 지움이 run 기준으로 행을 찾을 때 core가 쓴다.
export function sessionRunIds(tx: Tx, session: string): string[] {
  return tx.sql.all("select id from runs where session = ?", [session]).map((
    row,
  ) => String(row["id"]));
}

// session을 delete할 때 그 session의 run 기록과 run의 근거·결과 본문 참조를 지운다(conversation
// #R20). 끝난 run만 지우고, 진행 중이거나 기다리는 run이 있으면 지우지 않는다. 다른 concern이 run을
// 가리키는 행(질문·call 등)을 지우는 일은 그 concern의 몫이고 run보다 먼저 지워야 한다. run이
// 만든 문서·앱 변경은 이 기록 밖이라 그대로 남는다.
export function deleteSessionRuns(
  tx: Tx,
  session: string,
  eraseBlobRefs: EraseBlobRefs,
): Result<void> {
  if (
    tx.sql.get(
      "select 1 as found from runs where session = ? and state != 'finished' limit 1",
      [session],
    ) !== undefined
  ) {
    return err({
      code: "conflict",
      message: "a run of the session is not finished",
    });
  }
  // 다른 곳의 run이 이 session의 run을 가리키면(handoff를 보낸 쪽, 이어진 run, 선행 run)
  // 그 참조를 끊을 수 없으므로 지우지 않는다.
  if (
    tx.sql.get(
      `select 1 as found from runs
       where (session is null or session != ?)
         and (source_sender_run in (select id from runs where session = ?)
           or continued_from in (select id from runs where session = ?)
           or start_after in (select id from runs where session = ?))
       limit 1`,
      [session, session, session, session],
    ) !== undefined
  ) {
    return err({
      code: "conflict",
      message: "a run outside the session points at a run of this session",
    });
  }
  const refs = eraseBlobRefs(tx, "run", sessionRunIds(tx, session));
  if (!refs.ok) return refs;
  // start_after·continued_from은 앞서 접수한 run을 가리키고 FK는 restrict라, 가리키는 쪽을
  // 먼저 지우도록 나중에 접수한 run부터 지운다.
  const runs = tx.sql.all(
    "select id from runs where session = ? order by accepted_seq desc",
    [session],
  );
  for (const run of runs) {
    tx.sql.run("delete from runs where id = ?", [String(run["id"])]);
  }
  return ok(undefined);
}
