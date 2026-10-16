import { err, ok, type Result } from "../../base/mod.ts";
import {
  type AuthenticatedContext,
  authenticatedContextSchema,
} from "../../protocol/server/mod.ts";
import type { LedgerConnection } from "../storage/ledger/mod.ts";

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
    // core 안 machine credential(`machine:*`)은 코드가 기동마다 만든다. 권한이 기동마다 달라질 수
    // 있으니(provider host 등) 새 값으로 덮는다. coding connection은 같은 권한일 때만 건너뛰고,
    // 다르면 거절한다. 그 밖 credential은 중복을 그대로 거절한다.
    const existing = connection.sql.get(
      "select context, state from credentials where credential_ref = ?",
      [parsed.data.credential_ref],
    );
    if (existing === undefined) {
      connection.sql.run(
        `insert into credentials (credential_ref, context, state) values (?, ?, 'active')`,
        [parsed.data.credential_ref, JSON.stringify(parsed.data)],
      );
    } else if (parsed.data.credential_ref.startsWith("machine:")) {
      connection.sql.run(
        `update credentials set context = ?, state = 'active' where credential_ref = ?`,
        [JSON.stringify(parsed.data), parsed.data.credential_ref],
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

// coding agent connection의 인증 context는 connection마다 고정 ref(`coding:<cac>`)이고 시작마다
// 같은 권한으로 다시 기록한다. 권한이 다르면 위의 비교가 거절한다.
function isFixedCredential(ref: string): boolean {
  return /^coding:cac_[0-9a-z]{26}$/.test(ref);
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
