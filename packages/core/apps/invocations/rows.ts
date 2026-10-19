import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type AppInvocation,
  appInvocationSchema,
} from "../../../protocol/apps/calls/mod.ts";

function invalidStored(): Result<never> {
  return err({ code: "internal", message: "invalid stored invocation" });
}

function json(value: unknown): Result<unknown> {
  if (typeof value !== "string" || value.length === 0) return invalidStored();
  try {
    return ok(JSON.parse(value));
  } catch {
    return invalidStored();
  }
}

export function invocationFromRow(
  row: Record<string, unknown>,
): Result<AppInvocation> {
  const operation = json(row.operation);
  if (!operation.ok) return operation;
  const summary = json(row.summary);
  if (!summary.ok) return summary;
  let caller: unknown = null;
  if (row.caller !== null && row.caller !== undefined) {
    const parsed = json(row.caller);
    if (!parsed.ok) return parsed;
    caller = parsed.value;
  }
  const hash = row.changeset_hash ?? null;
  const parsed = appInvocationSchema.safeParse({
    id: row.id,
    app: row.app,
    release: row.release,
    mode: row.mode,
    operation: operation.value,
    caller,
    effect: row.effect,
    status: row.status,
    started_at: row.started_at ?? null,
    finished_at: row.finished_at ?? null,
    input_hash: row.input_hash ?? null,
    summary: summary.value,
    detail_hash: row.detail_hash ?? null,
    changeset: hash === null
      ? null
      : { hash, size_bytes: Number(row.changeset_size) },
    reverted_by: row.reverted_by ?? null,
  });
  return parsed.success ? ok(parsed.data) : invalidStored();
}
