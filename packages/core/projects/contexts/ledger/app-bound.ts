// 앱 하나에 묶인 agent(App Engineer의 `conditions.app`)가 context를 읽는 길이다
// (lophn-agent/roles/app-engineer#R2). context는 앱의 것이 아니라서 platform은 context target을 owner가
// 담당 앱과 이어진 사실(`apps`)을 줄 때만 연다. 여기서 owner는 그 사실을 context_app_data 표에서
// 내고, 열어 주는 읽기는 overview·용어집과 그 prompt 자료가 필요로 하는 get·contract뿐이다. 그 밖의
// 읽기와 모든 command는 없는 대상과 같은 답이다.
import type { Result } from "../../../../base/mod.ts";
import {
  parseActor,
  type RequestContext,
  type Sql,
  TargetAuthorization,
  type Tx,
} from "../../../../protocol/platform/mod.ts";
import type { ContextLedgerDeps } from "./adapter.ts";
import { loadAppData } from "./rows-app-data.ts";

// 앱 하나에 묶인 agent에게 열리는 읽기다. contract는 overview 자료의 type 뜻·관계를 그리는 데 쓴다.
export const APP_BOUND_READS: ReadonlySet<string> = new Set([
  "context.get",
  "context.contract",
  "context.overview",
  "glossary.list",
]);

// context 목록(`context.list`)은 열리는 context만 남긴다.
export const APP_BOUND_LIST = "context.list";

export function isAppBound(ctx: RequestContext): boolean {
  return parseActor(ctx.actor)?.kind === "agent" &&
    ctx.conditions.app !== undefined;
}

// Tx와 읽기 snapshot이 같이 가진 것이다.
type Scope = Pick<Tx, "port"> & { sql: Pick<Sql, "get" | "all"> };

type Deps = Pick<ContextLedgerDeps, "appIds">;

// context가 읽는 앱의 ID들이다. slug가 가리키는 앱이 없거나 앱 등록이 없으면 빠진다.
function appsOf(scope: Scope, deps: Deps, context: string): string[] {
  const slugs = loadAppData(scope.sql, context);
  return slugs.length === 0 ? [] : [...deps.appIds(slugs)];
}

// owner의 사실(context가 읽는 앱)을 target에 실어 platform에 판정을 맡긴다. 없는 context는 앱이 없어서
// 닫히고, 그래서 열리지 않는 context와 같은 답이다.
function judge(
  scope: Scope,
  deps: Deps,
  ctx: RequestContext,
  operation: string,
  context: string,
): Result<void> {
  return scope.port(TargetAuthorization)(ctx, operation, {
    context,
    apps: appsOf(scope, deps, context),
  });
}

// 읽기 하나가 이 agent에게 열리는가. 열리는 읽기가 아니거나 context를 가리키지 않으면 context가 비어
// 있는 target으로 판정해 닫는다.
export function authorizeRead(
  scope: Scope,
  deps: Deps,
  ctx: RequestContext,
  operation: string,
  context: string | undefined,
): Result<void> {
  if (!APP_BOUND_READS.has(operation) || context === undefined) {
    return scope.port(TargetAuthorization)(ctx, operation, { context: "" });
  }
  return judge(scope, deps, ctx, operation, context);
}

// command는 모두 없는 대상과 같은 답이다.
export function denyCommand(
  scope: Scope,
  ctx: RequestContext,
  operation: string,
): Result<void> {
  return scope.port(TargetAuthorization)(ctx, operation, { context: "" });
}

// 목록의 줄 중 열리는 context만 남긴다.
export function filterList<T extends { id: string }>(
  scope: Scope,
  deps: Deps,
  ctx: RequestContext,
  items: readonly T[],
): T[] {
  return items.filter((item) =>
    judge(scope, deps, ctx, APP_BOUND_LIST, item.id).ok
  );
}
