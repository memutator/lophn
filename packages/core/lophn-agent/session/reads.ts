import { err, ok, type Result } from "../../../base/mod.ts";
import {
  agentSessionList,
  agentSessionRead,
  receivedMessageList,
  receivedMessageRead,
  sessionCompactRequests,
} from "../../../protocol/lophn-agent/mod.ts";
import type { ReadDefinition } from "../../../protocol/server/mod.ts";
import { sessionVisible, visibleSessions } from "./guards.ts";
import {
  agentClause,
  agentSessionOf,
  loadMessage,
  loadSession,
  MESSAGE_COLUMNS,
  messageRowOf,
  receivedMessageOf,
  SESSION_COLUMNS,
  sessionRowOf,
} from "./model.ts";

// read는 pool read다. handler는 동기 Result를 돌려준다. 보이는 범위는 guards.ts가 정한다.
// archive한 session도 원문을 그대로 읽는다.

const PAGE = 50;

function notFound(): Result<never> {
  return err({ code: "not_found", message: "session not found" });
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
  session: ReadDefinition<typeof agentSessionRead>;
  sessions: ReadDefinition<typeof agentSessionList>;
  messages: ReadDefinition<typeof receivedMessageList>;
  message: ReadDefinition<typeof receivedMessageRead>;
  compactRequests: ReadDefinition<typeof sessionCompactRequests>;
} {
  return {
    session: {
      route: agentSessionRead,
      handle(snapshot, ctx, input) {
        const row = loadSession(snapshot, input.session);
        if (row === undefined || !sessionVisible(ctx, row)) return notFound();
        return ok({
          session: agentSessionOf(row),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    sessions: {
      route: agentSessionList,
      handle(snapshot, ctx, input) {
        const after = cursorAfter(input.cursor);
        if (!after.ok) return after;
        const scope = visibleSessions(ctx);
        const empty = ok({
          sessions: [],
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
        if (scope === undefined) return empty;
        // 목록은 agent별이다. 제목 검색은 화면이 이 결과의 제목만 거른다.
        const which = agentClause(input.agent);
        const clauses = ["created_seq > ?", `(${which.sql})`];
        const params: (string | bigint)[] = [
          after.value ?? 0n,
          ...which.params,
        ];
        // agent는 자기 session만 본다.
        if (scope !== null) {
          clauses.push("id = ?");
          params.push(scope);
        }
        const archived = input.archived ?? "exclude";
        if (archived !== "include") {
          clauses.push("lifecycle = ?");
          params.push(archived === "only" ? "archived" : "open");
        }
        const rows = snapshot.sql.all(
          `select ${SESSION_COLUMNS} from sessions
           where ${clauses.join(" and ")} order by created_seq limit ?`,
          [...params, PAGE + 1],
        ).map(sessionRowOf);
        const page = rows.slice(0, PAGE);
        const last = page[page.length - 1];
        return ok({
          sessions: page.map(agentSessionOf),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: rows.length > PAGE && last !== undefined
            ? cursorOf(last.created_seq)
            : null,
        });
      },
    },
    // 요약 요청을 session의 agent와 place로 말하는 계약이 아직 옛 assignment 모양이라 요청을 내지 않는다.
    // compact는 그 계약이 바뀔 때까지 막혀 있다.
    compactRequests: {
      route: sessionCompactRequests,
      handle(snapshot) {
        return ok({
          requests: [],
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    messages: {
      route: receivedMessageList,
      handle(snapshot, ctx, input) {
        const session = loadSession(snapshot, input.session);
        if (session === undefined || !sessionVisible(ctx, session)) {
          return notFound();
        }
        const after = cursorAfter(input.cursor);
        if (!after.ok) return after;
        const clauses = ["session = ?", "created_seq > ?"];
        const params: (string | bigint)[] = [session.id, after.value ?? 0n];
        if (input.turn !== undefined) {
          clauses.push("turn = ?");
          params.push(input.turn);
        }
        const rows = snapshot.sql.all(
          `select ${MESSAGE_COLUMNS} from messages
           where ${clauses.join(" and ")} order by created_seq limit ?`,
          [...params, PAGE + 1],
        ).map(messageRowOf);
        const page = rows.slice(0, PAGE);
        const last = page[page.length - 1];
        return ok({
          messages: page.map(receivedMessageOf),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: rows.length > PAGE && last !== undefined
            ? cursorOf(last.created_seq)
            : null,
        });
      },
    },
    message: {
      route: receivedMessageRead,
      handle(snapshot, ctx, input) {
        const row = loadMessage(snapshot, input.message);
        const session = row === undefined
          ? undefined
          : loadSession(snapshot, row.session);
        if (
          row === undefined || session === undefined ||
          !sessionVisible(ctx, session)
        ) {
          return err({ code: "not_found", message: "message not found" });
        }
        return ok({
          message: receivedMessageOf(row),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
  };
}
