// 사용 관계(app.usage)의 team 등록 file. writer·reader Worker가 import한다.
// apps는 sessions·jobs·projects·agents를 모르므로 정본 조회를 이 조립이 꽂는다.
// port는 그 등록의 reads에만 붙으므로 그 port를 쓰는 read(app.usage, app.tool_index)를 같은 등록에 둔다. 쓰는 쪽 tx(release 막기)는 core 등록의 port를 쓴다.

import type { Workspace } from "../../../../protocol/lophn-agent/workspaces.ts";
import type { Sql } from "../../../../protocol/server/mod.ts";
import { createToolIndexRead } from "../../../apps/declaration/reads.ts";
import { appStatusOf } from "../../../apps/lookups.ts";
import { loadActiveDeclaration } from "../../../apps/releases/store.ts";
import {
  createUsageReads,
  type UsagePorts,
  usagePorts,
} from "../../../apps/usage/mod.ts";
import type {
  StaticEventSubscriber,
  StaticToolUse,
} from "../../../apps/usage/ports.ts";
import {
  loadSession,
  workspaceOf,
} from "../../../lophn-agent/session/model.ts";
import { projectStatusOf } from "../../../projects/lookups.ts";
import {
  defineTxPort,
  type ReaderRegistration,
  snapshotPort,
} from "../../../storage/ledger/mod.ts";

type Query = Pick<Sql, "get" | "all">;

function parseCreatorWorkspace(raw: unknown): Workspace | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  if (raw.startsWith("prj_")) {
    return { kind: "project", id: raw as Workspace["id"] } as Workspace;
  }
  if (raw.startsWith("app_")) {
    return { kind: "app", id: raw as Workspace["id"] } as Workspace;
  }
  return null;
}

function isActiveWorkspace(sql: Query, workspace: Workspace | null): boolean {
  if (workspace === null) return true;
  return workspace.kind === "project"
    ? projectStatusOf(sql, workspace.id) === "active"
    : appStatusOf(sql, workspace.id) === "active";
}

function hasTable(sql: Query, name: string): boolean {
  return (
    sql.get(
      "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?",
      [name],
    ) !== undefined
  );
}

function usagePortsOf(sql: Query): UsagePorts {
  return {
    sessionWorkspace(session) {
      const row = loadSession({ sql }, session);
      return row === undefined ? null : { workspace: workspaceOf(row) };
    },
    declaredToolUsers(app) {
      if (!hasTable(sql, "jobs")) return [];
      const uses: StaticToolUse[] = [];
      for (const row of sql.all(
        "SELECT creator_workspace, action FROM jobs ORDER BY id",
        [],
      )) {
        let action: Record<string, unknown>;
        try {
          action = JSON.parse(String(row["action"])) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (
          action["kind"] !== "tool_run" ||
          action["app"] !== app ||
          typeof action["tool"] !== "string"
        ) {
          continue;
        }
        const workspace = parseCreatorWorkspace(row["creator_workspace"]);
        if (!isActiveWorkspace(sql, workspace)) continue;
        uses.push({ tool: action["tool"], workspace });
      }
      return uses;
    },
    declaredEventSubscribers(app) {
      if (!hasTable(sql, "jobs")) return [];
      const subs: StaticEventSubscriber[] = [];
      for (const row of sql.all(
        "SELECT creator_workspace, trigger FROM jobs WHERE trigger IS NOT NULL ORDER BY id",
        [],
      )) {
        let trigger: Record<string, unknown>;
        try {
          trigger = JSON.parse(String(row["trigger"])) as Record<
            string,
            unknown
          >;
        } catch {
          continue;
        }
        if (
          trigger["app"] !== app ||
          trigger["source_machine"] !== undefined ||
          typeof trigger["event"] !== "string"
        ) {
          continue;
        }
        const workspace = parseCreatorWorkspace(row["creator_workspace"]);
        if (!isActiveWorkspace(sql, workspace)) continue;
        subs.push({ event: trigger["event"], workspace });
      }
      return subs;
    },
  };
}

export function createReaderRegistration(): ReaderRegistration {
  return {
    reads: [createUsageReads(), createToolIndexRead(loadActiveDeclaration)],
    ports: new Map<unknown, unknown>([
      [usagePorts, snapshotPort((snapshot) => usagePortsOf(snapshot.sql))],
    ]),
  };
}

export function createCoreRegistration() {
  return {
    ports: [defineTxPort(usagePorts, (tx) => usagePortsOf(tx.sql))],
  };
}
