import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { RequestContext, Tx } from "../../../protocol/server/mod.ts";
import { LOPHN_AGENT_ID } from "../../../protocol/lophn-agent/mod.ts";
import { createNodeAgentFiles } from "./adapters/node-fs.ts";
import { createAgentCommands } from "./commands.ts";
import type { AgentLookups } from "./ports.ts";
import { agentSlotOf, createAgentStore } from "./store.ts";

const AGENT = "agt_00000000000000000000000001";
const OTHER = "agt_00000000000000000000000002";
const user = {} as RequestContext;
const agent = {
  actor: "agent:ses_00000000000000000000000001",
} as RequestContext;
const tx = { sql: {} } as unknown as Tx;

const lookups: AgentLookups = {
  workspaceExists: () => false,
  skills: () => [],
  shared: () => [],
  mcp: () => [],
  sharedCommands: () => [],
  inputMedia: () => null,
  modelDefault: () => null,
  projectModel: () => null,
};

test("lophn은 지우거나 handle·profile을 바꿀 수 없고, handle은 전역에 하나이고 바뀌지 않으며, agent 자격은 mcp_servers·skip·apps·permissions을 넣지 못한다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-agent-commands-"));
  try {
    const files = createNodeAgentFiles();
    const store = createAgentStore(files, root);
    const lophnSlot = agentSlotOf(root, LOPHN_AGENT_ID);
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
        { agent: LOPHN_AGENT_ID, definition } as never,
        { hash: beforeHash },
      );

    const deleted = commands.delete.handle(
      tx,
      user,
      { agent: LOPHN_AGENT_ID },
      { hash: beforeHash },
    );
    assert.ok(!deleted.ok);
    assert.equal(deleted.error.code, "forbidden");

    const profileChange = change({
      handle: "lophn",
      name: "lophn",
      profile: { kind: "character", shape: "arch", color: "sage" },
      body: "x",
    });
    assert.ok(!profileChange.ok);
    assert.equal(profileChange.error.code, "forbidden");
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
        agent: LOPHN_AGENT_ID,
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

test("bare가 고른 tool 이름이 아무것도 아니면 저장을 거절하고, 내장 tool·명령·앱 command·MCP tool은 받는다", async () => {
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
            runtime: "bare",
            tools,
            body: "x",
          },
        } as never,
        {} as never,
      );
    const refused = create(AGENT, [
      "file.read",
      "call.replay",
      "notes",
      "mcp__github",
    ]);
    assert.ok(!refused.ok);
    assert.equal(refused.error.code, "invalid_input");
    assert.deepEqual((refused.error.details as { issues: unknown[] }).issues, [
      { field: "tools.1", code: "unknown" },
      { field: "tools.2", code: "unknown" },
      { field: "tools.3", code: "unknown" },
    ]);
    assert.ok(
      create(OTHER, [
        "file.read",
        "call.reply",
        "notes.add-item",
        "mcp__github__create_issue",
      ]).ok,
    );
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
            agent: LOPHN_AGENT_ID,
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
