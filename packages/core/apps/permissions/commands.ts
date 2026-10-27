import { canonicalize, err, ok, type Result } from "../../../base/mod.ts";
import { type AppGrant, appGrantRevoke } from "../../../protocol/apps/mod.ts";
import type { CommandDefinition, Tx } from "../../../protocol/server/mod.ts";
import { authorizeApp, loadApp } from "../registration/mod.ts";
import {
  type AppFacts,
  compareFacts,
  declaredScopes,
  resourceLabel,
} from "./facts.ts";
import { isSameOrInside } from "./model.ts";
import {
  insertGrant,
  lastProcessFact,
  loadGrant,
  loadGrants,
  markRevoked,
} from "./store.ts";

type AppGrantScope = AppGrant["scope"];

// 앱 grant는 activation 성공 단계의 syncAppGrants가 만들고 거둔다. 사람이 거두는 것은
// app_grants.revoke 하나다.

function conflict(message: string): Result<never> {
  return err({ code: "conflict", message });
}

function forbidden(message: string): Result<never> {
  return err({ code: "forbidden", message });
}

// source를 감싸거나 source 안인 경로는 grant로 허락하지 않는다. 원장이 아는 앱 source만
// 본다. 여기서는 선언된 경로를 lexical로 견준다.
function outsideSources(
  tx: Pick<Tx, "sql">,
  scope: AppGrantScope,
): Result<void> {
  if (scope.kind !== "fs.read" && scope.kind !== "fs.write") {
    return ok(undefined);
  }
  const rows = tx.sql.all(
    "SELECT source_path FROM apps WHERE source_path IS NOT NULL",
    [],
  );
  for (const row of rows) {
    const root = String(row.source_path);
    if (isSameOrInside(scope.path, root) || isSameOrInside(root, scope.path)) {
      return forbidden("path covers an app source");
    }
  }
  return ok(undefined);
}

// 늘어난 선언을 사람이 허락했는지다. 이 함수는 Gate나 request를 모르고 값만 받는다.
type GrantDecision = "granted" | "not_needed";

// activation 성공 단계에서 한 transaction으로 부른다. 앱 grant를 새 선언에 맞춘다.
// - 허락(granted)일 때만 active grant가 덮지 않는 선언에 grant를 만든다. 허락 없이는 만들지 않는다.
// - 새 선언이 더는 요구하지 않는 active grant는 거둔다(앱 grant는 새 선언과의 교집합).
// app.call은 target 앱마다 grant 하나로 맞춘다. 거둔 grant는 다시 active가 되지 않는다.
export function syncAppGrants(
  tx: Pick<Tx, "sql" | "newId" | "now">,
  app: string,
  facts: Pick<AppFacts, "permissions" | "app_connections">,
  decision: GrantDecision,
): Result<{ created: AppGrant[]; revoked: AppGrant[] }> {
  const loaded = loadGrants(tx.sql, { app, status: "active" });
  if (!loaded.ok) return loaded;
  const active = loaded.value;
  const allowed = decision === "granted";
  const want = declaredScopes(app, facts);
  const gap = compareFacts(active, facts);
  const at = tx.now();
  const created: AppGrant[] = [];
  const revoked: AppGrant[] = [];

  function revoke(grant: AppGrant): Result<void> {
    const marked = markRevoked(tx, grant.id, at);
    if (!marked.ok) return marked;
    revoked.push({ ...grant, status: "revoked", revoked_at: at });
    return ok(undefined);
  }
  function create(scope: AppGrantScope): Result<void> {
    const outside = outsideSources(tx, scope);
    if (!outside.ok) return outside;
    const grant: AppGrant = {
      id: tx.newId("grt"),
      app,
      scope,
      status: "active",
      created_at: at,
      revoked_at: null,
    };
    insertGrant(tx, grant);
    created.push(grant);
    return ok(undefined);
  }

  const wanted = new Set(want.resources.map((scope) => canonicalize(scope)));
  for (const grant of active) {
    if (grant.scope.kind === "app.call") continue;
    if (wanted.has(canonicalize(grant.scope))) continue;
    const done = revoke(grant);
    if (!done.ok) return done;
  }
  if (allowed) {
    const added = new Set(gap.added_resources);
    for (const scope of want.resources) {
      if (!added.has(resourceLabel(scope))) continue;
      const done = create(scope);
      if (!done.ok) return done;
    }
  }

  const calls = active.filter((grant) => grant.scope.kind === "app.call");
  const targets = new Set([
    ...want.calls.keys(),
    ...calls.map((grant) => (grant.scope as { app: string }).app),
  ]);
  for (const target of [...targets].sort()) {
    const mine = calls.filter(
      (grant) => (grant.scope as { app: string }).app === target,
    );
    const declared = want.calls.get(target) ?? [];
    const have = new Set(
      mine.flatMap(
        (grant) => (grant.scope as { app_tools: string[] }).app_tools,
      ),
    );
    const tools = allowed
      ? declared
      : declared.filter((tool) => have.has(tool));
    const desired =
      tools.length === 0
        ? undefined
        : canonicalize({
            kind: "app.call",
            app: target,
            app_tools: tools,
          });
    let kept = false;
    for (const grant of mine) {
      if (!kept && canonicalize(grant.scope) === desired) {
        kept = true;
        continue;
      }
      const done = revoke(grant);
      if (!done.ok) return done;
    }
    if (desired !== undefined && !kept) {
      const done = create({
        kind: "app.call",
        app: target,
        app_tools: tools,
      } as AppGrantScope);
      if (!done.ok) return done;
    }
  }
  return ok({ created, revoked });
}

export function createGrantCommands(): {
  revoke: CommandDefinition<typeof appGrantRevoke>;
} {
  return {
    revoke: {
      route: appGrantRevoke,
      dispatchable: true,
      handle(tx, ctx, input) {
        // 없는 grant·범위 밖 앱·이미 거둔 grant는 같은 답이다.
        const absent = () => conflict("the grant is not active");
        const found = loadGrant(tx.sql, input.grant);
        if (!found.ok) return found;
        const grant = found.value;
        if (grant === null) return absent();
        const app = loadApp(tx.sql, grant.app);
        if (!app.ok) return app;
        if (app.value === null) return absent();
        const access = authorizeApp(tx.port, ctx, appGrantRevoke.name, {
          kind: "command",
          before: app.value,
          after: app.value,
        });
        if (!access.ok) {
          return access.error.code === "forbidden" ||
            access.error.code === "not_found"
            ? absent()
            : access;
        }
        if (grant.status !== "active") return absent();
        // 거두기 접수와 실제 완료는 다르다. 살아 있는 process가 멈췄다는 사실(AppStopped)이 원장에
        // 없으면 revoked로 확정하지 않는다. 부르는 쪽(GrantApplier)은 stop으로 종료를 확인하고
        // supervisor가 AppStopped를 기록한 뒤에 이 command를 부른다. 앱 grant는 event를 내지 않는다.
        if (lastProcessFact(tx.sql, grant.app).kind === "started") {
          return err({
            code: "unavailable",
            message:
              "process termination is not confirmed; the revoke is not complete",
          });
        }
        const at = tx.now();
        const revoked = markRevoked(tx, grant.id, at);
        if (!revoked.ok) return revoked;
        return ok({ grant: { ...grant, status: "revoked", revoked_at: at } });
      },
    },
  };
}
