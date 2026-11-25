import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ok } from "../../../../base/mod.ts";
import { codingSessionsForget } from "../../../../protocol/coding-agent/relay.ts";
import { HOME_TERMINAL_PROJECT } from "../../../../protocol/coding-agent/terminals.ts";
import {
  type AgentId,
  agentDelete,
} from "../../../../protocol/lophn-agent/mod.ts";
import type { Tx } from "../../../../protocol/server/mod.ts";
import { createSql } from "../../../storage/ledger/sqlite.ts";
import {
  AGENT_DELETED_CLEANUP_TOPIC,
  agentDeleteWiring,
  eraseAgentRemnants,
} from "./agent-delete.ts";
import type { WiringContext } from "./context.ts";

test("eraseAgentRemnants collects harness_sessions for project and home workspaces and agentDeleteWiring cascades to terminalAgents.forgetHarnessSessions", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-agent-delete-cascade-"));
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        agent TEXT NOT NULL,
        project TEXT,
        app TEXT,
        workspace_kind TEXT,
        workspace_id TEXT,
        title TEXT,
        lifecycle TEXT NOT NULL,
        forked_from_session TEXT,
        forked_from_through_seq TEXT,
        model_selection TEXT,
        compaction_through_seq TEXT,
        compaction_summary_call TEXT,
        skip INTEGER NOT NULL DEFAULT 0,
        harness TEXT,
        harness_session TEXT,
        harness_gui INTEGER NOT NULL DEFAULT 0,
        called_from_kind TEXT,
        called_from_id TEXT,
        spawned_by TEXT,
        opened_by_app TEXT,
        opened_by_machine TEXT,
        runs_on TEXT,
        workflow_origin TEXT,
        created_seq TEXT NOT NULL,
        state_seq TEXT NOT NULL
      );
    `);
    const sql = createSql(db, () => true);
    const AGENT = "agt_00000000000000000000000031" as AgentId;
    const PRJ = "prj_00000000000000000000000031";

    sql.run(
      `INSERT INTO sessions (id, agent, project, workspace_kind, workspace_id, lifecycle, title, state_seq, created_seq, harness, harness_session, harness_gui)
       VALUES (?, ?, ?, 'project', ?, 'open', 'Proj Agy', '1', '1', 'antigravity', 'conv-prj-1', 1)`,
      ["ses_00000000000000000000000031", AGENT, PRJ, PRJ],
    );
    sql.run(
      `INSERT INTO sessions (id, agent, project, workspace_kind, workspace_id, lifecycle, title, state_seq, created_seq, harness, harness_session, harness_gui)
       VALUES (?, ?, NULL, NULL, NULL, 'open', 'Home Claude', '1', '2', 'claude-code', 'conv-home-1', 0)`,
      ["ses_00000000000000000000000032", AGENT],
    );

    const pushed: Array<{ topic: string; data: unknown }> = [];
    const fakeTx = {
      sql,
      call: () => ok({}),
      port: () => ({
        push: (topic: string, data: unknown) => {
          pushed.push({ topic, data });
        },
      }),
    } as unknown as Tx;

    const erased = eraseAgentRemnants(fakeTx, {
      id: AGENT,
      handle: "custom-agy",
      workspace: null,
    });
    assert.ok(erased.ok);
    const cleanup = pushed.find(
      (action) => action.topic === AGENT_DELETED_CLEANUP_TOPIC,
    );
    assert.ok(cleanup !== undefined);
    assert.deepEqual(
      (cleanup.data as { harness_sessions?: unknown }).harness_sessions,
      [
        {
          project: PRJ,
          harness: "antigravity",
          external_session: "conv-prj-1",
        },
        {
          project: HOME_TERMINAL_PROJECT,
          harness: "claude",
          external_session: "conv-home-1",
        },
      ],
    );

    const forgotten: unknown[] = [];
    const built = await agentDeleteWiring().build!({
      telemetry: { logger: { error: () => {} } },
      root: { path: root },
      rewindFiles: { store: { removeSession: async () => {} } },
      secretStore: {
        names: () => ok([]),
        delete: async () => ok({ name: "", configured: false }),
      },
      settings: { get: () => undefined },
      settingsUpdate: () => ok({ rejected: [] }),
      peek: {
        terminalAgents: {
          forgetHarnessSessions: async (items: unknown) => {
            forgotten.push(items);
          },
        },
      },
    } as unknown as WiringContext);
    assert.ok(built.ok);
    const writer = built.value.writer!({
      command: async () =>
        ok({
          result: { agent: AGENT, hash: "0".repeat(64) },
          replayed: false,
          after_commit: [cleanup],
        }),
    } as never);
    const done = await writer.command(
      {} as never,
      { command: agentDelete.name, input: { agent: AGENT } } as never,
    );
    assert.ok(done.ok);
    assert.deepEqual(forgotten, [
      [
        {
          project: PRJ,
          harness: "antigravity",
          external_session: "conv-prj-1",
        },
        {
          project: HOME_TERMINAL_PROJECT,
          harness: "claude",
          external_session: "conv-home-1",
        },
      ],
    ]);

    // codingSessionsForget input accepts both prj_* and "home".
    assert.equal(
      codingSessionsForget.input.safeParse({
        project: HOME_TERMINAL_PROJECT,
        harness: "antigravity",
        cli_session: "conv-home-1",
      }).success,
      true,
    );
    assert.equal(
      codingSessionsForget.input.safeParse({
        project: PRJ,
        harness: "antigravity",
        cli_session: "conv-prj-1",
      }).success,
      true,
    );
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});
