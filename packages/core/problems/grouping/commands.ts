import { err, ok, type Result } from "../../../base/mod.ts";
import type { LophnError } from "../../../base/mod.ts";
import type {
  CommandDefinition,
  Input,
  Output,
  RequestContext,
  Tx,
} from "../../../protocol/server/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import { problemSetState } from "../../../protocol/problems/mod.ts";
import {
  loadProblem,
  NOT_FOUND,
  problemRecordOf,
  type ProblemRow,
} from "../reporting/mod.ts";

// 사람은 모든 문제의 상태를 바꾼다. App Engineer(agent)는 자기 앱의 문제만 바꾼다. 그 밖의 자격은
// 막는다. App Engineer는 session의 역할과 앱이 정한다.
function mayChange(tx: Tx, ctx: RequestContext, problem: ProblemRow): boolean {
  const actor = parseActor(ctx.actor);
  if (actor?.kind === "user") return true;
  if (actor?.kind !== "agent") return false;
  const session = tx.sql.get(
    "select role, app from sessions where id = ?",
    [actor.id],
  );
  return session !== undefined && session["role"] === "app_engineer" &&
    session["app"] === problem.app;
}

// 열림·해결됨·무시를 바꾼다. 같은 상태로 바꾸면 그대로 ok다. event도 Gate도 보류 request도 없다.
// 상태가 바뀌면 이전 재발 사실(recurred)은 비운다.
export function handleSetProblemState(
  tx: Tx,
  ctx: RequestContext,
  input: Input<typeof problemSetState>,
): Result<Output<typeof problemSetState>, LophnError> {
  const problem = loadProblem(tx.sql, input.problem);
  if (problem === null) {
    return err({ code: "not_found", message: NOT_FOUND });
  }
  if (!mayChange(tx, ctx, problem)) {
    return err({ code: "forbidden", message: "이 문제의 상태를 바꿀 수 없다" });
  }
  let current = problem;
  if (problem.state !== input.state) {
    tx.sql.run(
      `update problems
       set state = ?, state_changed_at = ?, seq = seq + 1,
           recurred_resolved_at = null, recurred_release = null
       where id = ?`,
      [input.state, tx.now(), problem.id],
    );
    current = loadProblem(tx.sql, problem.id) ?? problem;
  }
  const record = problemRecordOf(current);
  return record.ok ? ok({ problem: record.value }) : record;
}

export const setProblemStateCommand: CommandDefinition<
  typeof problemSetState
> = {
  route: problemSetState,
  handle: handleSetProblemState,
};
