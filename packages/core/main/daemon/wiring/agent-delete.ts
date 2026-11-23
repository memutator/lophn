// agent.delete의 결정적 정리 조립. agents는 jobs·secrets·config를 직접 import하지 않으므로
// 이 조립이 한 Tx에서 session과 job을 지우고(createCoreRegistration), commit 뒤 tool-results·rewind 폴더,
// MCP secret(`mcp.<agt_id>.*`, `mcp-oauth.<agt_id>.*`), `callPolicy`의 agent 쌍 규칙을 치운다(agentDeleteWiring).
import { ok, type Result } from "../../../../base/mod.ts";
import type { ErasedJobSpec, Id } from "../../../../protocol/base/mod.ts";
import {
  type AgentId,
  agentDelete,
  deleteSession,
  MESSAGE_BODY_OWNER_KIND,
  type Workspace,
} from "../../../../protocol/lophn-agent/mod.ts";
import type { Tx } from "../../../../protocol/server/mod.ts";
import { callPolicySetting } from "../../../config/setting-declarations.ts";
import { jobsChanged } from "../../../jobs/ports.ts";
import { agentRemnantsEraser } from "../../../lophn-agent/agents/ports.ts";
import { deleteSessionTurns } from "../../../lophn-agent/run-loop/mod.ts";
import {
  type AgentSessionRow,
  SESSION_COLUMNS,
  sessionRowOf,
} from "../../../lophn-agent/session/model.ts";
import {
  deleteSessionReverts,
  eraseToolResults,
} from "../../../lophn-agent/session/rewind/erase.ts";
import { deleteSessionToolCalls } from "../../../lophn-agent/tools/mod.ts";
import { deleteSessionModelCalls } from "../../../lophn-agent/usage/mod.ts";
import { SESSION_END_DEPS } from "../../../lophn-agent/workspaces/environment.ts";
import { endSession } from "../../../lophn-agent/workspaces/mod.ts";
import { deleteAppCallsReceivedBy } from "../../../router/mod.ts";
import { eraseBlobRefs } from "../../../storage/blobs/mod.ts";
import { afterCommit, defineTxPort } from "../../../storage/ledger/mod.ts";
import type { WiringFactory } from "./context.ts";

export const AGENT_DELETED_CLEANUP_TOPIC = "agents.deleted-cleanup";

type CleanupPayload = {
  agent: string;
  sessions: string[];
};

function hasTable(tx: Tx, name: string): boolean {
  return (
    tx.sql.get(
      "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?",
      [name],
    ) !== undefined
  );
}

function agentSessions(tx: Tx, agent: AgentId): AgentSessionRow[] {
  if (!hasTable(tx, "sessions")) return [];
  return tx.sql
    .all(
      `SELECT ${SESSION_COLUMNS} FROM sessions WHERE agent = ? ORDER BY created_seq`,
      [agent],
    )
    .map(sessionRowOf);
}

// deleteSession route는 actors: ["user"]라 agent 자격이 agent.delete를 부르면 tx.call(deleteSession)이
// forbidden으로 거절된다. 그 경우 같은 Tx에서 deleteSession과 동일한 순서로 session 기록을 지운다.
function eraseSessionDirectly(tx: Tx, session: AgentSessionRow): Result<void> {
  const ended = endSession(tx, SESSION_END_DEPS, session, "deleted");
  if (!ended.ok) return ended;
  const bodies = eraseBlobRefs(
    tx,
    MESSAGE_BODY_OWNER_KIND,
    tx.sql
      .all("SELECT id FROM messages WHERE session = ?", [session.id])
      .map((row) => String(row["id"])),
  );
  if (!bodies.ok) return bodies;
  const rewound = deleteSessionReverts(tx, session.id);
  if (!rewound.ok) return rewound;
  tx.sql.run("DELETE FROM messages WHERE session = ?", [session.id]);
  const steps: (() => Result<void>)[] = [
    () => deleteSessionToolCalls(tx, session.id, eraseBlobRefs),
    () => deleteSessionModelCalls(tx, session.id, eraseBlobRefs),
    () => deleteSessionTurns(tx, session.id, eraseBlobRefs),
    () => deleteAppCallsReceivedBy(tx, session.id),
  ];
  for (const step of steps) {
    const erased = step();
    if (!erased.ok) return erased;
  }
  tx.sql.run("DELETE FROM session_compact_requests WHERE session = ?", [
    session.id,
  ]);
  tx.sql.run("DELETE FROM sessions WHERE id = ?", [session.id]);
  return ok(undefined);
}

function summarizeJob(row: Record<string, unknown>): string {
  const every =
    row["every"] === null || row["every"] === undefined
      ? null
      : String(row["every"]);
  const at =
    row["at"] === null || row["at"] === undefined ? null : String(row["at"]);
  let cadence = "scheduled";
  if (every !== null) {
    cadence = at !== null ? `every ${every} at ${at}` : `every ${every}`;
  } else if (typeof row["trigger"] === "string") {
    try {
      const trigger = JSON.parse(row["trigger"]) as {
        source?: string;
        event?: string;
      };
      if (trigger.source && trigger.event) {
        cadence = `on ${trigger.source}.${trigger.event}`;
      }
    } catch {
      // keep fallback
    }
  }
  let actionDesc = "action";
  if (typeof row["action"] === "string") {
    try {
      const action = JSON.parse(row["action"]) as Record<string, unknown>;
      if (action["kind"] === "agent_run") {
        actionDesc = `agent ${String(action["agent"] ?? "")}`;
      } else if (action["kind"] === "tool_run") {
        actionDesc = `tool ${String(action["app"] ?? "")}.${String(action["tool"] ?? "")}`;
      } else if (action["kind"] === "workflow_start") {
        actionDesc = `workflow ${String(action["project"] ?? "")}/${String(action["workflow"] ?? "")}`;
      }
    } catch {
      // keep fallback
    }
  }
  return `${cadence} -> ${actionDesc}`;
}

function eraseJobsOfAgent(tx: Tx, agentId: AgentId): ErasedJobSpec[] {
  if (!hasTable(tx, "jobs")) return [];
  const rows = tx.sql.all(
    `SELECT id, title, every, at, trigger, action FROM jobs
     WHERE creator_agent = ?1
        OR (json_extract(action, '$.kind') = 'agent_run'
            AND json_extract(action, '$.agent') = ?1)
     ORDER BY id`,
    [agentId],
  );
  if (rows.length === 0) return [];
  const erased: ErasedJobSpec[] = [];
  const hasRuns = hasTable(tx, "job_runs");
  for (const row of rows) {
    const id = String(row["id"]) as Id<"job">;
    erased.push({
      id,
      title: String(row["title"]),
      summary: summarizeJob(row),
    });
    if (hasRuns) {
      tx.sql.run("DELETE FROM job_runs WHERE job = ?", [id]);
    }
    tx.sql.run("DELETE FROM jobs WHERE id = ?", [id]);
  }
  try {
    jobsChanged(tx);
  } catch {
    // afterCommit port가 없는 단위 test Tx에서는 건너뛴다.
  }
  return erased;
}

function pushCleanupAfterCommit(tx: Tx, payload: CleanupPayload): void {
  if (typeof tx.port !== "function") return;
  try {
    tx.port(afterCommit).push(AGENT_DELETED_CLEANUP_TOPIC, payload);
  } catch {
    // afterCommit port가 없는 단위 test Tx에서는 건너뛴다.
  }
}

export function eraseAgentRemnants(
  tx: Tx,
  agent: { id: AgentId; handle: string; workspace: Workspace | null },
): Result<{ sessions: string[]; erased_jobs: ErasedJobSpec[] }> {
  const sessions: string[] = [];
  for (const session of agentSessions(tx, agent.id)) {
    const deleted = tx.call(
      deleteSession,
      { session: session.id },
      { state_seq: session.state_seq },
    );
    if (!deleted.ok) {
      if (deleted.error.code !== "forbidden") return deleted;
      const direct = eraseSessionDirectly(tx, session);
      if (!direct.ok) return direct;
    }
    sessions.push(session.id);
  }
  const erasedJobs = eraseJobsOfAgent(tx, agent.id);
  pushCleanupAfterCommit(tx, { agent: agent.id, sessions });
  return ok({ sessions, erased_jobs: erasedJobs });
}

export function createCoreRegistration() {
  return {
    ports: [
      defineTxPort(agentRemnantsEraser, (tx) => ({
        erase: (agent) => eraseAgentRemnants(tx, agent),
      })),
    ],
  };
}

export const agentDeleteWiring: WiringFactory = () => ({
  name: "agent-delete",
  build(ctx) {
    const log = (event: string, message: unknown) =>
      ctx.telemetry.logger.error({
        component: "agent-delete",
        event,
        fields: { message: String(message) },
      });

    async function cleanSecrets(agentId: string): Promise<void> {
      const prefixes = [`mcp.${agentId}.`, `mcp-oauth.${agentId}.`];
      const names = ctx.secretStore.names();
      if (!names.ok) {
        log("secrets_not_listed", names.error.message);
        return;
      }
      for (const name of names.value) {
        if (!prefixes.some((prefix) => name.startsWith(prefix))) continue;
        const deleted = await ctx.secretStore.delete(name);
        if (!deleted.ok) {
          log("secret_not_deleted", `${name}: ${deleted.error.message}`);
        }
      }
    }

    function cleanCallPolicy(agentId: string): void {
      const policy = ctx.settings.get(callPolicySetting);
      if (policy === undefined) return;
      const kept = policy.agents.filter(
        (rule) => rule.from !== agentId && rule.to !== agentId,
      );
      if (kept.length === policy.agents.length) return;
      const written = ctx.settingsUpdate([
        {
          key: callPolicySetting.key,
          action: "set",
          value: { ...policy, agents: kept },
        },
      ]);
      if (!written.ok || written.value.rejected.length > 0) {
        log("call_policy_not_cleaned", written.ok ? "rejected" : written.error);
      }
    }

    async function cleanAfterDelete(payload: CleanupPayload): Promise<void> {
      for (const session of payload.sessions) {
        await eraseToolResults(ctx.root.path, session);
        await ctx.rewindFiles.store.removeSession(session).catch(() => {});
      }
      try {
        await cleanSecrets(payload.agent);
      } catch (thrown) {
        log("secrets_not_cleaned", thrown);
      }
      try {
        cleanCallPolicy(payload.agent);
      } catch (thrown) {
        log("call_policy_not_cleaned", thrown);
      }
    }

    return ok({
      writer: (inner) => ({
        ...inner,
        async command(auth, envelope) {
          const done = await inner.command(auth, envelope);
          if (!done.ok || done.value.replayed) return done;
          const payloads = (done.value.after_commit ?? [])
            .filter((action) => action.topic === AGENT_DELETED_CLEANUP_TOPIC)
            .map((action) => action.data as CleanupPayload);
          if (payloads.length > 0) {
            for (const payload of payloads) {
              await cleanAfterDelete(payload);
            }
          } else if (envelope.command === agentDelete.name) {
            const agent = (done.value.result as { agent?: unknown } | undefined)
              ?.agent;
            if (typeof agent === "string") {
              await cleanAfterDelete({ agent, sessions: [] });
            }
          }
          return done;
        },
      }),
    });
  },
});
