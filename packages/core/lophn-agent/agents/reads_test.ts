import assert from "node:assert/strict";
import { test } from "node:test";
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
    [projectLophn],
  );
});
