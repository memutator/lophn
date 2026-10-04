// approval request 생성·만료·취소 command(platform/approvals#R1, R2, R6, R12, R13).
// 허락·거절은 T22, 적용은 T23이 맡는다. handler는 동기이고 transaction 하나다.
// 설명 본문의 공백·secret 검사는 command 밖(work)에서 한다. 입력은 hash만 온다.
// contract 입력에 준비 blob 참조가 없으므로 command는 hash를 저장하고 본문을 다시 hash하지 않는다.

import { err, ok, type Result } from "../../base/mod.ts";
import {
  type Actor,
  type ApprovalEffect,
  type ApprovalRequest,
  approvalRequestCancelled,
  approvalRequestCreated,
  approvalRequestExpired,
  approvalRequestSchema,
  cancelApprovalRequest,
  type CommandDefinition,
  createApprovalRequest,
  expireApprovalRequest,
  type Tx,
} from "../../contracts/platform/mod.ts";
import {
  cancelActorAllowed,
  closeAllowed,
  deadlineReached,
  deadlineValid,
} from "./model.ts";

type StoredRow = {
  id: string;
  requester: string;
  run: string | null;
  reason_blob: string;
  effect: string;
  action: string;
  expires_at: string | null;
  status: string;
  closed_reason_blob: string | null;
  created_seq: bigint | number;
  closed_seq: bigint | number | null;
};

const REQUEST_COLUMNS =
  `id, requester, run, reason_blob, effect, action, expires_at,
  status, closed_reason_blob, created_seq, closed_seq`;

// 만료 이유는 machine이 고정한 글 "expired"의 sha256이다(R12). handler가 동기라 미리 둔다.
export const EXPIRY_REASON_TEXT = "expired";
export const EXPIRY_REASON_HASH =
  "fa64ea1e82e1206f828ab2a02917c7e92accb98e3b95881a1b4ad52b914b66e3";

function seqText(value: bigint | number): string {
  return typeof value === "bigint" ? value.toString() : String(value);
}

function rowOf(row: Record<string, unknown>): Result<StoredRow> {
  const created = row["created_seq"];
  const closed = row["closed_seq"];
  if (
    typeof row["id"] !== "string" ||
    typeof row["requester"] !== "string" ||
    (row["run"] !== null && typeof row["run"] !== "string") ||
    typeof row["reason_blob"] !== "string" ||
    typeof row["effect"] !== "string" ||
    typeof row["action"] !== "string" ||
    (row["expires_at"] !== null && typeof row["expires_at"] !== "string") ||
    typeof row["status"] !== "string" ||
    (row["closed_reason_blob"] !== null &&
      typeof row["closed_reason_blob"] !== "string") ||
    (typeof created !== "bigint" && typeof created !== "number") ||
    (closed !== null && typeof closed !== "bigint" &&
      typeof closed !== "number")
  ) {
    return err({ code: "internal", message: "approval 기록을 읽지 못했다" });
  }
  return ok({
    id: row["id"],
    requester: row["requester"],
    run: row["run"],
    reason_blob: row["reason_blob"],
    effect: row["effect"],
    action: row["action"],
    expires_at: row["expires_at"],
    status: row["status"],
    closed_reason_blob: row["closed_reason_blob"],
    created_seq: created,
    closed_seq: closed,
  });
}

function requestOf(row: StoredRow): Result<ApprovalRequest> {
  let effect: unknown;
  let action: unknown;
  try {
    effect = JSON.parse(row.effect);
    action = JSON.parse(row.action);
  } catch {
    return err({ code: "internal", message: "approval 기록을 읽지 못했다" });
  }
  const parsed = approvalRequestSchema.safeParse({
    id: row.id,
    requester: row.requester,
    run: row.run,
    reason_blob: row.reason_blob,
    effect,
    action,
    expires_at: row.expires_at,
    status: row.status,
    closed_reason_blob: row.closed_reason_blob,
    created_seq: seqText(row.created_seq),
    closed_seq: row.closed_seq === null ? null : seqText(row.closed_seq),
  });
  if (!parsed.success) {
    return err({
      code: "internal",
      message: "approval 기록이 schema와 다르다",
    });
  }
  return ok(parsed.data);
}

function loadRequest(tx: Tx, id: string): Result<StoredRow | undefined> {
  const row = tx.sql.get(
    `select ${REQUEST_COLUMNS} from approval_requests where id = ?`,
    [id],
  );
  if (row === undefined) return ok(undefined);
  return rowOf(row);
}

export function createApprovalCommands(): {
  create: CommandDefinition<typeof createApprovalRequest>;
  expire: CommandDefinition<typeof expireApprovalRequest>;
  cancel: CommandDefinition<typeof cancelApprovalRequest>;
} {
  return {
    create: {
      route: createApprovalRequest,
      handle(tx, ctx, input) {
        return createRequest(tx, ctx, input);
      },
    },
    expire: {
      route: expireApprovalRequest,
      handle(tx, _ctx, input, compare) {
        return expireRequest(tx, input, compare);
      },
    },
    cancel: {
      route: cancelApprovalRequest,
      handle(tx, ctx, input, compare) {
        return cancelRequest(tx, ctx, input, compare);
      },
    },
  };
}

type CreateInput = {
  id: string;
  requester: string;
  run: string | null;
  reason_blob: string;
  effect: ApprovalEffect;
  action: ApprovalRequest["action"];
  expires_at: string | null;
};

function createRequest(
  tx: Tx,
  ctx: { actor: Actor; run?: string },
  input: CreateInput,
): Result<{ request: ApprovalRequest }> {
  // 요청자 본문은 자격과 같아야 한다. 다른 actor를 대신 요청하지 못한다.
  if (input.requester !== ctx.actor) {
    return err({
      code: "forbidden",
      message: "요청자는 현재 자격과 같아야 한다",
    });
  }
  // agent 요청은 자격에 묶인 run이 필수다. run 유효성은 ledger의 run admission이 본다.
  if (ctx.actor.startsWith("agent:") && input.run === null) {
    return err({
      code: "invalid_input",
      message: "agent 요청에는 run이 필요하다",
    });
  }
  if (input.run !== null && ctx.run !== undefined && input.run !== ctx.run) {
    return err({
      code: "forbidden",
      message: "요청 run이 자격의 run과 다르다",
    });
  }
  if (!deadlineValid(input.expires_at, tx.now())) {
    return err({
      code: "invalid_input",
      message: "기한이 생성 시각보다 뒤가 아니다",
    });
  }
  const existing = loadRequest(tx, input.id);
  if (!existing.ok) return existing;
  if (existing.value !== undefined) {
    return err({ code: "conflict", message: "같은 approval id가 이미 있다" });
  }
  const created = tx.emit(approvalRequestCreated, input.id, {
    binding_hash: input.action.binding_hash,
  });
  tx.sql.run(
    `insert into approval_requests
       (id, requester, run, reason_blob, effect, action, action_binding_hash,
        expires_at, status, closed_reason_blob, created_seq, closed_seq)
     values (?, ?, ?, ?, ?, ?, ?, ?, 'pending', null, ?, null)`,
    [
      input.id,
      input.requester,
      input.run,
      input.reason_blob,
      JSON.stringify(input.effect),
      JSON.stringify(input.action),
      input.action.binding_hash,
      input.expires_at,
      BigInt(created),
    ],
  );
  return storedRequest(tx, input.id);
}

function expireRequest(
  tx: Tx,
  input: { approval: string; created_seq: string },
  compare: { created_seq: string } | undefined,
): Result<{ request: ApprovalRequest }> {
  const loaded = pendingAt(tx, input.approval, input.created_seq, compare);
  if (!loaded.ok) return loaded;
  // 지정 기한이 있고 그 경계에 도달했을 때만 만료한다(R12). 기한 없는 request는 만료하지 않는다.
  if (!deadlineReached(loaded.value.expires_at, tx.now())) {
    return err({
      code: "conflict",
      message: "기한이 없거나 아직 도달하지 않았다",
    });
  }
  return closeRequest(
    tx,
    loaded.value,
    "expired",
    approvalRequestExpired,
    EXPIRY_REASON_HASH,
  );
}

function cancelRequest(
  tx: Tx,
  ctx: { actor: Actor },
  input: { approval: string; created_seq: string; closed_reason_blob: string },
  compare: { created_seq: string } | undefined,
): Result<{ request: ApprovalRequest }> {
  const loaded = pendingAt(tx, input.approval, input.created_seq, compare);
  if (!loaded.ok) return loaded;
  const allowed = cancelActorAllowed(
    ctx.actor,
    loaded.value.requester as Actor,
  );
  if (!allowed.ok) return allowed;
  return closeRequest(
    tx,
    loaded.value,
    "cancelled",
    approvalRequestCancelled,
    input.closed_reason_blob,
  );
}

// 대기 상태와 생성 seq가 현재 기록과 같아야 한다. 다르면 그 결정을 적용하지 않는다(R6).
function pendingAt(
  tx: Tx,
  id: string,
  createdSeq: string,
  compare: { created_seq: string } | undefined,
): Result<StoredRow> {
  if (compare === undefined || compare.created_seq !== createdSeq) {
    return err({
      code: "conflict",
      message: "비교 기준이 입력의 생성 seq와 다르다",
    });
  }
  const loaded = loadRequest(tx, id);
  if (!loaded.ok) return loaded;
  if (loaded.value === undefined) {
    return err({ code: "not_found", message: "approval request가 없다" });
  }
  if (seqText(loaded.value.created_seq) !== createdSeq) {
    return err({ code: "conflict", message: "생성 seq가 현재 기록과 다르다" });
  }
  const open = closeAllowed(loaded.value.status as "pending", "cancelled");
  if (!open.ok) return open;
  return ok(loaded.value);
}

function closeRequest(
  tx: Tx,
  row: StoredRow,
  status: "expired" | "cancelled",
  event: typeof approvalRequestExpired | typeof approvalRequestCancelled,
  reasonHash: string,
): Result<{ request: ApprovalRequest }> {
  const closed = tx.emit(event, row.id, {
    created_seq: seqText(row.created_seq),
    closed_reason_blob: reasonHash,
  });
  tx.sql.run(
    `update approval_requests
       set status = ?, closed_reason_blob = ?, closed_seq = ?
     where id = ? and status = 'pending'`,
    [status, reasonHash, BigInt(closed), row.id],
  );
  const stored = loadRequest(tx, row.id);
  if (!stored.ok) return stored;
  if (stored.value === undefined || stored.value.status !== status) {
    return err({ code: "conflict", message: "종료를 기록하지 못했다" });
  }
  const request = requestOf(stored.value);
  if (!request.ok) return request;
  return ok({ request: request.value });
}

function storedRequest(
  tx: Tx,
  id: string,
): Result<{ request: ApprovalRequest }> {
  const stored = loadRequest(tx, id);
  if (!stored.ok) return stored;
  if (stored.value === undefined) {
    return err({ code: "internal", message: "approval 기록을 읽지 못했다" });
  }
  const request = requestOf(stored.value);
  if (!request.ok) return request;
  return ok({ request: request.value });
}
