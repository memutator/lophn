import { err, ok, type Result } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/mod.ts";
import {
  MESSAGE_BODY_FIELD,
  MESSAGE_BODY_OWNER_KIND,
  type Workspace,
} from "../../protocol/lophn-agent/mod.ts";
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

// running instance의 derived_status를 움직이는 줄 kind들. edit·started·code_updated는 진행/막힘 판정을 지우지 않는다.
export const STATUS_LINE_KINDS = [
  "handed",
  "retried",
  "report",
  "step_stalled",
  "not_handed",
  "lophn_restarted",
  "program_exited",
  "escalated",
] as const;
export type StatusLineKind = (typeof STATUS_LINE_KINDS)[number];

const STATUS_KINDS_SQL = STATUS_LINE_KINDS.map((k) => `'${k}'`).join(", ");
const MAX_REFS = 100;
const MAX_REF_LENGTH = 1024;
const MAX_INSTANCE_SESSIONS = 100;
const ASSISTANT_PREVIEW_CANDIDATES = 5;

export type InstanceSessionRow = {
  id: string;
  parent: string | null;
  agent: string;
  workspace: Workspace | null;
  lifecycle: "open" | "archived";
  harness_gui: boolean;
  runs_on: string | null;
};

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
    inputs?: Record<string, unknown>;
    participants: Record<string, Participant>;
    steps: InstanceStep[];
    current: Current;
    started_by: StartedBy;
    created_at: string;
  },
): void {
  if (instance.inputs !== undefined) {
    sql.run(
      `INSERT INTO workflow_instances
        (id, project, workflow, input, inputs_json, state, participants, steps, current_step,
         human_turn, started_by, created_at, state_seq)
       VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?)`,
      [
        instance.id,
        instance.project,
        instance.workflow,
        instance.input,
        JSON.stringify(instance.inputs),
        JSON.stringify(instance.participants),
        JSON.stringify(instance.steps),
        instance.current?.step ?? null,
        instance.current?.human_turn ? 1 : 0,
        JSON.stringify(instance.started_by),
        instance.created_at,
        nextStateSeq(sql),
      ],
    );
    return;
  }
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

// derived_status를 결정하는 가장 나중 줄의 kind. cursor로 자른 페이지 밖 이력도 보려고 표에서 바로 읽는다.
export function lastStatusLineKind(
  sql: Pick<Sql, "get">,
  instance: string,
): StatusLineKind | null {
  const row = sql.get(
    `SELECT kind FROM workflow_lines
     WHERE instance = ? AND kind IN (${STATUS_KINDS_SQL})
     ORDER BY seq DESC LIMIT 1`,
    [instance],
  );
  return row === undefined ? null : (String(row["kind"]) as StatusLineKind);
}

// report 줄에 명시적으로 적힌 refs 경로만 순서대로 중복 없이 모은다. 파일 시스템 추정은 하지 않는다.
export function loadReportRefs(sql: Query, instance: string): string[] {
  const rows = sql.all(
    `SELECT json_extract(data, '$.refs') AS refs FROM workflow_lines
     WHERE instance = ? AND kind = 'report' AND json_type(data, '$.refs') = 'array'
     ORDER BY seq LIMIT 500`,
    [instance],
  );
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.size >= MAX_REFS) break;
    const raw = row["refs"];
    if (typeof raw !== "string") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    for (const item of parsed) {
      if (
        typeof item === "string" &&
        item.length > 0 &&
        item.length <= MAX_REF_LENGTH
      ) {
        seen.add(item);
        if (seen.size >= MAX_REFS) break;
      }
    }
  }
  return [...seen];
}

// workflow 표만 올린 단위 test DB에서 sessions·turns 표가 없을 때 깨지지 않게 확인한다.
export function hasTable(sql: Pick<Sql, "get">, name: string): boolean {
  return (
    sql.get(
      "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?",
      [name],
    ) !== undefined
  );
}

// 이 instance의 workflow_origin을 가진 session 목록(sessions_workflow_instance partial index 사용).
export function loadInstanceSessions(
  sql: Query,
  instance: string,
): InstanceSessionRow[] {
  if (!hasTable(sql, "sessions")) return [];
  const rows = sql.all(
    `SELECT id, agent, workspace_kind, workspace_id, lifecycle, harness_gui, runs_on, spawned_by
     FROM sessions
     WHERE workflow_origin IS NOT NULL AND workflow_origin ->> '$.instance' = ?
     ORDER BY created_seq LIMIT ?`,
    [instance, MAX_INSTANCE_SESSIONS],
  );
  return rows.map((row) => {
    const kind =
      row["workspace_kind"] === null || row["workspace_kind"] === undefined
        ? null
        : String(row["workspace_kind"]);
    const id =
      row["workspace_id"] === null || row["workspace_id"] === undefined
        ? null
        : String(row["workspace_id"]);
    return {
      id: String(row["id"]),
      parent:
        row["spawned_by"] === null || row["spawned_by"] === undefined
          ? null
          : String(row["spawned_by"]),
      agent: String(row["agent"]),
      workspace:
        (kind === "project" || kind === "app") && id !== null
          ? ({ kind, id } as Workspace)
          : null,
      lifecycle: String(row["lifecycle"]) === "archived" ? "archived" : "open",
      harness_gui: Number(row["harness_gui"] ?? 0) === 1,
      runs_on:
        row["runs_on"] === null || row["runs_on"] === undefined
          ? null
          : String(row["runs_on"]),
    };
  });
}

// 가장 마지막 turn이 실패로 끝났으면 그 이유를 돌려준다. 새 turn이 돌거나 완료했으면 null이다.
export function lastFailedTurnReason(
  sql: Pick<Sql, "get">,
  session: string,
): string | null {
  const row = sql.get(
    `SELECT state, outcome_kind, outcome_reason FROM turns
     WHERE session = ? ORDER BY rowid DESC LIMIT 1`,
    [session],
  );
  if (
    row === undefined ||
    String(row["state"]) !== "finished" ||
    String(row["outcome_kind"]) !== "failed"
  ) {
    return null;
  }
  const reason = row["outcome_reason"];
  return typeof reason === "string" && reason.length > 0 ? reason : null;
}

// 이 session이 자기 답으로 남긴 최근 assistant 메시지 blob 참조(최신순).
export function lastAssistantMessageBlobs(
  sql: Query,
  session: string,
): { hash: string; size: number }[] {
  const rows = sql.all(
    `SELECT m.body AS hash, r.size_bytes AS size_bytes
     FROM messages m
     JOIN blob_refs r
       ON r.owner_kind = ? AND r.owner_key = m.id AND r.field = ?
     WHERE m.session = ? AND m.from_kind = 'agent' AND m.from_ref = ?
     ORDER BY m.created_seq DESC LIMIT ?`,
    [
      MESSAGE_BODY_OWNER_KIND,
      MESSAGE_BODY_FIELD,
      session,
      session,
      ASSISTANT_PREVIEW_CANDIDATES,
    ],
  );
  const out: { hash: string; size: number }[] = [];
  for (const row of rows) {
    const hash = row["hash"];
    const size = row["size_bytes"];
    if (
      typeof hash === "string" &&
      (typeof size === "bigint" || typeof size === "number")
    ) {
      out.push({ hash, size: Number(size) });
    }
  }
  return out;
}
