// confirm 접수 command `invocation.accept_confirm`(apps/invocations#R7, R9, R17).
// 사람이 확인한 정확한 release·command·입력의 approval을 접수와 함께 한 번만 쓴다. approval 사용 기록은
// `apply_approved_action`이 같은 transaction에서 남기고(platform Q28), 이 command는 접수 행과
// InvocationAccepted event만 만든다. 접수는 실제 시작이 아니므로 started_at이 없다.
import { canonicalize, err, ok, type Result } from "../../../base/mod.ts";
import {
  invocationAcceptConfirm,
  type InvocationAcceptConfirmInput,
  invocationAccepted,
  type InvocationCaller,
} from "../../../protocol/apps/mod.ts";
import type { CommandDefinition, Tx } from "../../../protocol/server/mod.ts";
import { actorSchema } from "../../../protocol/base/mod.ts";
import { insertInvocation, loadInvocation } from "./store.ts";

// 접수한 proof의 수명이다(apps Q5). 다시 보내도 접수 시각 기준이라 늘어나지 않는다.
export const CONFIRM_PROOF_LIFETIME_MS = 120_000;

const CONCERN = "apps/invocations";

function forbidden(message: string): Result<never> {
  return err({ code: "forbidden", message });
}

function conflict(message: string): Result<never> {
  return err({ code: "conflict", message });
}

// 접수 입력의 caller는 approval을 요청한 실제 주체와 같은 종류·같은 주체여야 한다.
// agent의 asg id는 caller(run·tool_call)에 없고 approval의 requester에만 있으므로
// Invocation의 actor는 항상 requester에서 읽는다(platform Q28).
export function callerMatchesRequester(
  caller: InvocationCaller,
  requester: string,
): boolean {
  switch (caller.kind) {
    case "direct":
      return requester === "user";
    case "app":
      return requester === `app:${caller.app}`;
    case "agent":
      return requester.startsWith("agent:");
    default:
      return false;
  }
}

type Stored = { requester: string; action: unknown };

function readApproval(tx: Tx, approval: string): Stored | undefined {
  const exists = tx.sql.get(
    "select name from sqlite_master where type = 'table' and name = 'approval_requests'",
    [],
  );
  if (exists === undefined) return undefined;
  const row = tx.sql.get(
    `select requester, action, status, expires_at, closed_seq
       from approval_requests where id = ?`,
    [approval],
  );
  if (row === undefined) return undefined;
  // 사람이 허락한 request만 쓴다. 대기·거절·취소·만료는 없는 것과 같게 답한다.
  if (row["status"] !== "granted") return undefined;
  if (row["expires_at"] !== null) {
    const deadline = Date.parse(String(row["expires_at"]));
    if (!Number.isFinite(deadline) || Date.parse(tx.now()) >= deadline) {
      return undefined;
    }
  }
  const decided = tx.sql.get("select actor from events where seq = ?", [
    row["closed_seq"] as number | bigint,
  ]);
  if (decided?.["actor"] !== "user") return undefined;
  let action: unknown;
  try {
    action = JSON.parse(String(row["action"]));
  } catch {
    return undefined;
  }
  return { requester: String(row["requester"]), action };
}

// 허락된 action이 이 접수 입력 전체와 정확히 같은지. 한 값이라도 다르면 그 허락이 아니다.
function sameAction(action: unknown, input: InvocationAcceptConfirmInput) {
  const value = action as {
    concern?: unknown;
    command?: unknown;
    targets?: unknown;
    input?: { kind?: unknown; value?: unknown };
  };
  const targets = value.targets;
  return value.concern === CONCERN &&
    value.command === invocationAcceptConfirm.name &&
    Array.isArray(targets) && targets.length === 2 &&
    targets[0] === input.app && targets[1] === input.release &&
    value.input?.kind === "inline" &&
    canonicalize(value.input.value) === canonicalize(input);
}

function proofFor(
  invocation: string,
  input: InvocationAcceptConfirmInput,
  acceptedAt: string,
) {
  return {
    invocation,
    process_nonce: input.process_nonce,
    release: input.release,
    command: input.command,
    input_hash: input.input_hash,
    caller: input.caller,
    expires_at: new Date(Date.parse(acceptedAt) + CONFIRM_PROOF_LIFETIME_MS)
      .toISOString(),
  };
}

// 이미 확정된 접수를 같은 접수 입력으로 다시 읽는다. 접수가 없으면 undefined이고 다른 호출에 쓰인
// approval이면 conflict다. 새 접수도 새 proof 수명도 만들지 않는다(R7, R8).
export function existingAcceptance(
  sql: Pick<Tx["sql"], "get" | "all">,
  input: InvocationAcceptConfirmInput,
): Result<
  { invocation: string; proof: ReturnType<typeof proofFor> } | undefined
> {
  const prior = sql.get("select id from invocations where approval = ?", [
    input.approval,
  ]);
  if (prior === undefined) return ok(undefined);
  const existing = loadInvocation(sql, String(prior["id"]));
  if (!existing.ok) return existing;
  const row = existing.value;
  if (
    row === null || row.app !== input.app || row.release !== input.release ||
    row.operation.kind !== "command" ||
    row.operation.command !== input.command ||
    row.input_hash !== input.input_hash ||
    canonicalize(row.caller) !== canonicalize(input.caller)
  ) {
    return conflict("approval was accepted for a different call");
  }
  const accepted = sql.get(
    "select at from events where subject = ? and type = ?",
    [row.id, invocationAccepted.type],
  );
  if (accepted === undefined) {
    return err({ code: "internal", message: "accepted event is missing" });
  }
  return ok({
    invocation: row.id,
    proof: proofFor(row.id, input, String(accepted["at"])),
  });
}

export function createConfirmCommands(): {
  acceptConfirm: CommandDefinition<typeof invocationAcceptConfirm>;
} {
  return {
    acceptConfirm: {
      route: invocationAcceptConfirm,
      // apply_approved_action 한 곳으로만 접수된다. 직접 호출은 approval_uses 없이 접수·proof를 낸다.
      dispatchable: true,
      dispatchOnly: true,
      handle(tx, ctx, input) {
        // 접수는 machine이 한다. 원래 요청자는 approval에 고정된 호출 주체다(R17).
        if (ctx.actor !== "machine") {
          return forbidden("confirm acceptance is a machine action");
        }
        const approval = readApproval(tx, input.approval);
        if (approval === undefined) return forbidden("approval is not usable");
        if (!sameAction(approval.action, input)) {
          return conflict("approval does not cover this call");
        }
        if (!callerMatchesRequester(input.caller, approval.requester)) {
          return conflict("caller is not the approval requester");
        }
        const actor = actorSchema.safeParse(approval.requester);
        if (!actor.success) {
          return err({
            code: "internal",
            message: "invalid approval requester",
          });
        }
        // 같은 접수의 재전송은 기존 접수만 돌려준다. 새 접수도 새 proof 수명도 없다(R7, R8).
        const prior = existingAcceptance(tx.sql, input);
        if (!prior.ok) return prior;
        if (prior.value !== undefined) return ok(prior.value);
        const invocation = tx.newId("inv");
        const at = tx.now();
        insertInvocation(tx, {
          id: invocation,
          app: input.app,
          release: input.release,
          operation: { kind: "command", command: input.command },
          trigger: { kind: "direct" },
          mode: "live",
          actor: actor.data,
          caller: input.caller,
          approval: input.approval,
          input_hash: input.input_hash,
          status: "accepted",
          started_at: null,
          finished_at: null,
          summary: {},
          detail_hash: null,
        });
        tx.emit(invocationAccepted, invocation, {
          app: input.app,
          release: input.release,
          command: input.command,
          input_hash: input.input_hash,
          approval: input.approval,
          caller: input.caller,
        });
        return ok({ invocation, proof: proofFor(invocation, input, at) });
      },
    },
  };
}
