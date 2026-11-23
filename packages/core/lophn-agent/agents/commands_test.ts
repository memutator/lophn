import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ok } from "../../../base/mod.ts";
import { agentDelete } from "../../../protocol/lophn-agent/agent-definitions.ts";
import {
  type AgentId,
  LOPHN_HOME_ID,
} from "../../../protocol/lophn-agent/mod.ts";
import type { RequestContext, Tx } from "../../../protocol/server/mod.ts";
import { callPolicySetting } from "../../config/setting-declarations.ts";
import { jobsSchemaSteps } from "../../jobs/schema.ts";
import {
  AGENT_DELETED_CLEANUP_TOPIC,
  agentDeleteWiring,
  eraseAgentRemnants,
} from "../../main/daemon/wiring/agent-delete.ts";
import type { WiringContext } from "../../main/daemon/wiring/context.ts";
import { createSql } from "../../storage/ledger/sqlite.ts";
import { createNodeAgentFiles } from "./adapters/node-fs.ts";
import { createAgentCommands } from "./commands.ts";
import {
  type AgentLookups,
  type AgentRemnantsEraser,
  agentRemnantsEraser,
} from "./ports.ts";
import { agentSlotOf, createAgentStore } from "./store.ts";

const AGENT = "agt_00000000000000000000000001";
const OTHER = "agt_00000000000000000000000002";
const user = {} as RequestContext;
const agent = {
  actor: "agent:ses_00000000000000000000000001",
} as RequestContext;
const tx = { sql: {} } as unknown as Tx;

const lookups: AgentLookups = {
  workspaces: () => [],
  workspaceExists: () => false,
  workspaceArchived: () => false,
  skills: () => [],
  shared: () => [],
  mcp: () => [],
  sharedCommands: () => [],
  modelInfo: () => null,
  modelDefault: () => null,
  workspaceModel: () => null,
};

test("lophn은 지우거나 handle·avatar를 바꿀 수 없고, handle은 전역에 하나이고 바뀌지 않으며, agent 자격은 mcp_servers·skip·apps·remote_apps·extensions·permissions을 넣지 못한다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-agent-commands-"));
  try {
    const files = createNodeAgentFiles();
    const store = createAgentStore(files, root);
    const lophnSlot = agentSlotOf(root, LOPHN_HOME_ID);
    assert.ok(store.write(lophnSlot, "").ok);
    const before = store.read(lophnSlot);
    assert.ok(before.ok && before.value !== null);
    const beforeHash = before.value.hash;
    const commands = createAgentCommands({
      files,
      lookups: () => lookups,
      dataRoot: root,
    });
    const create = (
      id: string,
      definition: Record<string, unknown>,
      ctx: RequestContext = user,
    ) =>
      commands.create.handle(tx, ctx, { id, definition } as never, {} as never);
    const change = (definition: Record<string, unknown>) =>
      commands.change.handle(
        tx,
        user,
        { agent: LOPHN_HOME_ID, definition } as never,
        { hash: beforeHash },
      );

    const deleted = commands.delete.handle(
      tx,
      user,
      { agent: LOPHN_HOME_ID },
      { hash: beforeHash },
    );
    assert.ok(!deleted.ok);
    assert.equal(deleted.error.code, "forbidden");

    const avatarChange = change({
      handle: "lophn",
      name: "lophn",
      avatar: { kind: "character", shape: "arch", color: "sage" },
      body: "x",
    });
    assert.ok(!avatarChange.ok);
    assert.equal(avatarChange.error.code, "forbidden");
    const handleChange = change({ handle: "other", name: "lophn", body: "x" });
    assert.ok(!handleChange.ok);
    assert.equal(handleChange.error.code, "invalid_input");

    for (const handle of ["lophn", " LOPHN "]) {
      const refused = create(AGENT, { handle, name: "x", body: "x" });
      assert.ok(!refused.ok);
      assert.equal(refused.error.code, "invalid_input");
      assert.ok(
        (refused.error.details as { issues: { field: string }[] }).issues.some(
          (issue) => issue.field === "handle",
        ),
      );
    }

    assert.ok(
      create(AGENT, { handle: "reviewer", name: "Reviewer", body: "x" }).ok,
    );
    const twin = create(OTHER, {
      handle: "Reviewer",
      name: "Other",
      body: "x",
    });
    assert.ok(!twin.ok);
    assert.equal(twin.error.code, "invalid_input");
    // 보이는 이름은 겹쳐도 된다.
    assert.ok(
      create(OTHER, { handle: "reviewer2", name: "Reviewer", body: "x" }).ok,
    );
    const reviewer = store.read(agentSlotOf(root, AGENT));
    assert.ok(reviewer.ok && reviewer.value !== null);
    const reviewerHash = reviewer.value.hash;
    const moved = commands.change.handle(
      tx,
      user,
      {
        agent: AGENT,
        definition: { handle: "renamed", name: "Reviewer", body: "x" },
      } as never,
      { hash: reviewerHash },
    );
    assert.ok(!moved.ok);
    assert.equal(moved.error.code, "invalid_input");

    const humanOnly: Record<string, unknown> = {
      skip: true,
      mcp_servers: [],
      apps: ["notes"],
      remote_apps: [
        {
          machine: "mch_00000000000000000000000001",
          app: "app_00000000000000000000000001",
          name: "notes",
          removed: [],
        },
      ],
      permissions: { deny: ["lophn(notes read)"] },
    };
    for (const field of Object.keys(humanOnly)) {
      const refused = create(
        "agt_00000000000000000000000003",
        {
          handle: `with-${field}`.replace("_", "-"),
          name: `with-${field}`,
          body: "x",
          [field]: humanOnly[field],
        },
        agent,
      );
      assert.ok(!refused.ok, field);
      assert.equal(refused.error.code, "forbidden", field);
    }
    const refusedChange = commands.change.handle(
      tx,
      agent,
      {
        agent: LOPHN_HOME_ID,
        definition: {
          handle: "lophn",
          name: "lophn",
          body: "x",
          apps: ["notes"],
        },
      } as never,
      { hash: beforeHash },
    );
    assert.ok(!refusedChange.ok);
    assert.equal(refusedChange.error.code, "forbidden");
    const refusedRemote = commands.change.handle(
      tx,
      agent,
      {
        agent: LOPHN_HOME_ID,
        definition: {
          handle: "lophn",
          name: "lophn",
          body: "x",
          remote_apps: humanOnly.remote_apps,
        },
      } as never,
      { hash: beforeHash },
    );
    assert.ok(!refusedRemote.ok);
    assert.equal(refusedRemote.error.code, "forbidden");

    const after = store.read(lophnSlot);
    assert.ok(after.ok && after.value?.hash === beforeHash);
    const ids = store.agentIds();
    assert.ok(ids.ok);
    assert.deepEqual(ids.value, [AGENT, OTHER]);
  } finally {
    await rm(root, { recursive: true });
  }
});

test("옛 hash로 agent를 고치면 충돌이고 파일은 그대로다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-agent-commands-"));
  try {
    const files = createNodeAgentFiles();
    const commands = createAgentCommands({
      files,
      lookups: () => lookups,
      dataRoot: root,
    });
    const made = commands.create.handle(
      tx,
      user,
      {
        id: AGENT,
        definition: { handle: "reviewer", name: "reviewer", body: "v1" },
      },
      {} as never,
    );
    assert.ok(made.ok);
    const stale = commands.change.handle(
      tx,
      user,
      {
        agent: AGENT,
        definition: { handle: "reviewer", name: "reviewer", body: "v2" },
      },
      { hash: "0".repeat(64) },
    );
    assert.ok(!stale.ok);
    assert.equal(stale.error.code, "conflict");
    const store = createAgentStore(files, root);
    const kept = store.read(agentSlotOf(root, AGENT));
    assert.ok(kept.ok && kept.value?.hash === made.value.hash);
  } finally {
    await rm(root, { recursive: true });
  }
});

test("custom이 고른 tool 이름이 아무것도 아니면 저장을 거절하고, 내장 tool·MCP tool·extension tool만 받고 lophn 명령과 앱 command 이름은 거절한다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-agent-commands-"));
  try {
    const commands = createAgentCommands({
      files: createNodeAgentFiles(),
      lookups: () => lookups,
      dataRoot: root,
    });
    const create = (id: string, tools: string[]) =>
      commands.create.handle(
        tx,
        user,
        {
          id,
          definition: {
            handle: id,
            name: id,
            runtime: "custom",
            tools,
            body: "x",
          },
        } as never,
        {} as never,
      );
    const refused = create(AGENT, [
      "file.read",
      "call.reply",
      "notes.add-item",
      "lophn",
      "mcp__github",
      "ext__web",
    ]);
    assert.ok(!refused.ok);
    assert.equal(refused.error.code, "invalid_input");
    assert.deepEqual((refused.error.details as { issues: unknown[] }).issues, [
      { field: "tools.1", code: "unknown" },
      { field: "tools.2", code: "unknown" },
      { field: "tools.3", code: "unknown" },
      { field: "tools.4", code: "unknown" },
      { field: "tools.5", code: "unknown" },
    ]);
    assert.ok(create(OTHER, ["file.read", "mcp__github__create_issue"]).ok);
  } finally {
    await rm(root, { recursive: true });
  }
});

// 범위는 만든 session의 workspace로 정해진다. agent가 다른 workspace를 적어도 따르지 않는다.
test("agent가 만든 agent는 부른 session의 workspace에 범위가 잡히고 home이면 전역이다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-agent-commands-"));
  try {
    const files = createNodeAgentFiles();
    const sessionAt = (kind: string | null, id: string | null) =>
      ({
        sql: {
          get: () => ({
            id: "ses_00000000000000000000000001",
            agent: LOPHN_HOME_ID,
            workspace_kind: kind,
            workspace_id: id,
            lifecycle: "open",
            skip: 0,
            created_seq: "1",
            state_seq: "1",
          }),
        },
      }) as unknown as Tx;
    const commands = createAgentCommands({
      files,
      lookups: () => ({ ...lookups, workspaceExists: () => true }),
      dataRoot: root,
    });
    const APP = "app_00000000000000000000000001";
    const made = (agentId: string, at: Tx) =>
      commands.create.handle(
        at,
        agent,
        {
          id: agentId,
          definition: {
            handle: agentId.slice(-3),
            name: "x",
            body: "x",
            workspace: {
              kind: "project",
              id: "prj_00000000000000000000000001",
            },
          },
        } as never,
        {} as never,
      );
    assert.ok(made(AGENT, sessionAt("app", APP)).ok);
    assert.ok(made(OTHER, sessionAt(null, null)).ok);
    const store = createAgentStore(files, root);
    const read = (id: string) => {
      const file = store.read(agentSlotOf(root, id));
      assert.ok(file.ok && file.value !== null);
      return file.value.text;
    };
    assert.match(
      read(AGENT),
      new RegExp(`workspace:\\n  kind: app\\n  id: ${APP}`),
    );
    assert.doesNotMatch(read(OTHER), /workspace:/);
  } finally {
    await rm(root, { recursive: true });
  }
});

// browser profile은 agent가 쓰는 cookie와 저장 login을 정한다. 깨지면 agent가 스스로 다른 profile의 로그인으로 옮겨 간다.
test("agent 자격은 정의의 browser_profile을 넣거나 바꾸지 못하고(forbidden) 사람은 된다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-agent-commands-"));
  try {
    const files = createNodeAgentFiles();
    const commands = createAgentCommands({
      files,
      lookups: () => lookups,
      dataRoot: root,
    });
    const WORK = `bpf_${"1".repeat(26)}`;
    const SHOP = `bpf_${"2".repeat(26)}`;
    const base = { handle: "shopper", name: "Shopper" };
    const refusedCreate = commands.create.handle(
      tx,
      agent,
      { id: OTHER, definition: { ...base, body: "x", browser_profile: WORK } },
      {} as never,
    );
    assert.ok(!refusedCreate.ok);
    assert.equal(refusedCreate.error.code, "forbidden");
    const made = commands.create.handle(
      tx,
      user,
      { id: AGENT, definition: { ...base, body: "v1", browser_profile: WORK } },
      {} as never,
    );
    assert.ok(made.ok);
    let hash = made.value.hash;
    const change = (ctx: RequestContext, definition: object) =>
      commands.change.handle(
        tx,
        ctx,
        { agent: AGENT, definition: { ...base, ...definition } } as never,
        { hash },
      );
    // 그대로 두면 agent도 다른 칸을 고친다.
    const kept = change(agent, { body: "v2", browser_profile: WORK });
    assert.ok(kept.ok);
    hash = kept.value.hash;
    for (const definition of [
      { body: "v3", browser_profile: SHOP },
      { body: "v3" },
    ]) {
      const refused = change(agent, definition);
      assert.ok(!refused.ok);
      assert.equal(refused.error.code, "forbidden");
    }
    const moved = change(user, { body: "v3", browser_profile: SHOP });
    assert.ok(moved.ok);
    const stored = createAgentStore(files, root).read(agentSlotOf(root, AGENT));
    assert.ok(stored.ok && stored.value !== null);
    assert.ok(stored.value.text.includes(`browser_profile: ${SHOP}`));
  } finally {
    await rm(root, { recursive: true });
  }
});

test("agent.delete는 P12 범위(Home은 전체, workspace agent는 자기 범위만)를 지키고 agentRemnantsEraser 결과를 반환한다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-agent-delete-p12-"));
  try {
    const files = createNodeAgentFiles();
    const store = createAgentStore(files, root);
    const PRJ_A = "prj_00000000000000000000000001";
    const PRJ_B = "prj_00000000000000000000000002";
    const AGT_GLOBAL = "agt_00000000000000000000000011" as AgentId;
    const AGT_PRJ_A = "agt_00000000000000000000000012" as AgentId;
    const AGT_PRJ_B = "agt_00000000000000000000000013" as AgentId;
    const commands = createAgentCommands({
      files,
      lookups: () => ({ ...lookups, workspaceExists: () => true }),
      dataRoot: root,
    });
    const createdGlobal = commands.create.handle(
      tx,
      user,
      {
        id: AGT_GLOBAL,
        definition: { handle: "global-bot", name: "Global", body: "g" },
      },
      {} as never,
    );
    const createdA = commands.create.handle(
      tx,
      user,
      {
        id: AGT_PRJ_A,
        definition: {
          handle: "prj-a-bot",
          name: "PrjA",
          body: "a",
          workspace: { kind: "project", id: PRJ_A },
        },
      } as never,
      {} as never,
    );
    const createdB = commands.create.handle(
      tx,
      user,
      {
        id: AGT_PRJ_B,
        definition: {
          handle: "prj-b-bot",
          name: "PrjB",
          body: "b",
          workspace: { kind: "project", id: PRJ_B },
        },
      } as never,
      {} as never,
    );
    assert.ok(createdGlobal.ok && createdA.ok && createdB.ok);

    const erasedCalls: string[] = [];
    const eraser: AgentRemnantsEraser = {
      erase(target) {
        erasedCalls.push(target.id);
        return ok({
          sessions: ["ses_00000000000000000000000099"],
          erased_jobs: [
            {
              id: "job_00000000000000000000000001",
              title: "Daily check",
              summary: "every 1d -> agent " + target.id,
            },
          ],
        });
      },
    };
    const makeTx = (wsKind: string | null, wsId: string | null) =>
      ({
        sql: {
          get: () => ({
            id: "ses_00000000000000000000000001",
            agent: LOPHN_HOME_ID,
            workspace_kind: wsKind,
            workspace_id: wsId,
            lifecycle: "open",
            skip: 0,
            created_seq: "1",
            state_seq: "1",
          }),
        },
        port: (key: unknown) => {
          if (key === agentRemnantsEraser) return eraser;
          throw new Error("unregistered");
        },
      }) as unknown as Tx;

    // Project A agent cannot delete global agent or Project B agent -> forbidden.
    const denyGlobal = commands.delete.handle(
      makeTx("project", PRJ_A),
      agent,
      { agent: AGT_GLOBAL },
      { hash: createdGlobal.value.hash },
    );
    assert.ok(!denyGlobal.ok);
    assert.equal(denyGlobal.error.code, "forbidden");

    const denyOtherPrj = commands.delete.handle(
      makeTx("project", PRJ_A),
      agent,
      { agent: AGT_PRJ_B },
      { hash: createdB.value.hash },
    );
    assert.ok(!denyOtherPrj.ok);
    assert.equal(denyOtherPrj.error.code, "forbidden");

    // Project A agent CAN delete Project A agent and gets erased_jobs from port.
    const okOwnPrj = commands.delete.handle(
      makeTx("project", PRJ_A),
      agent,
      { agent: AGT_PRJ_A },
      { hash: createdA.value.hash },
    );
    assert.ok(okOwnPrj.ok);
    assert.deepEqual(erasedCalls, [AGT_PRJ_A]);
    assert.equal(okOwnPrj.value.erased_jobs?.length, 1);
    assert.deepEqual(okOwnPrj.value.follow_ups, []);
    assert.equal(okOwnPrj.value.handoff_session, null);

    // Home agent CAN delete global agent AND Project B agent.
    const okHomeGlobal = commands.delete.handle(
      makeTx(null, null),
      agent,
      { agent: AGT_GLOBAL },
      { hash: createdGlobal.value.hash },
    );
    const okHomePrjB = commands.delete.handle(
      makeTx(null, null),
      agent,
      { agent: AGT_PRJ_B },
      { hash: createdB.value.hash },
    );
    assert.ok(okHomeGlobal.ok && okHomePrjB.ok);
    assert.deepEqual(erasedCalls, [AGT_PRJ_A, AGT_GLOBAL, AGT_PRJ_B]);
    const remaining = store.agentIds();
    assert.ok(remaining.ok && remaining.value.length === 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("agent-delete wiring은 agent의 job·MCP secret·callPolicy 규칙·session 디스크 흔적을 결정적으로 지운다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-agent-delete-wiring-"));
  const db = new DatabaseSync(":memory:");
  try {
    for (const step of jobsSchemaSteps) db.exec(step.sql);
    db.exec("ALTER TABLE jobs ADD COLUMN trigger TEXT;");
    const sql = createSql(db, () => true);

    const GONE = "agt_00000000000000000000000021" as AgentId;
    const KEPT = "agt_00000000000000000000000022" as AgentId;
    const SES_GONE = "ses_00000000000000000000000021";
    const AT = "2026-11-23T00:00:00.000Z";

    // Seed jobs: one created by GONE, one targeting GONE, one unrelated for KEPT.
    const seedJob = (
      id: string,
      title: string,
      creator: string,
      action: Record<string, unknown>,
    ) => {
      sql.run(
        `INSERT INTO jobs (id, title, creator_agent, creator_workspace, every, at, trigger, action, missed_policy, enabled, created_at, updated_at)
         VALUES (?, ?, ?, NULL, '1h', NULL, NULL, ?, 'run', 1, ?, ?)`,
        [id, title, creator, JSON.stringify(action), AT, AT],
      );
      sql.run(
        `INSERT INTO job_runs (id, job, due_at, missed_count, state, created_at)
         VALUES (?, ?, ?, 0, 'done', ?)`,
        [`jbr_${id.slice(4)}`, id, AT, AT],
      );
    };
    seedJob("job_00000000000000000000000001", "Created by gone", GONE, {
      kind: "agent_run",
      agent: KEPT,
      agent_workspace: null,
      prompt: "hi",
    });
    seedJob("job_00000000000000000000000002", "Targets gone", KEPT, {
      kind: "agent_run",
      agent: GONE,
      agent_workspace: null,
      prompt: "run",
    });
    seedJob("job_00000000000000000000000003", "Unrelated", KEPT, {
      kind: "agent_run",
      agent: KEPT,
      agent_workspace: null,
      prompt: "keep",
    });

    const pushedActions: { topic: string; data: unknown }[] = [];
    const fakeTx = {
      sql,
      port: () => ({
        push: (topic: string, data: unknown) => {
          pushedActions.push({ topic, data });
        },
      }),
    } as unknown as Tx;

    const erased = eraseAgentRemnants(fakeTx, {
      id: GONE,
      handle: "gone-bot",
      workspace: null,
    });
    assert.ok(erased.ok);
    assert.deepEqual(
      erased.value.erased_jobs.map((j) => j.id),
      ["job_00000000000000000000000001", "job_00000000000000000000000002"],
    );
    const leftJobs = sql.all("SELECT id FROM jobs ORDER BY id", []);
    assert.deepEqual(
      leftJobs.map((r) => String(r["id"])),
      ["job_00000000000000000000000003"],
    );
    const leftRuns = sql.all("SELECT job FROM job_runs ORDER BY job", []);
    assert.deepEqual(
      leftRuns.map((r) => String(r["job"])),
      ["job_00000000000000000000000003"],
    );

    // Prepare tool-results folder, secrets, and callPolicy setting for after-commit wiring check.
    const toolDir = join(root, "tool-results", SES_GONE);
    await mkdir(toolDir, { recursive: true });
    await writeFile(join(toolDir, "out.txt"), "data");
    const removedRewind: string[] = [];
    const secrets = new Set([
      `mcp.${GONE}.github.token`,
      `mcp-oauth.${GONE}.notion.access`,
      `mcp.${KEPT}.github.token`,
      "mcp.global.docs.token",
    ]);
    let policy = {
      private: [],
      workspaces: [],
      agents: [
        { from: GONE, to: KEPT, allow: false },
        { from: KEPT, to: GONE, allow: true },
        { from: KEPT, to: LOPHN_HOME_ID, allow: true },
      ],
    };

    const built = await agentDeleteWiring().build!({
      telemetry: { logger: { error: () => {} } },
      root: { path: root },
      rewindFiles: {
        store: {
          removeSession: async (ses: string) => {
            removedRewind.push(ses);
          },
        },
      },
      secretStore: {
        names: () => ok([...secrets]),
        delete: async (name: string) => {
          secrets.delete(name);
          return ok({ name, configured: false });
        },
      },
      settings: {
        get: (s: { key: string }) =>
          s.key === callPolicySetting.key ? policy : undefined,
      },
      settingsUpdate: (
        changes: { key: string; action: string; value: unknown }[],
      ) => {
        for (const change of changes) {
          if (change.key === callPolicySetting.key) {
            policy = change.value as typeof policy;
          }
        }
        return ok({ rejected: [] });
      },
    } as unknown as WiringContext);
    assert.ok(built.ok);
    const writer = built.value.writer!({
      command: async () =>
        ok({
          result: { agent: GONE, hash: "0".repeat(64) },
          replayed: false,
          after_commit: [
            {
              topic: AGENT_DELETED_CLEANUP_TOPIC,
              data: { agent: GONE, sessions: [SES_GONE] },
            },
          ],
        }),
    } as never);
    const done = await writer.command(
      {} as never,
      { command: agentDelete.name, input: { agent: GONE } } as never,
    );
    assert.ok(done.ok);
    assert.deepEqual(removedRewind, [SES_GONE]);
    await assert.rejects(() => stat(toolDir));
    assert.deepEqual([...secrets].sort(), [
      `mcp.${KEPT}.github.token`,
      "mcp.global.docs.token",
    ]);
    assert.deepEqual(policy.agents, [
      { from: KEPT, to: LOPHN_HOME_ID, allow: true },
    ]);
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});
