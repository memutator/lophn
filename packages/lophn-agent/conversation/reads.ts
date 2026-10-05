import { err, ok, type Result } from "../../base/mod.ts";
import {
  messagesList,
  sessionList,
  sessionRead,
} from "../../contracts/lophn-agent/mod.ts";
import {
  parseActor,
  type ReadDefinition,
  type RequestContext,
} from "../../contracts/platform/mod.ts";
import {
  loadSession,
  MESSAGE_COLUMNS,
  messageRowOf,
  SESSION_COLUMNS,
  sessionRecordOf,
  type SessionRow,
  sessionRowOf,
  snapshotOf,
} from "./model.ts";

// read는 pool read다. handler는 동기 Result를 돌려준다. user·machine은 모든
// 세션을 보고 agent는 자기 assignment의 세션만 본다. 그 밖(다른 assignment의
// agent, coding_agent, app)은 없는 세션과 똑같이 답한다. 닫힌 세션도 원문을
// 그대로 읽는다(R8).

const PAGE = 50;
const PAGE_MAX = 200;

function notFound(): Result<never> {
  return err({ code: "not_found", message: "session not found" });
}

// null은 제한 없음, 문자열은 그 assignment만, undefined는 아무것도 보지 못함.
function visibleAssignment(
  ctx: RequestContext,
): string | null | undefined {
  const actor = parseActor(ctx.actor);
  if (actor === undefined) return undefined;
  if (actor.kind === "user" || actor.kind === "machine") return null;
  if (actor.kind === "agent") return actor.id;
  return undefined;
}

function visible(ctx: RequestContext, session: SessionRow): boolean {
  const scope = visibleAssignment(ctx);
  return scope === null || scope === session.assignment;
}

function cursorAfter(cursor: string | undefined): Result<bigint | null> {
  if (cursor === undefined) return ok(null);
  try {
    const bytes = Uint8Array.from(atob(cursor), (char) => char.charCodeAt(0));
    const parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as { after?: unknown };
    if (
      typeof parsed.after !== "string" || !/^[1-9][0-9]*$/.test(parsed.after)
    ) {
      throw new TypeError("cursor");
    }
    return ok(BigInt(parsed.after));
  } catch {
    return err({ code: "invalid_input", message: "invalid cursor" });
  }
}

function cursorOf(after: string): string {
  return btoa(JSON.stringify({ after }));
}

export function createConversationReads(): {
  session: ReadDefinition<typeof sessionRead>;
  sessions: ReadDefinition<typeof sessionList>;
  messages: ReadDefinition<typeof messagesList>;
} {
  return {
    session: {
      route: sessionRead,
      handle(snapshot, ctx, input) {
        const row = loadSession(snapshot, input.session);
        if (row === undefined || !visible(ctx, row)) return notFound();
        return ok({
          session: sessionRecordOf(row),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    sessions: {
      route: sessionList,
      handle(snapshot, ctx, input) {
        const after = cursorAfter(input.cursor);
        if (!after.ok) return after;
        const scope = visibleAssignment(ctx);
        const empty = ok({
          sessions: [],
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
        if (scope === undefined) return empty;
        if (
          scope !== null && input.assignment !== undefined &&
          input.assignment !== scope
        ) return empty;
        const clauses = ["created_seq > ?"];
        const params: (string | bigint)[] = [after.value ?? 0n];
        const assignment = scope ?? input.assignment;
        if (assignment !== undefined && assignment !== null) {
          clauses.push("assignment = ?");
          params.push(assignment);
        }
        const rows = snapshot.sql.all(
          `select ${SESSION_COLUMNS} from sessions
           where ${clauses.join(" and ")} order by created_seq limit ?`,
          [...params, PAGE + 1],
        ).map(sessionRowOf);
        const page = rows.slice(0, PAGE);
        const last = page[page.length - 1];
        return ok({
          sessions: page.map(sessionRecordOf),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: rows.length > PAGE && last !== undefined
            ? cursorOf(last.created_seq)
            : null,
        });
      },
    },
    messages: {
      route: messagesList,
      handle(snapshot, ctx, input) {
        const session = loadSession(snapshot, input.session);
        if (session === undefined || !visible(ctx, session)) return notFound();
        const after = cursorAfter(input.cursor);
        if (!after.ok) return after;
        // cursor가 after_seq보다 앞서지 않게 둘 중 큰 쪽부터 읽는다.
        const floor = BigInt(input.after_seq ?? "0");
        const clauses = ["session = ?", "created_seq > ?"];
        const params: (string | bigint)[] = [
          session.id,
          after.value !== null && after.value > floor ? after.value : floor,
        ];
        if (input.through_seq !== undefined) {
          clauses.push("created_seq <= ?");
          params.push(BigInt(input.through_seq));
        }
        if (input.run !== undefined) {
          clauses.push("run = ?");
          params.push(input.run);
        }
        const size = Math.min(input.limit ?? PAGE, PAGE_MAX);
        const rows = snapshot.sql.all(
          `select ${MESSAGE_COLUMNS} from messages
           where ${clauses.join(" and ")} order by created_seq limit ?`,
          [...params, size + 1],
        ).map(messageRowOf);
        const page = rows.slice(0, size);
        const last = page[page.length - 1];
        return ok({
          messages: page.map(snapshotOf),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: rows.length > size && last !== undefined
            ? cursorOf(last.created_seq)
            : null,
        });
      },
    },
  };
}
