import { canonicalize, err, ok, type Result } from "../../../base/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import { definePort } from "../../../protocol/base/mod.ts";
import type {
  AddedAppApi,
  AppGrant,
  GrantPermissionRequirement,
} from "../../../protocol/apps/mod.ts";

// grant가 기대는 현재 release의 선언이다. releases(apps/releases)가 고정 blueprint에서
// 만들어 port로 내놓는다. permissions는 blueprint 내용을 읽거나 해석하지 않는다.
// 앱 grant와 닿는 것은 바깥 자원 요구(permissions)와 다른 앱 app-api 선언(app_connections)이다.
export type AppDeclarations = {
  release: string;
  permissions: readonly GrantPermissionRequirement[];
  // 이 앱이 부르겠다고 선언한 다른 앱의 app-api.
  app_connections: readonly { app: string; commands: readonly string[] }[];
  // 현재 blueprint의 command key 전체. broker가 호출한 command가 선언된 것인지 본다.
  commands: readonly string[];
};

export interface CurrentDeclarations {
  // 현재 release가 없으면 null이다. sql은 부른 transaction·snapshot의 것이다.
  // reader Worker의 port는 고정 값이라 구현은 sql을 받아 읽는다.
  get(
    sql: Pick<Tx["sql"], "get" | "all">,
    app: string,
  ): Result<AppDeclarations | null>;
}

export const currentDeclarations = definePort<CurrentDeclarations>(
  "apps.permissions.CurrentDeclarations",
);

// 선언 port가 등록되지 않은 core에서는 선언 비교가 필요한 grant를 만들지 않는다.
// 선언을 알 수 없는데 허락 범위가 선언과 같다고 가정하지 않는다(fail-closed).
export function declarationsOf(
  tx: Pick<Tx, "port" | "sql">,
  app: string,
): Result<AppDeclarations | null> {
  const lookup = tx as Pick<Tx, "port" | "sql"> & {
    portLookup?: { present(key: object): boolean };
  };
  if (lookup.portLookup?.present(currentDeclarations) !== true) {
    return err({
      code: "unavailable",
      message: "current release declarations are unavailable",
    });
  }
  const declarations = tx.port(currentDeclarations);
  const found = declarations.get(tx.sql, app);
  return found.ok ? ok(found.value) : found;
}

// read 쪽. 선언을 낼 주체가 없으면(port 미등록) 선언을 모르는 것이고 null이다.

const LISTEN_HOSTS = ["localhost", "127.0.0.1", "::1"];

type AppGrantScope = AppGrant["scope"];
type ResourceScope = Exclude<AppGrantScope, { kind: "app.call" }>;

// grant가 되는 바깥 자원 요구만 고른다. grant가 아닌 요구 kind는 버린다.
function resourceOf(
  requirement: GrantPermissionRequirement,
): ResourceScope | undefined {
  const { kind, scope } = requirement;
  if (kind === "fs.read" || kind === "fs.write") {
    return "path" in scope ? { kind, ...scope } : undefined;
  }
  if (kind === "net.fetch") {
    return "host" in scope ? { kind, ...scope } : undefined;
  }
  if (kind === "net.listen") {
    // 앱 grant의 듣기 host는 loopback뿐이다. 다른 host는 grant가 되지 않는다.
    return "host" in scope && LISTEN_HOSTS.includes(scope.host)
      ? { kind, ...scope, host: scope.host as "localhost" }
      : undefined;
  }
  if (kind === "secret.use") {
    return "name" in scope ? { kind, ...scope } : undefined;
  }
  return undefined;
}

// 바깥 자원의 비교 이름이다. 같은 자원은 같은 이름이고 카드의 "늘어난 선언"이 이 이름을 보인다.
export function resourceLabel(scope: ResourceScope): string {
  if (scope.kind === "fs.read" || scope.kind === "fs.write") {
    return `${scope.kind}:${scope.path}${scope.recursive ? "/**" : ""}`;
  }
  if (scope.kind === "net.fetch" || scope.kind === "net.listen") {
    return `${scope.kind}:${scope.host}:${scope.port}`;
  }
  return `${scope.kind}:${scope.name}`;
}

type DeclarationGap = {
  added_resources: string[];
  added_app_apis: AddedAppApi[];
};

// 선언한 것 가운데 지금 active grant가 덮지 않는 것이다. activation에서 묻는 판정의 한 곳이다.
// 이전 release와 따로 비교하지 않는다. 선언이 그대로면 빈 목록이다.
// 자기 앱 app-api는 grant가 아니라 agent grant가 받으므로 보지 않는다.
export function compareDeclarations(
  grants: readonly AppGrant[],
  declarations: Pick<AppDeclarations, "permissions" | "app_connections">,
): DeclarationGap {
  const active = grants.filter((grant) => grant.status === "active");
  const covered = new Set(
    active.filter((grant) => grant.scope.kind !== "app.call")
      .map((grant) => canonicalize(grant.scope)),
  );
  const calls = new Map<string, Set<string>>();
  for (const grant of active) {
    if (grant.scope.kind !== "app.call") continue;
    const apis = calls.get(grant.scope.app) ?? new Set<string>();
    for (const api of grant.scope.app_apis) apis.add(api);
    calls.set(grant.scope.app, apis);
  }

  const resources = new Map<string, true>();
  for (const requirement of declarations.permissions) {
    const scope = resourceOf(requirement);
    if (scope !== undefined && !covered.has(canonicalize(scope))) {
      resources.set(resourceLabel(scope), true);
    }
  }
  const apis: AddedAppApi[] = [];
  for (const connection of declarations.app_connections) {
    const have = calls.get(connection.app);
    for (const api of new Set(connection.commands)) {
      if (!have?.has(api)) {
        apis.push({ app: connection.app as AddedAppApi["app"], api });
      }
    }
  }
  apis.sort((a, b) => `${a.app}:${a.api}`.localeCompare(`${b.app}:${b.api}`));
  return {
    added_resources: [...resources.keys()].sort(),
    added_app_apis: apis,
  };
}

// 선언을 grant scope로 바꾼다. activation 성공 단계의 syncAppGrants가 쓴다.
export function declaredScopes(
  app: string,
  declarations: Pick<AppDeclarations, "permissions" | "app_connections">,
): { resources: ResourceScope[]; calls: Map<string, string[]> } {
  const resources = new Map<string, ResourceScope>();
  for (const requirement of declarations.permissions) {
    const scope = resourceOf(requirement);
    if (scope !== undefined) resources.set(canonicalize(scope), scope);
  }
  const calls = new Map<string, string[]>();
  for (const connection of declarations.app_connections) {
    if (connection.app === app) continue;
    const merged = new Set([
      ...(calls.get(connection.app) ?? []),
      ...connection.commands,
    ]);
    calls.set(connection.app, [...merged].sort());
  }
  return { resources: [...resources.values()], calls };
}
