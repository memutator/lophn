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

// 바뀐 순의 cursor는 그 뒤 state_seq(`after_seq`), 최신 순의 cursor는 그보다 먼저 시작한 turn(`before_row`, rowid)이다.
function cursorValue(
  cursor: string | undefined,
  field: "after_seq" | "before_row",
): Result<number | null> {
  if (cursor === undefined) return ok(null);
  try {
    const bytes = Uint8Array.from(atob(cursor), (char) => char.charCodeAt(0));
    const parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as Record<string, unknown>;
    const value = parsed[field];
    if (typeof value !== "number") throw new TypeError("cursor");
    return ok(value);
  } catch {
    return err({ code: "invalid_input", message: "invalid turn cursor" });
  }
}

const cursorOf = (field: "after_seq" | "before_row", value: number) =>
  btoa(JSON.stringify({ [field]: value }));

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
        // rowid는 시작한 순서다(turn은 시작할 때 들어간다).
        const newest = input.order === "newest";
        const field = newest ? "before_row" : "after_seq";
        const from = cursorValue(input.cursor, field);
        if (!from.ok) return from;
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
        const clauses: string[] = [];
        const params: (string | number)[] = [];
        if (!newest) {
          clauses.push("state_seq > ?");
          params.push(from.value ?? 0);
        } else if (from.value !== null) {
          clauses.push("rowid < ?");
          params.push(from.value);
        }
        if (session !== undefined) {
          clauses.push("session = ?");
          params.push(session);
        }
        if (input.state !== undefined) {
          clauses.push("state = ?");
          params.push(input.state);
        }
        const size = input.limit ?? PAGE;
        const where =
          clauses.length === 0 ? "" : `where ${clauses.join(" and ")}`;
        const rows = snapshot.sql.all(
          `select rowid as row_order, ${TURN_COLUMNS} from turns ${where}
           order by ${newest ? "rowid desc" : "state_seq"} limit ?`,
          [...params, size + 1],
        );
        const page = rows.slice(0, size);
        const last = page[page.length - 1];
        return ok({
          turns: page.map((row) => turnRecordOf(turnRowOf(row))),
          as_of_seq: snapshot.as_of_seq,
          next_cursor:
            rows.length > size && last !== undefined
              ? cursorOf(
                  field,
                  Number(newest ? last["row_order"] : last["state_seq"]),
                )
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
