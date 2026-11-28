import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CALL_POLICY_SETTING_KEY } from "../../../protocol/lophn-agent/call-policy.ts";
import {
  lophnIdOf,
  type ModelChoice,
} from "../../../protocol/lophn-agent/mod.ts";
import { mcpTokenNames } from "../extensions/mcp-oauth-vault.ts";
import type {
  ReadSnapshot,
  RequestContext,
} from "../../../protocol/server/mod.ts";
import type { AgentFileSystem, AgentLookups } from "./ports.ts";
import { createAgentReads } from "./reads.ts";

const PROJECT = "prj_00000000000000000000000001";
const AGENT = "agt_00000000000000000000000001";
const choice = (model_name: string): ModelChoice => ({
  provider: "pvd_00000000000000000000000000",
  model_name,
  option_values: {},
});

test("정의 읽기의 model 출처는 agent, project, global 순서다", () => {
  const read = (agentFile: string, project: ModelChoice | null) => {
    const lookups: AgentLookups = {
      workspaces: () => [],
      workspaceExists: () => true,
      workspaceArchived: () => false,
      skills: () => [],
      reaching: () => [],
      shared: () => [],
      mcp: () => [],
      sharedCommands: () => [],
      modelInfo: () => null,
      modelDefault: () => choice("global-model"),
      workspaceModel: (workspace) =>
        workspace?.kind === "project" ? project : null,
    };
    const files: AgentFileSystem = {
      read: () => agentFile,
      writeAtomic: () => {},
      remove: () => {},
      list: () => [],
      ensureFolder: () => {},
    };
    const reads = createAgentReads({
      files,
      lookups: () => lookups,
      dataRoot: "/data",
    });
    const result = reads.read.handle(
      { sql: {} } as unknown as ReadSnapshot,
      { actor: "user" } as RequestContext,
      {
        agent: AGENT,
        workspace: { kind: "project", id: PROJECT },
      },
    );
    assert.ok(result.ok);
    return result.value.effective.model;
  };
  const own =
    "---\nhandle: reviewer\nname: reviewer\nmodel:\n  provider: pvd_00000000000000000000000000\n  model_name: agent-model\n  option_values: {}\n---\nbody\n";
  const agent = read(own, choice("workspace-model"));
  assert.deepEqual(
    [agent?.value.model_name, agent?.source],
    ["agent-model", "agent"],
  );
  const project = read(
    "---\nhandle: reviewer\nname: reviewer\n---\nbody\n",
    choice("workspace-model"),
  );
  assert.deepEqual(
    [project?.value.model_name, project?.source],
    ["workspace-model", "project"],
  );
  const global = read(
    "---\nhandle: reviewer\nname: reviewer\n---\nbody\n",
    null,
  );
  assert.deepEqual(
    [global?.value.model_name, global?.source],
    ["global-model", "global"],
  );
});

// 비밀 경계다. workspace마다 lophn이 따로여서 앱 lophn에 건 MCP server는 다른 workspace의 lophn 정의에 실리지 않고,
// 그 token 이름도 겹치지 않으며, 목록에는 자기 workspace의 lophn만 보인다.
test("an app lophn's MCP server and token are not seen by the project lophn", () => {
  const app = { kind: "app", id: "app_00000000000000000000000001" } as const;
  const project = { kind: "project", id: PROJECT } as const;
  const appLophn = lophnIdOf(app);
  const projectLophn = lophnIdOf(project);
  const stored: Record<string, string> = {
    "/data/agents/lophn_app_00000000000000000000000001.md":
      "---\nmcp_servers:\n  - name: calendar\n    enabled: true\n    call_timeout_ms: 30000\n    transport: stdio\n    stdio:\n      executable: /bin/echo\n      args: []\n      cwd: null\n      env: {}\n---\n",
  };
  const lookups: AgentLookups = {
    workspaces: () => [project, app],
    workspaceExists: () => true,
    workspaceArchived: () => false,
    skills: () => [],
    reaching: () => [],
    shared: () => [],
    mcp: () => [],
    sharedCommands: () => [],
    modelInfo: () => null,
    modelDefault: () => choice("global-model"),
    workspaceModel: () => null,
  };
  const reads = createAgentReads({
    files: {
      read: (path) => stored[path] ?? null,
      writeAtomic: () => {},
      remove: () => {},
      list: () => [],
      ensureFolder: () => {},
    },
    lookups: () => lookups,
    dataRoot: "/data",
  });
  const snapshot = { sql: {} } as unknown as ReadSnapshot;
  const user = { actor: "user", conditions: {} } as unknown as RequestContext;
  const definitionOf = (agent: string) => {
    const read = reads.read.handle(snapshot, user, { agent } as never);
    assert.ok(read.ok);
    return read.value.definition;
  };
  assert.equal(definitionOf(appLophn)?.mcp_servers?.[0]?.name, "calendar");
  assert.equal(definitionOf(projectLophn)?.mcp_servers, undefined);
  assert.notEqual(
    mcpTokenNames({ workspace: null, agent: appLophn, name: "calendar" })
      .access,
    mcpTokenNames({ workspace: null, agent: projectLophn, name: "calendar" })
      .access,
  );
  const listed = reads.list.handle(snapshot, user, { workspace: project });
  assert.ok(listed.ok);
  assert.deepEqual(
    listed.value.agents.map((row) => row.agent),
    [projectLophn, "coding_claude", "coding_codex", "coding_opencode"],
  );
});

// 권한 경계다. agent는 `agent list`로 다른 workspace의 명함을 읽을 수 있지만, 이 기계에서 private인 다른 workspace는 읽지 못한다.
// 자기 workspace는 private이어도 읽고, 보관한 앱 workspace는 없는 것이다.
test("agent는 자기 workspace가 아닌 private workspace의 명함 목록을 읽지 못한다", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-cards-"));
  const hidden = {
    kind: "project",
    id: "prj_00000000000000000000000002",
  } as const;
  const other = {
    kind: "project",
    id: "prj_00000000000000000000000003",
  } as const;
  const archived = {
    kind: "app",
    id: "app_00000000000000000000000001",
  } as const;
  writeFileSync(
    join(root, "settings.json"),
    JSON.stringify({
      [CALL_POLICY_SETTING_KEY]: {
        private: [{ kind: "project", id: PROJECT }, hidden],
        workspaces: [],
        agents: [],
      },
    }),
  );
  const lookups: AgentLookups = {
    workspaces: () => [],
    workspaceExists: () => true,
    workspaceArchived: (workspace) => workspace.kind === "app",
    skills: () => [],
    reaching: () => [],
    shared: () => [],
    mcp: () => [],
    sharedCommands: () => [],
    modelInfo: () => null,
    modelDefault: () => null,
    workspaceModel: () => null,
  };
  const reads = createAgentReads({
    files: {
      read: () => null,
      writeAtomic: () => {},
      remove: () => {},
      list: () => [],
      ensureFolder: () => {},
    },
    lookups: () => lookups,
    dataRoot: root,
  });
  // 부르는 agent의 session은 private project(PROJECT)에 있다.
  const snapshot = {
    sql: {
      get: () => ({
        id: "ses_me",
        agent: lophnIdOf({ kind: "project", id: PROJECT }),
        project: PROJECT,
        workspace_kind: "project",
        workspace_id: PROJECT,
        lifecycle: "open",
      }),
      all: () => [],
    },
    as_of_seq: "1",
  } as unknown as ReadSnapshot;
  const agent = {
    actor: "agent:ses_me",
    conditions: { session: "ses_me" },
  } as unknown as RequestContext;
  const code = (workspace: unknown) => {
    const read = reads.cards.handle(snapshot, agent, { workspace } as never);
    return read.ok ? "ok" : read.error.code;
  };
  try {
    assert.equal(code(hidden), "forbidden");
    assert.equal(code({ kind: "project", id: PROJECT }), "ok");
    assert.equal(code(other), "ok");
    assert.equal(code(null), "ok");
    assert.equal(code(archived), "not_found");
    // core 안 machine 자격(다른 컴퓨터에 내주는 길은 자기가 private을 거른다)은 막지 않는다.
    const machine = reads.cards.handle(
      snapshot,
      { actor: "machine", conditions: {} } as unknown as RequestContext,
      { workspace: hidden },
    );
    assert.ok(machine.ok);
  } finally {
    rmSync(root, { recursive: true });
  }
});

// 권한 경계다. 다른 컴퓨터에 내주는 명함(`a2a/agents`가 without_apps로 읽는다)에는 이 기계에서 private인 앱의 slug, command,
// skill, 그 skill의 끄기가 남지 않는다.
test("다른 컴퓨터에 내주는 명함은 private 앱을 싣지 않는다", () => {
  const DIARY = "app_0000000000000000000000000d";
  const NOTES = "app_0000000000000000000000000e";
  const lookups: AgentLookups = {
    workspaces: () => [],
    workspaceExists: () => true,
    workspaceArchived: () => false,
    skills: () => [],
    reaching: (_workspace, agent) => agent,
    shared: (deployed) =>
      deployed.map((one) => ({ name: one.skill, can_disable: true })),
    mcp: () => [],
    sharedCommands: (deployed) =>
      deployed.map((one) => ({
        slug: one.app === NOTES ? "notes" : "diary",
        name: "add",
      })),
    modelInfo: () => null,
    modelDefault: () => null,
    workspaceModel: () => null,
  };
  const reads = createAgentReads({
    files: {
      read: (path) =>
        path === `/data/agents/${AGENT}.md`
          ? `---\nhandle: reviewer\nname: reviewer\ndeployed_skills:\n  - app: ${DIARY}\n    skill: diary-skill\n  - app: ${NOTES}\n    skill: notes-skill\nskills_off:\n  - diary-skill\n---\nbody\n`
          : null,
      writeAtomic: () => {},
      remove: () => {},
      list: () => [`${AGENT}.md`],
      ensureFolder: () => {},
    },
    lookups: () => lookups,
    dataRoot: "/data",
  });
  const machine = {
    actor: "machine",
    conditions: {},
  } as unknown as RequestContext;
  const snapshot = { sql: {}, as_of_seq: "1" } as unknown as ReadSnapshot;
  const cardOf = (without_apps?: string[]) => {
    const read = reads.cards.handle(snapshot, machine, {
      workspace: null,
      ...(without_apps === undefined ? {} : { without_apps }),
    });
    assert.ok(read.ok);
    const card = read.value.cards.find((one) => one.handle === "reviewer");
    assert.ok(card);
    return JSON.stringify(card);
  };
  assert.match(cardOf(), /diary/);
  const remote = cardOf([DIARY]);
  assert.doesNotMatch(remote, /diary/);
  assert.match(remote, /command: notes add/);
});
