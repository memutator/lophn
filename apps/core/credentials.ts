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
  try {
    connection.sql.run(
      `insert into credentials (credential_ref, context, state) values (?, ?, 'active')`,
      [parsed.data.credential_ref, JSON.stringify(parsed.data)],
    );
  } catch {
    return err({
      code: "unavailable",
      message: "credential 기록을 남기지 못했다",
    });
  }
  return ok(undefined);
}
