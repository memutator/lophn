import { err, ok, type Result } from "../../../base/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import type { SecretAllowanceCheck } from "../../../protocol/secrets/mod.ts";
import { type AppDeclarations, declarationsOf } from "./declarations.ts";
import { effectiveScope } from "./effective.ts";
import { secretAllowed } from "./broker/secrets.ts";
import { loadGrants } from "./store.ts";

const DENIED = {
  code: "forbidden" as const,
  message: "현재 grant가 이 secret 전송을 허용하지 않는다",
};

type AllowanceSource = {
  sql: Pick<Tx["sql"], "get" | "all">;
  declarations(app: string): Result<AppDeclarations | null>;
  // 앱이 grant로 닿는 loopback에서 막을 플랫폼의 실제 port. 없으면 막지 않는다.
  platformPorts?: () => readonly number[];
};

// platform SecretAllowance port의 apps 구현이다.
// 현재 release 선언 ∩ 현재 active grant만 본다. 누가 command를 불렀는지는 보지 않는다.
// 부른 Tx의 snapshot 위에서 판정하므로 회수는 다음 사용부터 거절된다.
export function createSecretAllowance(
  tx: Pick<Tx, "port" | "sql">,
): SecretAllowanceCheck {
  return secretAllowanceOver({
    sql: tx.sql,
    declarations: (app) => declarationsOf(tx, app),
  });
}

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
    const declarations = source.declarations(app);
    if (!declarations.ok) return declarations;
    if (declarations.value === null) return err(DENIED);
    if (release !== undefined && declarations.value.release !== release) {
      return err(DENIED);
    }
    const grants = loadGrants(source.sql, { app, status: "active" });
    if (!grants.ok) return grants;
    const scope = effectiveScope({
      app,
      declarations: declarations.value,
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
