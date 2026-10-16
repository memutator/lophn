// 보류 request의 쓰기. 짧은 transaction 하나이고 domain event는 같은 tx에서 쓴다.
// 적용(applier 호출)은 command 밖이다. 결과는 recordApplied로 돌아온다.
import {
  canonicalize,
  err,
  formatSeq,
  ok,
  type Result,
} from "../../base/mod.ts";
import { approvalDecided } from "../../protocol/events/mod.ts";
import {
  approvalsDecide,
  choicesFor,
  type PendingApproval,
} from "../../protocol/approvals/mod.ts";
import type { CommandDefinition, Tx } from "../../protocol/server/mod.ts";
import { canClose, choiceOffered, pendingKindAllowed } from "./model.ts";
import { loadRequest } from "./rows.ts";
import {
  approvalsCancelPendingFor,
  approvalsCreatePending,
  approvalsRecordApplied,
} from "./routes.ts";

type DecidedKind = "activation" | "reaction";

// 지금 ledger 끝의 seq. request의 순서를 보이는 표시다.
function headSeq(tx: Tx): string {
  const row = tx.sql.get("select coalesce(max(seq), 0) as seq from events", []);
  return formatSeq(BigInt(row?.["seq"] as bigint | number ?? 0));
}

function machineOnly(actor: string): Result<void> {
  return actor === "machine" ? ok(undefined) : err({
    code: "forbidden",
    message: "only core records pending requests",
  });
}

function stored(tx: Tx, id: string): Result<PendingApproval> {
  const loaded = loadRequest(tx.sql, id);
  if (!loaded.ok) return loaded;
  if (loaded.value === null) {
    return err({ code: "not_found", message: "the request does not exist" });
  }
  return ok(loaded.value);
}

export const createPendingCommand: CommandDefinition<
  typeof approvalsCreatePending
> = {
  route: approvalsCreatePending,
  handle(tx, ctx, input) {
    const allowed = machineOnly(ctx.actor);
    if (!allowed.ok) return allowed;
    const kind = pendingKindAllowed(input.intent);
    if (!kind.ok) return kind;
    // 같은 intent가 이미 기다리면 새로 묻지 않는다. Reactor가 같은 event를 다시 처리해도 카드가 불어나지 않게 한다.
    const intent = canonicalize(input.intent);
    const same = tx.sql.get(
      `select id from approval_requests where status = 'pending' and intent = ?`,
      [intent],
    );
    if (same !== undefined) {
      const found = stored(tx, String(same["id"]));
      return found.ok ? ok({ request: found.value, created: false }) : found;
    }
    const id = tx.newId("apr");
    tx.sql.run(
      `insert into approval_requests
         (id, intent, choices, status, reject_reason, applied, created_seq,
          decided_seq, created_at, decided_at)
       values (?, ?, ?, 'pending', null, null, ?, null, ?, null)`,
      [
        id,
        intent,
        JSON.stringify(choicesFor(input.intent.kind)),
        BigInt(headSeq(tx)),
        tx.now(),
      ],
    );
    const created = stored(tx, id);
    return created.ok ? ok({ request: created.value, created: true }) : created;
  },
};

// 사람의 결정. 거절이면 여기서 ApprovalDecided를 쓴다. 허락이면 적용이 끝난 뒤 recordApplied가 쓴다.
export const decideCommand: CommandDefinition<typeof approvalsDecide> = {
  route: approvalsDecide,
  handle(tx, ctx, input) {
    if (ctx.actor !== "user") {
      return err({
        code: "forbidden",
        message: "only the user decides a request",
      });
    }
    const current = stored(tx, input.request);
    if (!current.ok) return current;
    const request = current.value;
    const open = canClose(request.status);
    if (!open.ok) return open;
    const offered = choiceOffered(request.choices, input.choice.kind);
    if (!offered.ok) return offered;
    const rejected = input.choice.kind === "reject";
    // 거절의 decided_seq는 ApprovalDecided의 seq다.
    const seq = rejected
      ? tx.emit(approvalDecided, request.id, {
        kind: request.intent.kind as DecidedKind,
        decision: "reject",
        applied: null,
      })
      : headSeq(tx);
    tx.sql.run(
      `update approval_requests
         set status = ?, reject_reason = ?, decided_seq = ?, decided_at = ?
       where id = ? and status = 'pending'`,
      [
        rejected ? "reject" : "allow",
        input.choice.kind === "reject" ? input.choice.reason ?? null : null,
        BigInt(seq),
        tx.now(),
        request.id,
      ],
    );
    const decided = stored(tx, request.id);
    return decided.ok ? ok({ request: decided.value }) : decided;
  },
};

export const recordAppliedCommand: CommandDefinition<
  typeof approvalsRecordApplied
> = {
  route: approvalsRecordApplied,
  handle(tx, ctx, input) {
    const allowed = machineOnly(ctx.actor);
    if (!allowed.ok) return allowed;
    const current = stored(tx, input.request);
    if (!current.ok) return current;
    const request = current.value;
    if (request.status !== "allow" || request.applied !== null) {
      return err({
        code: "conflict",
        message: "the request is not waiting for an apply result",
      });
    }
    tx.sql.run(
      `update approval_requests set applied = ? where id = ? and applied is null`,
      [JSON.stringify(input.applied), request.id],
    );
    tx.emit(approvalDecided, request.id, {
      kind: request.intent.kind as DecidedKind,
      decision: "allow",
      applied: input.applied,
    });
    const recorded = stored(tx, request.id);
    return recorded.ok ? ok({ request: recorded.value }) : recorded;
  },
};

export const cancelPendingForCommand: CommandDefinition<
  typeof approvalsCancelPendingFor
> = {
  route: approvalsCancelPendingFor,
  handle(tx, ctx, input) {
    const allowed = machineOnly(ctx.actor);
    if (!allowed.ok) return allowed;
    const release = input.release ?? null;
    const done = tx.sql.run(
      `update approval_requests
         set status = 'cancelled', decided_seq = ?, decided_at = ?
       where status = 'pending'
         and json_extract(intent, '$.target.kind') = 'activation'
         and json_extract(intent, '$.target.app') = ?
         and (? is null or json_extract(intent, '$.target.release') != ?)`,
      [BigInt(headSeq(tx)), tx.now(), input.app, release, release],
    );
    return ok({ cancelled: Number(done.changes) });
  },
};

export const approvalCommands = [
  createPendingCommand,
  decideCommand,
  recordAppliedCommand,
  cancelPendingForCommand,
] as const;
