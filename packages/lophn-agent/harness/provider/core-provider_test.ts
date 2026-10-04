import { assert, assertEquals } from "@std/assert";
import { createCoreHarness } from "../../../../apps/core/testing/core.ts";
import { lophnAgentDefinitions } from "../../../../apps/core/lophn-agent.ts";

// core를 메모리 SQLite로 띄워 API로 입력·출력·오류를 검증한다(T3).
// scope operation은 route name이다(platform executor).

const OPERATIONS = [
  "RegisterProvider",
  "ChangeProvider",
  "RegisterProviderCredential",
  "ChangeProviderCredentials",
  "RefreshProviderCredential",
  "RecordProviderAvailability",
  "RecordProviderCheck",
  "ReadProvider",
  "ListProviders",
  "ListProviderCredentials",
];

const ANTHROPIC_DEFINITION = {
  key: "anthropic",
  display_name: "Anthropic",
  protocols: ["anthropic-messages"],
  auth_kinds: ["api_key"],
  models_endpoint: null,
  oauth: null,
  revision: "2026-01-01",
};

async function post(
  port: number,
  token: string | null,
  resource: string,
  method: string,
  body: unknown,
): Promise<Response> {
  return await fetch(`http://127.0.0.1:${port}/v1/${resource}/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });
}

Deno.test("T3-integration: core API rejects unauthenticated, invalid input and unknown provider", async () => {
  const opened = await createCoreHarness({
    teams: [{ lophnAgentDefinitions }],
    teamModules: [
      new URL("../../../../apps/core/lophn-agent.ts", import.meta.url).href,
    ],
  });
  assert(opened.ok);
  const harness = opened.value;
  try {
    const issued = await harness.credential({
      actor: "user",
      principal: "user-1",
      scope: { operations: OPERATIONS, targets: {} },
      conditions: {},
    });
    assert(issued.ok, issued.ok ? undefined : issued.error.code);
    const { token } = issued.value;

    // 인증 없이는 401이다.
    const anonymous = await post(
      harness.port,
      null,
      "providers",
      "register",
      {},
    );
    assertEquals(anonymous.status, 401);

    // schema 밖 입력은 400 invalid_input이다.
    const invalid = await post(harness.port, token, "providers", "register", {
      input: { id: "not-an-id", name: "x" },
      idempotency_key: "k-1",
      compare: {},
      prepared: [],
    });
    assertEquals(invalid.status, 400);
    const invalidBody = await invalid.json() as { error?: { code?: string } };
    assertEquals(invalidBody.error?.code, "invalid_input");

    // 등록되지 않은 provider에 대한 change는 404 not_found다.
    const missing = await post(harness.port, token, "providers", "change", {
      input: { provider: "pvd_01arz3ndektsv4rrffq69g5fav", enabled: false },
      idempotency_key: "k-2",
      compare: { revision: 1 },
      prepared: [],
    });
    assertEquals(missing.status, 404);
    const missingBody = await missing.json() as { error?: { code?: string } };
    assertEquals(missingBody.error?.code, "not_found");
  } finally {
    await harness.close();
  }
});

Deno.test("T3-integration: registered loopback provider serves read, rejects agent actor", async () => {
  const opened = await createCoreHarness({
    teams: [{ lophnAgentDefinitions }],
    teamModules: [
      new URL("../../../../apps/core/lophn-agent.ts", import.meta.url).href,
    ],
  });
  assert(opened.ok);
  const harness = opened.value;
  try {
    const user = await harness.credential({
      actor: "user",
      principal: "user-1",
      scope: { operations: OPERATIONS, targets: {} },
      conditions: {},
    });
    assert(user.ok);
    const agent = await harness.credential({
      actor: "agent",
      principal: "asg:one",
      scope: { operations: OPERATIONS, targets: {} },
      conditions: {},
    });
    assert(agent.ok);

    // loopback HTTP·인증 없음 정의를 등록한다(R5).
    const registered = await post(
      harness.port,
      user.value.token,
      "providers",
      "register",
      {
        input: {
          id: "pvd_01arz3ndektsv4rrffq69g5fav",
          name: "Ollama loopback",
          definition: {
            key: "ollama",
            display_name: "Ollama",
            protocols: ["openai-chat-completions"],
            auth_kinds: ["none"],
            models_endpoint: null,
            oauth: null,
            revision: "2026-01-01",
          },
          endpoint: "http://127.0.0.1:11434/v1",
          protocol: "openai-chat-completions",
        },
        idempotency_key: "k-1",
        compare: {},
        prepared: [],
      },
    );
    assertEquals(registered.status, 200);
    const registeredBody = await registered.json() as {
      provider?: { revision?: number };
    };
    assertEquals(registeredBody.provider?.revision, 1);

    // user read는 200이다. read body는 등록된 인자 객체 그대로다.
    const read = await post(
      harness.port,
      user.value.token,
      "providers",
      "read",
      {
        provider: "pvd_01arz3ndektsv4rrffq69g5fav",
      },
    );
    assertEquals(read.status, 200);
    const readBody = await read.json() as {
      provider?: { name?: string };
    };
    assertEquals(readBody.provider?.name, "Ollama loopback");

    // user는 두 번 등록할 수 없다(같은 id는 conflict다).
    const duplicate = await post(
      harness.port,
      user.value.token,
      "providers",
      "register",
      {
        input: {
          id: "pvd_01arz3ndektsv4rrffq69g5fav",
          name: "again",
          definition: {
            key: "ollama",
            display_name: "Ollama",
            protocols: ["openai-chat-completions"],
            auth_kinds: ["none"],
            models_endpoint: null,
            oauth: null,
            revision: "2026-01-01",
          },
          endpoint: "http://127.0.0.1:11434/v1",
          protocol: "openai-chat-completions",
        },
        idempotency_key: "k-2",
        compare: {},
        prepared: [],
      },
    );
    assertEquals(duplicate.status, 409);
    const duplicateBody = await duplicate.json() as {
      error?: { code?: string };
    };
    assertEquals(duplicateBody.error?.code, "conflict");

    // register는 user route다. agent actor는 403 forbidden이다.
    const asAgent = await post(
      harness.port,
      agent.value.token,
      "providers",
      "register",
      {
        input: {
          id: "pvd_01arz3ndektsv4rrffq69g5fbv",
          name: "no",
          definition: ANTHROPIC_DEFINITION,
          endpoint: "http://127.0.0.1:8080/v1",
          protocol: "anthropic-messages",
        },
        idempotency_key: "k-3",
        compare: {},
        prepared: [],
      },
    );
    assertEquals(asAgent.status, 403);
    const agentBody = await asAgent.json() as { error?: { code?: string } };
    assertEquals(agentBody.error?.code, "forbidden");
  } finally {
    await harness.close();
  }
});
