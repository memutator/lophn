import { err, ok } from "../../base/mod.ts";
import type { SecretAllowanceCheck, Tx } from "../../contracts/platform/mod.ts";
import { declarationsOf } from "./declarations.ts";
import { effectiveScope } from "./effective.ts";
import { secretAllowed } from "./broker/secrets.ts";
import { loadGrants } from "./store.ts";

const DENIED = {
  code: "forbidden" as const,
  message: "현재 grant가 이 secret 전송을 허용하지 않는다",
};

// platform SecretAllowance port의 apps 구현이다(platform/secrets#R10, apps/permissions#R14).
// 현재 release 선언 ∩ 현재 active grant만 본다. 누가 command를 불렀는지는 보지 않는다.
// 부른 Tx의 snapshot 위에서 판정하므로 회수는 다음 사용부터 거절된다.
export function createSecretAllowance(
  tx: Pick<Tx, "port" | "sql">,
): SecretAllowanceCheck {
  return (request) => {
    const prefix = "app:";
    const principal = request.context.principal;
    if (!principal.startsWith(prefix) || request.purpose !== "app_secret") {
      return err(DENIED);
    }
    const app = principal.slice(prefix.length);
    const declarations = declarationsOf(tx, app);
    if (!declarations.ok) return declarations;
    if (declarations.value === null) return err(DENIED);
    const grants = loadGrants(tx.sql, { app, status: "active" });
    if (!grants.ok) return grants;
    const scope = effectiveScope({
      app,
      declarations: declarations.value,
      grants: grants.value,
      targetCommands: () => undefined,
    });
    return secretAllowed(scope, [], request.name, request.destination)
      ? ok(undefined)
      : err(DENIED);
  };
}
