import { err, ok, type Result } from "../../base/mod.ts";
import { type Invocation, invocationSchema } from "../../contracts/apps/mod.ts";

function invalidStored(): Result<never> {
  return err({ code: "internal", message: "invalid stored invocation" });
}

// JSON 값(caller·operation·trigger)의 저장 실패는 internal이다.
function jsonValue(value: unknown): Result<unknown> {
  if (typeof value !== "string" || value.length === 0) return invalidStored();
  try {
    return ok(JSON.parse(value));
  } catch {
    return invalidStored();
  }
}

export function invocationFromRow(
  row: Record<string, unknown>,
): Result<Invocation> {
  const caller = jsonValue(row.caller);
  if (!caller.ok) return caller;
  const operation = jsonValue(row.operation);
  if (!operation.ok) return operation;
  const trigger = jsonValue(row.trigger);
  if (!trigger.ok) return trigger;
  const summary = jsonValue(row.summary);
  if (!summary.ok) return summary;
  const invocation = invocationSchema.safeParse({
    id: row.id,
    app: row.app,
    release: row.release,
    operation: operation.value,
    trigger: trigger.value,
    mode: row.mode,
    actor: row.actor,
    caller: caller.value,
    approval: row.approval ?? null,
    input_hash: row.input_hash ?? null,
    status: row.status,
    started_at: row.started_at ?? null,
    finished_at: row.finished_at ?? null,
    summary: summary.value,
    detail_hash: row.detail_hash ?? null,
  });
  return invocation.success ? ok(invocation.data) : invalidStored();
}
