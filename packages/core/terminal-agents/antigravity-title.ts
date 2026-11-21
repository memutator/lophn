// Antigravity(`agy`) TUI는 OSC 제목과 hook payload에 AI 제목을 싣지 않고 자기 summary SQLite DB에만 쓴다.
// 사람의 `~/.gemini/antigravity-cli/conversation_summaries.db`를 읽기 전용으로 열어 해당 conversation의 제목만 읽는다.
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

/** `conversation_summaries.db`에서 해당 conversation의 AI 제목을 읽는다. 없거나 비어 있으면 null이다. */
export function readAntigravityTitle(
  dbPath: string,
  conversationId: string,
): string | null {
  if (!existsSync(dbPath)) return null;
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const row = db
      .prepare(
        "SELECT title FROM conversation_summaries WHERE conversation_id = ?",
      )
      .get(conversationId) as { title?: unknown } | undefined;
    const title = typeof row?.title === "string" ? row.title.trim() : "";
    return title.length > 0 ? title : null;
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      // ignore close errors
    }
  }
}
