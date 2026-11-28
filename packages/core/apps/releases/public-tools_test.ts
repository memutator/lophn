import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { ReleaseRecord } from "../../../protocol/apps/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import { jobsSchemaSteps } from "../../jobs/schema.ts";
import { jobTriggerSchemaSteps } from "../../jobs/trigger-schema.ts";
import {
  readWorkspaceSnapshot,
  scanImpact,
  scanReleaseContractUsers,
} from "../../main/daemon/wiring/workspace-reader.ts";
import {
  PROJECTS_FORMER_IDENTITY_STEPS,
  PROJECTS_IDENTITY_STEPS,
  PROJECTS_SEPARATED_STEPS,
  projectsSchemaSteps,
} from "../../projects/registry/schema.ts";
import type { AppDeclaration } from "../declaration/mod.ts";
import { appsSchemaSteps } from "../registration/schema.ts";
import { type UsagePorts, usagePorts } from "../usage/mod.ts";
import {
  contractChangesOf,
  diffReleaseContracts,
  removedPublicOf,
} from "./public-tools.ts";
import { releasesSchemaSteps } from "./schema.ts";
import { insertRelease } from "./store.ts";

type Tool = AppDeclaration["commands"][number];

const tool = (
  name: string,
  pub: boolean,
  effect: Tool["effect"] = "read",
  inputSchema: Tool["inputSchema"] = null,
): Tool => ({
  name,
  description: name,
  inputSchema,
  effect,
  public: pub,
});

const decl = (partial: Partial<AppDeclaration>): AppDeclaration => ({
  name: "Target",
  description: "Target app",
  screens: [],
  operations: [],
  commands: [],
  permissions: [],
  app_connections: [],
  sdk_dependencies: [],
  ...partial,
});

test("공개였다가 비공개가 된 tool도 지운 것이다", () => {
  const before = [tool("a", true), tool("b", true), tool("c", false)];
  const after = [tool("a", false), tool("b", true, "write"), tool("d", true)];
  assert.deepStrictEqual(removedPublicOf(before, after), ["a"]);
});

test("diffReleaseContracts detects removed and canonical-JSON-changed commands, skills, and events", () => {
  const prev = decl({
    commands: [
      tool("keep", true),
      tool("change_schema", true, "read", {
        type: "object",
        properties: { q: { type: "string" } },
      }),
      tool("drop_cmd", true),
      tool("priv", false),
    ],
    skills: [
      { name: "guide", public: true, commands: ["keep"] },
      { name: "old_skill", public: true, commands: ["drop_cmd"] },
    ],
    events: [
      {
        name: "created",
        description: "item created",
        payloadSchema: {
          type: "object",
          properties: { id: { type: "string" } },
        },
      },
      {
        name: "deleted",
        description: "item deleted",
        payloadSchema: { type: "object" },
      },
    ],
  });
  const next = decl({
    commands: [
      tool("keep", true),
      tool("change_schema", true, "read", {
        type: "object",
        properties: { q: { type: "string" }, limit: { type: "integer" } },
      }),
      tool("priv", false, "write"),
    ],
    skills: [
      { name: "guide", public: true, commands: ["keep", "change_schema"] },
      { name: "old_skill", public: false, commands: [] },
    ],
    events: [
      {
        name: "created",
        description: "item created",
        payloadSchema: {
          type: "object",
          properties: { id: { type: "integer" } },
        },
      },
    ],
  });

  assert.deepStrictEqual(diffReleaseContracts(prev, next), [
    { surface: "command", name: "change_schema", change: "changed" },
    { surface: "command", name: "drop_cmd", change: "removed" },
    { surface: "skill", name: "guide", change: "changed" },
    { surface: "skill", name: "old_skill", change: "removed" },
    { surface: "event", name: "created", change: "changed" },
    { surface: "event", name: "deleted", change: "removed" },
  ]);
});

test("contractChangesOf counts unique external users without leaking external workspace identities (P12)", () => {
  const db = new DatabaseSync(":memory:");
  for (const step of [...appsSchemaSteps, ...releasesSchemaSteps]) {
    db.exec(step.sql);
  }
  db.exec(
    `CREATE TABLE invocations (app TEXT, caller_kind TEXT, operation TEXT, session TEXT)`,
  );
  const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzza";
  const SUB_APP = "app_01hzzzzzzzzzzzzzzzzzzzzzzb";
  const ARCHIVED_APP = "app_01hzzzzzzzzzzzzzzzzzzzzzzc";
  const PRJ = "prj_01hzzzzzzzzzzzzzzzzzzzzzza";

  for (const [appId, slug, status] of [
    [APP, "ledger", "active"],
    [SUB_APP, "dash", "active"],
    [ARCHIVED_APP, "retired", "archived"],
  ]) {
    db.prepare(
      `INSERT INTO apps VALUES (?, ?, ?, 'd', NULL, NULL, NULL, ?, '1', ?)`,
    ).run(appId, slug, slug, status === "archived" ? 0 : 1, status);
  }
  const sql = {
    run: (text: string, params: never[]) => db.prepare(text).run(...params),
    get: (text: string, params: never[]) =>
      db.prepare(text).get(...params) as Record<string, never> | undefined,
    all: (text: string, params: never[]) =>
      db.prepare(text).all(...params) as Record<string, never>[],
  };
  const putActive = (
    appId: string,
    relId: string,
    declaration: AppDeclaration,
  ) => {
    const rec = {
      id: relId,
      app: appId,
      number: 1,
      code_commit: "0".repeat(40),
      bundle_hash: "0".repeat(64),
      declaration_hash: "0".repeat(64),
      data_schema: 0,
      data_changes: [],
      created_by: "agent:ses_01hzzzzzzzzzzzzzzzzzzzzzza",
      created_at: "2026-10-16T00:00:00.000Z",
      status: "prepared",
    } as unknown as ReleaseRecord;
    insertRelease({ sql }, rec, JSON.stringify(declaration), {} as never);
    db.prepare(
      "UPDATE releases SET status = 'active', activated_at = ? WHERE id = ?",
    ).run(rec.created_at, rec.id);
  };

  putActive(
    APP,
    "rel_01hzzzzzzzzzzzzzzzzzzzzzz1",
    decl({
      commands: [tool("list", true)],
      skills: [{ name: "usage", public: true, commands: ["list"] }],
      events: [
        {
          name: "posted",
          description: "posted",
          payloadSchema: { type: "object" },
        },
      ],
    }),
  );
  putActive(
    SUB_APP,
    "rel_01hzzzzzzzzzzzzzzzzzzzzzz2",
    decl({
      app_connections: [{ app: APP, commands: ["list"], reason: "sync" }],
      subscriptions: [
        { source: "ledger", event: "posted" },
        // remote subscription must be ignored
        { source: "ledger", event: "posted", machine: "laptop" },
      ],
    }),
  );
  putActive(
    ARCHIVED_APP,
    "rel_01hzzzzzzzzzzzzzzzzzzzzzz3",
    decl({
      app_connections: [{ app: APP, commands: ["list"], reason: "old" }],
      subscriptions: [{ source: "ledger", event: "posted" }],
    }),
  );

  const ports: UsagePorts = {
    sessionWorkspace: () => null,
    declaredToolUsers: () => [
      { tool: "list", workspace: null }, // Home job -> counts as 1
      { tool: "list", workspace: { kind: "app", id: APP as never } }, // self -> ignored
    ],
    declaredEventSubscribers: () => [
      { event: "posted", workspace: { kind: "project", id: PRJ as never } },
    ],
  };
  const tx = {
    sql,
    port: (key: unknown) => {
      if (key === usagePorts) return ports;
      throw new Error("unknown port");
    },
  } as unknown as Pick<Tx, "sql" | "port">;

  const next = decl({ commands: [], skills: [], events: [] });
  const result = contractChangesOf(tx, APP, next);
  assert.ok(result.ok);
  assert.deepStrictEqual(result.value, [
    {
      surface: "command",
      name: "list",
      change: "removed",
      external_user_count: 2,
    },
    {
      surface: "skill",
      name: "usage",
      change: "removed",
      // 받는 자리는 배포 목록(전역·harness·workspace·agent)에서 오고 core 메인 thread가 채운다(`release.prepare`).
      external_user_count: 0,
    },
    {
      surface: "event",
      name: "posted",
      change: "removed",
      external_user_count: 2,
    },
  ]);
  // P12: no external workspace IDs or names appear in serialized contract_changes
  const serialized = JSON.stringify(result.value);
  assert.ok(!serialized.includes(SUB_APP));
  assert.ok(!serialized.includes(PRJ));
  assert.ok(!serialized.includes("dash"));
});

test("workspace-reader scans declared vs mentioned impact, skips archived workspaces and memory/LOPHN files, and scans contract users", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-ws-reader-"));
  try {
    const db = new DatabaseSync(":memory:");
    for (const step of [
      ...appsSchemaSteps,
      ...releasesSchemaSteps,
      ...projectsSchemaSteps,
      ...PROJECTS_IDENTITY_STEPS,
      ...PROJECTS_FORMER_IDENTITY_STEPS,
      ...PROJECTS_SEPARATED_STEPS,
      ...jobsSchemaSteps,
      ...jobTriggerSchemaSteps,
    ]) {
      db.exec(step.sql);
    }

    const APP_TARGET = "app_01hzzzzzzzzzzzzzzzzzzzzzza" as const;
    const APP_CONSUMER = "app_01hzzzzzzzzzzzzzzzzzzzzzzb" as const;
    const APP_ARCHIVED = "app_01hzzzzzzzzzzzzzzzzzzzzzzc" as const;
    const PRJ_ACTIVE = "prj_01hzzzzzzzzzzzzzzzzzzzzzza" as const;
    const PRJ_ARCHIVED = "prj_01hzzzzzzzzzzzzzzzzzzzzzzb" as const;
    const AGT_REVIEWER = "agt_01hzzzzzzzzzzzzzzzzzzzzzza" as const;

    for (const [id, slug, name, status] of [
      [APP_TARGET, "billing", "Billing", "active"],
      [APP_CONSUMER, "reports", "Reports", "active"],
      [APP_ARCHIVED, "legacy", "Legacy", "archived"],
    ]) {
      db.prepare(
        `INSERT INTO apps VALUES (?, ?, ?, 'd', NULL, NULL, NULL, ?, '1', ?)`,
      ).run(id, slug, name, status === "archived" ? 0 : 1, status);
    }
    for (const [id, name, status] of [
      [PRJ_ACTIVE, "ops", "active"],
      [PRJ_ARCHIVED, "old-ops", "archived"],
    ]) {
      db.prepare(
        `INSERT INTO projects (id, name, title, purpose, revision, status, identity)
         VALUES (?, ?, ?, 'p', '1', ?, ?)`,
      ).run(id, name, name, status, `pri_${id.slice(4)}`);
    }

    const sql = {
      run: (text: string, params: never[]) => db.prepare(text).run(...params),
      get: (text: string, params: never[]) =>
        db.prepare(text).get(...params) as Record<string, never> | undefined,
      all: (text: string, params: never[]) =>
        db.prepare(text).all(...params) as Record<string, never>[],
    };

    const putActive = (
      appId: string,
      relId: string,
      declaration: AppDeclaration,
    ) => {
      const rec = {
        id: relId,
        app: appId,
        number: 1,
        code_commit: "0".repeat(40),
        bundle_hash: "0".repeat(64),
        declaration_hash: "0".repeat(64),
        data_schema: 0,
        data_changes: [],
        created_by: "agent:ses_01hzzzzzzzzzzzzzzzzzzzzzza",
        created_at: "2026-10-16T00:00:00.000Z",
        status: "prepared",
      } as unknown as ReleaseRecord;
      insertRelease({ sql }, rec, JSON.stringify(declaration), {} as never);
      db.prepare(
        "UPDATE releases SET status = 'active', activated_at = ? WHERE id = ?",
      ).run(rec.created_at, rec.id);
    };

    putActive(
      APP_TARGET,
      "rel_01hzzzzzzzzzzzzzzzzzzzzzz1",
      decl({
        commands: [tool("charge", true)],
        events: [
          {
            name: "paid",
            description: "paid",
            payloadSchema: { type: "object" },
          },
        ],
      }),
    );
    putActive(
      APP_CONSUMER,
      "rel_01hzzzzzzzzzzzzzzzzzzzzzz2",
      decl({
        app_connections: [
          { app: APP_TARGET, commands: ["charge"], reason: "bill" },
        ],
        subscriptions: [
          { source: "billing", event: "paid" },
          { source: "billing", event: "paid", machine: "other-mac" },
        ],
      }),
    );
    putActive(
      APP_ARCHIVED,
      "rel_01hzzzzzzzzzzzzzzzzzzzzzz3",
      decl({
        app_connections: [
          { app: APP_TARGET, commands: ["charge"], reason: "archived" },
        ],
      }),
    );

    // Jobs: active project tool_run + event trigger, plus archived project job (must be skipped)
    db.prepare(
      `INSERT INTO jobs (id, title, creator_agent, creator_workspace, every, at, action, missed_policy, enabled, created_at, updated_at, trigger)
       VALUES (?, 'Daily charge', ?, ?, '1d', NULL, ?, 'run', 1, '2026-11-01', '2026-11-01', NULL)`,
    ).run(
      "job_01hzzzzzzzzzzzzzzzzzzzzzz1",
      AGT_REVIEWER,
      PRJ_ACTIVE,
      JSON.stringify({ kind: "tool_run", app: APP_TARGET, tool: "charge" }),
    );
    db.prepare(
      `INSERT INTO jobs (id, title, creator_agent, creator_workspace, every, at, action, missed_policy, enabled, created_at, updated_at, trigger)
       VALUES (?, 'On paid', ?, ?, NULL, NULL, ?, 'run', 1, '2026-11-01', '2026-11-01', ?)`,
    ).run(
      "job_01hzzzzzzzzzzzzzzzzzzzzzz2",
      AGT_REVIEWER,
      PRJ_ACTIVE,
      JSON.stringify({
        kind: "agent_run",
        agent: AGT_REVIEWER,
        agent_workspace: null,
        prompt: "handle",
      }),
      JSON.stringify({
        source: "billing",
        app: APP_TARGET,
        event: "paid",
        min_interval: "5m",
        pass_event: false,
      }),
    );
    db.prepare(
      `INSERT INTO jobs (id, title, creator_agent, creator_workspace, every, at, action, missed_policy, enabled, created_at, updated_at, trigger)
       VALUES (?, 'Archived job', ?, ?, '1d', NULL, ?, 'run', 1, '2026-11-01', '2026-11-01', NULL)`,
    ).run(
      "job_01hzzzzzzzzzzzzzzzzzzzzzz3",
      AGT_REVIEWER,
      PRJ_ARCHIVED,
      JSON.stringify({ kind: "tool_run", app: APP_TARGET, tool: "charge" }),
    );

    // Agent file (custom runtime, assigned billing)
    await mkdir(join(root, "agents"), { recursive: true });
    await writeFile(
      join(root, "agents", `${AGT_REVIEWER}.md`),
      `---\nhandle: reviewer\nname: Reviewer\nruntime: custom\ndeployed_skills:\n  - app: ${APP_TARGET}\n    skill: billing-guide\n---\nYou review billing.\n`,
    );

    // Active workflow with flow.ts + workflow.yaml referencing reviewer & billing
    const wfDir = join(root, "projects", PRJ_ACTIVE, "workflows", "reconcile");
    await mkdir(wfDir, { recursive: true });
    await writeFile(
      join(wfDir, "workflow.yaml"),
      `flow_sdk: "2.0.0"\nagent: reviewer\nparticipants:\n  rev:\n    agent: reviewer\ninputs:\n  owner:\n    type: agent\n    default: reviewer\n`,
    );
    await writeFile(
      join(wfDir, "flow.ts"),
      `import { agent, tool, onEvent } from "@lophn/flow";\nawait tool({ app: "billing", tool: "charge" });\nonEvent({ source: "billing", event: "paid" }, () => {});\nawait agent({ agent: { agent: "reviewer" }, prompt: "check" });\n`,
    );

    // Archived project workflow (must be skipped!)
    const archivedWfDir = join(
      root,
      "projects",
      PRJ_ARCHIVED,
      "workflows",
      "stale",
    );
    await mkdir(archivedWfDir, { recursive: true });
    await writeFile(
      join(archivedWfDir, "flow.ts"),
      `await tool({ app: "billing", tool: "charge" });\n`,
    );

    // Skill markdown mention + memory.md / LOPHN.md traps (must NEVER be scanned!)
    await mkdir(join(root, "projects", PRJ_ACTIVE, "skills", "ops-runbook"), {
      recursive: true,
    });
    await writeFile(
      join(root, "projects", PRJ_ACTIVE, "skills", "ops-runbook", "SKILL.md"),
      `# Ops Runbook\nUse billing charge when closing month.\n`,
    );
    await writeFile(
      join(root, "projects", PRJ_ACTIVE, "memory.md"),
      `Remember billing and reviewer forever.\n`,
    );
    await writeFile(
      join(root, "projects", PRJ_ACTIVE, "LOPHN.md"),
      `Always mention billing and reviewer.\n`,
    );

    const snap = await readWorkspaceSnapshot({ sql, dataRoot: root });
    assert.ok(snap.ok);
    assert.strictEqual(snap.value.summary.active_apps, 2);
    assert.strictEqual(snap.value.summary.active_projects, 1);
    assert.strictEqual(snap.value.summary.workflows, 1);
    assert.strictEqual(snap.value.summary.custom_agents, 1);

    // 받는 자리는 배포 목록 한 길에서 온다(전역, harness, workspace, agent). 여기서는 agent 하나와 전역 하나가 받는다.
    const receivers = async () => ({
      unreadable: 0,
      found: [
        {
          app: APP_TARGET,
          slug: "billing",
          skill: "billing-guide",
          provided: true,
          layer: "agent" as const,
          at: "reviewer",
          workspace: null,
          active: true,
        },
        {
          app: APP_TARGET,
          slug: "billing",
          skill: "billing-guide",
          provided: true,
          layer: "global" as const,
          at: null,
          workspace: undefined,
          active: true,
        },
      ],
    });
    const appImpact = await scanImpact(
      { sql, dataRoot: root, receivers },
      { kind: "app", app: APP_TARGET },
    );
    assert.ok(appImpact.ok);
    assert.deepStrictEqual(
      appImpact.value.impact.declared.map((d) => d.kind).sort(),
      [
        "app_connection",
        "app_subscription",
        "job_action",
        "job_trigger",
        "skill_deployment",
        "skill_deployment",
      ],
    );
    // flow.ts tool + onEvent + SKILL.md mention, NO memory.md or LOPHN.md, NO archived project
    assert.strictEqual(appImpact.value.impact.mentioned.length, 3);
    assert.ok(
      appImpact.value.impact.mentioned.every(
        (m) => !m.file.includes("memory.md") && !m.file.includes("LOPHN.md"),
      ),
    );

    const agentImpact = await scanImpact(
      {
        sql,
        dataRoot: root,
        secretNames: () => [`mcp.${AGT_REVIEWER}.github`],
      },
      { kind: "agent", agent: AGT_REVIEWER },
    );
    assert.ok(agentImpact.ok);
    assert.deepStrictEqual(
      agentImpact.value.impact.declared.map((d) => d.kind).sort(),
      [
        "job_action",
        "workflow_creator",
        "workflow_input",
        "workflow_participant",
      ],
    );
    assert.ok(
      agentImpact.value.immediate.some((line) => line.includes("MCP secret")),
    );

    const contractImpact = await scanReleaseContractUsers(
      sql,
      root,
      APP_TARGET,
      [{ surface: "command", name: "charge", change: "changed" }],
      receivers,
    );
    assert.ok(contractImpact.ok);
    assert.deepStrictEqual(
      contractImpact.value.affected_workspaces.map((w) =>
        w.workspace === null ? "home" : `${w.workspace.kind}:${w.workspace.id}`,
      ),
      [`app:${APP_CONSUMER}`, `project:${PRJ_ACTIVE}`],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
