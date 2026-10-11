import { err, ok, type Result } from "../../../base/mod.ts";
import type { Tx } from "../../../contracts/platform/mod.ts";

// session을 delete할 때 그 session의 run 기록을 지운다(conversation#R20). 끝난 run만
// 지우고, 진행 중이거나 기다리는 run이 있으면 지우지 않는다. 다른 concern이 run을
// 가리키는 행(질문·call 등)을 지우는 일은 그 concern의 몫이다. run이 만든 문서·앱 변경은
// 이 기록 밖이라 그대로 남는다.
export function deleteSessionRuns(tx: Tx, session: string): Result<void> {
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
