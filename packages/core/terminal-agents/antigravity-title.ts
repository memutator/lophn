// Antigravity(`agy`) TUI는 OSC 제목과 hook payload에 AI 제목을 싣지 않고 자기 summary SQLite DB에만 쓴다.
// 사람의 `~/.gemini/antigravity-cli/conversation_summaries.db`를 읽기 전용으로 열어 AI 제목과 subagent 여부만 읽는다.
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

function withReadOnlyDb<T>(
  dbPath: string,
  fallback: T,
  read: (db: DatabaseSync) => T,
): T {
  if (!existsSync(dbPath)) return fallback;
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    return read(db);
  } catch {
    return fallback;
  } finally {
    try {
      db?.close();
    } catch {
      // ignore close errors
    }
  }
}

/** `conversation_summaries.db`에서 해당 conversation의 AI 제목을 읽는다. 없거나 비어 있으면 null이다. */
export function readAntigravityTitle(
  dbPath: string,
  conversationId: string,
): string | null {
  return withReadOnlyDb(dbPath, null, (db) => {
    const row = db
      .prepare(
        "SELECT title FROM conversation_summaries WHERE conversation_id = ?",
      )
      .get(conversationId) as { title?: unknown } | undefined;
    const title = typeof row?.title === "string" ? row.title.trim() : "";
    return title.length > 0 ? title : null;
  });
}

/**
 * `conversation_summaries.db`에서 해당 conversation이 subagent(부모가 있거나 `nesting_depth > 0`)인지 확인한다.
 * DB·행·컬럼이 없으면 false로 내려간다(일반 세션을 잘못 숨기지 않는다).
 */
export function isAntigravitySubagent(
  dbPath: string,
  conversationId: string,
): boolean {
  if (conversationId.trim() === "") return false;
  return withReadOnlyDb(dbPath, false, (db) => {
    const row = db
      .prepare(
        "SELECT parent_conversation_id, nesting_depth FROM conversation_summaries WHERE conversation_id = ?",
      )
      .get(conversationId) as
      | { parent_conversation_id?: unknown; nesting_depth?: unknown }
      | undefined;
    if (row === undefined) return false;
    const hasParent =
      typeof row.parent_conversation_id === "string" &&
      row.parent_conversation_id.trim() !== "";
    const nested =
      typeof row.nesting_depth === "number" && row.nesting_depth > 0;
    return hasParent || nested;
  });
}

/**
 * 주어진 conversation id들 가운데 `conversation_summaries.db`에 subagent로 기록된 id 집합을 한 번의 쿼리로 읽는다.
 * DB·컬럼이 없으면 빈 집합을 돌려준다.
 */
export function readAntigravitySubagentIds(
  dbPath: string,
  conversationIds: readonly string[],
): Set<string> {
  const unique = [
    ...new Set(conversationIds.filter((id) => id.trim().length > 0)),
  ];
  if (unique.length === 0) return new Set();
  return withReadOnlyDb(dbPath, new Set<string>(), (db) => {
    const placeholders = unique.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT conversation_id FROM conversation_summaries WHERE conversation_id IN (${placeholders}) AND (parent_conversation_id != '' OR nesting_depth > 0)`,
      )
      .all(...unique) as Array<{ conversation_id?: unknown }>;
    const found = new Set<string>();
    for (const row of rows) {
      if (typeof row.conversation_id === "string") {
        found.add(row.conversation_id);
      }
    }
    return found;
  });
}
