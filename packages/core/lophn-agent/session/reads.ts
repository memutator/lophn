import { err, ok, type Result } from "../../../base/mod.ts";
import {
  workspaceSessionCompactRequests,
  workspaceSessionList,
  workspaceSessionRead,
  receivedMessageList,
  receivedMessageRead,
} from "../../../protocol/lophn-agent/mod.ts";
import type { ReadDefinition, SqlRow } from "../../../protocol/server/mod.ts";
import { sessionVisible, visibleSessions } from "./guards.ts";
import {
  loadMessage,
  loadSession,
  MESSAGE_COLUMNS,
  messageRowOf,
  workspaceOf,
  workspaceSessionOf,
  receivedMessageOf,
  SESSION_COLUMNS,
  sessionClause,
  sessionRowOf,
} from "./model.ts";

// read는 pool read다. handler는 동기 Result를 돌려준다. 보이는 범위는 guards.ts가 정한다.
// archive한 session도 원문을 그대로 읽는다.

const PAGE = 50;

function notFound(): Result<never> {
  return err({ code: "not_found", message: "session not found" });
}

function lastActiveAtOf(row: SqlRow | undefined): string | null {
  const value = row?.["last_active_at"];
  return value === null || value === undefined ? null : String(value);
}

function cursorAfter(cursor: string | undefined): Result<bigint | null> {
  if (cursor === undefined) return ok(null);
  try {
    const bytes = Uint8Array.from(atob(cursor), (char) => char.charCodeAt(0));
    const parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as { after?: unknown };
    if (
      typeof parsed.after !== "string" ||
      !/^[1-9][0-9]*$/.test(parsed.after)
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
  session: ReadDefinition<typeof workspaceSessionRead>;
  sessions: ReadDefinition<typeof workspaceSessionList>;
  messages: ReadDefinition<typeof receivedMessageList>;
  message: ReadDefinition<typeof receivedMessageRead>;
  compactRequests: ReadDefinition<typeof workspaceSessionCompactRequests>;
} {
  return {
    session: {
      route: workspaceSessionRead,
      handle(snapshot, ctx, input) {
        const row = loadSession(snapshot, input.session);
        if (row === undefined || !sessionVisible(ctx, row)) return notFound();
        return ok({
          session: workspaceSessionOf(row),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    sessions: {
      route: workspaceSessionList,
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
        const which = sessionClause(input.agent, input.workspace);
        // GUI 탭의 팀원 session은 그 탭이 자리다. 목록에 한 번 더 세우지 않는다.
        const clauses = [
          "created_seq > ?",
          `(${which.sql})`,
          "harness_gui = 0",
        ];
        const params: (string | bigint | null)[] = [
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
        // 마지막 활동은 turn 표에서 한 번에 구한다. 화면이 session마다 turn을 읽지 않게 한다.
        const raw = snapshot.sql.all(
          `select ${SESSION_COLUMNS},
             (select max(coalesce(t.finished_at, t.started_at)) from turns t
              where t.session = sessions.id) as last_active_at
           from sessions
           where ${clauses.join(" and ")} order by created_seq limit ?`,
          [...params, PAGE + 1],
        );
        const rows = raw.map(sessionRowOf);
        const page = rows.slice(0, PAGE);
        const last = page[page.length - 1];
        return ok({
          sessions: page.map((row, index) => ({
            ...workspaceSessionOf(row),
            last_active_at: lastActiveAtOf(raw[index]),
          })),
          as_of_seq: snapshot.as_of_seq,
          next_cursor:
            rows.length > PAGE && last !== undefined
              ? cursorOf(last.created_seq)
              : null,
        });
      },
    },
    // 열린 요청을 오래된 것부터 낸다. 도는 turn이 있는 session의 요청은 그 turn이 끝날 때까지 나오지 않는다.
    compactRequests: {
      route: workspaceSessionCompactRequests,
      handle(snapshot) {
        const rows = snapshot.sql.all(
          `select cast(r.request_seq as text) as request_seq, s.*
           from session_compact_requests r join sessions s on s.id = r.session
           where r.state = 'requested' and s.lifecycle = 'open'
             and not exists (
               select 1 from turns t where t.session = s.id and t.state = 'running'
             )
           order by r.request_seq limit ?`,
          [PAGE],
        );
        return ok({
          requests: rows.map((row) => {
            const session = sessionRowOf(row);
            return {
              session: session.id,
              agent: session.agent,
              workspace: workspaceOf(session),
              request_seq: String(row["request_seq"]),
            };
          }),
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
        const rows = snapshot.sql
          .all(
            `select ${MESSAGE_COLUMNS} from messages
           where ${clauses.join(" and ")} order by created_seq limit ?`,
            [...params, PAGE + 1],
          )
          .map(messageRowOf);
        const page = rows.slice(0, PAGE);
        const last = page[page.length - 1];
        return ok({
          messages: page.map(receivedMessageOf),
          as_of_seq: snapshot.as_of_seq,
          next_cursor:
            rows.length > PAGE && last !== undefined
              ? cursorOf(last.created_seq)
              : null,
        });
      },
    },
    message: {
      route: receivedMessageRead,
      handle(snapshot, ctx, input) {
        const row = loadMessage(snapshot, input.message);
        const session =
          row === undefined ? undefined : loadSession(snapshot, row.session);
        if (
          row === undefined ||
          session === undefined ||
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
