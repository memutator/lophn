import { err, ok, type Result } from "../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../packages/contracts/platform/mod.ts";
import { authenticatedContextSchema } from "../../packages/contracts/platform/mod.ts";
import type { CredentialRegistry } from "../../packages/platform/identity/mod.ts";
import { openConnection } from "../../packages/platform/ledger/mod.ts";

// 테스트 harness만 쓴다. 제품 registry 앞에 서서 다섯 actor bearer를 ledger 기록과 맞춘다.
export function testCredentialFront(
  inner: CredentialRegistry,
  ledgerPath: string,
): CredentialRegistry {
  const tokens = new Map<string, string>();
  const front = {
    acceptTestCredential(
      context: AuthenticatedContext,
      token: string,
    ): Promise<Result<void>> {
      const parsed = authenticatedContextSchema.safeParse(context);
      if (!parsed.success || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
        return Promise.resolve(err({
          code: "invalid_input",
          message: "테스트 credential이 올바르지 않다",
        }));
      }
      tokens.set(token, parsed.data.credential_ref);
      return Promise.resolve(ok(undefined));
    },
    async authenticate(
      bearer: string,
    ): Promise<Result<AuthenticatedContext>> {
      const known = await inner.authenticate(bearer);
      if (known.ok) return known;
      const ref = tokens.get(bearer);
      if (!ref) return known;
      return readRecord(ledgerPath, ref);
    },
    revalidate: inner.revalidate.bind(inner),
    authorize: inner.authorize.bind(inner),
    revoke: inner.revoke.bind(inner),
    end: inner.end.bind(inner),
    endBy: inner.endBy.bind(inner),
    issue: inner.issue.bind(inner),
  };
  return front as unknown as CredentialRegistry;
}

function readRecord(
  ledgerPath: string,
  credentialRef: string,
): Result<AuthenticatedContext> {
  const opened = openConnection(ledgerPath);
  if (!opened.ok) return opened;
  try {
    const row = opened.value.sql.get(
      `select context, state from credentials where credential_ref = ?`,
      [credentialRef],
    );
    if (
      !row || row["state"] !== "active" || typeof row["context"] !== "string"
    ) {
      return err({ code: "unauthorized", message: "현재 credential이 없다" });
    }
    const context = authenticatedContextSchema.safeParse(
      JSON.parse(row["context"]),
    );
    if (!context.success || context.data.credential_ref !== credentialRef) {
      return err({ code: "unauthorized", message: "현재 credential이 없다" });
    }
    return ok(context.data);
  } finally {
    opened.value.close();
  }
}
