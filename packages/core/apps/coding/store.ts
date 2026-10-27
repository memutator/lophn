// coding session, 앱 줄, 넣기를 기다리는 메시지의 표 읽기·쓰기. writer와 reader가 같이 쓴다.
import type { HarnessId } from "../../../protocol/coding-agent/harness-id.ts";
import {
  type CodingOptions,
  codingOptionsSchema,
} from "../../../protocol/coding-agent/harness-id.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { Place } from "../../../protocol/lophn-agent/places.ts";

type Reader = Pick<Sql, "get" | "all">;

// coding session의 place는 앱이다. 터미널은 app space에 열린다. 앱이 없으면 null이다.
export function codingPlace(sql: Reader, app: string): Place | null {
  return sql.get("select id from apps where id = ?", [app]) === undefined
    ? null
    : { kind: "app", id: app as Id<"app"> };
}

type SessionState = "running" | "waiting" | "idle" | "unknown";

export type SessionRow = {
  session: string;
  app: string;
  prompt: string;
  call: string;
  harness: HarnessId;
  ended: boolean;
  // SessionStarted를 냈는가. 냈으면 끝날 때 SessionEnded를 낸다.
  started: boolean;
  // harness가 무엇이든 알려 준 적이 있는가. 없으면 상태는 unknown이고 메시지를 넣지 않는다.
  // 화면 출력으로 idle을 짐작하지 않는다. hook 신호만 믿는다.
  heard: boolean;
  running: boolean;
  turn: string | null;
  // 풀리지 않은 권한 요청 ID. 먼저 온 것부터다.
  permissions: string[];
  // 넣은 메시지가 아직 TurnStarted로 이어지지 않았다.
  inflight: boolean;
  external_session: string | null;
  // 첫 prompt를 harness에 넘겼으나 MessageReceived를 아직 내지 않았다.
  prompt_pending: boolean;
  // 첫 prompt를 hook 뒤에 넣는 제품이 SessionStarted hook을 기다리는 기한. 기다리지 않으면 null.
  paste_until: string | null;
};

const COLUMNS = `session, app, prompt, call, harness, ended, started, heard, running, turn,
   permissions, inflight, external_session, prompt_pending, paste_until`;

// createSql이 INTEGER를 bigint로 주므로 1n === 1이 거짓이다. Number로 바꿔 비교한다.
function rowOf(row: Record<string, unknown>): SessionRow {
  return {
    session: String(row.session),
    app: String(row.app),
    prompt: String(row.prompt),
    call: String(row.call),
    harness: row.harness as HarnessId,
    ended: Number(row.ended) === 1,
    started: Number(row.started) === 1,
    heard: Number(row.heard) === 1,
    running: Number(row.running) === 1,
    turn: row.turn === null ? null : String(row.turn),
    permissions: JSON.parse(String(row.permissions)) as string[],
    inflight: Number(row.inflight) === 1,
    external_session:
      row.external_session === null ? null : String(row.external_session),
    prompt_pending: Number(row.prompt_pending) === 1,
    paste_until: row.paste_until === null ? null : String(row.paste_until),
  };
}

export function loadSession(sql: Reader, session: string): SessionRow | null {
  const row = sql.get(
    `SELECT ${COLUMNS} FROM coding_sessions WHERE session = ?`,
    [session],
  );
  return row === undefined ? null : rowOf(row);
}

// 앱 하나에 끝나지 않은 session은 하나뿐이다.
export function activeOf(sql: Reader, app: string): SessionRow | null {
  const row = sql.get(
    `SELECT ${COLUMNS} FROM coding_sessions WHERE app = ? AND ended = 0`,
    [app],
  );
  return row === undefined ? null : rowOf(row);
}

export function activeOfCall(sql: Reader, call: string): SessionRow | null {
  const row = sql.get(
    `SELECT ${COLUMNS} FROM coding_sessions WHERE call = ? AND ended = 0`,
    [call],
  );
  return row === undefined ? null : rowOf(row);
}

// 끝나지 않은 session 전부.
export function liveSessions(sql: Reader): SessionRow[] {
  return sql
    .all(
      `SELECT ${COLUMNS} FROM coding_sessions WHERE ended = 0 ORDER BY rowid`,
      [],
    )
    .map(rowOf);
}

export function insertSession(sql: Sql, row: SessionRow): void {
  sql.run(
    `INSERT INTO coding_sessions (session, app, prompt, call, harness, paste_until)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [row.session, row.app, row.prompt, row.call, row.harness, row.paste_until],
  );
}

export function saveSession(sql: Sql, row: SessionRow): void {
  sql.run(
    `UPDATE coding_sessions SET ended = ?, started = ?, heard = ?, running = ?,
       turn = ?, permissions = ?, inflight = ?, external_session = ?,
       prompt_pending = ?, paste_until = ?
     WHERE session = ?`,
    [
      row.ended ? 1 : 0,
      row.started ? 1 : 0,
      row.heard ? 1 : 0,
      row.running ? 1 : 0,
      row.turn,
      JSON.stringify(row.permissions),
      row.inflight ? 1 : 0,
      row.external_session,
      row.prompt_pending ? 1 : 0,
      row.paste_until,
      row.session,
    ],
  );
}

export function stateOf(row: SessionRow): SessionState {
  if (row.permissions.length > 0) return "waiting";
  if (!row.heard) return "unknown";
  return row.running ? "running" : "idle";
}

export type LineRow = {
  call: string;
  app: string;
  prompt: string;
  options: CodingOptions;
};

export function pushLine(sql: Sql, line: LineRow): void {
  sql.run(
    "INSERT INTO coding_lines (call, app, prompt, options) VALUES (?, ?, ?, ?)",
    [line.call, line.app, line.prompt, JSON.stringify(line.options)],
  );
}

function lineOf(row: Record<string, unknown>): LineRow {
  return {
    call: String(row.call),
    app: String(row.app),
    prompt: String(row.prompt),
    options: codingOptionsSchema.parse(JSON.parse(String(row.options))),
  };
}

// 앱의 줄 맨 앞을 꺼낸다.
export function shiftLine(sql: Sql, app: string): LineRow | null {
  const row = sql.get(
    "SELECT call, app, prompt, options FROM coding_lines WHERE app = ? ORDER BY rowid LIMIT 1",
    [app],
  );
  if (row === undefined) return null;
  sql.run("DELETE FROM coding_lines WHERE call = ?", [row.call as string]);
  return lineOf(row);
}

export function removeLine(sql: Sql, call: string): boolean {
  const removed = sql.run("DELETE FROM coding_lines WHERE call = ?", [call]);
  return Number(removed.changes) > 0;
}

export function allLines(sql: Reader): LineRow[] {
  return sql
    .all(
      "SELECT call, app, prompt, options FROM coding_lines ORDER BY rowid",
      [],
    )
    .map(lineOf);
}

type InputRow = { id: number; call: string | null; text: string };

export function pushInput(
  sql: Sql,
  session: string,
  call: string | null,
  text: string,
): void {
  sql.run("INSERT INTO coding_inputs (session, call, text) VALUES (?, ?, ?)", [
    session,
    call,
    text,
  ]);
}

export function shiftInput(sql: Sql, session: string): InputRow | null {
  const row = sql.get(
    "SELECT id, call, text FROM coding_inputs WHERE session = ? ORDER BY id LIMIT 1",
    [session],
  );
  if (row === undefined) return null;
  sql.run("DELETE FROM coding_inputs WHERE id = ?", [row.id as number]);
  return {
    id: Number(row.id),
    call: row.call === null ? null : String(row.call),
    text: String(row.text),
  };
}

export function clearInputs(sql: Sql, session: string): void {
  sql.run("DELETE FROM coding_inputs WHERE session = ?", [session]);
}
