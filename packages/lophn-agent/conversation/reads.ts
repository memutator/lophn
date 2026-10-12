import { err, ok, type Result } from "../../base/mod.ts";
import {
  messagesList,
  sessionCompactRequests,
  sessionList,
  sessionRead,
} from "../../protocol/lophn-agent/mod.ts";
import type { ReadDefinition } from "../../protocol/platform/mod.ts";
import { sessionVisible, visibleAssignment } from "./guards.ts";
import {
  loadSession,
  MESSAGE_COLUMNS,
  messageRowOf,
  SESSION_COLUMNS,
  sessionRecordOf,
  sessionRowOf,
  snapshotOf,
} from "./model.ts";

// read는 pool read다. handler는 동기 Result를 돌려준다. 보이는 범위는 guards.ts가 정한다.
// 닫힌 세션도 원문을 그대로 읽는다(R8).

const PAGE = 50;
const PAGE_MAX = 200;

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
  session: ReadDefinition<typeof sessionRead>;
  sessions: ReadDefinition<typeof sessionList>;
  messages: ReadDefinition<typeof messagesList>;
  compactRequests: ReadDefinition<typeof sessionCompactRequests>;
} {
  return {
    session: {
      route: sessionRead,
      handle(snapshot, ctx, input) {
        const row = loadSession(snapshot, input.session);
        if (row === undefined || !sessionVisible(ctx, row)) return notFound();
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
        // 다른 agent의 목록을 이름으로 물어도 비어 있다(R21).
        if (scope === undefined) return empty;
        if (scope !== null && input.assignment !== scope) return empty;
        // 목록은 agent와 자리별이다. 제목 검색은 화면이 이 결과의 제목만 거른다.
        const clauses = [
          "created_seq > ?",
          "assignment = ?",
          "work_place_kind = ?",
          "work_place_id = ?",
        ];
        const params: (string | bigint)[] = [
          after.value ?? 0n,
          input.assignment,
          input.work_place.kind,
          input.work_place.id,
        ];
        const archived = input.archived ?? "exclude";
        if (archived !== "include") {
          clauses.push("archived = ?");
          params.push(archived === "only" ? 1n : 0n);
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
    // runtime이 요약을 시작할 Compact 요청이다. 끝나지 않은 run이 있는 session의 요청은 그 run이 끝날 때까지
    // 나오지 않고(그 사이에 요약을 시작하지 않는다) 가장 오래된 요청부터 나온다.
    compactRequests: {
      route: sessionCompactRequests,
      handle(snapshot) {
        const rows = snapshot.sql.all(
          `select cast(r.request_seq as text) as request_seq, s.id as id,
             s.assignment as assignment, s.work_place_kind as kind,
             s.work_place_id as place
           from session_compact_requests r join sessions s on s.id = r.session
           where r.state = 'requested' and s.state = 'open'
             and not exists (
               select 1 from runs where session = s.id and state != 'finished')
           order by r.request_seq limit ?`,
          [PAGE],
        );
        return ok({
          requests: rows.map((row) => ({
            session: String(row["id"]),
            assignment: String(row["assignment"]),
            work_place: {
              kind: String(row["kind"]),
              id: String(row["place"]),
            } as never,
            request_seq: String(row["request_seq"]),
          })),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    messages: {
      route: messagesList,
      handle(snapshot, ctx, input) {
        const session = loadSession(snapshot, input.session);
        if (session === undefined || !sessionVisible(ctx, session)) {
          return notFound();
        }
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
