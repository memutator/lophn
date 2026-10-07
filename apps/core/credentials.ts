import { err, ok, type Result } from "../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../packages/contracts/platform/mod.ts";
import { authenticatedContextSchema } from "../../packages/contracts/platform/mod.ts";
import type { LedgerConnection } from "../../packages/platform/ledger/mod.ts";
import { APPS_CONTROL_PRINCIPAL } from "./apps-control.ts";
import { INVOCATION_RECOVERY_PRINCIPAL } from "../../packages/apps/invocations/restart.ts";
import { DOCUMENTS_FEED_PRINCIPAL } from "./documents-events.ts";
import {
  ASSIGNMENT_REACTIONS_PRINCIPAL,
  APPROVAL_EXPIRY_PRINCIPAL,
  NOTIFICATIONS_PRINCIPAL,
} from "./platform.ts";

// 발급 원문(token)은 core 프로세스 메모리에만 있다. ledger에는 credential_ref와
// 그 권한 context만 적어 writer·reader Worker가 제출 context를 다시 검증한다.
export const CREDENTIAL_SCHEMA = {
  id: "platform.credentials",
  sql: `
create table credentials (
  credential_ref text primary key,
  context text not null,
  state text not null check (state in ('active', 'revoked', 'ended'))
) strict`,
};

export function recordCredential(
  connection: LedgerConnection,
  context: AuthenticatedContext,
): Result<void> {
  const parsed = authenticatedContextSchema.safeParse(context);
  if (!parsed.success) {
    return err({
      code: "internal",
      message: "credential 기록을 만들지 못했다",
    });
  }
  // writer의 유일한 연결이다. 열린 transaction 밖에서 자체 transaction으로 확정한다.
  // 열린 transaction 안에서 부르면 실행기의 commit 경계가 깨지므로 거절한다.
  if (connection.inTransaction()) {
    return err({
      code: "internal",
      message: "credential 기록을 열린 transaction 안에서 남길 수 없다",
    });
  }
  try {
    connection.exec("begin immediate");
    // 고정 machine credential만 재시작에서 다시 기록한다. 같은 ref가 있으면
    // scope·conditions·state가 같을 때만 건너뛰고, 다르면 기동을 거절한다.
    // 그 밖 credential은 중복을 그대로 거절한다(coding-agent/tickets#R13).
    const existing = connection.sql.get(
      "select context, state from credentials where credential_ref = ?",
      [parsed.data.credential_ref],
    );
    if (existing === undefined) {
      connection.sql.run(
        `insert into credentials (credential_ref, context, state) values (?, ?, 'active')`,
        [parsed.data.credential_ref, JSON.stringify(parsed.data)],
      );
    } else if (!sameFixedCredential(existing, parsed.data)) {
      connection.exec("rollback");
      return err({
        code: "conflict",
        message: "credential 기록이 이미 있고 권한이 다르다",
      });
    }
    connection.exec("commit");
  } catch {
    try {
      if (connection.inTransaction()) connection.exec("rollback");
    } catch {
      // rollback도 실패하면 연결은 다음 command에서 거절된다.
    }
    return err({
      code: "unavailable",
      message: "credential 기록을 남기지 못했다",
    });
  }
  return ok(undefined);
}

// sweep·내장 assignment 준비 credential처럼 기동마다 같은 ref로 다시 기록하는 것만
// 중복을 허용한다. documents·notifications 구독자(core 안 machine principal)도 기동마다
// 같은 자격을 다시 기록한다.
const FIXED_CREDENTIALS = new Set([
  "machine:ticket-claims",
  APPS_CONTROL_PRINCIPAL,
  "machine:lophn-agent-bootstrap",
  APPROVAL_EXPIRY_PRINCIPAL,
  INVOCATION_RECOVERY_PRINCIPAL,
  DOCUMENTS_FEED_PRINCIPAL,
  NOTIFICATIONS_PRINCIPAL,
  ASSIGNMENT_REACTIONS_PRINCIPAL,
]);

// coding agent connection의 인증 context는 connection마다 고정 ref(`coding:<cac>`)이고 시작마다
// 같은 권한으로 다시 기록한다(platform#T34). 권한이 다르면 위의 비교가 거절한다.
function isFixedCredential(ref: string): boolean {
  return FIXED_CREDENTIALS.has(ref) || /^coding:cac_[0-9a-z]{26}$/.test(ref);
}

function sameFixedCredential(
  row: Record<string, unknown>,
  context: AuthenticatedContext,
): boolean {
  if (!isFixedCredential(context.credential_ref)) return false;
  if (row.state !== "active" || typeof row.context !== "string") return false;
  let stored: {
    scope?: unknown;
    conditions?: unknown;
  };
  try {
    stored = JSON.parse(row.context) as {
      scope?: unknown;
      conditions?: unknown;
    };
  } catch {
    return false;
  }
  return JSON.stringify(stored.scope) === JSON.stringify(context.scope) &&
    JSON.stringify(stored.conditions) === JSON.stringify(context.conditions);
}
