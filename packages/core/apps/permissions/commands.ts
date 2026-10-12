import { canonicalize, err, ok, type Result } from "../../../base/mod.ts";
import {
  type App,
  automationGrantRevoke,
  type Grant,
  grantCreate,
  grantCreated,
  type GrantPermissionScope,
  grantRevoke,
  grantRevoked,
} from "../../../protocol/apps/mod.ts";
import type {
  CommandDefinition,
  RequestContext,
  Tx,
} from "../../../protocol/server/mod.ts";
import { authorizeApp, loadApp } from "../registration/mod.ts";
import { declarationsOf } from "./declarations.ts";
import { isSameOrInside } from "./model.ts";
import {
  activationInProgress,
  grantsSeq,
  insertGrant,
  lastProcessFact,
  loadGrant,
  markRevoked,
} from "./store.ts";

// grant.create는 정확한 approval 적용으로만 만들어지는 machine command이고,
// grant.revoke는 confirmation window를 지난 사람의 결정이다(domain-model apps/permissions).

export const GRANT_APPROVAL_CONCERN = "apps/permissions";

function invalid(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

function conflict(message: string): Result<never> {
  return err({ code: "conflict", message });
}

function forbidden(message: string): Result<never> {
  return err({ code: "forbidden", message });
}

// 범위 밖 앱은 없는 앱과 같은 답이다.
function accessible(
  tx: Tx,
  ctx: RequestContext,
  operation: string,
  app: App,
): Result<void> {
  const access = authorizeApp(tx.port, ctx, operation, {
    kind: "command",
    before: app,
    after: app,
  });
  if (access.ok) return access;
  return access.error.code === "forbidden" || access.error.code === "not_found"
    ? invalid("app is not registered")
    : access;
}

// 정규 scope만 받는다. 같은 허락이 서로 다른 글자로 두 번 생기지 않게 한다.
function normalized(scope: GrantPermissionScope): Result<void> {
  if (scope.kind === "fs.read" || scope.kind === "fs.write") {
    const posix = scope.path.startsWith("/");
    if (
      posix && (scope.path.includes("//") ||
        (scope.path.length > 1 && scope.path.endsWith("/")))
    ) {
      return invalid("path scope is not normalized");
    }
    return ok(undefined);
  }
  if (scope.kind === "net.fetch" || scope.kind === "net.listen") {
    return scope.host === scope.host.toLowerCase()
      ? ok(undefined)
      : invalid("host scope is not normalized");
  }
  if (scope.kind === "app.call" || scope.kind === "agent.commands") {
    const sorted = [...scope.commands].sort();
    return canonicalize(sorted) === canonicalize(scope.commands)
      ? ok(undefined)
      : invalid("command list is not sorted");
  }
  return ok(undefined);
}

// source를 감싸거나 source 안인 경로는 grant로 허락하지 않는다. 원장이 아는 앱 source만
// 본다. 실제 경로 해석과 credential·데이터 root는 부여 준비와 flag 계산이 한다.
function outsideSources(tx: Tx, scope: GrantPermissionScope): Result<void> {
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

function tableExists(tx: Tx, name: string): boolean {
  return tx.sql.get(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    [name],
  ) !== undefined;
}

// grant 하나는 그것을 정확히 허락한 approval 하나에서만 나온다. 사용 기록은 approval 적용이
// 같은 transaction에서 남기고, 한 approval은 grants.approval unique가 한 grant로 묶는다.
function checkApproval(
  tx: Tx,
  input: {
    app: string;
    kind: string;
    scope: GrantPermissionScope;
    approval: string;
  },
): Result<void> {
  const notGranted = () => forbidden("approval is not granted for this grant");
  if (!tableExists(tx, "approval_requests")) {
    return err({
      code: "unavailable",
      message: "approvals are unavailable",
    });
  }
  const row = tx.sql.get(
    `SELECT status, action, expires_at, closed_seq
     FROM approval_requests WHERE id = ?`,
    [input.approval],
  );
  if (row === undefined || row.status !== "granted") return notGranted();
  if (row.expires_at !== null) {
    const deadline = Date.parse(String(row.expires_at));
    const now = Date.parse(tx.now());
    if (
      !Number.isFinite(deadline) || !Number.isFinite(now) || now >= deadline
    ) {
      return conflict("approval has expired");
    }
  }
  if (
    tx.sql.get("SELECT 1 AS found FROM grants WHERE approval = ?", [
        input.approval,
      ]) !== undefined ||
    (tableExists(tx, "approval_uses") &&
      tx.sql.get("SELECT 1 AS found FROM approval_uses WHERE approval = ?", [
          input.approval,
        ]) !== undefined)
  ) {
    return conflict("approval was already used");
  }
  let action: {
    concern?: unknown;
    command?: unknown;
    targets?: unknown;
    input?: { kind?: unknown; value?: unknown };
  };
  try {
    action = JSON.parse(String(row.action));
  } catch {
    return err({ code: "internal", message: "approval record is unreadable" });
  }
  const targets = action.targets;
  if (
    action.concern !== GRANT_APPROVAL_CONCERN ||
    action.command !== grantCreate.name ||
    !Array.isArray(targets) || targets.length !== 1 ||
    targets[0] !== input.app ||
    action.input?.kind !== "inline" ||
    canonicalize(action.input.value) !== canonicalize(input)
  ) {
    return notGranted();
  }
  // grant를 허락한 쪽은 사람이다. 결정 event의 actor로 확인한다.
  const decided = tx.sql.get("SELECT actor FROM events WHERE seq = ?", [
    row.closed_seq as number | bigint,
  ]);
  return decided?.actor === "user" ? ok(undefined) : notGranted();
}

// app.call·agent.commands·automation.run은 현재 선언과 맞아야 한다.
// 선언은 releases가 port로 낸다. 없으면 만들지 않는다.
function checkDeclared(
  tx: Tx,
  app: string,
  scope: GrantPermissionScope,
): Result<void> {
  if (
    scope.kind !== "app.call" && scope.kind !== "agent.commands" &&
    scope.kind !== "automation.run"
  ) return ok(undefined);
  if (scope.kind === "app.call") {
    if (scope.app === app) return invalid("an app cannot call itself");
    const target = loadApp(tx.sql, scope.app);
    if (!target.ok) return target;
    if (target.value === null) return invalid("target app is not registered");
  }
  const declarations = declarationsOf(tx, app);
  if (!declarations.ok) return declarations;
  const current = declarations.value;
  if (current === null) return conflict("the app has no current release");
  if (scope.kind === "app.call") {
    const declared = new Set(
      current.app_connections.filter((c) => c.app === scope.app)
        .flatMap((c) => c.commands),
    );
    return scope.commands.every((c) => declared.has(c))
      ? ok(undefined)
      : conflict("commands are not in the current app_connections");
  }
  if (scope.kind === "agent.commands") {
    const known = new Set(current.commands);
    return scope.commands.every((c) => known.has(c))
      ? ok(undefined)
      : conflict("commands are not in the current blueprint");
  }
  const wanted = canonicalize({
    automation: scope.automation,
    command: scope.command,
    input_hash: scope.input_hash,
    when: scope.when,
  });
  const matched = current.automations.some((a) =>
    a.external && canonicalize({
        automation: a.key,
        command: a.command,
        input_hash: a.input_hash,
        when: a.when,
      }) === wanted
  );
  return matched
    ? ok(undefined)
    : conflict("automation is not a current external automation declaration");
}

export function createGrantCommands(): {
  create: CommandDefinition<typeof grantCreate>;
  revoke: CommandDefinition<typeof grantRevoke>;
  revokeAutomation: CommandDefinition<typeof automationGrantRevoke>;
} {
  return {
    create: {
      route: grantCreate,
      // approval 적용(`apply_approved_action`)이 같은 transaction에서 부른다. 직접 호출은 approval_uses
      // 없이 grant를 만들어 한 번 사용이 깨지므로 dispatch 전용이다.
      dispatchable: true,
      dispatchOnly: true,
      handle(tx, ctx, input, compare) {
        const app = loadApp(tx.sql, input.app);
        if (!app.ok) return app;
        if (app.value === null) return invalid("app is not registered");
        const access = accessible(tx, ctx, grantCreate.name, app.value);
        if (!access.ok) return access;
        if (activationInProgress(tx.sql, input.app)) {
          return conflict("an activation is in progress for the app");
        }
        if (compare.grants_seq !== grantsSeq(tx.sql, input.app)) {
          return conflict("the grant set changed");
        }
        if (input.kind !== input.scope.kind) {
          return invalid("grant kind does not match scope kind");
        }
        const shape = normalized(input.scope);
        if (!shape.ok) return shape;
        const sources = outsideSources(tx, input.scope);
        if (!sources.ok) return sources;
        const approved = checkApproval(tx, input);
        if (!approved.ok) return approved;
        const declared = checkDeclared(tx, input.app, input.scope);
        if (!declared.ok) return declared;
        const same = tx.sql.get(
          `SELECT 1 AS found FROM grants
           WHERE app = ? AND kind = ? AND scope = ? AND status = 'active'`,
          [input.app, input.kind, canonicalize(input.scope)],
        );
        if (same !== undefined) return conflict("the grant already exists");
        const id = tx.newId("grt");
        const at = tx.now();
        const grant: Grant = {
          id,
          app: input.app,
          kind: input.kind,
          scope: input.scope,
          approval: input.approval,
          status: "active",
          created_by: "user",
          created_at: at,
          revoked_by: null,
          revoked_at: null,
        };
        tx.emit(grantCreated, id, {
          app: input.app,
          kind: input.kind,
          scope: input.scope,
          approval: input.approval,
          created_by: "user",
          created_at: at,
        });
        insertGrant(tx, grant);
        return ok({ grant });
      },
    },
    revokeAutomation: {
      route: automationGrantRevoke,
      handle(tx, ctx, input, compare) {
        const absent = () =>
          err({
            code: "not_found" as const,
            message: "automation grant not found",
          });
        if (ctx.actor !== "user") return absent();
        const loaded = loadGrant(tx.sql, input.grant);
        if (!loaded.ok) return loaded;
        const grant = loaded.value;
        if (
          grant === null || grant.app !== input.app ||
          grant.kind !== "automation.run" ||
          grant.scope.kind !== "automation.run" ||
          grant.scope.automation !== input.automation
        ) return absent();
        const app = loadApp(tx.sql, input.app);
        if (!app.ok) return app;
        if (app.value === null) return absent();
        const access = authorizeApp(tx.port, ctx, automationGrantRevoke.name, {
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
        if (
          grant.status !== "active" ||
          compare.grants_seq !== grantsSeq(tx.sql, input.app)
        ) return conflict("the grant set changed");
        const at = tx.now();
        const revoked = markRevoked(tx, grant.id, at);
        if (!revoked.ok) return revoked;
        tx.emit(grantRevoked, grant.id, {
          app: grant.app,
          kind: grant.kind,
          revoked_by: "user",
          revoked_at: at,
        });
        return ok({
          grant: {
            ...grant,
            status: "revoked" as const,
            revoked_by: "user" as const,
            revoked_at: at,
          },
        });
      },
    },
    revoke: {
      route: grantRevoke,
      dispatchable: true,
      handle(tx, ctx, input, compare) {
        // 없는 grant·범위 밖 앱·이미 회수한 grant는 같은 답이다.
        const absent = () => conflict("the grant is not active");
        const found = loadGrant(tx.sql, input.grant);
        if (!found.ok) return found;
        const grant = found.value;
        if (
          grant === null || (input.app !== undefined && input.app !== grant.app)
        ) return absent();
        const app = loadApp(tx.sql, grant.app);
        if (!app.ok) return app;
        if (app.value === null) return absent();
        const access = authorizeApp(tx.port, ctx, grantRevoke.name, {
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
        if (activationInProgress(tx.sql, grant.app)) {
          return conflict("an activation is in progress for the app");
        }
        if (compare.grants_seq !== grantsSeq(tx.sql, grant.app)) {
          return conflict("the grant set changed");
        }
        // 회수 요청 접수와 실제 완료는 다르다. 살아 있는 프로세스의 종료 확인이 없으면
        // revoked로 확정하지 않는다. automation.run은 프로세스 재시작 없이 다음 회차부터 막힌다.
        if (grant.kind !== "automation.run") {
          const fact = lastProcessFact(tx.sql, grant.app);
          if (
            fact.kind === "started" &&
            !(input.termination_confirmed === true &&
              input.process_nonce === fact.nonce)
          ) {
            return err({
              code: "unavailable",
              message:
                "process termination is not confirmed; the revoke is not complete",
            });
          }
        }
        const at = tx.now();
        const revoked = markRevoked(tx, grant.id, at);
        if (!revoked.ok) return revoked;
        tx.emit(grantRevoked, grant.id, {
          app: grant.app,
          kind: grant.kind,
          revoked_by: "user",
          revoked_at: at,
        });
        return ok({
          grant: {
            ...grant,
            status: "revoked",
            revoked_by: "user",
            revoked_at: at,
          },
        });
      },
    },
  };
}
