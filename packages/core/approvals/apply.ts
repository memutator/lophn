// approval 적용과 한 번 사용. 허락된 정확한 action을
// 등록된 소유 command로 dispatch하고, 소유 변경·event와 approval_uses를 한 transaction에 확정한다.
// approval만 먼저 소비하는 공개 command는 없다: 사용 기록은 소유 command가 접수·변경을 낸 뒤에만
// 같은 transaction에서 INSERT되고, 실패하면 소유 변경까지 모두 rollback되어 receipt가 남지 않는다.
// handler는 동기다. 입력이 큰 blob인 action은 transaction 안에서 읽을 수 없어 적용하지 못한다.
import { createHash } from "node:crypto";
import { canonicalize, err, ok, type Result } from "../../base/mod.ts";
import type { CommandDefinition, Tx } from "../../protocol/server/mod.ts";
import type { Actor, CommandRoute } from "../../protocol/base/mod.ts";
import {
  applyApprovedAction,
  type ApprovalAction,
  type ApprovalUse,
} from "../../protocol/approvals/mod.ts";
import { recordedUse, usableApproval } from "../storage/ledger/mod.ts";

function notFound(): Result<never> {
  return err({ code: "not_found", message: "approval request가 없다" });
}

function lastSeq(tx: Tx): bigint {
  const row = tx.sql.get("select coalesce(max(seq), 0) as seq from events", []);
  const seq = row?.["seq"];
  return typeof seq === "bigint" ? seq : BigInt(String(seq ?? 0));
}

function inputDigest(value: unknown): string {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

function applyApproved(
  tx: Tx,
  ctx: { actor: Actor },
  input: {
    approval: string;
    action: ApprovalAction;
    idempotency_key: string;
  },
  owners: () => readonly CommandRoute[],
): Result<{ use: ApprovalUse; replayed: boolean }> {
  const stored = tx.sql.get(
    "select action from approval_requests where id = ?",
    [input.approval],
  );
  if (stored === undefined) return notFound();
  let fixed: ApprovalAction;
  try {
    fixed = JSON.parse(String(stored["action"]));
  } catch {
    return err({ code: "internal", message: "approval 기록을 읽지 못했다" });
  }
  // 적용은 machine이나 고정된 호출자만 한다. 그 밖의 자격에는 없는 request와 같게 답한다.
  if (ctx.actor !== "machine" && ctx.actor !== fixed.caller) return notFound();
  // 같은 허락의 재호출은 처음 접수의 receipt를 돌려주고 새 동작을 만들지 않는다.
  const prior = recordedUse(tx, input.approval);
  if (!prior.ok) return prior;
  if (prior.value !== undefined) {
    if (canonicalize(fixed) !== canonicalize(input.action)) {
      return err({
        code: "conflict",
        message: "허락된 동작과 사용하려는 동작이 다르다",
      });
    }
    return ok({ use: prior.value, replayed: true });
  }
  // 허락됨·기한 전·정확한 action·원래 run 진행 중. 소유 command를 부르기 전이다.
  const usable = usableApproval(tx, input.approval, input.action);
  if (!usable.ok) return usable;
  if (input.action.input.kind !== "inline") {
    return err({
      code: "unavailable",
      message: "blob 입력의 동작은 transaction 안에서 적용할 수 없다",
    });
  }
  const value = input.action.input.value;
  if (inputDigest(value) !== input.action.input_hash) {
    return err({
      code: "conflict",
      message: "입력 지문이 허락된 입력과 다르다",
    });
  }
  const route = owners().find((owner) => owner.name === input.action.command);
  if (route === undefined) {
    return err({
      code: "forbidden",
      message: "등록된 소유 command가 아니다",
    });
  }
  const before = lastSeq(tx);
  // 소유 command는 같은 transaction·원래 자격으로 현재 권한·대상·CAS를 다시 검사한다.
  const called = tx.call(route, value, input.action.comparison as never);
  if (!called.ok) return called;
  const accepted = lastSeq(tx);
  if (accepted <= before) {
    return err({
      code: "conflict",
      message: "소유 command가 접수·변경 event를 남기지 않았다",
    });
  }
  const seq = accepted.toString();
  const used = tx.useApproval(input.approval, input.action, {
    approval: input.approval,
    concern: input.action.concern,
    receipt: { kind: "event", seq },
    accepted_seq: seq,
  });
  if (!used.ok) return used;
  return ok({ use: used.value, replayed: false });
}

// owners는 부르는 시점에 dispatch할 수 있는 소유 command route 목록을 돌려준다. writer가 모든
// 등록을 모은 뒤 정해지므로 함수로 받는다.
export function createApplyCommand(
  owners: () => readonly CommandRoute[],
): CommandDefinition<typeof applyApprovedAction> {
  return {
    route: applyApprovedAction,
    handle(tx, ctx, input) {
      return applyApproved(tx, ctx, input, owners);
    },
  };
}
