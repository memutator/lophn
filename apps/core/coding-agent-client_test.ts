// coding-agent client를 실제 core에 붙이는 통합 테스트다. test credential 입구
// (apps/core/testing)는 테스트에만 있고 제품 entry에는 없다. connection client
// 코드 자체는 제품 자리(packages/coding-agent/connection/)다.
import { assert, assertEquals } from "@std/assert";
import {
  createRpcClient,
  platformStatus,
} from "../../packages/contracts/platform/mod.ts";
import { createCoreClient } from "../../packages/coding-agent/connection/client/core.ts";
import { createCoreHarness } from "./testing/core.ts";

const CAC = "cac_01arz3ndektsv4rrffq69g5fav";

Deno.test(
  "coding-agent/connection#R16 #R9: core client는 test credential로 실제 core에 붙는다",
  async () => {
    const opened = await createCoreHarness();
    assert(opened.ok, opened.ok ? "" : JSON.stringify(opened.error));
    const harness = opened.value;
    try {
      // coding_agent actor·테스트 scope로 credential을 심는다. 이 입구는
      // 제품 entry가 발급을 막는 actor의 테스트 기록이다(platform#T9).
      const agent = await harness.credential({
        actor: "coding_agent",
        principal: `coding_agent:${CAC}`,
        scope: { operations: ["PlatformStatus"], targets: {} },
        conditions: {},
      });
      assert(agent.ok, agent.ok ? "" : agent.error.message);

      // 같은 client 코드가 provider에서 credential을 받아 실제 core에 read를
      // 보낸다. platformStatus read는 core가 실제로 내놓는 route다.
      const client = createCoreClient({
        baseUrl: `http://127.0.0.1:${harness.port}`,
        connection: CAC,
        provider: (connection) => {
          assertEquals(connection, CAC);
          return Promise.resolve({
            ok: true,
            value: { token: agent.value.token },
          });
        },
      });
      assertEquals(client.connection, CAC);
      assertEquals(client.baseUrl, `http://127.0.0.1:${harness.port}`);

      // client가 쓰는 rpc layer를 같은 credential로 실제 core에 붙인다.
      const rpc = createRpcClient({
        baseUrl: `http://127.0.0.1:${harness.port}`,
        token: agent.value.token,
        fetch: (input, init) =>
          fetch(input, init).then(async (response) => ({
            status: response.status,
            headers: response.headers,
            bytes: new Uint8Array(await response.arrayBuffer()),
          })),
      });
      const status = await rpc.call(platformStatus, {});
      assert(status.ok, status.ok ? "" : JSON.stringify(status.error));
      assertEquals(status.value.ready, true);
      assert(status.value.ledger_id.length > 0);
    } finally {
      await harness.close();
    }
  },
);

Deno.test(
  "coding-agent/connection#R16: user credential로도 같은 core에 붙는다",
  async () => {
    const opened = await createCoreHarness();
    assert(opened.ok, opened.ok ? "" : JSON.stringify(opened.error));
    const harness = opened.value;
    try {
      const user = await harness.credential({
        actor: "user",
        principal: "user-1",
        scope: { operations: ["PlatformStatus"], targets: {} },
        conditions: {},
      });
      assert(user.ok, user.ok ? "" : user.error.message);
      const rpc = createRpcClient({
        baseUrl: `http://127.0.0.1:${harness.port}`,
        token: user.value.token,
        fetch: (input, init) =>
          fetch(input, init).then(async (response) => ({
            status: response.status,
            headers: response.headers,
            bytes: new Uint8Array(await response.arrayBuffer()),
          })),
      });
      const status = await rpc.call(platformStatus, {});
      assert(status.ok, status.ok ? "" : JSON.stringify(status.error));
      assertEquals(status.value.ready, true);

      // client의 provider 실패는 실제 core에 닿기 전에 unavailable이다.
      const client = createCoreClient({
        baseUrl: `http://127.0.0.1:${harness.port}`,
        connection: CAC,
        provider: () => Promise.resolve({ ok: false, error: "locked" }),
      });
      const blocked = await client.command(platformStatus as never, {
        input: {},
        idempotency_key: "blocked-1",
      });
      assert(!blocked.ok);
      assertEquals(blocked.error.code, "unavailable");
      assertEquals(blocked.error.details, { reason: "locked" });
    } finally {
      await harness.close();
    }
  },
);
