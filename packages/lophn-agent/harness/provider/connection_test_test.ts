// lophn-agent/harness/provider#R29, R30: 명시 연결 test. 실제 ledger(temp SQLite)와
// 실제 HTTP(fake provider)로 돈다. 실제 provider·사람 data root는 쓰지 않는다.
import { assert, assertEquals } from "@std/assert";
import { canonicalize, ok, type Result, sha256Hex } from "../../../base/mod.ts";
import type {
  CallModel,
  ModelCallRecord,
  ProviderRecord,
} from "../../../contracts/lophn-agent/mod.ts";
import type {
  AuthenticatedContext,
  SecretSendInput,
} from "../../../contracts/platform/mod.ts";
import {
  createLedgerHarness,
  type LedgerHarness,
} from "../../../../apps/core/testing/ledger.ts";
import { startFakeProvider } from "../../../../tools/fake-provider/mod.ts";
import type { Step } from "../../../../tools/fake-provider/types.ts";
import {
  createAuthTransport,
  type SecretAttachLike,
} from "./adapters/auth-transport.ts";
import { createFetchTransport } from "./adapters/transport.ts";
import { createInvokeModelCall } from "./invoke.ts";
import {
  type ConnectionTestPort,
  type InvokeModelCall,
  runConnectionTest,
  TEST_TOOL_NAME,
} from "./work.ts";

const NOW = Date.UTC(2026, 0, 1);
const PVDR = "pvd_01arz3ndektsv4rrffq69g5fav";
const KEY = "sk-test-secret-value";

const OPERATIONS = [
  "RegisterProvider",
  "RegisterProviderCredential",
  "RecordProviderAvailability",
  "RecordProviderCheck",
  "ReadProvider",
  "ListProviders",
  "StartModelCall",
  "FinishModelCall",
  "ReadModelCall",
  "ListModelCalls",
  "CommandResult",
];

function cred(actor: "user" | "machine"): AuthenticatedContext {
  return {
    actor,
    principal: `${actor}-1`,
    credential_ref: `test:${actor}-1:${actor}`,
    scope: { operations: OPERATIONS, targets: {} },
    conditions: {},
  };
}
const userCred = cred("user");
const machineCred = cred("machine");

let idempotency = 0;
function envelope(
  command: string,
  input: unknown,
  extra: Record<string, unknown> = {},
) {
  idempotency++;
  return {
    command,
    input,
    compare: {},
    idempotency_key: `k-${idempotency}`,
    prepared: [],
    ...extra,
  };
}

function keep<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

const PREPARATION = {
  preparation: "prep_test_credential",
  sealed_ref: "seal_test_credential",
  purpose: "provider_credential",
  owner: "user-1",
};

const DEFINITIONS = {
  "anthropic-messages": {
    key: "anthropic",
    display_name: "Anthropic",
    protocols: ["anthropic-messages"],
    auth_kinds: ["api_key"],
    models_endpoint: null,
    oauth: null,
    revision: "2026-01-01",
  },
  "openai-responses": {
    key: "openai",
    display_name: "OpenAI",
    protocols: ["openai-responses", "openai-chat-completions"],
    auth_kinds: ["api_key"],
    models_endpoint: null,
    oauth: null,
    revision: "2026-01-01",
  },
  "openai-chat-completions": {
    key: "openai",
    display_name: "OpenAI",
    protocols: ["openai-responses", "openai-chat-completions"],
    auth_kinds: ["api_key"],
    models_endpoint: null,
    oauth: null,
    revision: "2026-01-01",
  },
} as const;

type Protocol = keyof typeof DEFINITIONS;
const FAKE = {
  "anthropic-messages": "messages",
  "openai-responses": "responses",
  "openai-chat-completions": "chat_completions",
} as const;

async function openLedger(): Promise<LedgerHarness> {
  return keep(
    await createLedgerHarness({
      registrationModules: [
        new URL("./registration_test.ts", import.meta.url),
        new URL("../usage/registration_test.ts", import.meta.url),
      ],
      credentials: [userCred, machineCred],
      nowMs: NOW,
    }),
  );
}

async function readProvider(h: LedgerHarness): Promise<ProviderRecord> {
  const read = keep(
    await h.read({ resource: "providers", method: "read" }, userCred, {
      provider: PVDR,
    }),
  ) as { provider: ProviderRecord };
  return read.provider;
}

async function register(
  h: LedgerHarness,
  protocol: Protocol,
  endpoint: string,
): Promise<void> {
  keep(
    await h.command(
      userCred,
      envelope("RegisterProvider", {
        id: PVDR,
        name: "Fake",
        definition: DEFINITIONS[protocol],
        endpoint,
        protocol,
      }),
    ),
  );
  const bound = { provider: PVDR, key: "key-a", preparation: PREPARATION };
  const content = await sha256Hex(canonicalize(bound));
  const issued = keep(
    await h.confirmation({
      action: "issue",
      request: {
        type: "confirmation_handle_register",
        window_id: "win-1",
        target_ref: PVDR,
        content_hash: content,
        allowed_decisions: ["RegisterProviderCredential"],
        expires_at: new Date(NOW + 600_000).toISOString(),
      },
    }),
  ) as { confirmation: string };
  keep(
    await h.command(
      userCred,
      envelope("RegisterProviderCredential", {
        provider: PVDR,
        key: "key-a",
        kind: "api_key",
        label: "main",
        preparation: PREPARATION,
        account: null,
        organization: null,
        plan: null,
        dedup_fingerprint: "a".repeat(64),
      }, { confirmation: issued.confirmation, compare: { revision: 1 } }),
    ),
  );
}

function portFor(h: LedgerHarness, protocol: Protocol): ConnectionTestPort {
  return {
    readProvider: async (id) => {
      assertEquals(id, PVDR);
      return ok(await readProvider(h));
    },
    resolveModel: (
      provider,
      credential,
      modelName,
    ): Promise<Result<CallModel>> =>
      Promise.resolve(ok({
        provider: provider.id,
        name: modelName,
        protocol,
        credential_key: credential.key,
        credential_revision: credential.revision,
        options: {},
        option_values: { requested: {}, applied: {} },
        limits: {
          context_limit: 1000,
          input_limit: 900,
          output_limit: 100,
          supports_tools: true,
        },
        catalog_basis: {},
        price_basis: null,
        billing_route: "api",
      })),
    startCall: async (call: ModelCallRecord) => {
      const done = await h.command(
        machineCred,
        envelope("StartModelCall", {
          call,
          applied_messages: [],
          state_seq: "4",
          timeout_ms: 30_000,
        }, { compare: { state_seq: "4" } }),
      );
      return done.ok ? ok(undefined) : done;
    },
    finishCall: async (input) => {
      const done = await h.command(
        machineCred,
        envelope("FinishModelCall", { ...input, state_seq: "5" }, {
          compare: { state_seq: "4" },
        }),
      );
      return done.ok ? ok(undefined) : done;
    },
    recordAvailability: async (provider, key, change) => {
      const current = await readProvider(h);
      const done = await h.command(
        machineCred,
        envelope("RecordProviderAvailability", { provider, key, ...change }, {
          compare: { revision: current.revision },
        }),
      );
      return done.ok ? ok(undefined) : done;
    },
    recordCheck: async (provider, check) => {
      const current = await readProvider(h);
      const done = await h.command(
        machineCred,
        envelope("RecordProviderCheck", { provider, check }, {
          compare: { revision: current.revision },
        }),
      );
      return done.ok ? ok(undefined) : done;
    },
  };
}

const attach: SecretAttachLike = {
  send: async (_input, transmit) => await transmit(KEY),
};

function realInvoke(protocol: Protocol): InvokeModelCall {
  return createInvokeModelCall({
    transport: createAuthTransport({
      attach,
      transport: createFetchTransport(),
      context: {} as SecretSendInput["context"],
      use: {} as SecretSendInput["use"],
      operation: "connection.test",
      headerName: protocol === "anthropic-messages"
        ? "x-api-key"
        : "authorization",
      kind: protocol === "anthropic-messages" ? "api_key" : "bearer",
    }),
    nowMs: () => NOW,
    at: (ms) => new Date(ms).toISOString(),
  });
}

let callSeq = 0;
function setup(
  h: LedgerHarness,
  protocol: Protocol,
  invoke: InvokeModelCall = realInvoke(protocol),
) {
  return {
    port: portFor(h, protocol),
    invoke,
    nowMs: () => NOW,
    newCallId: () =>
      `mcl_01arz3ndektsv4rrffq69g5f${String(++callSeq).padStart(2, "0")}`,
    at: (ms: number) => new Date(ms).toISOString(),
  };
}

const INPUT = {
  provider: PVDR,
  credential_key: "key-a",
  model_name: "fixture-model",
  test_kind: "text" as const,
  command_key: "test-1",
};

let stepSeq = 0;
function ok200(protocol: Protocol, reply: Step["reply"]): Step {
  return { id: `r${++stepSeq}`, protocol: FAKE[protocol], reply };
}
function fail(protocol: Protocol, status: number, body: unknown): Step {
  return {
    id: "r",
    protocol: FAKE[protocol],
    response: {
      status,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  };
}

async function withFake(
  protocol: Protocol,
  steps: Step[],
  body: (
    h: LedgerHarness,
    fake: ReturnType<typeof startFakeProvider>,
  ) => Promise<void>,
) {
  const fake = startFakeProvider({
    script: { steps },
    nowMs: () => NOW,
    instant: true,
  });
  const h = await openLedger();
  try {
    await register(h, protocol, fake.url);
    await body(h, fake);
  } finally {
    await h.close();
    await fake.close();
  }
}

async function readCall(h: LedgerHarness, id: string) {
  const read = keep(
    await h.read({ resource: "model-calls", method: "read" }, userCred, {
      call: id,
    }),
  ) as { call: ModelCallRecord };
  return read.call;
}

for (const protocol of Object.keys(DEFINITIONS) as Protocol[]) {
  Deno.test(`lophn-agent/harness/provider#R29: ${protocol} 명시 텍스트 test는 고정 재료만 한 번 보내고 사용량을 기록한다`, async () => {
    await withFake(
      protocol,
      [ok200(protocol, { text: "ok", usage: { input: 5, output: 2 } })],
      async (h, fake) => {
        const result = keep(
          await runConnectionTest(
            setup(h, protocol),
            INPUT,
            new AbortController().signal,
          ),
        );
        assertEquals(result.check?.result, "success");
        assertEquals(result.check?.test_kind, "text");
        assertEquals(result.check?.command_key, "test-1");
        assertEquals(fake.requests().length, 1);
        // 재료는 고정 문구뿐이다. 세션·문서·사용자 입력이 없다(R29).
        const sent = JSON.stringify(fake.requests()[0].body);
        assert(sent.includes("Reply with the single word: ok"));
        // 호출 기록: connection_test, run·세션 없음, 사용량 남김(R30).
        const calls = result.check!.calls;
        assertEquals(calls.length, 1);
        const record = await readCall(h, calls[0]);
        assertEquals(record.purpose, "connection_test");
        assertEquals(record.run, null);
        assertEquals(record.session, null);
        assertEquals(record.agent_hash, null);
        assertEquals(record.test_request, {
          command_key: "test-1",
          test_kind: "text",
        });
        assertEquals(record.state, "finished");
        assertEquals(record.usage.output, 2);
        // 마지막 check는 provider 기록에 남는다.
        assertEquals((await readProvider(h)).last_check?.result, "success");
      },
    );
  });
}

Deno.test("lophn-agent/harness/provider#R29: tool_call test는 probe tool 호출이 있어야 성공이다", async () => {
  const protocol: Protocol = "openai-chat-completions";
  await withFake(
    protocol,
    [
      ok200(protocol, {
        toolCalls: [{
          id: "call_1",
          name: TEST_TOOL_NAME,
          arguments: '{"ping":true}',
        }],
      }),
      ok200(protocol, {
        toolCalls: [{ id: "call_2", name: "other_tool", arguments: "{}" }],
      }),
    ],
    async (h, fake) => {
      const first = keep(
        await runConnectionTest(
          setup(h, protocol),
          { ...INPUT, test_kind: "tool_call", command_key: "t-a" },
          new AbortController().signal,
        ),
      );
      assertEquals(first.check?.result, "success");
      const body = JSON.stringify(fake.requests()[0].body);
      assert(body.includes(TEST_TOOL_NAME));
      const second = keep(
        await runConnectionTest(
          setup(h, protocol),
          { ...INPUT, test_kind: "tool_call", command_key: "t-b" },
          new AbortController().signal,
        ),
      );
      assertEquals(second.check?.result, "failure");
      assertEquals(second.check?.code, "unknown");
    },
  );
});

Deno.test("lophn-agent/harness/provider#R29: 설정 조회·목록 읽기만으로는 test 요청이 나가지 않는다", async () => {
  const protocol: Protocol = "openai-responses";
  await withFake(protocol, [], async (h, fake) => {
    await readProvider(h);
    keep(await h.read({ resource: "providers", method: "list" }, userCred, {}));
    assertEquals(fake.requests().length, 0);
    assertEquals((await readProvider(h)).last_check, null);
  });
});

Deno.test("lophn-agent/harness/provider#R30: 한 시도는 30초 상한이고 기한을 넘기면 끝낸다", async () => {
  const protocol: Protocol = "openai-chat-completions";
  const hold: Step = {
    id: "hold",
    protocol: FAKE[protocol],
    response: {
      status: 200,
      headers: { "content-type": "text/event-stream" },
      chunks: [],
      end: "hold",
    },
  };
  await withFake(protocol, [hold], async (h) => {
    const inner = realInvoke(protocol);
    const seen: (number | null)[] = [];
    // 계약의 30초를 그대로 받았는지 보고, 시험 시간을 위해 짧게 줄여 위임한다.
    const spy: InvokeModelCall = (input, signal) => {
      seen.push(input.timeoutMs);
      return inner({ ...input, timeoutMs: 200 }, signal);
    };
    const result = keep(
      await runConnectionTest(
        setup(h, protocol, spy),
        INPUT,
        new AbortController().signal,
      ),
    );
    assertEquals(seen, [30_000]);
    assertEquals(result.check?.result, "failure");
    assertEquals(result.check?.code, "temporary");
    // 실패한 시도도 호출 기록은 닫힌다(R30).
    const record = await readCall(h, result.check!.calls[0]);
    assertEquals(record.state, "finished");
  });
});

Deno.test("lophn-agent/harness/provider#R30: 사용량 대기 credential은 보내지 않는다(유일한 credential이어도)", async () => {
  const protocol: Protocol = "openai-responses";
  await withFake(protocol, [], async (h, fake) => {
    const provider = await readProvider(h);
    keep(
      await h.command(
        machineCred,
        envelope("RecordProviderAvailability", {
          provider: PVDR,
          key: "key-a",
          state: "usage_wait",
          unavailable_reason: "quota",
          until: new Date(NOW + 3_600_000).toISOString(),
          model_block: null,
        }, { compare: { revision: provider.revision } }),
      ),
    );
    const result = keep(
      await runConnectionTest(
        setup(h, protocol),
        INPUT,
        new AbortController().signal,
      ),
    );
    assertEquals(result.check, null);
    assertEquals(fake.requests().length, 0);
  });
});

Deno.test("lophn-agent/harness/provider#R21: 인증 거절 test는 credential을 rejected로 남기고 check는 credential_unavailable이다", async () => {
  const protocol: Protocol = "anthropic-messages";
  await withFake(
    protocol,
    [fail(protocol, 401, {
      type: "error",
      error: { type: "authentication_error", message: "x" },
    })],
    async (h) => {
      const result = keep(
        await runConnectionTest(
          setup(h, protocol),
          INPUT,
          new AbortController().signal,
        ),
      );
      assertEquals(result.check?.code, "credential_unavailable");
      const credential = (await readProvider(h)).credentials[0];
      assertEquals(credential.state, "rejected");
      assertEquals(credential.unavailable_reason, "authentication");
    },
  );
});

Deno.test("lophn-agent/harness/provider#R22: model 없음 test는 그 model만 막고 credential은 available로 남는다", async () => {
  const protocol: Protocol = "openai-responses";
  await withFake(
    protocol,
    [fail(protocol, 404, { error: { code: "model_not_found" } })],
    async (h) => {
      const result = keep(
        await runConnectionTest(
          setup(h, protocol),
          INPUT,
          new AbortController().signal,
        ),
      );
      assertEquals(result.check?.code, "model_unavailable");
      const credential = (await readProvider(h)).credentials[0];
      assertEquals(credential.state, "available");
      assertEquals(credential.model_blocks.map((b) => b.model_name), [
        "fixture-model",
      ]);
    },
  );
});

Deno.test("lophn-agent/harness/provider#R24: usage_wait 429 test는 reset 시각까지 대기 상태를 남긴다", async () => {
  const protocol: Protocol = "openai-chat-completions";
  const step: Step = {
    id: "r",
    protocol: FAKE[protocol],
    response: {
      status: 429,
      headers: { "content-type": "application/json", "retry-after": "600" },
      body: "{}",
    },
  };
  await withFake(protocol, [step], async (h) => {
    keep(
      await runConnectionTest(
        setup(h, protocol),
        INPUT,
        new AbortController().signal,
      ),
    );
    const credential = (await readProvider(h)).credentials[0];
    assertEquals(credential.state, "usage_wait");
    assertEquals(credential.until, new Date(NOW + 600_000).toISOString());
  });
});
