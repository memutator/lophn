import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  Input,
  Output,
  ReadSnapshot,
  RequestContext,
} from "../../../protocol/server/mod.ts";
import { problemListProject } from "../../../protocol/problems/mod.ts";
import type { Violation } from "../../../protocol/projects/mod.ts";

const LIST_LIMIT = 100;

// 앱 problem의 reporting/access.ts와 같은 두 줄이다. 폴더끼리 얽히지 않게 따로 쓴다.
// project 범위 판정(자기 project만)은 호출하는 agent tool이 자기 place로 한다.
function requireOperation(
  ctx: RequestContext,
  operation: string,
): Result<void> {
  return ctx.scope.operations.includes(operation)
    ? ok(undefined)
    : err({ code: "forbidden", message: "이 credential로는 할 수 없다" });
}

// cursor는 마지막 행의 `<state_changed_at>|<id>`다.
function parseCursor(
  cursor: string | undefined,
): Result<{ at: string; id: string } | null> {
  if (cursor === undefined) return ok(null);
  const match = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\|(prb_\S+)$/.exec(cursor);
  return match === null
    ? err({ code: "invalid_input", message: "cursor가 올바르지 않다" })
    : ok({ at: match[1], id: match[2] });
}

export const projectProblemListRead = {
  route: problemListProject,
  handle(
    snapshot: ReadSnapshot,
    ctx: RequestContext,
    input: Input<typeof problemListProject>,
  ): Result<Output<typeof problemListProject>> {
    const granted = requireOperation(ctx, problemListProject.name);
    if (!granted.ok) return granted;
    const after = parseCursor(input.cursor);
    if (!after.ok) return after;
    const where = ["project = ?"];
    const params: (string | number)[] = [input.project];
    if (input.state !== undefined) {
      where.push("state = ?");
      params.push(input.state);
    }
    if (after.value !== null) {
      where.push("(state_changed_at, id) < (?, ?)");
      params.push(after.value.at, after.value.id);
    }
    const limit = input.limit ?? LIST_LIMIT;
    // 한 행 더 읽어 다음 page가 있는지 안다.
    params.push(limit + 1);
    const rows = snapshot.sql.all(
      `select * from project_problems where ${where.join(" and ")}
       order by state_changed_at desc, id desc limit ?`,
      params,
    );
    const shown = rows.slice(0, limit);
    const last = shown[shown.length - 1];
    return ok({
      problems: shown.map((row) => ({
        id: String(row["id"]),
        project: String(row["project"]),
        violation: {
          source: row["source"],
          rule: row["rule"],
          kind: row["kind"],
          path: row["path"],
          field: row["field"],
          message: row["message"],
        } as Violation,
        state: row["state"] === "open" ? "open" as const : "resolved" as const,
        opened_at: String(row["opened_at"]),
        state_changed_at: String(row["state_changed_at"]),
        last_seen_at: String(row["last_seen_at"]),
        seq: String(row["seq"]),
      })),
      as_of_seq: snapshot.as_of_seq,
      next_cursor: rows.length > limit
        ? `${last["state_changed_at"]}|${last["id"]}`
        : null,
    });
  },
};
