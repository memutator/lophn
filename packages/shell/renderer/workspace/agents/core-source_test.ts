import assert from "node:assert/strict";
import { test } from "node:test";

import type { CoreSource } from "../../desktop/connection/connection.ts";
import { coreAgentsSource } from "./core-source.ts";

// Operator의 credential 이름은 저장 전에 만든 id를 쓴다. 만들 때 다른 id를 쓰면 이름의 주인이 달라져 다른
// Operator의 secret 이름과 겹칠 수 있다.
test("새 Operator는 미리 받은 id로 만들어지고 새 server의 값은 그 id의 이름으로 받는다", async () => {
  const draftId = "agt_0abcdefghjkmnpqrstvwxyz012";
  const sent: { resource: string; body: unknown }[] = [];
  const core = {
    subscribe: () => () => {},
    call: (call: { resource: string; body: unknown }) => {
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
      opened.push(request.name);
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
    place: "prj_01h455vb4pex5v6nkc6gd5fd01",
    definition: { name: "Docs", body: "read docs", mcp_servers: [server] },
    hash: null,
  });

  assert.deepStrictEqual(saved.ok && saved.value.assignment, draftId);
  assert.deepStrictEqual(opened, [`mcp.${draftId}.docs`]);
});
