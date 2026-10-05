import { err, ok, type Result } from "../../base/mod.ts";
import { assignmentOccurrencesList } from "../../contracts/lophn-agent/mod.ts";
import {
  parseActor,
  type ReadDefinition,
  type RequestContext,
} from "../../contracts/platform/mod.ts";
import { OCCURRENCE_COLUMNS, recordOf, rowOf } from "./model.ts";

// read는 pool read다. handler는 동기 Result를 돌려준다. agent 자격은 자기
// assignment의 기록만 보고 그 밖은 없는 assignment와 똑같이 답한다.

const DEFAULT_PAGE = 50;
const MAX_PAGE = 200;

function notFound(): Result<never> {
  return err({ code: "not_found", message: "assignment not found" });
}

function ownAssignment(ctx: RequestContext): string | undefined {
  const parts = parseActor(ctx.actor);
  return parts !== undefined && parts.kind === "agent" ? parts.id : undefined;
}

function cursorAfter(cursor: string | undefined): Result<string | null> {
  if (cursor === undefined) return ok(null);
  try {
    const bytes = Uint8Array.from(atob(cursor), (char) => char.charCodeAt(0));
    const parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as { after_due_at?: unknown };
    if (typeof parsed.after_due_at !== "string") throw new TypeError("cursor");
    return ok(parsed.after_due_at);
  } catch {
    return err({ code: "invalid_input", message: "invalid occurrence cursor" });
  }
}

export function createSchedulingReads(): {
  list: ReadDefinition<typeof assignmentOccurrencesList>;
} {
  return {
    list: {
      route: assignmentOccurrencesList,
      handle(snapshot, ctx, input) {
        const own = ownAssignment(ctx);
        if (own !== undefined && own !== input.assignment) return notFound();
        const exists = snapshot.sql.get(
          "select 1 as found from assignments where id = ?",
          [input.assignment],
        );
        if (exists === undefined) return notFound();
        const cursor = cursorAfter(input.cursor);
        if (!cursor.ok) return cursor;
        const after = [cursor.value, input.after_due_at ?? null].filter((
          value,
        ): value is string => value !== null).sort().pop() ?? "";
        const clauses = ["assignment_id = ?", "due_at > ?"];
        const params: (string | number)[] = [input.assignment, after];
        if (input.assignment_revision !== undefined) {
          clauses.push("assignment_revision = ?");
          params.push(input.assignment_revision);
        }
        if (input.through_due_at !== undefined) {
          clauses.push("due_at <= ?");
          params.push(input.through_due_at);
        }
        const size = Math.min(input.limit ?? DEFAULT_PAGE, MAX_PAGE);
        const rows = snapshot.sql.all(
          `select ${OCCURRENCE_COLUMNS} from assignment_schedule_occurrences
           where ${clauses.join(" and ")} order by due_at limit ?`,
          [...params, size + 1],
        ).map(rowOf);
        const page = rows.slice(0, size);
        const last = page[page.length - 1];
        return ok({
          occurrences: page.map((row) => ({
            occurrence: recordOf(row),
            event_seq: row.event_seq,
          })),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: rows.length > size && last !== undefined
            ? btoa(JSON.stringify({ after_due_at: last.due_at }))
            : null,
        });
      },
    },
  };
}
