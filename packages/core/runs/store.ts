import { err, ok, type Result } from "../../base/mod.ts";
import type { AgentRef } from "../../protocol/lophn-agent/mod.ts";
import type { RunPlace, RunRecord, RunState } from "../../protocol/runs/mod.ts";
import { runRecordSchema } from "../../protocol/runs/mod.ts";
import type { Sql } from "../../protocol/server/mod.ts";

type Query = Pick<Sql, "get" | "all">;

// ListRuns의 거르기와 CreateRun이 같은 글로 비교하려고 한 함수를 같이 쓴다.
export function agentKeyOf(agent: AgentRef): string {
  switch (agent.role) {
    case "lophn":
      return "lophn";
    case "project_manager":
      return `project_manager:${agent.project}`;
    case "app_engineer":
      return `app_engineer:${agent.app}`;
    case "operator":
      return `operator:${agent.agent}`;
  }
}

export function placeKeyOf(place: RunPlace): string {
  return "project" in place ? `project:${place.project}` : `app:${place.app}`;
}

function nullable<T>(value: T | null | undefined): T | null {
  return value ?? null;
}

function runFromRow(row: Record<string, unknown>): Result<RunRecord> {
  const parsed = runRecordSchema.safeParse({
    id: row.id,
    kind: row.kind,
    target: JSON.parse(String(row.target)),
    session: row.session,
    session_opened: Number(row.session_opened) === 1,
    input_message: row.input_message,
    turn: row.turn,
    invocation: row.invocation,
    schema: row.schema === null ? null : JSON.parse(String(row.schema)),
    job: row.job,
    state: row.state,
    result: row.result === null ? null : JSON.parse(String(row.result)),
    error: row.error_reason === null
      ? null
      : { reason: row.error_reason, message: row.error_message },
    created_at: row.created_at,
    finished_at: row.finished_at,
    state_seq: String(row.state_seq),
  });
  return parsed.success
    ? ok(parsed.data)
    : err({ code: "internal", message: "invalid stored run" });
}

// 기록 event 없이 표 안에서 이어 센다.
function nextStateSeq(sql: Pick<Sql, "get">): number {
  const row = sql.get(
    "SELECT coalesce(max(state_seq), 0) + 1 AS next FROM runs",
    [],
  );
  return row === undefined ? 1 : Number(row["next"]);
}

export function loadRun(sql: Query, id: string): Result<RunRecord | null> {
  const row = sql.get("SELECT * FROM runs WHERE id = ?", [id]);
  return row === undefined ? ok(null) : runFromRow(row);
}

export function insertRun(
  sql: Pick<Sql, "get" | "run">,
  run: {
    id: string;
    kind: string;
    target: unknown;
    place: RunPlace | null;
    session: string | null;
    session_opened: boolean;
    input_message: string | null;
    schema: unknown;
    job: string | null;
    created_at: string;
  },
): void {
  const agent = (run.target as { agent?: AgentRef }).agent;
  sql.run(
    `INSERT INTO runs
      (id, kind, target, session, session_opened, input_message, schema, job, state,
       created_at, state_seq, agent_key, place_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?)`,
    [
      run.id,
      run.kind,
      JSON.stringify(run.target),
      run.session,
      run.session_opened ? 1 : 0,
      run.input_message,
      run.schema === null ? null : JSON.stringify(run.schema),
      run.job,
      run.created_at,
      nextStateSeq(sql),
      agent === undefined ? null : agentKeyOf(agent),
      run.place === null ? null : placeKeyOf(run.place),
    ],
  );
}

// 새것이 앞이다. 준 칸은 모두 AND로 건다. cursor는 page 마지막 run id다.
export function listRuns(
  sql: Query,
  filter: {
    session?: string;
    agent?: AgentRef;
    place?: RunPlace;
    state?: RunState;
    after?: string;
    limit: number;
  },
): Result<RunRecord[]> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.session !== undefined) {
    where.push("session = ?");
    params.push(filter.session);
  }
  if (filter.agent !== undefined) {
    where.push("agent_key = ?");
    params.push(agentKeyOf(filter.agent));
  }
  if (filter.place !== undefined) {
    where.push("place_key = ?");
    params.push(placeKeyOf(filter.place));
  }
  if (filter.state !== undefined) {
    where.push("state = ?");
    params.push(filter.state);
  }
  if (filter.after !== undefined) {
    where.push("id < ?");
    params.push(filter.after);
  }
  const clause = where.length === 0 ? "" : ` WHERE ${where.join(" AND ")}`;
  params.push(filter.limit);
  const runs: RunRecord[] = [];
  for (
    const row of sql.all(
      `SELECT * FROM runs${clause} ORDER BY id DESC LIMIT ?`,
      params,
    )
  ) {
    const run = runFromRow(row);
    if (!run.ok) return run;
    runs.push(run.value);
  }
  return ok(runs);
}

export function settleRow(
  sql: Pick<Sql, "get" | "run">,
  input: {
    id: string;
    state: "done" | "failed" | "cancelled";
    turn?: string | undefined;
    invocation?: string | null | undefined;
    result?: unknown;
    error?: { reason: string; message: string } | undefined;
    now: string;
  },
): Result<void> {
  const changed = sql.run(
    `UPDATE runs SET state = ?, turn = coalesce(?, turn),
       invocation = coalesce(?, invocation), result = ?,
       error_reason = ?, error_message = ?, finished_at = ?, state_seq = ?
     WHERE id = ? AND state = 'running'`,
    [
      input.state,
      nullable(input.turn),
      nullable(input.invocation),
      input.result === undefined ? null : JSON.stringify(input.result),
      input.error?.reason ?? null,
      input.error?.message ?? null,
      input.now,
      nextStateSeq(sql),
      input.id,
    ],
  );
  return Number(changed.changes) === 1
    ? ok(undefined)
    : err({ code: "conflict", message: "run is not running" });
}
