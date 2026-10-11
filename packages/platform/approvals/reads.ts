// approval request 조회(platform/approvals#R17).
// 판단할 동작·대상·이유·변경·외부 전송·보존·되돌림을 요약하되 R1·R2 항목을 빼지 않는다.
// 본문은 blob 참조로 돌려주고 원문 조립은 화면(shell)이 blob read로 한다.

import { err, ok, type Result } from "../../base/mod.ts";
import {
  type ApprovalRequest,
  approvalsGet,
  approvalsList,
  type ApprovalUse,
  approvalUseSchema,
  type ReadDefinition,
  type ReadSnapshot,
  type RequestContext,
} from "../../contracts/platform/mod.ts";

const REQUEST_COLUMNS =
  `id, requester, run, reason_blob, effect, action, expires_at,
  session_grantable, status, grant_scope, grant_session, closed_reason_blob,
  created_seq, closed_seq`;

type StoredRow = Record<string, unknown>;

function seqText(value: bigint | number): string {
  return typeof value === "bigint" ? value.toString() : String(value);
}

// 요청자는 자기 요청만 본다. 사람은 전부 본다. machine은 만료·종료 처리로 전부 본다.
export function visible(ctx: RequestContext, requester: string): boolean {
  if (ctx.actor === "user" || ctx.actor === "machine") return true;
  return ctx.actor === requester;
}

function requestOf(row: StoredRow): Result<ApprovalRequest> {
  const created = row["created_seq"];
  const closed = row["closed_seq"];
  if (
    (typeof created !== "bigint" && typeof created !== "number") ||
    (closed !== null && typeof closed !== "bigint" &&
      typeof closed !== "number")
  ) {
    return err({ code: "internal", message: "approval 기록을 읽지 못했다" });
  }
  let effect: unknown;
  let action: unknown;
  try {
    effect = JSON.parse(String(row["effect"]));
    action = JSON.parse(String(row["action"]));
  } catch {
    return err({ code: "internal", message: "approval 기록을 읽지 못했다" });
  }
  return ok({
    id: String(row["id"]),
    requester: String(row["requester"]),
    run: row["run"] === null ? null : String(row["run"]),
    reason_blob: String(row["reason_blob"]),
    effect,
    action,
    expires_at: row["expires_at"] === null ? null : String(row["expires_at"]),
    session_grantable: Number(row["session_grantable"]) === 1,
    status: String(row["status"]),
    grant_scope: row["grant_scope"] === null
      ? null
      : String(row["grant_scope"]),
    grant_session: row["grant_session"] === null
      ? null
      : String(row["grant_session"]),
    closed_reason_blob: row["closed_reason_blob"] === null
      ? null
      : String(row["closed_reason_blob"]),
    created_seq: seqText(created),
    closed_seq: closed === null ? null : seqText(closed),
  } as ApprovalRequest);
}

function useOf(
  snapshot: ReadSnapshot,
  approval: string,
): Result<ApprovalUse | null> {
  const row = snapshot.sql.get(
    "select approval, concern, receipt, accepted_seq from approval_uses where approval = ?",
    [approval],
  );
  if (row === undefined) return ok(null);
  const accepted = row["accepted_seq"];
  if (typeof accepted !== "bigint" && typeof accepted !== "number") {
    return err({
      code: "internal",
      message: "approval 사용 기록을 읽지 못했다",
    });
  }
  let receipt: unknown;
  try {
    receipt = JSON.parse(String(row["receipt"]));
  } catch {
    return err({
      code: "internal",
      message: "approval 사용 기록을 읽지 못했다",
    });
  }
  const parsed = approvalUseSchema.safeParse({
    approval: String(row["approval"]),
    concern: String(row["concern"]),
    receipt,
    accepted_seq: seqText(accepted),
  });
  if (!parsed.success) {
    return err({
      code: "internal",
      message: "approval 사용 기록이 schema와 다르다",
    });
  }
  return ok(parsed.data);
}

export function approvalsGetRead(): ReadDefinition<typeof approvalsGet> {
  return {
    route: approvalsGet,
    handle(snapshot, ctx, input) {
      const row = snapshot.sql.get(
        `select ${REQUEST_COLUMNS} from approval_requests where id = ?`,
        [input.approval],
      );
      if (row === undefined) {
        return err({ code: "not_found", message: "approval request가 없다" });
      }
      if (!visible(ctx, String(row["requester"]))) {
        // 남의 요청은 존재도 알리지 않는다.
        return err({ code: "not_found", message: "approval request가 없다" });
      }
      const request = requestOf(row);
      if (!request.ok) return request;
      const use = useOf(snapshot, input.approval);
      if (!use.ok) return use;
      return ok({
        request: request.value,
        use: use.value,
        as_of_seq: snapshot.as_of_seq,
        next_cursor: null,
      });
    },
  };
}

// 한 페이지의 기본·최대. read 응답 행 한도(500) 안에 둔다.
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export function approvalsListRead(): ReadDefinition<typeof approvalsList> {
  return {
    route: approvalsList,
    handle(snapshot, ctx, input) {
      const limit = input.limit ?? DEFAULT_LIMIT;
      if (limit > MAX_LIMIT) {
        return err({
          code: "invalid_input",
          message: "한 번에 볼 수 있는 요청 수를 넘었다",
        });
      }
      const filters: string[] = [];
      const params: (string | number | bigint | null)[] = [];
      // 요청자는 자기 요청만 본다. 사람·machine은 필터 없이 전부 본다.
      if (ctx.actor !== "user" && ctx.actor !== "machine") {
        filters.push("requester = ?");
        params.push(ctx.actor);
      }
      if (input.status !== undefined) {
        filters.push("status = ?");
        params.push(input.status);
      }
      if (input.run !== undefined) {
        filters.push("run = ?");
        params.push(input.run);
      }
      if (input.grant_session !== undefined) {
        filters.push("grant_scope = 'session' and grant_session = ?");
        params.push(input.grant_session);
      }
      const where = filters.length === 0
        ? ""
        : `where ${filters.join(" and ")}`;
      const rows = snapshot.sql.all(
        `select ${REQUEST_COLUMNS} from approval_requests ${where}
         order by created_seq desc limit ?`,
        [...params, limit],
      );
      const requests: ApprovalRequest[] = [];
      for (const row of rows) {
        const request = requestOf(row);
        if (!request.ok) return request;
        requests.push(request.value);
      }
      return ok({ requests, as_of_seq: snapshot.as_of_seq, next_cursor: null });
    },
  };
}
