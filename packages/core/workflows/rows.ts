import { err, ok, type Result } from "../../base/mod.ts";
import {
  type WorkflowCheckpoint,
  type WorkflowInstance,
  type WorkflowLine,
  workflowCheckpointSchema,
  workflowInstanceSchema,
  workflowLineSchema,
} from "../../protocol/workflows/mod.ts";

// createSql은 INTEGER를 bigint로 준다. 1n === 1은 늘 거짓이라 Number()·String()으로 읽는다.
export function instanceFromRow(
  row: Record<string, unknown>,
): Result<WorkflowInstance> {
  let inputs: unknown;
  if (row.inputs_json !== undefined && row.inputs_json !== null) {
    try {
      inputs = JSON.parse(String(row.inputs_json));
    } catch {
      return err({ code: "internal", message: "invalid stored workflow" });
    }
  }
  const codeSnapshot =
    typeof row.code_snapshot === "string" && row.code_snapshot.length > 0
      ? row.code_snapshot
      : undefined;
  const openMode =
    row.open_mode === "tab" || row.open_mode === "background"
      ? row.open_mode
      : undefined;
  let participantModes: unknown;
  if (
    row.participant_modes_json !== undefined &&
    row.participant_modes_json !== null
  ) {
    try {
      participantModes = JSON.parse(String(row.participant_modes_json));
    } catch {
      return err({ code: "internal", message: "invalid stored workflow" });
    }
  }
  const title =
    typeof row.title === "string" && row.title.length > 0 ? row.title : null;
  const parsed = workflowInstanceSchema.safeParse({
    id: row.id,
    project: row.project,
    workflow: row.workflow,
    title,
    input: row.input,
    ...(inputs !== undefined ? { inputs } : {}),
    state: row.state,
    participants: JSON.parse(String(row.participants)),
    steps: JSON.parse(String(row.steps)),
    current:
      row.current_step === null
        ? null
        : { step: row.current_step, human_turn: Number(row.human_turn) === 1 },
    started_by: JSON.parse(String(row.started_by)),
    ...(codeSnapshot !== undefined ? { code_snapshot: codeSnapshot } : {}),
    ...(openMode !== undefined ? { open_mode: openMode } : {}),
    ...(participantModes !== undefined
      ? { participant_modes: participantModes }
      : {}),
    created_at: row.created_at,
    finished_at: row.finished_at,
    state_seq: String(row.state_seq),
  });
  return parsed.success
    ? ok(parsed.data)
    : err({ code: "internal", message: "invalid stored workflow" });
}

export function checkpointFromRow(
  row: Record<string, unknown>,
): Result<WorkflowCheckpoint> {
  let output: unknown = null;
  if (row.output_json !== undefined && row.output_json !== null) {
    try {
      output = JSON.parse(String(row.output_json));
    } catch {
      return err({
        code: "internal",
        message: "invalid stored workflow checkpoint",
      });
    }
  }
  let error: unknown = null;
  if (row.error_json !== undefined && row.error_json !== null) {
    try {
      error = JSON.parse(String(row.error_json));
    } catch {
      return err({
        code: "internal",
        message: "invalid stored workflow checkpoint",
      });
    }
  }
  const parsed = workflowCheckpointSchema.safeParse({
    instance: row.instance,
    key: row.key,
    kind: row.kind,
    state: row.state,
    handle_ref:
      row.handle_ref === undefined || row.handle_ref === null
        ? null
        : String(row.handle_ref),
    output,
    error,
    started_at: row.started_at,
    finished_at:
      row.finished_at === undefined || row.finished_at === null
        ? null
        : String(row.finished_at),
  });
  return parsed.success
    ? ok(parsed.data)
    : err({
        code: "internal",
        message: "invalid stored workflow checkpoint",
      });
}

// kind에 없는 칸은 schema가 버린다(step은 ended·stopped에 없고 text는 report·started만 쓴다).
export function lineFromRow(
  row: Record<string, unknown>,
): Result<WorkflowLine> {
  const parsed = workflowLineSchema.safeParse({
    instance: row.instance,
    seq: String(row.seq),
    at: row.at,
    kind: row.kind,
    by: JSON.parse(String(row.by)),
    step: row.step,
    text: row.body,
    ...(row.data === null ? {} : JSON.parse(String(row.data))),
  });
  return parsed.success
    ? ok(parsed.data)
    : err({ code: "internal", message: "invalid stored workflow line" });
}

// 남길 줄: instance, seq, at은 appendLine이 채운다.
export type NewLine = WorkflowLine extends infer L
  ? L extends unknown
    ? Omit<L, "instance" | "seq" | "at">
    : never
  : never;

// 줄을 step, body(started·report의 글), data(나머지 칸)로 가른다.
export function lineColumns(line: NewLine): {
  step: string | null;
  body: string | null;
  data: string | null;
} {
  const {
    kind: _kind,
    by: _by,
    step,
    text,
    ...rest
  } = line as Record<string, unknown> & { step?: string | null; text?: string };
  return {
    step: step ?? null,
    body: text ?? null,
    data: Object.keys(rest).length === 0 ? null : JSON.stringify(rest),
  };
}
