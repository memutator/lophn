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
import { ReleaseLookupPort } from "../reporting/mod.ts";
import {
  agentResolveDecision,
  loadProblem,
  NOT_FOUND,
  problemRecordOf,
  type ProblemRow,
} from "../reporting/mod.ts";

// 사람은 모든 문제의 상태를 바꾼다. Project Manager(agent)는 자기 앱의 문제만 바꾼다. 그 밖의 자격은
// 막는다. Project Manager의 앱은 자격의 `conditions.app`이 정한다.
function mayChange(ctx: RequestContext, problem: ProblemRow): boolean {
  const actor = parseActor(ctx.actor);
  if (actor?.kind === "user") return true;
  return actor?.kind === "agent" && ctx.conditions.app === problem.app;
}

// agent가 resolved로 바꾸려면 마지막 발생의 release보다 뒤에 activate된 active release가 있어야 한다.
// 없이 닫으면 같은 release의 새 발생이 닫힌 문제에 묻힌다. 사람은 이 조건 없이 바꾼다.
function agentMayResolve(
  tx: Tx,
  problem: ProblemRow,
): Result<boolean, LophnError> {
  const lastRow = tx.sql.get(
    `select release from reports where problem = ?
     order by observed_at desc, id desc limit 1`,
    [problem.id],
  );
  const lastId = lastRow === undefined ? null : lastRow["release"];
  const releases = tx.port(ReleaseLookupPort)(tx.sql);
  const last = typeof lastId === "string" ? releases.get(lastId) : ok(null);
  if (!last.ok) return last;
  const active = releases.activeOf(problem.app);
  if (!active.ok) return active;
  return ok(
    agentResolveDecision({ last: last.value, active: active.value }) ===
      "allow",
  );
}

// 열림·해결됨·무시를 바꾼다. 같은 상태로 바꾸면 그대로 ok다. event도 Gate도 보류 request도 없다.
// 상태가 바뀌면 이전 재발 사실(recurred)은 비운다.
function handleSetProblemState(
  tx: Tx,
  ctx: RequestContext,
  input: Input<typeof problemSetState>,
): Result<Output<typeof problemSetState>, LophnError> {
  const problem = loadProblem(tx.sql, input.problem);
  if (problem === null) {
    return err({ code: "not_found", message: NOT_FOUND });
  }
  if (!mayChange(ctx, problem)) {
    return err({ code: "forbidden", message: "이 문제의 상태를 바꿀 수 없다" });
  }
  if (
    input.state === "resolved" && problem.state !== "resolved" &&
    parseActor(ctx.actor)?.kind === "agent"
  ) {
    const may = agentMayResolve(tx, problem);
    if (!may.ok) return may;
    if (!may.value) {
      return err({
        code: "conflict",
        message:
          "no fix release yet: no active release was activated after the release of the last occurrence. Ask the person to resolve it, or wait until a fix release is active.",
      });
    }
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
