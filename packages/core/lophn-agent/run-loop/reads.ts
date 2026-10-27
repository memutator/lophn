import { err, ok, type Result } from "../../../base/mod.ts";
import {
  turnList,
  turnRead,
  turnResult,
} from "../../../protocol/lophn-agent/mod.ts";
import type {
  ReadDefinition,
  RequestContext,
} from "../../../protocol/server/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import { loadTurn, TURN_COLUMNS, turnRecordOf, turnRowOf } from "./model.ts";

// read는 pool read다. handler는 동기 Result를 돌려준다. agent 자격은 자기 session의 turn만 보고 그 밖은
// 없는 turn과 똑같이 답한다.

const PAGE = 50;

function notFound(): Result<never> {
  return err({ code: "not_found", message: "turn not found" });
}

// agent는 자기 session의 turn만 본다. null이면 제한이 없다.
function ownSession(ctx: RequestContext): string | null {
  const parts = parseActor(ctx.actor);
  return parts !== undefined && parts.kind === "agent" ? parts.id : null;
}

function visible(ctx: RequestContext, session: string): boolean {
  const own = ownSession(ctx);
  return own === null || own === session;
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
    return err({ code: "invalid_input", message: "invalid turn cursor" });
  }
}

export function createTurnReads(): {
  read: ReadDefinition<typeof turnRead>;
  list: ReadDefinition<typeof turnList>;
  result: ReadDefinition<typeof turnResult>;
} {
  return {
    read: {
      route: turnRead,
      handle(snapshot, ctx, input) {
        const row = loadTurn(snapshot, input.turn);
        if (row === undefined || !visible(ctx, row.session)) return notFound();
        return ok({
          turn: turnRecordOf(row),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    list: {
      route: turnList,
      handle(snapshot, ctx, input) {
        const after = cursorAfter(input.cursor);
        if (!after.ok) return after;
        const own = ownSession(ctx);
        if (
          own !== null &&
          input.session !== undefined &&
          input.session !== own
        ) {
          return ok({
            turns: [],
            as_of_seq: snapshot.as_of_seq,
            next_cursor: null,
          });
        }
        const session = own ?? input.session;
        const clauses = ["state_seq > ?"];
        const params: (string | number)[] = [after.value ?? 0];
        if (session !== undefined) {
          clauses.push("session = ?");
          params.push(session);
        }
        if (input.state !== undefined) {
          clauses.push("state = ?");
          params.push(input.state);
        }
        const rows = snapshot.sql
          .all(
            `select ${TURN_COLUMNS} from turns where ${clauses.join(" and ")}
           order by state_seq limit ?`,
            [...params, PAGE + 1],
          )
          .map(turnRowOf);
        const page = rows.slice(0, PAGE);
        const last = page[page.length - 1];
        return ok({
          turns: page.map(turnRecordOf),
          as_of_seq: snapshot.as_of_seq,
          next_cursor:
            rows.length > PAGE && last !== undefined
              ? btoa(JSON.stringify({ after_seq: Number(last.state_seq) }))
              : null,
        });
      },
    },
    result: {
      route: turnResult,
      handle(snapshot, ctx, input) {
        const row = loadTurn(snapshot, input.turn);
        if (row === undefined || !visible(ctx, row.session)) return notFound();
        const record = turnRecordOf(row);
        return ok({
          turn: row.id,
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
