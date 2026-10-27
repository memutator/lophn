import { ok, type Result } from "../../../base/mod.ts";
import {
  CODING_CLI_COMMANDS,
  CODING_MCP_OPERATION,
  codingPrincipal,
  type CodingTokens,
} from "../../../protocol/coding-agent/mod.ts";
import type { CredentialRegistry } from "./registry.ts";

// token이 여는 operation은 CLI 명령 가운데 coding_token 인증인 것의 route다.
// MCP endpoint도 같은 token으로 연다.
const CODING_TOKEN_OPERATIONS = [
  CODING_MCP_OPERATION,
  ...new Set(
    CODING_CLI_COMMANDS.flatMap((command) =>
      command.auth === "coding_token" && command.route
        ? [command.route.name]
        : [],
    ),
  ),
];

// session마다 앱 하나에 묶인 token을 새로 만든다. token은 registry 메모리에만 있고 lophn이 꺼지면
// 사라진다. session이 끝나면 revoke가 거둔다. 만료도 자동 재발급도 없다.
export function createCodingTokens(options: {
  registry: CredentialRegistry;
}): CodingTokens {
  const refs = new Map<string, string>();
  return {
    issue({ session, app }): Result<{ token: string; credential_ref: string }> {
      // session마다 token은 하나다. 다시 발급하면 앞 것은 거둔다.
      const old = refs.get(session);
      if (old !== undefined) options.registry.revoke(old);
      const principal = codingPrincipal(session);
      const issued = options.registry.issue({
        actor: principal,
        principal,
        scope: { operations: CODING_TOKEN_OPERATIONS, targets: { app } },
        conditions: { app },
      });
      if (!issued.ok) return issued;
      refs.set(session, issued.value.credential_ref);
      return ok({
        token: issued.value.token,
        credential_ref: issued.value.credential_ref,
      });
    },
    revoke(session) {
      const ref = refs.get(session);
      if (ref === undefined) return ok(undefined);
      refs.delete(session);
      return options.registry.revoke(ref);
    },
  };
}
