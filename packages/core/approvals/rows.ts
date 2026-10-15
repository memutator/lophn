// approval_requests 표의 행을 PendingApproval로 읽는다. command와 read가 같이 쓴다.
import { err, formatSeq, ok, type Result } from "../../base/mod.ts";
import {
  type PendingApproval,
  pendingApprovalSchema,
} from "../../protocol/approvals/mod.ts";
import type { Sql, SqlRow } from "../../protocol/server/mod.ts";

export const REQUEST_COLUMNS =
  `id, intent, choices, status, reject_reason, applied, created_seq,
  decided_seq, created_at, decided_at`;

function seqText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return formatSeq(BigInt(value as bigint | number));
}

export function requestOf(row: SqlRow): Result<PendingApproval> {
  let parsed;
  try {
    parsed = pendingApprovalSchema.safeParse({
      id: row["id"],
      intent: JSON.parse(String(row["intent"])),
      choices: JSON.parse(String(row["choices"])),
      status: row["status"],
      reject_reason: row["reject_reason"],
      applied: row["applied"] === null
        ? null
        : JSON.parse(String(row["applied"])),
      created_seq: seqText(row["created_seq"]),
      decided_seq: seqText(row["decided_seq"]),
      created_at: row["created_at"],
      decided_at: row["decided_at"],
    });
  } catch {
    return err({ code: "internal", message: "could not read the request" });
  }
  if (!parsed.success) {
    return err({
      code: "internal",
      message: "the stored request does not match its schema",
    });
  }
  return ok(parsed.data);
}

export function loadRequest(
  sql: Pick<Sql, "get">,
  id: string,
): Result<PendingApproval | null> {
  const row = sql.get(
    `select ${REQUEST_COLUMNS} from approval_requests where id = ?`,
    [id],
  );
  if (row === undefined) return ok(null);
  return requestOf(row);
}
