import { err, ok, type Result } from "../../../base/mod.ts";
import type { SecretAllowanceCheck } from "../../../protocol/secrets/mod.ts";
import type { AppFacts } from "./facts.ts";
import { effectiveScope } from "./effective.ts";
import { secretAllowed } from "./broker/secrets.ts";
import { loadGrants } from "./store.ts";

const DENIED = {
  code: "forbidden" as const,
  message: "현재 grant가 이 secret 전송을 허용하지 않는다",
};

type AllowanceSource = {
  sql: Parameters<typeof loadGrants>[0];
  facts(app: string): Result<AppFacts | null>;
  // 앱이 grant로 닿는 loopback에서 막을 플랫폼의 실제 port. 없으면 막지 않는다.
  platformPorts?: () => readonly number[];
};

// 앱은 context의 principal이 아니라 `conditions.app`·`conditions.release`가 정한다. 값을 건네는 호출자는
// supervisor의 machine 자격이고 앱은 그 호출이 대신하는 대상이기 때문이다. core 메인 스레드가 Tx 없이
// 부를 때도 같은 판정을 쓴다.
export function secretAllowanceOver(
  source: AllowanceSource,
): SecretAllowanceCheck {
  return (request) => {
    const { app, release } = request.context.conditions;
    if (app === undefined || request.purpose !== "app_secret") {
      return err(DENIED);
    }
    const facts = source.facts(app);
    if (!facts.ok) return facts;
    if (facts.value === null) return err(DENIED);
    if (release !== undefined && facts.value.release !== release) {
      return err(DENIED);
    }
    const grants = loadGrants(source.sql, { app, status: "active" });
    if (!grants.ok) return grants;
    const scope = effectiveScope({
      app,
      facts: facts.value,
      grants: grants.value,
      targetCommands: () => undefined,
    });
    return secretAllowed(
        scope,
        source.platformPorts?.() ?? [],
        request.name,
        request.destination,
      )
      ? ok(undefined)
      : err(DENIED);
  };
}
