import assert from "node:assert/strict";
import { test } from "node:test";

import type { CoreSource } from "../../desktop/connection/connection.ts";
import { coreAgentsSource } from "./core-source.ts";

// agent의 credential 이름은 저장 전에 만든 id를 쓴다. 만들 때 다른 id를 쓰면 이름의 주인이 달라져 다른 agent의
// secret 이름과 겹칠 수 있다.
test("새 agent는 미리 받은 id로 만들어지고 새 server의 값은 그 id의 이름으로 받는다", async () => {
  const draftId = "agt_0abcdefghjkmnpqrstvwxyz012";
  const sent: { resource: string; method: string; body: unknown }[] = [];
  const core = {
    subscribe: () => () => {},
    call: (call: { resource: string; method: string; body: unknown }) => {
      sent.push(call);
      const input = (call.body as { input: { id: string } }).input;
      return Promise.resolve({
        ok: true,
        value: { agent: input.id, hash: "h" },
      });
    },
  } as unknown as CoreSource;
  const opened: string[] = [];
  const source = coreAgentsSource(core, {
    openSecret: (request) => {
      opened.push("name" in request ? request.name : "");
      return Promise.resolve({ ok: true, result: "stored" });
    },
  });
  const server = {
    name: "docs",
    enabled: true,
    call_timeout_ms: 60_000,
    transport: "http" as const,
    http: {
      url: "https://docs.example.com/mcp",
      headers: {},
      auth: {
        kind: "bearer" as const,
        credential: { secret: `mcp.${draftId}.docs` },
      },
    },
  };

  const saved = await source.saveAgent("prj_01h455vb4pex5v6nkc6gd5fd01", {
    assignment: null,
    draftId,
    definition: { name: "Docs", body: "read docs", mcp_servers: [server] },
    hash: null,
  });

  assert.deepStrictEqual(
    sent.map((call) => `${call.resource}/${call.method}`),
    ["agents/create"],
  );
  assert.deepStrictEqual(
    (sent[0]?.body as { input: { id: string } }).input.id,
    draftId,
  );
  assert.deepStrictEqual(saved.ok && saved.value.assignment, draftId);
  assert.deepStrictEqual(opened, [`mcp.${draftId}.docs`]);
});

test("harnessCatalog·refreshHarnessCatalog·codingChoices가 맞는 route와 입력을 부른다", async () => {
  const sent: {
    kind: string;
    resource: string;
    method: string;
    body: unknown;
  }[] = [];
  const sampleView = {
    harness: "codex" as const,
    status: "ready" as const,
    catalog: {
      models: [
        {
          id: "openai",
          label: "OpenAI",
          models: [{ id: "gpt-5.3-codex", label: "GPT-5.3 Codex", axes: [] }],
        },
      ],
      defaults: { model: "gpt-5.3-codex", options: {} },
    },
    fetched_at: "2026-11-23T05:00:00.000Z",
    stale: false,
    error: null,
  };
  const core = {
    subscribe: () => () => {},
    call: (call: {
      kind: string;
      resource: string;
      method: string;
      body: unknown;
    }) => {
      sent.push(call);
      if (call.resource === "harness_catalog") {
        return Promise.resolve({ ok: true, value: sampleView });
      }
      if (call.resource === "settings" && call.method === "list") {
        return Promise.resolve({
          ok: true,
          value: {
            settings: [
              {
                key: "shell.coding_agents",
                chosen: { favorites: ["omp", "claude"], commands: {} },
              },
            ],
          },
        });
      }
      if (call.resource === "coding_agents" && call.method === "list") {
        return Promise.resolve({
          ok: true,
          value: {
            harnesses: [
              { harness_id: "claude", discovery: "detected" },
              { harness_id: "codex", discovery: "absent" },
              { harness_id: "omp", discovery: "detected" },
            ],
          },
        });
      }
      return Promise.resolve({ ok: false, error: { code: "not_found" } });
    },
  } as unknown as CoreSource;

  const source = coreAgentsSource(core);
  const read = await source.harnessCatalog(
    "codex",
    true,
    "prj_01h455vb4pex5v6nkc6gd5fd01",
  );
  const refreshed = await source.refreshHarnessCatalog("codex", "home");
  const choices = await source.codingChoices();

  assert.equal(read.ok, true);
  assert.equal(refreshed.ok, true);
  assert.deepStrictEqual(choices, {
    ok: true,
    value: { favorites: ["omp", "claude"], detected: ["claude", "omp"] },
  });
  assert.deepStrictEqual(sent[0], {
    kind: "read",
    resource: "harness_catalog",
    method: "read",
    body: {
      harness: "codex",
      workspace: { kind: "project", id: "prj_01h455vb4pex5v6nkc6gd5fd01" },
      probe: true,
    },
  });
  assert.deepStrictEqual(sent[1], {
    kind: "memory",
    resource: "harness_catalog",
    method: "refresh",
    body: { harness: "codex" },
  });
});
