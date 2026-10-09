import { err, ok } from "../../base/mod.ts";
import {
  atSchema,
  idSchema,
  notificationsDisplay,
  notificationsGet,
  notificationsList,
  type ReadDefinition,
} from "../../contracts/platform/mod.ts";
import { notificationView } from "./model.ts";
import { osDisplayRequest } from "./os-display.ts";
import { notificationOf, readNotificationRow } from "./store.ts";

const documentId = idSchema("doc");

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parsePayload(raw: unknown): unknown {
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ContextWatchedItemChanged가 저장한 문서 참조만. 없거나 id가 아니면 null이다.
function documentOf(event: string, payload: unknown): string | null {
  if (event !== "ContextWatchedItemChanged" || !isRecord(payload)) return null;
  const target = payload["target"];
  if (!isRecord(target) || target["kind"] !== "document") return null;
  const document = target["document"];
  return typeof document === "string" && documentId.safeParse(document).success
    ? document
    : null;
}

// 사람 줄만 본다. 다른 actor에게는 source 시각·문서 참조를 열지 않고 payload는 어디에도 없다.
function lineFacts(
  actor: string,
  event: string,
  at: unknown,
  payload: unknown,
): { occurred_at?: string; document?: string | null } {
  if (actor !== "user") return {};
  const facts: { occurred_at?: string; document: string | null } = {
    document: documentOf(event, payload),
  };
  if (typeof at === "string" && atSchema.safeParse(at).success) {
    facts.occurred_at = at;
  }
  return facts;
}

type GetRoute = typeof notificationsGet;
type ListRoute = typeof notificationsList;
type DisplayRoute = typeof notificationsDisplay;

// get은 source 사실과 읽음을 그대로 본다(R3, R11). 현재 대상 상태는 read가
// 조립하지 않는다. 결과 열기 경로는 source_event가 가리킨다.
export function notificationsGetRead(): ReadDefinition<GetRoute> {
  return {
    route: notificationsGet,
    handle(snapshot, ctx, input) {
      const row = readNotificationRow(snapshot.sql, input.notification);
      if (row === undefined) {
        return err({ code: "not_found", message: "notification이 없다" });
      }
      const source = snapshot.sql.get(
        "select at, payload from events where seq = ?",
        [BigInt(row.notification.source_seq)],
      );
      return ok({
        notification: {
          id: row.notification.id,
          source_seq: row.notification.source_seq,
          read_at: row.notification.read_at,
        },
        source_event: row.source_event,
        ...lineFacts(
          ctx.actor,
          row.source_event,
          source?.["at"],
          parsePayload(source?.["payload"]),
        ),
        as_of_seq: snapshot.as_of_seq,
        next_cursor: null,
      } as never);
    },
  };
}

// 발생 순서대로 모두 읽는다(R11). 임의 종류·고정 개수로 생략하지 않고 page로 나눈다.
export function notificationsListRead(): ReadDefinition<ListRoute> {
  return {
    route: notificationsList,
    handle(snapshot, ctx, input) {
      const limit = Math.min(input.limit ?? 100, 500);
      const clauses: string[] = [];
      const params: bigint[] = [];
      if (input.unread_only === true) {
        clauses.push("read_at is null");
      }
      if (input.after_source_seq !== undefined) {
        clauses.push("source_seq > ?");
        params.push(BigInt(input.after_source_seq));
      }
      const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
      const rows = snapshot.sql.all(
        `with source as (
           select id, cast(source_seq as text) as source_seq, read_at
           from notifications ${where} order by source_seq limit ?
         )
         select source.*, events.type as source_event,
                events.at as source_at, events.payload as source_payload
         from source join events on events.seq = cast(source.source_seq as integer)
         order by cast(source.source_seq as integer)`,
        [...params, limit],
      );
      const notifications = rows.map((row) => ({
        notification: {
          id: String(row["id"]),
          source_seq: String(row["source_seq"]),
          read_at: row["read_at"] === null ? null : String(row["read_at"]),
        },
        source_event: String(row["source_event"]),
        ...lineFacts(
          ctx.actor,
          String(row["source_event"]),
          row["source_at"],
          parsePayload(row["source_payload"]),
        ),
      }));
      const last = rows.length
        ? String(rows[rows.length - 1]["source_seq"])
        : null;
      return ok({
        notifications,
        as_of_seq: snapshot.as_of_seq,
        next_cursor: last,
        omitted: [],
      } as never);
    },
  };
}

// shell main이 OS에 올릴 요청이다(R9). 제목·열 곳은 source 사실에서 redaction을 거쳐 만든다.
// 사람이 켰는지는 settings 값이라 이 read가 아니라 core 조립이 본다(켜지 않았으면 display를
// 비운다). 없는 notification은 not_found다.
export function notificationsDisplayRead(): ReadDefinition<DisplayRoute> {
  return {
    route: notificationsDisplay,
    handle(snapshot, _ctx, input) {
      const row = snapshot.sql.get(
        `select n.id as id, cast(n.source_seq as text) as source_seq,
                n.read_at as read_at, e.type as type, e.subject as subject,
                e.payload as payload
         from notifications n join events e on e.seq = n.source_seq
         where n.id = ?`,
        [input.notification],
      );
      if (row === undefined) {
        return err({ code: "not_found", message: "notification이 없다" });
      }
      let payload: unknown = null;
      try {
        payload = JSON.parse(String(row["payload"]));
      } catch {
        payload = null;
      }
      const view = notificationView(
        notificationOf(row),
        String(row["type"]),
        row["subject"],
        payload,
      );
      return ok({
        display: osDisplayRequest(view, true),
        as_of_seq: snapshot.as_of_seq,
        next_cursor: null,
      } as never);
    },
  };
}
