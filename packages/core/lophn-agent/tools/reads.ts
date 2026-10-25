import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type ListedToolCall,
  toolCallList,
  toolCallRead,
} from "../../../protocol/lophn-agent/mod.ts";
import { TURN_BODY_VIEW_MAX_BYTES } from "../../../protocol/lophn-agent/turn-reads.ts";
import type {
  ApiReadDefinition,
  ReadDefinition,
  SqlRow,
} from "../../../protocol/server/mod.ts";
import {
  type MessageBodyEnvironment,
  readBodyBytes,
} from "../session/body-read.ts";
import { toolCallDisplay } from "./display.ts";
import { callColumns, callFromRow, type CallRow } from "./model.ts";
import type { ToolDefinition } from "./registry.ts";

// read는 pool read다. handler는 동기 Result를 돌려준다.

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

export function createToolReads(): {
  read: ReadDefinition<typeof toolCallRead>;
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
  };
}

export type ToolCallListEnvironment = MessageBodyEnvironment & {
  /** 지금의 redaction. 끝내지 못하면 null이다. */
  readonly redact: (text: string) => string | null;
  readonly definitionOf: (tool: string) => ToolDefinition | undefined;
};

// 입력 blob의 크기를 같은 query에서 읽는다. body view가 참조를 판정하는 열과 같다.
const LIST_COLUMNS = `${callColumns},
  (select size_bytes from blob_refs
   where owner_kind = 'tool_call' and owner_key = tool_calls.id
     and field = 'input' and hash = tool_calls.input) as input_size`;

// 제목은 call마다 만든다. 표에 없는 정의(앱·MCP·다른 module)와 display가 없는 정의는
// `toolCallDisplay`의 fallback(other, tool 이름)이다.
async function listedCall(
  environment: ToolCallListEnvironment,
  row: SqlRow,
): Promise<ListedToolCall> {
  const call = callFromRow(row as CallRow);
  const definition = environment.definitionOf(call.tool);
  const stored = row["input_size"];
  const size = typeof stored === "bigint" ? Number(stored) : stored;
  let input: unknown;
  // 64 KiB를 넘는 입력은 읽지 않고 fallback이다(잘린 JSON은 해석되지 않는다).
  if (
    definition?.display !== undefined && typeof size === "number" &&
    size >= 1 && size <= TURN_BODY_VIEW_MAX_BYTES
  ) {
    const bytes = await readBodyBytes(environment, call.input, size);
    if (bytes.ok) {
      try {
        input = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes.value),
        );
      } catch {
        input = undefined;
      }
    }
  }
  const display = await toolCallDisplay(
    definition,
    call.tool,
    input,
    environment.redact,
  );
  return { ...call, display };
}

// ListToolCalls. pool read(reader Worker)는 blob 바이트를 기다리지 못하고 지금의 redaction도 core에만
// 있다. core가 바로 여는 API read로 제목을 만들고, 저장된 입력은 이때 읽는다.
export function toolCallListRead(
  environment: ToolCallListEnvironment,
): ApiReadDefinition<typeof toolCallList> {
  return {
    route: toolCallList,
    async handle(_ctx, input) {
      const parsed = toolCallList.input.safeParse(input);
      if (!parsed.success) {
        return err({ code: "invalid_input", message: "invalid read input" });
      }
      const after = cursorAfter(parsed.data.cursor);
      if (!after.ok) return after;
      const limit = parsed.data.limit ?? PAGE;
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (parsed.data.turn !== undefined) {
        clauses.push("turn = ?");
        params.push(parsed.data.turn);
      }
      if (parsed.data.session !== undefined) {
        clauses.push("turn in (select id from turns where session = ?)");
        params.push(parsed.data.session);
      }
      if (parsed.data.model_call !== undefined) {
        clauses.push("model_call = ?");
        params.push(parsed.data.model_call);
      }
      if (parsed.data.tool !== undefined) {
        clauses.push("tool = ?");
        params.push(parsed.data.tool);
      }
      if (after.value !== null) {
        clauses.push("id > ?");
        params.push(after.value);
      }
      const where = clauses.length === 0
        ? ""
        : `where ${clauses.join(" and ")}`;
      const found = environment.snapshot((sql, asOf) =>
        ok({
          rows: sql.all(
            `select ${LIST_COLUMNS} from tool_calls ${where}
             order by id limit ?`,
            [...params, limit + 1] as never,
          ),
          asOf,
        })
      );
      if (!found.ok) return found;
      const { rows, asOf } = found.value;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return ok({
        tool_calls: await Promise.all(
          page.map((row) => listedCall(environment, row)),
        ),
        as_of_seq: asOf,
        next_cursor: rows.length > limit && last !== undefined
          ? cursorOf(String(last["id"]))
          : null,
      });
    },
  };
}
