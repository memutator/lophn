// approval 한 번 사용의 공통 검사와 기록(platform/approvals#R7, R11, R12, R13).
// `Tx.useApproval`의 실제 구현이다. 정확한 action 일치 확인과 `approval_uses` INSERT는 소유 변경과
// 같은 transaction에서 한다. 실패하면 err이고 부른 쪽이 그 결과를 돌려주어 전체가 rollback한다.
// 표는 platform/approvals가 만들고 이 함수가 쓴다: 사용 기록은 이 공통 함수만 쓴다(domain model).
// platform/approvals 모듈을 import하지 않는다(approvals가 ledger의 port를 쓰므로 순환이다).

import {
  canonicalize,
  err,
  ok,
  parseSeq,
  type Result,
} from "../../../base/mod.ts";
import {
  type ApprovalAction,
  type ApprovalUse,
  approvalUseSchema,
  type Tx,
} from "../../../protocol/server/mod.ts";
import { runAdmission } from "./run-admission.ts";

export type UsableApproval = {
  id: string;
  // 허락 결정이 남은 event 위치. 이보다 앞선 event는 접수 근거가 될 수 없다.
  grantedSeq: bigint;
};

function tableExists(tx: Tx, name: string): boolean {
  return tx.sql.get(
    "select name from sqlite_master where type = 'table' and name = ?",
    [name],
  ) !== undefined;
}

function deadlineReached(expiresAt: string | null, now: string): boolean {
  if (expiresAt === null) return false;
  const deadline = Date.parse(expiresAt);
  const current = Date.parse(now);
  // 시각을 읽지 못하면 사용을 거절한다(fail-closed).
  if (!Number.isFinite(deadline) || !Number.isFinite(current)) return true;
  return current >= deadline;
}

// 지금 이 action으로 이 approval을 쓸 수 있는지 본다. 기록은 바꾸지 않는다.
// 허락됨·기한 전·정확한 action 일치·원래 run 진행 중이어야 한다(R5, R11, R12, R13).
export function usableApproval(
  tx: Tx,
  approval: string,
  action: ApprovalAction,
): Result<UsableApproval> {
  if (!tableExists(tx, "approval_requests")) {
    return err({
      code: "unavailable",
      message: "approval 적용을 사용할 수 없다",
    });
  }
  const row = tx.sql.get(
    `select status, action, expires_at, run, closed_seq
       from approval_requests where id = ?`,
    [approval],
  );
  if (row === undefined) {
    return err({ code: "not_found", message: "approval request가 없다" });
  }
  if (row["status"] !== "granted") {
    return err({
      code: "conflict",
      message: "허락된 approval request만 사용할 수 있다",
    });
  }
  if (
    deadlineReached(
      row["expires_at"] === null ? null : String(row["expires_at"]),
      tx.now(),
    )
  ) {
    return err({ code: "conflict", message: "기한이 지나 사용할 수 없다" });
  }
  let stored: unknown;
  try {
    stored = JSON.parse(String(row["action"]));
  } catch {
    return err({ code: "internal", message: "approval 기록을 읽지 못했다" });
  }
  // 호출자·동작·대상·전체 입력·비교 기준 중 하나라도 다르면 새 request가 필요하다(R5, R10).
  if (canonicalize(stored) !== canonicalize(action)) {
    return err({
      code: "conflict",
      message: "허락된 동작과 사용하려는 동작이 다르다",
    });
  }
  const run = row["run"];
  if (run !== null) {
    const lookup = tx as Tx & {
      portLookup?: { present(key: object): boolean };
    };
    // 원래 run의 상태를 알 수 없으면 사용하지 않는다(fail-closed).
    if (lookup.portLookup?.present(runAdmission) !== true) {
      return err({
        code: "unavailable",
        message: "원래 run 상태를 확인할 수 없다",
      });
    }
    if (tx.port(runAdmission).status(String(run)) !== "active") {
      return err({
        code: "conflict",
        message: "끝난 run의 허락으로 새 동작을 적용하지 않는다",
      });
    }
  }
  const closed = row["closed_seq"];
  if (typeof closed !== "bigint" && typeof closed !== "number") {
    return err({ code: "internal", message: "approval 기록을 읽지 못했다" });
  }
  return ok({ id: approval, grantedSeq: BigInt(closed) });
}

function eventAfter(tx: Tx, seq: string, after: bigint): boolean {
  const parsed = parseSeq(seq);
  if (!parsed.ok || parsed.value <= after) return false;
  return tx.sql.get("select seq from events where seq = ?", [parsed.value]) !==
    undefined;
}

// 이미 저장된 사용. 같은 허락의 재호출이 같은 receipt를 돌려받는 데 쓴다(R7).
export function recordedUse(
  tx: Tx,
  approval: string,
): Result<ApprovalUse | undefined> {
  if (!tableExists(tx, "approval_uses")) {
    return err({
      code: "unavailable",
      message: "approval 적용을 사용할 수 없다",
    });
  }
  const row = tx.sql.get(
    `select approval, concern, receipt, accepted_seq
       from approval_uses where approval = ?`,
    [approval],
  );
  if (row === undefined) return ok(undefined);
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
    accepted_seq: String(row["accepted_seq"]),
  });
  if (!parsed.success) {
    return err({
      code: "internal",
      message: "approval 사용 기록이 schema와 다르다",
    });
  }
  return ok(parsed.data);
}

// 정확한 action 일치 확인 → approval_uses INSERT. 한 approval은 한 번만 쓴다(PK).
export function useApproval(
  tx: Tx,
  approval: string,
  action: ApprovalAction,
  use: ApprovalUse,
): Result<ApprovalUse> {
  const parsed = approvalUseSchema.safeParse(use);
  if (
    !parsed.success || parsed.data.approval !== approval ||
    parsed.data.concern !== action.concern
  ) {
    return err({
      code: "invalid_input",
      message: "사용 기록이 approval·action과 맞지 않는다",
    });
  }
  const usable = usableApproval(tx, approval, action);
  if (!usable.ok) return usable;
  const existing = recordedUse(tx, approval);
  if (!existing.ok) return existing;
  if (existing.value !== undefined) {
    return err({ code: "conflict", message: "이미 사용한 approval이다" });
  }
  const value = parsed.data;
  // 접수·변경 event는 허락 뒤에 실제로 남은 것이어야 한다. 옛 event를 근거로 쓰지 못한다.
  if (!eventAfter(tx, value.accepted_seq, usable.value.grantedSeq)) {
    return err({
      code: "conflict",
      message: "접수 위치가 허락 뒤의 실제 event가 아니다",
    });
  }
  if (
    value.receipt.kind === "event" &&
    !eventAfter(tx, value.receipt.seq, usable.value.grantedSeq)
  ) {
    return err({
      code: "conflict",
      message: "receipt event가 허락 뒤의 실제 event가 아니다",
    });
  }
  tx.sql.run(
    `insert into approval_uses (approval, concern, receipt, accepted_seq)
     values (?, ?, ?, ?)`,
    [
      value.approval,
      value.concern,
      JSON.stringify(value.receipt),
      BigInt(value.accepted_seq),
    ],
  );
  return ok(value);
}
