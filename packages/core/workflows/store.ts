import { err, ok, type Result } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/mod.ts";
import type { Sql } from "../../protocol/server/mod.ts";
import type {
  InstanceStep,
  Participant,
  ReportLine,
  StartedBy,
  WorkflowInstance,
  WorkflowLine,
  WorkflowState,
} from "../../protocol/workflows/mod.ts";
import {
  instanceFromRow,
  lineColumns,
  lineFromRow,
  type NewLine,
} from "./rows.ts";

type Query = Pick<Sql, "get" | "all">;
type Write = Pick<Sql, "get" | "run">;

export type Current = { step: string; human_turn: boolean } | null;

// 기록 event 없이 표 안에서 이어 센다.
function nextStateSeq(sql: Pick<Sql, "get">): number {
  const row = sql.get(
    "SELECT coalesce(max(state_seq), 0) + 1 AS next FROM workflow_instances",
    [],
  );
  return row === undefined ? 1 : Number(row["next"]);
}

export function insertInstance(
  sql: Write,
  instance: {
    id: Id<"wfi">;
    project: Id<"prj">;
    workflow: string;
    input: string;
    participants: Record<string, Participant>;
    steps: InstanceStep[];
    current: Current;
    started_by: StartedBy;
    created_at: string;
  },
): void {
  sql.run(
    `INSERT INTO workflow_instances
      (id, project, workflow, input, state, participants, steps, current_step,
       human_turn, started_by, created_at, state_seq)
     VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?)`,
    [
      instance.id,
      instance.project,
      instance.workflow,
      instance.input,
      JSON.stringify(instance.participants),
      JSON.stringify(instance.steps),
      instance.current?.step ?? null,
      instance.current?.human_turn ? 1 : 0,
      JSON.stringify(instance.started_by),
      instance.created_at,
      nextStateSeq(sql),
    ],
  );
}

export function loadInstance(
  sql: Pick<Sql, "get">,
  id: string,
): Result<WorkflowInstance | null> {
  const row = sql.get("SELECT * FROM workflow_instances WHERE id = ?", [id]);
  return row === undefined ? ok(null) : instanceFromRow(row);
}

export function updateInstance(
  sql: Write,
  id: string,
  change: {
    state: WorkflowState;
    current: Current;
    steps: InstanceStep[];
    finished_at: string | null;
  },
): Result<void> {
  const changed = sql.run(
    `UPDATE workflow_instances SET state = ?, current_step = ?, human_turn = ?,
       steps = ?, finished_at = ?, state_seq = ?
     WHERE id = ?`,
    [
      change.state,
      change.current?.step ?? null,
      change.current?.human_turn ? 1 : 0,
      JSON.stringify(change.steps),
      change.finished_at,
      nextStateSeq(sql),
      id,
    ],
  );
  return Number(changed.changes) === 1
    ? ok(undefined)
    : err({ code: "not_found", message: "workflow instance not found" });
}

// seq는 그 instance 안에서 이어 센다. 한 tx 안에서 여럿 남겨도 이어진다.
export function appendLine(
  sql: Write,
  instance: string,
  at: string,
  line: NewLine,
): string {
  const next = Number(
    sql.get(
      "SELECT coalesce(max(seq), 0) + 1 AS next FROM workflow_lines WHERE instance = ?",
      [instance],
    )?.["next"] ?? 1,
  );
  const { step, body, data } = lineColumns(line);
  sql.run(
    `INSERT INTO workflow_lines (instance, seq, at, kind, by, step, body, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [instance, next, at, line.kind, JSON.stringify(line.by), step, body, data],
  );
  return String(next);
}

function parseLines(rows: Record<string, unknown>[]): Result<WorkflowLine[]> {
  const lines: WorkflowLine[] = [];
  for (const row of rows) {
    const line = lineFromRow(row);
    if (!line.ok) return line;
    lines.push(line.value);
  }
  return ok(lines);
}

// seq > after 오름차순. limit이 null이면 끝까지다.
export function loadLines(
  sql: Query,
  instance: string,
  page: { after: number; limit: number | null },
): Result<WorkflowLine[]> {
  return parseLines(
    sql.all(
      `SELECT * FROM workflow_lines WHERE instance = ? AND seq > ?
     ORDER BY seq LIMIT ?`,
      [instance, page.after, page.limit ?? -1],
    ),
  );
}

// step마다 seq가 가장 큰 report 줄이다.
export function lastReports(
  sql: Query,
  instance: string,
): Result<Record<string, ReportLine>> {
  const lines = parseLines(
    sql.all(
      `SELECT * FROM workflow_lines AS l
     WHERE instance = ? AND kind = 'report' AND seq = (
       SELECT max(seq) FROM workflow_lines
       WHERE instance = l.instance AND kind = 'report' AND step = l.step
     )`,
      [instance],
    ),
  );
  if (!lines.ok) return lines;
  const reports: Record<string, ReportLine> = {};
  for (const line of lines.value) {
    if (line.kind === "report") reports[line.step] = line;
  }
  return ok(reports);
}

export function lastLine(
  sql: Query,
  instance: string,
): Result<WorkflowLine | null> {
  const lines = parseLines(
    sql.all(
      "SELECT * FROM workflow_lines WHERE instance = ? ORDER BY seq DESC LIMIT 1",
      [instance],
    ),
  );
  return lines.ok ? ok(lines.value[0] ?? null) : lines;
}

function parseInstances(
  rows: Record<string, unknown>[],
): Result<WorkflowInstance[]> {
  const instances: WorkflowInstance[] = [];
  for (const row of rows) {
    const instance = instanceFromRow(row);
    if (!instance.ok) return instance;
    instances.push(instance.value);
  }
  return ok(instances);
}

// 새것이 앞이다. 준 칸은 모두 AND로 건다. after는 page 마지막 instance id다.
export function listInstances(
  sql: Query,
  filter: {
    project: string;
    workflow?: string;
    state?: WorkflowState;
    after?: string;
    limit: number;
  },
): Result<WorkflowInstance[]> {
  const where = ["project = ?"];
  const params: (string | number)[] = [filter.project];
  if (filter.workflow !== undefined) {
    where.push("workflow = ?");
    params.push(filter.workflow);
  }
  if (filter.state !== undefined) {
    where.push("state = ?");
    params.push(filter.state);
  }
  if (filter.after !== undefined) {
    where.push("id < ?");
    params.push(filter.after);
  }
  params.push(filter.limit);
  return parseInstances(
    sql.all(
      `SELECT * FROM workflow_instances WHERE ${where.join(" AND ")}
     ORDER BY id DESC LIMIT ?`,
      params,
    ),
  );
}

// 모든 project의 running instance.
export function runningInstances(sql: Query): Result<WorkflowInstance[]> {
  return parseInstances(
    sql.all(
      "SELECT * FROM workflow_instances WHERE state = 'running' ORDER BY id",
      [],
    ),
  );
}

// idle-exit가 보는 일. project를 가리지 않고 running인 instance가 있으면 true다.
export function hasActivity(sql: Query): Result<boolean> {
  const row = sql.get(
    "SELECT EXISTS (SELECT 1 FROM workflow_instances WHERE state = 'running') AS busy",
    [],
  );
  return ok(Number(row?.["busy"] ?? 0) === 1);
}
