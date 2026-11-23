import { err, ok, type Result } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/mod.ts";
import type { Sql } from "../../protocol/server/mod.ts";
import type {
  WorkflowCheckpoint,
  WorkflowCheckpointKind,
  WorkflowCheckpointState,
  WorkflowOutcomeError,
} from "../../protocol/workflows/mod.ts";
import type { WorkflowOutcome } from "./agent-primitive.ts";
import { redactJsonValues } from "./plan.ts";
import { checkpointFromRow } from "./rows.ts";
import { hasTable } from "./store.ts";

type Query = Pick<Sql, "get" | "all">;
type Write = Pick<Sql, "get" | "run">;

export type UpsertCheckpointRowInput = {
  instance: string;
  key: string;
  kind: WorkflowCheckpointKind;
  state: WorkflowCheckpointState;
  handle_ref?: string | null;
  output?: unknown;
  error?: WorkflowOutcomeError | null;
  at: string;
};

// workflow_checkpoints의 (instance, key) 행을 2단계로 쓴다(started -> completed | failed | interrupted).
// started_at은 최초 기록 시각을 보존하고, handle_ref는 생략하면 기존 값을 유지한다.
export function upsertCheckpointRow(
  sql: Write,
  input: UpsertCheckpointRowInput,
): Result<WorkflowCheckpoint> {
  const existing = sql.get(
    "SELECT * FROM workflow_checkpoints WHERE instance = ? AND key = ?",
    [input.instance, input.key],
  );
  if (existing === undefined) {
    const handleRef = input.handle_ref ?? null;
    const outputJson =
      input.state === "completed" &&
      input.output !== undefined &&
      input.output !== null
        ? JSON.stringify(input.output)
        : null;
    const errorJson =
      (input.state === "failed" || input.state === "interrupted") &&
      input.error !== undefined &&
      input.error !== null
        ? JSON.stringify(input.error)
        : null;
    const finishedAt = input.state === "started" ? null : input.at;
    sql.run(
      `INSERT INTO workflow_checkpoints
         (instance, key, kind, state, handle_ref, output_json, error_json, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.instance,
        input.key,
        input.kind,
        input.state,
        handleRef,
        outputJson,
        errorJson,
        input.at,
        finishedAt,
      ],
    );
  } else {
    const handleRef =
      input.handle_ref !== undefined
        ? input.handle_ref
        : existing["handle_ref"] === undefined ||
            existing["handle_ref"] === null
          ? null
          : String(existing["handle_ref"]);
    const existingOutput =
      existing["output_json"] === undefined || existing["output_json"] === null
        ? null
        : String(existing["output_json"]);
    const existingError =
      existing["error_json"] === undefined || existing["error_json"] === null
        ? null
        : String(existing["error_json"]);
    const outputJson =
      input.state === "completed"
        ? input.output !== undefined
          ? input.output === null
            ? null
            : JSON.stringify(input.output)
          : existingOutput
        : null;
    const errorJson =
      input.state === "failed" || input.state === "interrupted"
        ? input.error !== undefined
          ? input.error === null
            ? null
            : JSON.stringify(input.error)
          : existingError
        : null;
    const finishedAt = input.state === "started" ? null : input.at;
    sql.run(
      `UPDATE workflow_checkpoints
       SET kind = ?, state = ?, handle_ref = ?, output_json = ?, error_json = ?, finished_at = ?
       WHERE instance = ? AND key = ?`,
      [
        input.kind,
        input.state,
        handleRef,
        outputJson,
        errorJson,
        finishedAt,
        input.instance,
        input.key,
      ],
    );
  }
  const loaded = loadCheckpoint(sql, input.instance, input.key);
  if (!loaded.ok) return loaded;
  if (loaded.value === null) {
    return err({ code: "internal", message: "checkpoint write disappeared" });
  }
  return ok(loaded.value);
}

export function loadCheckpoint(
  sql: Pick<Sql, "get">,
  instance: string,
  key: string,
): Result<WorkflowCheckpoint | null> {
  if (!hasTable(sql, "workflow_checkpoints")) return ok(null);
  const row = sql.get(
    "SELECT * FROM workflow_checkpoints WHERE instance = ? AND key = ?",
    [instance, key],
  );
  return row === undefined ? ok(null) : checkpointFromRow(row);
}

export function loadCheckpoints(
  sql: Query,
  instance: string,
): Result<WorkflowCheckpoint[]> {
  if (!hasTable(sql, "workflow_checkpoints")) return ok([]);
  const rows = sql.all(
    "SELECT * FROM workflow_checkpoints WHERE instance = ? ORDER BY rowid ASC",
    [instance],
  );
  const out: WorkflowCheckpoint[] = [];
  for (const row of rows) {
    const parsed = checkpointFromRow(row);
    if (!parsed.ok) return parsed;
    out.push(parsed.value);
  }
  return ok(out);
}

// checkpoint의 output과 error를 저장 전에 재귀 redaction한다. 한 문자열이라도 redaction이 끝나지 않으면 fail-closed다.
export function redactCheckpointPayload<
  T extends { output?: unknown; error?: WorkflowOutcomeError | null },
>(payload: T, redact: (text: string) => string | null): Result<T> {
  let nextOutput = payload.output;
  if (payload.output !== undefined && payload.output !== null) {
    const safeOutput = redactJsonValues(payload.output, redact);
    if (!safeOutput.ok) {
      return err({
        code: "unavailable",
        message: "workflow checkpoint redaction did not finish",
      });
    }
    nextOutput = safeOutput.value;
  }
  let nextError = payload.error;
  if (payload.error !== undefined && payload.error !== null) {
    const safeMessage = redact(payload.error.message);
    if (safeMessage === null) {
      return err({
        code: "unavailable",
        message: "workflow checkpoint redaction did not finish",
      });
    }
    nextError = {
      ...payload.error,
      message: safeMessage,
    };
  }
  return ok({
    ...payload,
    ...(payload.output !== undefined ? { output: nextOutput } : {}),
    ...(payload.error !== undefined ? { error: nextError } : {}),
  });
}

// replay 시 이미 끝났거나 중단된 checkpoint를 WorkflowOutcome으로 돌려준다(started는 null).
export function checkpointToOutcome<T>(
  checkpoint: WorkflowCheckpoint,
): WorkflowOutcome<T> | null {
  if (checkpoint.state === "completed") {
    return { ok: true, result: checkpoint.output as T };
  }
  if (checkpoint.state === "failed") {
    const rawSession =
      checkpoint.error?.session ??
      (checkpoint.handle_ref?.startsWith("ses_")
        ? checkpoint.handle_ref
        : undefined);
    const session = rawSession as Id<"ses"> | undefined;
    return {
      ok: false,
      reason: checkpoint.error?.reason ?? "internal",
      message: checkpoint.error?.message ?? "checkpoint failed",
      ...(session !== undefined ? { session } : {}),
    };
  }
  if (checkpoint.state === "interrupted") {
    const rawSession =
      checkpoint.error?.session ??
      (checkpoint.handle_ref?.startsWith("ses_")
        ? checkpoint.handle_ref
        : undefined);
    const session = rawSession as Id<"ses"> | undefined;
    return {
      ok: false,
      reason: checkpoint.error?.reason ?? "interrupted",
      message:
        checkpoint.error?.message ?? "lophn restarted while step was running",
      ...(session !== undefined ? { session } : {}),
    };
  }
  return null;
}
