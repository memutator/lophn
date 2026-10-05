import { err, ok, type Result } from "../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../packages/contracts/platform/mod.ts";
import { authenticatedContextSchema } from "../../packages/contracts/platform/mod.ts";
import type { LedgerConnection } from "../../packages/platform/ledger/mod.ts";

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
    // 같은 credential_ref가 이미 있으면 기동을 죽이지 않는다. 재시작마다 같은
    // machine credential을 다시 기록한다(coding-agent/tickets#R13).
    const existing = connection.sql.get(
      "select state from credentials where credential_ref = ?",
      [parsed.data.credential_ref],
    );
    if (existing === undefined) {
      connection.sql.run(
        `insert into credentials (credential_ref, context, state) values (?, ?, 'active')`,
        [parsed.data.credential_ref, JSON.stringify(parsed.data)],
      );
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
