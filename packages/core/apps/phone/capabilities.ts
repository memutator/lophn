// 앱이 폰에서 쓸 수 있는 기능의 목록을 계산하는 곳이다. 폰의 `apps/phone_screens`와 view를 여는 `app_views/open`이 같이 쓴다.
import type { Result } from "../../../base/mod.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import { effectiveScope, loadGrants } from "../permissions/mod.ts";
import type { AppFacts } from "../permissions/mod.ts";

// preview에는 grant가 없다. 선언이 `phone.use`로 선언한 기능이 그 preview에서 쓸 수 있는 기능이다.
export function declaredPhoneCapabilities(
  permissions: readonly { kind: string; scope: unknown }[],
): string[] {
  return permissions
    .filter((permission) => permission.kind === "phone.use")
    .map((permission) =>
      String((permission.scope as { capability: string }).capability),
    );
}

// live: 그 release의 선언 ∩ active grant. broker가 요청마다 보는 것과 같은 계산(`effectiveScope`)이다.
export function usablePhoneCapabilities(
  sql: Pick<Sql, "get" | "all">,
  app: string,
  facts: AppFacts,
): Result<string[]> {
  const grants = loadGrants(sql, { app, status: "active" });
  if (!grants.ok) return grants;
  return {
    ok: true,
    value: effectiveScope({
      app,
      facts,
      grants: grants.value,
      targetCommands: () => undefined,
    })
      .access.filter((entry) => entry.kind === "phone.use")
      .map((entry) => String(entry.scope.capability)),
  };
}
