// approval request 생성·만료·취소·허락·거절 command(platform/approvals#R1, R2, R3, R4,
// R5, R6, R12, R13, R14, R15, R16). 적용은 apply.ts가 맡는다. handler는 동기이고 transaction 하나다.
// 허락·거절의 사람 확인(confirmation handle)은 route의 `confirmation: "required"`와 binding으로
// 선언하고, writer 실행기가 transaction 안에서 현재 handle을 예약·소비한다.
// 설명 글(이유·변경·외부 영향·되돌림)은 값으로 받는다. core가 redaction을 거쳐 blob으로
// 준비해 두었고(공백·크기는 contract schema가 거절한다), create가 같은 글에서 hash와 준비
// 증거를 다시 만들어 같은 transaction에서 영구 참조를 등록한다. 살아 있는 준비가 없으면 등록이
// 거절되어 request가 만들어지지 않는다. 종료 이유(closed_reason_blob)는 아직 hash로 받는다.

import { canonicalize, err, ok, type Result } from "../../base/mod.ts";
import {
  type Actor,
  type ApprovalRequest,
  approvalRequestCancelled,
  approvalRequestCreated,
  approvalRequestExpired,
  approvalRequestGranted,
  approvalRequestRejected,
  approvalRequestSchema,
  cancelApprovalRequest,
  type CommandDefinition,
  createApprovalRequest,
  type CreateApprovalRequestInput,
  expireApprovalRequest,
  grantApprovalRequest,
  rejectApprovalRequest,
  type RequestContext,
  type Tx,
} from "../../contracts/platform/mod.ts";
import { checkConfirmAction, overlappingConfirm } from "./confirm.ts";
import { approvalRunLineage } from "./lineage.ts";
import {
  cancelActorAllowed,
  closeAllowed,
  deadlineReached,
  deadlineValid,
} from "./model.ts";
import { registerTextBlobs, storedText } from "./text.ts";

type StoredRow = {
  id: string;
  requester: string;
  run: string | null;
  reason_blob: string;
  effect: string;
  action: string;
  action_binding_hash: string;
  expires_at: string | null;
  status: string;
  closed_reason_blob: string | null;
  created_seq: bigint | number;
  closed_seq: bigint | number | null;
};

const REQUEST_COLUMNS =
  `id, requester, run, reason_blob, effect, action, action_binding_hash,
  expires_at, status, closed_reason_blob, created_seq, closed_seq`;

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
    typeof row["action_binding_hash"] !== "string" ||
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
    action_binding_hash: row["action_binding_hash"],
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
  grant: CommandDefinition<typeof grantApprovalRequest>;
  reject: CommandDefinition<typeof rejectApprovalRequest>;
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
    grant: {
      route: grantApprovalRequest,
      handle(tx, ctx, input, compare) {
        return decideRequest(tx, ctx, input, compare, "granted");
      },
    },
    reject: {
      route: rejectApprovalRequest,
      handle(tx, ctx, input, compare) {
        return decideRequest(tx, ctx, input, compare, "rejected");
      },
    },
  };
}

type CreateInput = CreateApprovalRequestInput;

function createRequest(
  tx: Tx,
  ctx: RequestContext,
  input: CreateInput,
): Result<{ request: ApprovalRequest }> {
  // 요청자 본문은 자격과 같아야 한다. 다른 actor를 대신 요청하지 못한다.
  if (input.requester !== ctx.actor) {
    return err({
      code: "forbidden",
      message: "요청자는 현재 자격과 같아야 한다",
    });
  }
  // 사람이 확인해야 하는 앱 command의 request는 정확한 앱·release·command·입력과 실제 호출 주체에 묶인다(R8).
  const confirm = checkConfirmAction(input.id, input.requester, input.action);
  if (!confirm.ok) return confirm;
  const overlap = overlappingConfirm(tx, input.id, input.action);
  if (overlap !== undefined) {
    return err({
      code: "conflict",
      message: "같은 호출의 approval이 이미 있다",
      details: { approval: overlap },
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
  // 같은 run·같은 사람 요청의 handoff 계보에서 사람이 거절한 같은 동작은 다시 묻지 않는다(R16).
  const rejected = rejectedInLineage(tx, input);
  if (!rejected.ok) return rejected;
  if (rejected.value !== undefined) {
    return err({
      code: "conflict",
      message: "같은 계보에서 사람이 거절한 같은 동작은 다시 묻지 않는다",
      details: { rejected_approval: rejected.value },
    });
  }
  const text = storedText(ctx, input);
  const created = tx.emit(approvalRequestCreated, input.id, {
    binding_hash: input.action.binding_hash,
  });
  const registered = registerTextBlobs(tx, input.id, created, text.blobs);
  if (!registered.ok) return registered;
  tx.sql.run(
    `insert into approval_requests
       (id, requester, run, reason_blob, effect, action, action_binding_hash,
        expires_at, status, closed_reason_blob, created_seq, closed_seq)
     values (?, ?, ?, ?, ?, ?, ?, ?, 'pending', null, ?, null)`,
    [
      input.id,
      input.requester,
      input.run,
      text.reason_blob,
      JSON.stringify(text.effect),
      JSON.stringify(input.action),
      input.action.binding_hash,
      input.expires_at,
      BigInt(created),
    ],
  );
  return storedRequest(tx, input.id);
}

// 거절된 같은 동작·대상·입력이 같은 계보에 있으면 그 approval id를 돌려준다(R16).
// 같음은 concern·command·정확한 대상·정규 입력 지문이다. 설명(reason)·호출자·비교 기준은 보지 않는다:
// 설명만 바꿔 다시 묻는 것을 막는 것이고, handoff를 받은 다른 역할이 같은 동작을 묻는 것도 같은 요청이다.
// 계보는 같은 run이거나 lophn-agent가 판정한 원래 사람 요청이 같은 run이다. 새 사람 요청은 별개다.
function rejectedInLineage(
  tx: Tx,
  input: CreateInput,
): Result<string | undefined> {
  if (input.run === null) return ok(undefined);
  const rows = tx.sql.all(
    `select id, run, action from approval_requests
      where status = 'rejected' and run is not null
        and json_extract(action, '$.concern') = ?
        and json_extract(action, '$.command') = ?
        and json_extract(action, '$.input_hash') = ?
      order by created_seq`,
    [input.action.concern, input.action.command, input.action.input_hash],
  );
  const targets = canonicalize(input.action.targets);
  const lookup = tx as Tx & { portLookup?: { present(key: object): boolean } };
  // 계보 판정이 없는 등록(run이 없는 core)에서는 같은 run만 같은 계보다.
  const lineage = lookup.portLookup?.present(approvalRunLineage) === true
    ? tx.port(approvalRunLineage)
    : undefined;
  const origin = lineage?.origin(input.run) ?? null;
  for (const row of rows) {
    let action: { targets?: unknown };
    try {
      action = JSON.parse(String(row["action"]));
    } catch {
      return err({ code: "internal", message: "approval 기록을 읽지 못했다" });
    }
    if (canonicalize(action.targets) !== targets) continue;
    const run = String(row["run"]);
    if (run === input.run) return ok(String(row["id"]));
    if (origin !== null && lineage?.origin(run) === origin) {
      return ok(String(row["id"]));
    }
  }
  return ok(undefined);
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
  return closeRequest(tx, loaded.value, "expired", {
    kind: "expired",
    reason: EXPIRY_REASON_HASH,
  });
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
  return closeRequest(tx, loaded.value, "cancelled", {
    kind: "cancelled",
    reason: input.closed_reason_blob,
  });
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

type ClosedStatus = "granted" | "rejected" | "expired" | "cancelled";

type Closing =
  | { kind: "granted"; bindingHash: string }
  | { kind: "rejected"; reason: string | null }
  | {
    kind: "expired" | "cancelled";
    reason: string;
  };

// 사람 결정(허락·거절)은 현재 내용·기한과 함께 본다(R5, R6, R12). 대기가 아니거나 생성 seq가
// 다르면 거절한다. 허락·거절 event의 actor는 user이므로 다른 actor는 handler도 막는다.
function decideRequest(
  tx: Tx,
  ctx: { actor: Actor },
  input: {
    approval: string;
    created_seq: string;
    binding_hash: string;
    closed_reason_blob?: string | null;
  },
  compare: { created_seq: string } | undefined,
  decision: "granted" | "rejected",
): Result<{ request: ApprovalRequest }> {
  if (ctx.actor !== "user") {
    return err({
      code: "forbidden",
      message: "허락과 거절은 사람의 보호된 결정만 한다",
    });
  }
  const loaded = pendingAt(tx, input.approval, input.created_seq, compare);
  if (!loaded.ok) return loaded;
  // 사람이 본 동작과 지금 동작이 다르면 새 request가 필요하다(R5).
  if (loaded.value.action_binding_hash !== input.binding_hash) {
    return err({
      code: "conflict",
      message: "결정이 본 동작과 현재 request의 동작이 다르다",
    });
  }
  // 기한 경계부터 결정을 거절한다. 만료 처리는 machine이 따로 한다(R12).
  if (deadlineReached(loaded.value.expires_at, tx.now())) {
    return err({ code: "conflict", message: "기한이 지나 결정할 수 없다" });
  }
  return closeRequest(
    tx,
    loaded.value,
    decision,
    decision === "granted"
      ? { kind: "granted", bindingHash: loaded.value.action_binding_hash }
      : { kind: "rejected", reason: input.closed_reason_blob ?? null },
  );
}

function closeRequest(
  tx: Tx,
  row: StoredRow,
  status: ClosedStatus,
  closing: Closing,
): Result<{ request: ApprovalRequest }> {
  const createdSeq = seqText(row.created_seq);
  let reasonHash: string | null = null;
  let closed: string;
  if (closing.kind === "granted") {
    closed = tx.emit(approvalRequestGranted, row.id, {
      created_seq: createdSeq,
      binding_hash: closing.bindingHash,
    });
  } else if (closing.kind === "rejected") {
    reasonHash = closing.reason;
    closed = tx.emit(approvalRequestRejected, row.id, {
      created_seq: createdSeq,
      closed_reason_blob: closing.reason,
    });
  } else {
    reasonHash = closing.reason;
    closed = tx.emit(
      closing.kind === "expired"
        ? approvalRequestExpired
        : approvalRequestCancelled,
      row.id,
      { created_seq: createdSeq, closed_reason_blob: closing.reason },
    );
  }
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
