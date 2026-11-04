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
  placeExists: () => false,
  skills: () => [],
  shared: () => [],
  mcp: () => [],
  sharedCommands: () => [],
  inputMedia: () => null,
  modelDefault: () => null,
  projectModel: () => null,
};

test("lophn은 지우거나 이름·profile을 바꿀 수 없고, agent 이름은 전역에 하나이며, agent 자격은 mcp_servers·skip·apps·permissions을 넣지 못한다", async () => {
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

    for (const definition of [
      { name: "other", body: "x" },
      {
        name: "lophn",
        profile: { kind: "character", shape: "arch", color: "sage" },
        body: "x",
      },
    ]) {
      const refused = change(definition);
      assert.ok(!refused.ok);
      assert.equal(refused.error.code, "forbidden");
    }

    for (const name of ["lophn", " LOPHN "]) {
      const refused = create(AGENT, { name, body: "x" });
      assert.ok(!refused.ok);
      assert.equal(refused.error.code, "invalid_input");
      assert.deepEqual(
        (refused.error.details as { issues: unknown[] }).issues,
        [{ field: "name", code: "reserved_name" }],
      );
    }

    assert.ok(create(AGENT, { name: "reviewer", body: "x" }).ok);
    const twin = create(OTHER, { name: "Reviewer", body: "x" });
    assert.ok(!twin.ok);
    assert.equal(twin.error.code, "invalid_input");
    assert.deepEqual((twin.error.details as { issues: unknown[] }).issues, [
      { field: "name", code: "duplicate" },
    ]);

    const humanOnly: Record<string, unknown> = {
      skip: true,
      mcp_servers: [],
      apps: ["notes"],
      permissions: { deny: ["lophn(notes read)"] },
    };
    for (const field of Object.keys(humanOnly)) {
      const refused = create(
        OTHER,
        { name: `with-${field}`, body: "x", [field]: humanOnly[field] },
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
        definition: { name: "lophn", body: "x", apps: ["notes"] },
      } as never,
      { hash: beforeHash },
    );
    assert.ok(!refusedChange.ok);
    assert.equal(refusedChange.error.code, "forbidden");

    const after = store.read(lophnSlot);
    assert.ok(after.ok && after.value?.hash === beforeHash);
    const ids = store.agentIds();
    assert.ok(ids.ok);
    assert.deepEqual(ids.value, [AGENT]);
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
        definition: { name: "reviewer", body: "v1" },
      },
      {} as never,
    );
    assert.ok(made.ok);
    const stale = commands.change.handle(
      tx,
      user,
      {
        agent: AGENT,
        definition: { name: "reviewer", body: "v2" },
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
