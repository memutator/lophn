import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SETTINGS_FILE_NAME } from "../../../protocol/config/mod.ts";
import type { RequestContext, Tx } from "../../../protocol/server/mod.ts";
import { createNodeAgentFiles } from "./adapters/node-fs.ts";
import { createAgentCommands } from "./commands.ts";
import { createAgentDirectory } from "./directory.ts";
import { openAgentContext } from "./inspect.ts";
import type { AgentDeps, AgentLookups } from "./ports.ts";

const lookups: AgentLookups = {
  workspaces: () => [],
  workspaceExists: () => false,
  workspaceArchived: () => false,
  skills: () => [],
  reaching: () => [],
  shared: () => [],
  mcp: () => [],
  sharedCommands: () => [],
  modelInfo: () => null,
  modelDefault: () => null,
  workspaceModel: () => null,
};
const user = {} as RequestContext;
const tx = { sql: {} } as unknown as Tx;

async function inRoot(
  settings: Record<string, unknown>,
  body: (deps: AgentDeps, root: string) => void,
  agentFiles: Record<string, string> = {},
) {
  const root = await mkdtemp(join(tmpdir(), "lophn-coding-builtin-"));
  try {
    await writeFile(join(root, SETTINGS_FILE_NAME), JSON.stringify(settings));
    await mkdir(join(root, "agents"));
    for (const [name, text] of Object.entries(agentFiles)) {
      await writeFile(join(root, "agents", name), text);
    }
    body(
      { files: createNodeAgentFiles(), lookups: () => lookups, dataRoot: root },
      root,
    );
  } finally {
    await rm(root, { recursive: true });
  }
}

// 목록과 handle 풀기는 harness extension이 켜지고 즐겨찾기에 있을 때만 내장 coding agent를 낸다. id로 읽기는 늘 된다.
test("a built-in coding agent is listed and resolved only when harness is on and it is a favorite", async () => {
  const handles = (deps: AgentDeps) => {
    const directory = createAgentDirectory((sql) =>
      openAgentContext(deps, sql),
    )({} as never);
    return {
      listed: directory.agents().map((agent) => agent.handle),
      byId: directory.agent("coding_claude")?.runtime,
      card: directory.cardOf("claude", null)?.runtime,
    };
  };
  await inRoot(
    { "shell.coding_agents": { favorites: ["claude"], commands: {} } },
    (deps) =>
      assert.deepEqual(handles(deps), {
        listed: ["lophn", "claude"],
        byId: "claude-code",
        card: "claude-code",
      }),
  );
  await inRoot(
    { "shell.coding_agents": { favorites: ["codex"], commands: {} } },
    (deps) =>
      assert.deepEqual(handles(deps), {
        listed: ["lophn", "codex"],
        byId: "claude-code",
        card: undefined,
      }),
  );
});

test("a built-in coding agent's handle, runtime and scope cannot change, it cannot be deleted, and its handle is reserved", async () => {
  await inRoot({}, (deps) => {
    const commands = createAgentCommands(deps);
    const change = (definition: Record<string, unknown>) =>
      commands.change.handle(
        tx,
        user,
        { agent: "coding_claude", definition } as never,
        { hash: null },
      );
    const base = {
      handle: "claude",
      runtime: "claude-code",
      name: "Claude",
      body: "",
    };
    for (const bad of [
      { handle: "other" },
      { runtime: "codex" },
      { workspace: { kind: "project", id: "prj_00000000000000000000000001" } },
    ]) {
      const refused = change({ ...base, ...bad });
      assert.ok(!refused.ok, JSON.stringify(bad));
      assert.equal(refused.error.code, "invalid_input");
    }
    assert.ok(change({ ...base, name: "My Claude" }).ok);
    const deleted = commands.delete.handle(
      tx,
      user,
      { agent: "coding_claude" },
      { hash: "x" } as never,
    );
    assert.ok(!deleted.ok);
    assert.equal(deleted.error.code, "forbidden");

    for (const handle of ["claude", " Codex ", "opencode"]) {
      const created = commands.create.handle(
        tx,
        user,
        {
          id: "agt_00000000000000000000000001",
          definition: { handle, name: "x", body: "x" },
        } as never,
        {} as never,
      );
      assert.ok(!created.ok, handle);
      assert.equal(created.error.code, "invalid_input");
    }
  });
});

// 즐겨찾기한 harness는 headless 명령이 없는 omp·antigravity도 목록에 선다. 정의의 harness_config.model은 명함의 model로 보인다.
test("every favorite coding agent is listed, and a pinned harness model shows on its card", async () => {
  const favorites = ["claude", "codex", "opencode", "omp", "antigravity"];
  await inRoot(
    { "shell.coding_agents": { favorites, commands: {} } },
    (deps) => {
      const directory = createAgentDirectory((sql) =>
        openAgentContext(deps, sql),
      )({} as never);
      assert.deepEqual(
        directory.agents().map((agent) => agent.handle),
        ["lophn", ...favorites],
      );
      assert.deepEqual(directory.cardOf("codex", null)?.model, {
        provider: "codex",
        model_name: "gpt-5",
        price: null,
        options: { effort: "high" },
      });
      assert.equal(directory.cardOf("omp", null)?.model, undefined);
    },
    {
      "coding_codex.md":
        "---\nharness_config:\n  model: gpt-5\n  options:\n    effort: high\n---\n",
    },
  );
});
