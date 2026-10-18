import { assertEquals } from "@std/assert";

import type { CoreSource } from "../../desktop/connection/connection.ts";
import { coreAgentsSource } from "./core-source.ts";

// Operator의 credential 이름은 저장 전에 만든 id를 쓴다. 만들 때 다른 id를 쓰면 이름의 주인이 달라져 다른
// Operator의 secret 이름과 겹칠 수 있다.
Deno.test("새 Operator는 미리 받은 id로 만들어지고 새 server의 값은 그 id의 이름으로 받는다", async () => {
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

  assertEquals(saved.ok && saved.value.assignment, draftId);
  assertEquals(opened, [`mcp.${draftId}.docs`]);
});

// 이름을 더할 때 provider가 알려 준 목록을 덮어쓰면 목록 하나가 사라진다. 있던 이름은 그대로 두고, 읽은 뒤 목록이
// 바뀌었으면(판이 다르면) core가 거절해 아무것도 쓰지 않아야 한다.
Deno.test("model 이름을 더해도 알려 준 목록은 그대로이고 판이 어긋나면 쓰지 않는다", async () => {
  const provider = "pvd_01arz3ndektsv4rrffq69g5fa4";
  const stored = { revision: 3, models: ["llama", "qwen"] };
  // 읽은 뒤 다른 곳이 먼저 쓴 것처럼 읽기만 옛 판을 돌려준다.
  let readRevision = 3;
  const core = {
    subscribe: () => () => {},
    call: (call: { resource: string; method: string; body: unknown }) => {
      if (call.method === "read") {
        return Promise.resolve({
          ok: true,
          value: {
            provider: {
              revision: readRevision,
              credential: { reported_models: stored.models },
            },
          },
        });
      }
      const body = call.body as {
        input: { models: string[] };
        compare: { revision: number };
      };
      if (body.compare.revision !== stored.revision) {
        return Promise.resolve({ ok: false, error: { code: "conflict" } });
      }
      stored.models = body.input.models;
      stored.revision += 1;
      return Promise.resolve({ ok: true, value: {} });
    },
  } as unknown as CoreSource;
  const source = coreAgentsSource(core, {});

  const added = await source.addModelName(provider, "mistral");
  assertEquals(added.ok, true);
  assertEquals(stored.models, ["llama", "qwen", "mistral"]);

  readRevision = 3;
  const stale = await source.addModelName(provider, "gemma");
  assertEquals(stale.ok, false);
  assertEquals(stored.models, ["llama", "qwen", "mistral"]);
});
