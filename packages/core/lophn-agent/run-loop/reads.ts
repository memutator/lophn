import { err, ok, type Result } from "../../../base/mod.ts";
import {
  runList,
  runRead,
  runResult,
} from "../../../protocol/lophn-agent/mod.ts";
import {
  parseActor,
  type ReadDefinition,
  type RequestContext,
} from "../../../protocol/platform/mod.ts";
import { loadRun, recordOf, rowOf, RUN_COLUMNS, type RunRow } from "./model.ts";

// read는 pool read다. handler는 동기 Result를 돌려준다. agent 자격은 자기
// assignment의 run만 보고 그 밖은 없는 run과 똑같이 답한다.

const PAGE = 50;

function notFound(): Result<never> {
  return err({ code: "not_found", message: "run not found" });
}

function ownAssignment(ctx: RequestContext): string | null | undefined {
  const parts = parseActor(ctx.actor);
  if (parts !== undefined && parts.kind === "agent") return parts.id;
  return null;
}

function visible(ctx: RequestContext, row: RunRow): boolean {
  const own = ownAssignment(ctx);
  return own === null || own === row.assignment;
}

function cursorAfter(cursor: string | undefined): Result<number | null> {
  if (cursor === undefined) return ok(null);
  try {
    const bytes = Uint8Array.from(atob(cursor), (char) => char.charCodeAt(0));
    const parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as { after_seq?: unknown };
    if (typeof parsed.after_seq !== "number") throw new TypeError("cursor");
    return ok(parsed.after_seq);
  } catch {
    return err({ code: "invalid_input", message: "invalid run cursor" });
  }
}

export function createRunReads(): {
  read: ReadDefinition<typeof runRead>;
  list: ReadDefinition<typeof runList>;
  result: ReadDefinition<typeof runResult>;
} {
  return {
    read: {
      route: runRead,
      handle(snapshot, ctx, input) {
        const row = loadRun(snapshot, input.run);
        if (row === undefined || !visible(ctx, row)) return notFound();
        return ok({
          run: recordOf(row),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    list: {
      route: runList,
      handle(snapshot, ctx, input) {
        const after = cursorAfter(input.cursor);
        if (!after.ok) return after;
        const own = ownAssignment(ctx);
        if (
          own !== null && own !== undefined && input.assignment !== undefined &&
          input.assignment !== own
        ) {
          return ok({
            runs: [],
            as_of_seq: snapshot.as_of_seq,
            next_cursor: null,
          });
        }
        const clauses = ["accepted_seq > ?"];
        const params: (string | number)[] = [after.value ?? 0];
        const assignment = own ?? input.assignment;
        if (assignment !== undefined && assignment !== null) {
          clauses.push("assignment = ?");
          params.push(assignment);
        }
        if (input.state !== undefined) {
          clauses.push("state = ?");
          params.push(input.state);
        }
        const rows = snapshot.sql.all(
          `select ${RUN_COLUMNS} from runs where ${clauses.join(" and ")}
           order by accepted_seq limit ?`,
          [...params, PAGE + 1],
        ).map(rowOf);
        const page = rows.slice(0, PAGE);
        const last = page[page.length - 1];
        return ok({
          runs: page.map(recordOf),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: rows.length > PAGE && last !== undefined
            ? btoa(JSON.stringify({ after_seq: Number(last.accepted_seq) }))
            : null,
        });
      },
    },
    result: {
      route: runResult,
      handle(snapshot, ctx, input) {
        const row = loadRun(snapshot, input.run);
        if (row === undefined || !visible(ctx, row)) return notFound();
        const record = recordOf(row);
        return ok({
          run: row.id,
          state: row.state,
          outcome: record.outcome,
          result: record.result,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
  };
}
