import { err, ok } from "../../base/mod.ts";
import type { SdkDecision } from "../../protocol/apps/sdk-status.ts";
import {
  definePort,
  type FollowUpItem,
  type FollowUpOrigin,
  type FollowUpState,
  type FollowUpWorkspace,
  parseActor,
} from "../../protocol/base/mod.ts";
import {
  followUpList,
  followUpReport,
} from "../../protocol/lophn-agent/follow-ups.ts";
import type {
  CommandDefinition,
  ReadDefinition,
  RequestContext,
  SchemaStep,
  Sql,
  SqlRow,
  Tx,
} from "../../protocol/server/mod.ts";

type Query = Pick<Sql, "get" | "all">;

// 따라하기·플랫폼 검토와 후속 정리 항목(follow_up_items)을 통합한다.
// WIRINGS 맨 뒤 wiring(remote)의 schemaStepsAfterTeams 끝에서 잇는다(schema-steps.lock.json).
export const WORKSPACE_LIFECYCLE_SCHEMA_STEP: SchemaStep = {
  id: "workspace.lifecycle.tables",
  sql: `
    CREATE TABLE follow_up_items (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_kind TEXT CHECK (workspace_kind IN ('project', 'app')),
      workspace_id TEXT,
      origin TEXT NOT NULL CHECK (origin IN ('app_sdk', 'flow_sdk', 'platform_note', 'cascade')),
      source_ref TEXT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('open', 'done', 'changed', 'skipped')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      outcome TEXT,
      CHECK ((workspace_kind IS NULL) = (workspace_id IS NULL))
    ) STRICT;
    CREATE INDEX follow_up_items_workspace ON follow_up_items(workspace_kind, workspace_id, state, created_at, id);
    CREATE INDEX follow_up_items_state ON follow_up_items(state, created_at, id);
    INSERT INTO follow_up_items (
      id,
      workspace_kind,
      workspace_id,
      origin,
      source_ref,
      title,
      body,
      state,
      created_at,
      updated_at,
      outcome
    )
    SELECT
      'fup_' || substr(f.id, 5),
      'app',
      f.app,
      'app_sdk',
      f.note_file,
      f.title,
      f.proposal,
      f.state,
      COALESCE((SELECT r.created_at FROM sdk_reviews r WHERE r.id = f.review), f.state_at),
      f.state_at,
      f.outcome
    FROM sdk_features f;
    DROP INDEX IF EXISTS sdk_features_app;
    DROP TABLE sdk_features;
    CREATE TABLE flow_sdk_reviews (
      id TEXT PRIMARY KEY NOT NULL,
      project TEXT NOT NULL,
      workflow TEXT NOT NULL,
      session TEXT,
      decision TEXT NOT NULL CHECK (decision IN ('leave', 'update')),
      through TEXT NOT NULL,
      call TEXT,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX flow_sdk_reviews_target ON flow_sdk_reviews(project, workflow, created_at, id);
    CREATE TABLE platform_reviews (
      id TEXT PRIMARY KEY NOT NULL,
      through TEXT NOT NULL,
      session TEXT,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX platform_reviews_order ON platform_reviews(created_at, id);
  `,
};

export interface FollowUpPorts {
  sessionWorkspace(
    session: string,
  ): { workspace: FollowUpWorkspace | null } | null;
}

export const followUpPorts = definePort<FollowUpPorts>("follow-ups.session");

function rowToFollowUp(row: SqlRow): FollowUpItem {
  const kind = row["workspace_kind"];
  const id = row["workspace_id"];
  const workspace: FollowUpWorkspace | null =
    kind === null || id === null
      ? null
      : ({ kind: String(kind), id: String(id) } as FollowUpWorkspace);
  return {
    id: String(row["id"]) as FollowUpItem["id"],
    workspace,
    origin: String(row["origin"]) as FollowUpOrigin,
    source_ref: row["source_ref"] === null ? null : String(row["source_ref"]),
    title: String(row["title"]),
    body: String(row["body"]),
    state: String(row["state"]) as FollowUpState,
    created_at: String(row["created_at"]),
    updated_at: String(row["updated_at"]),
    outcome: row["outcome"] === null ? null : String(row["outcome"]),
  };
}

export function insertFollowUp(
  tx: Pick<Tx, "sql" | "newId" | "now">,
  input: {
    id?: string;
    workspace: FollowUpWorkspace | null;
    origin: FollowUpOrigin;
    source_ref: string | null;
    title: string;
    body: string;
  },
): FollowUpItem {
  const id = input.id ?? tx.newId("fup");
  const now = tx.now();
  tx.sql.run(
    `INSERT INTO follow_up_items (
       id, workspace_kind, workspace_id, origin, source_ref, title, body, state, created_at, updated_at, outcome
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, NULL)`,
    [
      id,
      input.workspace?.kind ?? null,
      input.workspace?.id ?? null,
      input.origin,
      input.source_ref,
      input.title,
      input.body,
      now,
      now,
    ],
  );
  return {
    id: id as FollowUpItem["id"],
    workspace: input.workspace,
    origin: input.origin,
    source_ref: input.source_ref,
    title: input.title,
    body: input.body,
    state: "open",
    created_at: now,
    updated_at: now,
    outcome: null,
  };
}

export function listFollowUps(
  sql: Query,
  filter?: {
    workspace?: "home" | FollowUpWorkspace;
    state?: FollowUpState;
    origin?: FollowUpOrigin;
  },
): FollowUpItem[] {
  const clauses: string[] = [];
  const params: (string | number | null)[] = [];
  if (filter?.workspace === "home") {
    clauses.push("workspace_kind IS NULL");
  } else if (filter?.workspace !== undefined) {
    clauses.push("workspace_kind = ? AND workspace_id = ?");
    params.push(filter.workspace.kind, filter.workspace.id);
  }
  if (filter?.state !== undefined) {
    clauses.push("state = ?");
    params.push(filter.state);
  }
  if (filter?.origin !== undefined) {
    clauses.push("origin = ?");
    params.push(filter.origin);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return sql
    .all(
      `SELECT id, workspace_kind, workspace_id, origin, source_ref, title, body, state, created_at, updated_at, outcome
       FROM follow_up_items ${where}
       ORDER BY created_at ASC, id ASC`,
      params,
    )
    .map(rowToFollowUp);
}

export function loadFollowUp(sql: Query, id: string): FollowUpItem | undefined {
  const row = sql.get(
    `SELECT id, workspace_kind, workspace_id, origin, source_ref, title, body, state, created_at, updated_at, outcome
     FROM follow_up_items WHERE id = ?`,
    [id],
  );
  return row === undefined ? undefined : rowToFollowUp(row);
}

export function reportFollowUp(
  tx: Pick<Tx, "sql" | "now">,
  id: string,
  state: Exclude<FollowUpState, "open">,
  outcome: string | null,
): FollowUpItem | undefined {
  const now = tx.now();
  tx.sql.run(
    "UPDATE follow_up_items SET state = ?, outcome = ?, updated_at = ? WHERE id = ?",
    [state, outcome, now, id],
  );
  return loadFollowUp(tx.sql, id);
}

export function eraseWorkspaceFollowUps(
  tx: Pick<Tx, "sql">,
  workspace: FollowUpWorkspace,
): void {
  tx.sql.run(
    "DELETE FROM follow_up_items WHERE workspace_kind = ? AND workspace_id = ?",
    [workspace.kind, workspace.id],
  );
}

export function insertFlowSdkReview(
  tx: Pick<Tx, "sql" | "newId" | "now">,
  input: {
    project: string;
    workflow: string;
    session: string | null;
    decision: SdkDecision;
    through: string;
    call: string | null;
  },
): string {
  const id = tx.newId("sdr");
  tx.sql.run(
    `INSERT INTO flow_sdk_reviews (id, project, workflow, session, decision, through, call, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.project,
      input.workflow,
      input.session,
      input.decision,
      input.through,
      input.call,
      tx.now(),
    ],
  );
  return id;
}

export function loadLastFlowSdkReview(
  sql: Query,
  project: string,
  workflow: string,
): {
  id: string;
  project: string;
  workflow: string;
  decision: SdkDecision;
  through: string;
  at: string;
} | null {
  const row = sql.get(
    `SELECT id, decision, through, created_at
     FROM flow_sdk_reviews
     WHERE project = ? AND workflow = ?
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    [project, workflow],
  );
  if (row === undefined) return null;
  return {
    id: String(row["id"]),
    project,
    workflow,
    decision: String(row["decision"]) as SdkDecision,
    through: String(row["through"]),
    at: String(row["created_at"]),
  };
}

export function insertPlatformReview(
  tx: Pick<Tx, "sql" | "newId" | "now">,
  input: {
    through: string;
    session: string | null;
  },
): string {
  const id = tx.newId("sdr");
  tx.sql.run(
    `INSERT INTO platform_reviews (id, through, session, created_at)
     VALUES (?, ?, ?, ?)`,
    [id, input.through, input.session, tx.now()],
  );
  return id;
}

export function loadLastPlatformReview(
  sql: Query,
): { id: string; through: string; at: string } | null {
  const row = sql.get(
    `SELECT id, through, created_at
     FROM platform_reviews
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    [],
  );
  if (row === undefined) return null;
  return {
    id: String(row["id"]),
    through: String(row["through"]),
    at: String(row["created_at"]),
  };
}

type AgentScope =
  | { kind: "unrestricted" }
  | { kind: "scoped"; workspace: FollowUpWorkspace }
  | { kind: "denied" };

function resolveAgentScope(
  ctx: RequestContext,
  lookupSession: (
    session: string,
  ) => { workspace: FollowUpWorkspace | null } | null,
): AgentScope {
  const actor = parseActor(ctx.actor);
  if (actor === undefined) return { kind: "denied" };
  if (actor.kind === "user" || actor.kind === "machine") {
    return { kind: "unrestricted" };
  }
  if (actor.kind !== "agent") return { kind: "denied" };
  const bound = lookupSession(actor.id);
  if (bound !== null) {
    return bound.workspace === null
      ? { kind: "unrestricted" }
      : { kind: "scoped", workspace: bound.workspace };
  }
  if (ctx.conditions.project !== undefined) {
    return {
      kind: "scoped",
      workspace: {
        kind: "project",
        id: ctx.conditions.project as FollowUpWorkspace["id"],
      },
    };
  }
  if (ctx.conditions.app !== undefined) {
    return {
      kind: "scoped",
      workspace: {
        kind: "app",
        id: ctx.conditions.app as FollowUpWorkspace["id"],
      },
    };
  }
  return { kind: "denied" };
}

function sameWorkspace(
  a: FollowUpWorkspace | null,
  b: FollowUpWorkspace,
): boolean {
  return a !== null && a.kind === b.kind && a.id === b.id;
}

const list: ReadDefinition<typeof followUpList> = {
  route: followUpList,
  handle(snapshot, ctx, input) {
    const ports = snapshot.port(followUpPorts);
    const scope = resolveAgentScope(ctx, (s) => ports.sessionWorkspace(s));
    if (scope.kind === "denied") {
      return err({ code: "forbidden", message: "forbidden" });
    }
    if (scope.kind === "scoped") {
      if (input.workspace !== undefined) {
        if (
          input.workspace === "home" ||
          input.workspace.kind !== scope.workspace.kind ||
          input.workspace.id !== scope.workspace.id
        ) {
          return err({
            code: "forbidden",
            message: "only own workspace follow-up items can be read",
          });
        }
      }
      return ok({
        items: listFollowUps(snapshot.sql, {
          workspace: scope.workspace,
          state: input.state,
        }),
        as_of_seq: snapshot.as_of_seq,
        next_cursor: null,
      });
    }
    return ok({
      items: listFollowUps(snapshot.sql, {
        workspace: input.workspace,
        state: input.state,
      }),
      as_of_seq: snapshot.as_of_seq,
      next_cursor: null,
    });
  },
};

const report: CommandDefinition<typeof followUpReport> = {
  route: followUpReport,
  handle(tx, ctx, input) {
    const ports = tx.port(followUpPorts);
    const scope = resolveAgentScope(ctx, (s) => ports.sessionWorkspace(s));
    if (scope.kind === "denied") {
      return err({ code: "not_found", message: "follow-up item not found" });
    }
    const existing = loadFollowUp(tx.sql, input.item);
    if (existing === undefined) {
      return err({ code: "not_found", message: "follow-up item not found" });
    }
    if (
      scope.kind === "scoped" &&
      !sameWorkspace(existing.workspace, scope.workspace)
    ) {
      return err({ code: "not_found", message: "follow-up item not found" });
    }
    const updated = reportFollowUp(tx, input.item, input.state, input.outcome);
    if (updated === undefined) {
      return err({ code: "not_found", message: "follow-up item not found" });
    }
    return ok({ item: updated });
  },
};

export const followUpCommands = { report };
export const followUpReads = { list };
