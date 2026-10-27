import {
  err,
  formatSeq,
  internalError,
  ok,
  type Result,
} from "../../../base/mod.ts";
import {
  commandResultSchema,
  commandsResult,
  type ReadDefinition,
  type ReadSnapshot,
  type RequestContext,
} from "../../../protocol/server/mod.ts";
import { authorizeConditions } from "../../server/identity/mod.ts";

// commands/result는 자기 principal만 본다.
// snapshot SQL만 쓴다. writer queue를 기다리지 않는다.
export const commandResultRead: ReadDefinition<typeof commandsResult> = {
  route: commandsResult,
  handle(snapshot: ReadSnapshot, ctx: RequestContext, input) {
    const allowed = authorizeConditions(ctx, commandsResult.name);
    if (!allowed.ok) return allowed;
    const row = snapshot.sql.get(
      `select principal, idempotency_key, fingerprint, result, first_seq, last_seq, at
       from command_results where principal = ? and idempotency_key = ?`,
      [ctx.principal, input.idempotency_key],
    );
    if (row === undefined) {
      return ok({
        result: null,
        as_of_seq: snapshot.as_of_seq,
        next_cursor: null,
      });
    }
    const parsed = storedResult(row);
    if (!parsed.ok) return parsed;
    const result = commandResultSchema.safeParse(parsed.value);
    if (!result.success) return err(internalError());
    return ok({
      result: result.data,
      as_of_seq: snapshot.as_of_seq,
      next_cursor: null,
    });
  },
};

function storedResult(row: Record<string, unknown>): Result<{
  principal: string;
  idempotency_key: string;
  fingerprint: string;
  result: unknown;
  first_seq: string | null;
  last_seq: string | null;
  at: string;
}> {
  const principal = row["principal"];
  const key = row["idempotency_key"];
  const fingerprint = row["fingerprint"];
  const raw = row["result"];
  const at = row["at"];
  if (
    typeof principal !== "string" ||
    typeof key !== "string" ||
    typeof fingerprint !== "string" ||
    typeof raw !== "string" ||
    typeof at !== "string"
  ) {
    return err(internalError());
  }
  let result: unknown;
  try {
    result = JSON.parse(raw);
  } catch {
    return err(internalError());
  }
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    return err(internalError());
  }
  return ok({
    principal,
    idempotency_key: key,
    fingerprint,
    result,
    first_seq: seqText(row["first_seq"]),
    last_seq: seqText(row["last_seq"]),
    at,
  });
}

function seqText(value: unknown): string | null {
  return typeof value === "bigint" ? formatSeq(value) : null;
}
