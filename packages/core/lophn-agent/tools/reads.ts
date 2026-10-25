import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type ListedToolCall,
  toolCallList,
  toolCallRead,
} from "../../../protocol/lophn-agent/mod.ts";
import type { ReadDefinition, SqlRow } from "../../../protocol/server/mod.ts";
import { callColumns, callFromRow, type CallRow } from "./model.ts";

// read·list는 pool read다. handler는 동기 Result를 돌려준다.

const PAGE = 50;

function notFound(): Result<never> {
  return err({ code: "not_found", message: "tool call not found" });
}

function invalidCursor(): Result<never> {
  return err({ code: "invalid_input", message: "invalid tool call cursor" });
}

function cursorAfter(cursor: string | undefined): Result<string | null> {
  if (cursor === undefined) return ok(null);
  try {
    const bytes = Uint8Array.from(atob(cursor), (char) => char.charCodeAt(0));
    const parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as { after_id?: unknown };
    if (typeof parsed.after_id !== "string") return invalidCursor();
    return ok(parsed.after_id);
  } catch {
    return invalidCursor();
  }
}

function cursorOf(afterId: string): string {
  return btoa(JSON.stringify({ after_id: afterId }));
}

// 목록은 낼 때 제목을 만들고, 아직 tool마다의 제목 규칙이 없어 tool 이름을 `other`로 싣는다.
function toCalls(rows: readonly SqlRow[]): ListedToolCall[] {
  return rows.map((row) => {
    const call = callFromRow(row as CallRow);
    return { ...call, display: { category: "other", title: call.tool } };
  });
}

export function createToolReads(): {
  read: ReadDefinition<typeof toolCallRead>;
  list: ReadDefinition<typeof toolCallList>;
} {
  return {
    read: {
      route: toolCallRead,
      handle(snapshot, _ctx, input) {
        const row = snapshot.sql.get(
          `select ${callColumns} from tool_calls where id = ?`,
          [input.tool_call],
        );
        if (row === undefined) return notFound();
        return ok({
          tool_call: callFromRow(row as CallRow),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    list: {
      route: toolCallList,
      handle(snapshot, _ctx, input) {
        const after = cursorAfter(input.cursor);
        if (!after.ok) return after;
        const limit = input.limit ?? PAGE;
        const clauses: string[] = [];
        const params: unknown[] = [];
        if (input.turn !== undefined) {
          clauses.push("turn = ?");
          params.push(input.turn);
        }
        if (input.session !== undefined) {
          clauses.push("turn in (select id from turns where session = ?)");
          params.push(input.session);
        }
        if (input.model_call !== undefined) {
          clauses.push("model_call = ?");
          params.push(input.model_call);
        }
        if (input.tool !== undefined) {
          clauses.push("tool = ?");
          params.push(input.tool);
        }
        if (after.value !== null) {
          clauses.push("id > ?");
          params.push(after.value);
        }
        const where = clauses.length === 0
          ? ""
          : `where ${clauses.join(" and ")}`;
        const rows = snapshot.sql.all(
          `select ${callColumns} from tool_calls ${where}
           order by id limit ?`,
          [...params, limit + 1] as never,
        );
        const page = rows.slice(0, limit);
        const last = page[page.length - 1];
        return ok({
          tool_calls: toCalls(page),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: rows.length > limit && last !== undefined
            ? cursorOf(String(last["id"]))
            : null,
        });
      },
    },
  };
}
