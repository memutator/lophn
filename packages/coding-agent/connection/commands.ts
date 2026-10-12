import { err, ok, type Result } from "../../base/mod.ts";
import { appRegistrationLookup } from "../../protocol/apps/mod.ts";
import {
  codingAgentConnectionCreated,
  codingAgentConnectionRevoked,
  type Connection,
  connectionCreate,
  connectionPrincipal,
  connectionRevoke,
} from "../../protocol/coding-agent/mod.ts";
import {
  type CommandDefinition,
  type ConfirmationRef,
  confirmationRefSchema,
  type RequestContext,
  type Tx,
} from "../../protocol/server/mod.ts";
import { parseActor } from "../../protocol/base/mod.ts";
import { assertConnection, nextState, scopeColumns } from "./model.ts";
import { insertConnection, loadConnection, markRevoked } from "./store.ts";

function forbidden(): Result<never> {
  return err({
    code: "forbidden",
    message: "connection changes are user only",
  });
}

function notFound(): Result<never> {
  return err({ code: "not_found", message: "connection not found" });
}

function conflict(message: string): Result<never> {
  return err({ code: "conflict", message });
}

function invalid(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

function requireUser(ctx: RequestContext): Result<void> {
  return parseActor(ctx.actor)?.kind === "user" ? ok(undefined) : forbidden();
}

// 회수만 확인 창 근거가 필요하다. create에는 이 검사를 두지 않는다.
export function requireConfirmation(
  confirmation: string | undefined,
): Result<ConfirmationRef> {
  const parsed = confirmationRefSchema.safeParse(confirmation);
  if (!parsed.success) {
    return err({
      code: "forbidden",
      message: "confirmation window evidence is required",
    });
  }
  return ok(parsed.data);
}

export function createConnectionCommands(): {
  create: CommandDefinition<typeof connectionCreate>;
  revoke: CommandDefinition<typeof connectionRevoke>;
} {
  return {
    create: {
      route: connectionCreate,
      handle(tx, ctx, input) {
        const actor = requireUser(ctx);
        if (!actor.ok) return actor;
        if (input.label.trim().length === 0) return invalid("blank label");
        const columns = scopeColumns(input.scope);
        if (!columns.ok) return columns;
        if (input.scope.kind === "app") {
          const app = tx.port(appRegistrationLookup).get(input.scope.app);
          if (!app.ok) return app;
          if (app.value === null) return invalid("app does not exist");
        }
        const existing = loadConnection(tx.sql, input.id);
        if (!existing.ok) return existing;
        if (existing.value !== null) {
          return conflict("connection id already exists");
        }
        const hashed = tx.sql.get(
          "SELECT id FROM coding_agent_connections WHERE token_hash = ?",
          [input.token_digest],
        );
        if (hashed !== undefined) {
          return conflict("token digest already exists");
        }
        const principal = connectionPrincipal(input.id);
        const seq = tx.emit(codingAgentConnectionCreated, input.id, {
          label: input.label,
          scope: input.scope,
          principal,
        });
        const connection = assertConnection({
          id: input.id,
          label: input.label,
          scope: input.scope,
          principal,
          state: "active",
          revision: seq,
        });
        if (!connection.ok) return connection;
        insertConnection(tx, connection.value, input.token_digest);
        return ok({ connection: connection.value });
      },
    },
    revoke: {
      route: connectionRevoke,
      // 사람 결정 확인은 ledger executor가 transaction 안에서 검증·소비한다.
      // 이 route는 confirmation: "required"라 handle 없이는 여기 오지 않는다.
      handle(tx, ctx, input, compare) {
        return applyRevoke(tx, ctx, input, compare);
      },
    },
  };
}

export function revokeConnection(
  tx: Tx,
  ctx: RequestContext,
  input: { connection: string; base_revision: string },
  compare: { base_revision: string },
  confirmation: string | undefined,
): Result<{ connection: Connection }> {
  const evidence = requireConfirmation(confirmation);
  if (!evidence.ok) return evidence;
  return applyRevoke(tx, ctx, input, compare);
}

function applyRevoke(
  tx: Tx,
  ctx: RequestContext,
  input: { connection: string; base_revision: string },
  compare: { base_revision: string },
): Result<{ connection: Connection }> {
  const actor = requireUser(ctx);
  if (!actor.ok) return actor;
  if (compare.base_revision !== input.base_revision) {
    return conflict("connection revision changed");
  }
  const current = loadConnection(tx.sql, input.connection);
  if (!current.ok) return current;
  if (current.value === null) return notFound();
  if (current.value.revision !== compare.base_revision) {
    return conflict("connection revision changed");
  }
  const state = nextState(current.value.state);
  if (!state.ok) return state;
  const before = current.value.revision;
  const seq = tx.emit(codingAgentConnectionRevoked, current.value.id, {
    before_revision: before,
  });
  const connection = assertConnection({
    ...current.value,
    state: state.value,
    revision: seq,
  });
  if (!connection.ok) return connection;
  const stored = markRevoked(tx, connection.value);
  if (!stored.ok) return stored;
  return ok({ connection: connection.value });
}
