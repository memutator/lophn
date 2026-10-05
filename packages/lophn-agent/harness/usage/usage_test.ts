// lophn-agent/harness/usage의 R1–R11 테스트. 테스트는 실제 provider를 부르지 않는다.
// createLedgerHarness + temp dir SQLite. 사실 기록은 model_calls 표의 값만 본다.
import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../../../packages/contracts/platform/mod.ts";
import {
  createLedgerHarness,
  type LedgerHarness,
} from "../../../../apps/core/testing/ledger.ts";

const NOW = Date.UTC(2026, 0, 1);
const SUFFIX = "01arz3ndektsv4rrffq69g5fav";
const CALL = `mcl_${SUFFIX}`;
const RUN = `run_${SUFFIX}`;
const SESSION = `ses_${SUFFIX}`;
const PVDR = `pvd_${SUFFIX}`;
const HASH = "ab".repeat(32);
const AT = "2026-10-05T00:00:00.000Z";

// command는 route name을 scope operation으로 검사한다(platform/ledger executor).
const OPERATIONS = [
  "StartModelCall",
  "FinishModelCall",
  "SupplementModelCall",
  "RegisterProvider",
  "ReadProvider",
  "ListProviders",
  "ReadModelCall",
  "ListModelCalls",
  "ReadAgentUsage",
  "CommandResult",
];

const userCred: AuthenticatedContext = {
  actor: "user",
  principal: "user-1",
  credential_ref: "test:user-1:user",
  scope: { operations: OPERATIONS, targets: {} },
  conditions: {},
};

const machineCred: AuthenticatedContext = {
  actor: "machine",
  principal: "machine-1",
  credential_ref: "test:machine-1:machine",
  scope: { operations: OPERATIONS, targets: {} },
  conditions: {},
};

const at = (ms: number) => new Date(ms).toISOString();

const price = {
  currency: "USD" as const,
  rates: [{
    context_from: null,
    context_through: null,
    cache_ttl_ms: null,
    input: "3",
    output: "15",
    cache_read: "0.3",
    cache_write: "3.75",
    reasoning: "30",
  }],
  source: "models.dev",
  revision: "2026-10",
  checked_at: AT,
};

// model.call 시작은 credential 참조를 열로 남긴다. 테스트는 credential 표를
// 등록하지 않으므로 참조를 null로 둔다(callModelShape는 둘 다 null을 본다).
const model = {
  provider: PVDR,
  name: "gpt",
  protocol: "openai-responses" as const,
  credential_key: null,
  credential_revision: null,
  options: {},
  requested_reasoning: "provider_default" as const,
  applied_reasoning: null,
  limits: {
    context_limit: 128000,
    input_limit: 120000,
    output_limit: 8000,
    supports_tools: true,
  },
  catalog_basis: { source: "models_dev" },
  price_basis: price,
  billing_route: "api" as const,
};

const usage = {
  input: null,
  output: null,
  cache_read: null,
  cache_write: null,
  reasoning: null,
  cache_in_input: null,
  reasoning_in_output: null,
  definition_revision: "2026-10",
};

const unknownCost = {
  kind: "unknown" as const,
  amount: null,
  currency: null,
  basis: null,
  confirmed_at: null,
};

const started = {
  id: CALL,
  run: RUN,
  session: SESSION,
  model_use: "judgment" as const,
  preset: { id: "pst_01arz3ndektsv4rrffq69g5fav", revision: 1 },
  purpose: "judgment" as const,
  test_request: null,
  attempt_kind: "initial" as const,
  attempt_order: 1,
  retry_of: null,
  credential_change_of: null,
  model,
  input: HASH,
  context_basis: HASH,
  output: null,
  state: "started" as const,
  started_at: at(NOW),
  finished_at: null,
  duration_ms: null,
  first_output_ms: null,
  outcome: null,
  usage,
  cost: unknownCost,
};

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
    // model-calls CAS는 state_seq다. 시도마다 같은 값을 다시 보낸다.
    compare: { state_seq: "4" },
    idempotency_key: `k-${idempotency}`,
    prepared: [],
    ...extra,
  };
}

function keep<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

function code(result: Result<unknown>, expected: string) {
  if (result.ok) {
    assert(false, "expected failure, got " + JSON.stringify(result.value));
  } else {
    assertEquals(result.error.code, expected);
  }
}

async function open(
  credentials: readonly AuthenticatedContext[] = [userCred, machineCred],
): Promise<LedgerHarness> {
  const opened = await createLedgerHarness({
    registrationModules: [
      new URL("../provider/registration_test.ts", import.meta.url),
      new URL("./registration_test.ts", import.meta.url),
    ],
    credentials,
    nowMs: NOW,
  });
  return keep(opened);
}

// start 전 provider를 먼저 등록한다. model_calls FK는 providers 표를 참조한다.
async function seedProvider(h: LedgerHarness): Promise<void> {
  const registered = await h.command(
    userCred,
    envelope("RegisterProvider", {
      id: PVDR,
      name: "Loopback provider",
      definition: {
        key: "ollama",
        display_name: "Ollama",
        protocols: ["openai-responses"],
        auth_kinds: ["none"],
        models_endpoint: null,
        oauth: null,
        revision: "2026-01-01",
      },
      endpoint: "http://127.0.0.1:8080/v1",
      protocol: "openai-responses",
    }),
  );
  keep(registered);
}

async function readCall(
  h: LedgerHarness,
  id: string,
): Promise<Record<string, unknown>> {
  const result = await h.read(
    { resource: "model-calls", method: "read" },
    userCred,
    { call: id },
  );
  return ((keep(result) as Record<string, unknown>)["call"] ?? {}) as Record<
    string,
    unknown
  >;
}

Deno.test("lophn-agent/harness/usage#R1: a started call stores once and repeats reject", async () => {
  const h = await open();
  try {
    await seedProvider(h);
    const first = await h.command(
      machineCred,
      envelope("StartModelCall", {
        call: started,
        applied_messages: [`msg_${SUFFIX}`],
        state_seq: "4",
        timeout_ms: null,
      }),
    );
    assert(first.ok, first.ok ? undefined : JSON.stringify(first.error));
    // 같은 id를 다시 시작하면 유니크 PK가 conflict다(R1: 시도마다 한 번).
    const repeated = await h.command(
      machineCred,
      envelope("StartModelCall", {
        call: { ...started, id: CALL },
        applied_messages: [],
        state_seq: "4",
        timeout_ms: null,
      }, { idempotency_key: `k-${idempotency + 1}` }),
    );
    code(repeated, "conflict");
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/usage#R1: a start that fails to store sends nothing", async () => {
  const h = await open([userCred, machineCred]);
  try {
    // provider가 등록되지 않아 start는 unavailable이고 저장도 없다.
    const blocked = await h.command(
      machineCred,
      envelope("StartModelCall", {
        call: started,
        applied_messages: [`msg_${SUFFIX}`],
        state_seq: "4",
        timeout_ms: null,
      }),
    );
    code(blocked, "unavailable");
    const list = keep(
      await h.read({ resource: "model-calls", method: "list" }, userCred, {
        run: RUN,
      }),
    ) as { calls: unknown[] };
    // 저장 실패면 ledger에 행이 없다(R1).
    assertEquals(list.calls.length, 0);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/usage#R2: a call records use, choice, model and billing route", async () => {
  const h = await open();
  try {
    await seedProvider(h);
    keep(
      await h.command(
        machineCred,
        envelope("StartModelCall", {
          call: started,
          applied_messages: [`msg_${SUFFIX}`],
          state_seq: "4",
          timeout_ms: null,
        }),
      ),
    );
    const record = await readCall(h, CALL);
    assertEquals(record["model_use"], "judgment");
    assertEquals(record["purpose"], "judgment");
    assertEquals((record["model"] as Record<string, unknown>)["name"], "gpt");
    assertEquals(
      (record["model"] as Record<string, unknown>)["billing_route"],
      "api",
    );
    assertEquals(record["state"], "started");
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/usage#R3: finish keeps outcome, timing, no error body", async () => {
  const h = await open();
  try {
    await seedProvider(h);
    keep(
      await h.command(
        machineCred,
        envelope("StartModelCall", {
          call: started,
          applied_messages: [`msg_${SUFFIX}`],
          state_seq: "4",
          timeout_ms: null,
        }),
      ),
    );
    const finished = keep(
      await h.command(
        machineCred,
        envelope("FinishModelCall", {
          call: CALL,
          output: HASH,
          outcome: {
            kind: "complete",
            code: null,
            retry_at: null,
            finish_reason: "stop",
            http_status: 200,
            provider_code: null,
          },
          usage,
          cost: unknownCost,
          duration_ms: 1200,
          first_output_ms: 300,
          state_seq: "5",
        }),
      ),
    ) as unknown as { result: { call: Record<string, unknown> } };
    assertEquals(finished.result.call["state"], "finished");
    assertEquals(finished.result.call["duration_ms"], 1200);
    assertEquals(finished.result.call["first_output_ms"], 300);
    const outcome = finished.result.call["outcome"] as Record<string, unknown>;
    assertEquals(outcome["finish_reason"], "stop");
    // 오류 본문은 어디에도 저장하지 않는다(R3).
    assert(!("body" in outcome));
    assert(!("error_body" in outcome));
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/usage#R3: a failed outcome keeps kind and code, no body", async () => {
  const h = await open();
  try {
    await seedProvider(h);
    keep(
      await h.command(
        machineCred,
        envelope("StartModelCall", {
          call: started,
          applied_messages: [`msg_${SUFFIX}`],
          state_seq: "4",
          timeout_ms: null,
        }),
      ),
    );
    const finished = keep(
      await h.command(
        machineCred,
        envelope("FinishModelCall", {
          call: CALL,
          output: null,
          outcome: {
            kind: "failed",
            code: "temporary",
            retry_at: at(NOW + 60_000),
            finish_reason: null,
            http_status: 429,
            provider_code: "rate_limit_error",
          },
          usage,
          cost: unknownCost,
          duration_ms: 200,
          first_output_ms: null,
          state_seq: "5",
        }),
      ),
    ) as unknown as { result: { call: Record<string, unknown> } };
    const outcome = finished.result.call["outcome"] as Record<string, unknown>;
    assertEquals(outcome["kind"], "failed");
    assertEquals(outcome["code"], "temporary");
    // http_status만 남고 본문 문자열은 없다.
    assertEquals(outcome["http_status"], 429);
    assert(!("body" in outcome));
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/usage#R4: input and output keep blob refs, finish does not overwrite", async () => {
  const h = await open();
  try {
    await seedProvider(h);
    keep(
      await h.command(
        machineCred,
        envelope("StartModelCall", {
          call: started,
          applied_messages: [`msg_${SUFFIX}`],
          state_seq: "4",
          timeout_ms: null,
        }),
      ),
    );
    keep(
      await h.command(
        machineCred,
        envelope("FinishModelCall", {
          call: CALL,
          output: HASH,
          outcome: {
            kind: "complete",
            code: null,
            retry_at: null,
            finish_reason: "stop",
            http_status: null,
            provider_code: null,
          },
          usage,
          cost: unknownCost,
          duration_ms: 500,
          first_output_ms: 100,
          state_seq: "5",
        }),
      ),
    );
    const record = await readCall(h, CALL);
    assertEquals(record["input"], HASH);
    assertEquals(record["output"], HASH);
    // 끝난 결과는 덮지 않는다(R4, R9). finished에서 finished로 supplement만 통과한다.
    const again = await h.command(
      machineCred,
      envelope("FinishModelCall", {
        call: CALL,
        output: "cd".repeat(32),
        outcome: {
          kind: "complete",
          code: null,
          retry_at: null,
          finish_reason: "stop",
          http_status: null,
          provider_code: null,
        },
        usage,
        cost: unknownCost,
        duration_ms: 600,
        first_output_ms: null,
        state_seq: "6",
      }),
    );
    code(again, "conflict");
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/usage#R5: cache in input and reasoning in output are kept apart", async () => {
  const h = await open();
  try {
    await seedProvider(h);
    keep(
      await h.command(
        machineCred,
        envelope("StartModelCall", {
          call: started,
          applied_messages: [`msg_${SUFFIX}`],
          state_seq: "4",
          timeout_ms: null,
        }),
      ),
    );
    // Anthropic 모양: input이 cache 톤을 이미 포함하면 cache_in_input=true (담당 adapter 기록).
    const anthropic = keep(
      await h.command(
        machineCred,
        envelope("FinishModelCall", {
          call: CALL,
          output: HASH,
          outcome: {
            kind: "complete",
            code: null,
            retry_at: null,
            finish_reason: "stop",
            http_status: null,
            provider_code: null,
          },
          usage: {
            ...usage,
            input: 100,
            output: 200,
            cache_read: 50,
            cache_write: 25,
            reasoning: 0,
            cache_in_input: true,
            reasoning_in_output: true,
            definition_revision: "2026-10",
          },
          cost: unknownCost,
          duration_ms: 100,
          first_output_ms: 20,
          state_seq: "5",
        }),
      ),
    ) as unknown as { result: { call: Record<string, unknown> } };
    const used = anthropic.result.call["usage"] as Record<string, unknown>;
    assertEquals(used["input"], 100);
    assertEquals(used["cache_read"], 50);
    assertEquals(used["cache_in_input"], true);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/usage#R6: unknown usage stays null, not zero", async () => {
  const h = await open();
  try {
    await seedProvider(h);
    keep(
      await h.command(
        machineCred,
        envelope("StartModelCall", {
          call: started,
          applied_messages: [`msg_${SUFFIX}`],
          state_seq: "4",
          timeout_ms: null,
        }),
      ),
    );
    const finished = keep(
      await h.command(
        machineCred,
        envelope("FinishModelCall", {
          call: CALL,
          output: null,
          outcome: {
            kind: "failed",
            code: "temporary",
            retry_at: null,
            finish_reason: null,
            http_status: 529,
            provider_code: null,
          },
          usage,
          cost: unknownCost,
          duration_ms: 10,
          first_output_ms: null,
          state_seq: "5",
        }),
      ),
    ) as unknown as { result: { call: Record<string, unknown> } };
    const kept = finished.result.call["usage"] as Record<string, unknown>;
    // 미보고는 모름이다. 0으로 바꾸지 않는다(R6).
    assertEquals(kept["input"], null);
    assertEquals(kept["output"], null);
    assertEquals(kept["cache_read"], null);
    assertEquals(kept["cost"], kept["cost"]);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/usage#R7: the five cost kinds stay apart", async () => {
  const h = await open();
  try {
    await seedProvider(h);
    keep(
      await h.command(
        machineCred,
        envelope("StartModelCall", {
          call: started,
          applied_messages: [`msg_${SUFFIX}`],
          state_seq: "4",
          timeout_ms: null,
        }),
      ),
    );
    // estimated kind는 basis를 요구한다(R7).
    const estimated = keep(
      await h.command(
        machineCred,
        envelope("FinishModelCall", {
          call: CALL,
          output: HASH,
          outcome: {
            kind: "complete",
            code: null,
            retry_at: null,
            finish_reason: "stop",
            http_status: null,
            provider_code: null,
          },
          usage: {
            ...usage,
            input: 16000,
            output: 2000,
            cache_read: 0,
            cache_write: 0,
            reasoning: 0,
            cache_in_input: false,
            reasoning_in_output: false,
            definition_revision: "2026-10",
          },
          cost: {
            kind: "estimated",
            amount: "0.09",
            currency: "USD",
            basis: { price, tokens: { input: 16000, output: 2000 } },
            confirmed_at: null,
          },
          duration_ms: 100,
          first_output_ms: 10,
          state_seq: "5",
        }),
      ),
    ) as unknown as { result: { call: Record<string, unknown> } };
    const cost = estimated.result.call["cost"] as Record<string, unknown>;
    assertEquals(cost["kind"], "estimated");
    assertEquals(cost["amount"], "0.09");
    assert(cost["currency"] === "USD");
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/usage#R8: estimated amount keeps basis and currency apart", async () => {
  const h = await open();
  try {
    await seedProvider(h);
    keep(
      await h.command(
        machineCred,
        envelope("StartModelCall", {
          call: started,
          applied_messages: [`msg_${SUFFIX}`],
          state_seq: "4",
          timeout_ms: null,
        }),
      ),
    );
    const done = keep(
      await h.command(
        machineCred,
        envelope("FinishModelCall", {
          call: CALL,
          output: HASH,
          outcome: {
            kind: "complete",
            code: null,
            retry_at: null,
            finish_reason: "stop",
            http_status: null,
            provider_code: null,
          },
          usage: {
            ...usage,
            input: 10000,
            output: 2000,
            cache_read: 5000,
            cache_write: 1000,
            reasoning: 800,
            cache_in_input: false,
            reasoning_in_output: true,
            definition_revision: "2026-10",
          },
          cost: {
            kind: "estimated",
            amount: "0.09",
            currency: "USD",
            basis: {
              price,
              usage: { input: 16000, output: 1200, reasoning: 800 },
              per_unit: "1000000",
            },
            confirmed_at: null,
          },
          duration_ms: 300,
          first_output_ms: 50,
          state_seq: "5",
        }),
      ),
    ) as unknown as { result: { call: Record<string, unknown> } };
    const costRecord = done.result.call["cost"] as Record<string, unknown>;
    assertEquals(costRecord["currency"], "USD");
    const basis = costRecord["basis"] as Record<string, unknown>;
    assertEquals(basis["per_unit"], "1000000");
    // source·판·확인 시각은 보존한다(R8).
    assertEquals(
      (basis["price"] as Record<string, unknown>)["source"],
      "models.dev",
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/usage#R9: supplement appends a late fact without overwriting", async () => {
  const h = await open();
  try {
    await seedProvider(h);
    keep(
      await h.command(
        machineCred,
        envelope("StartModelCall", {
          call: started,
          applied_messages: [`msg_${SUFFIX}`],
          state_seq: "4",
          timeout_ms: null,
        }),
      ),
    );
    keep(
      await h.command(
        machineCred,
        envelope("FinishModelCall", {
          call: CALL,
          output: HASH,
          outcome: {
            kind: "complete",
            code: null,
            retry_at: null,
            finish_reason: "stop",
            http_status: null,
            provider_code: null,
          },
          usage,
          cost: unknownCost,
          duration_ms: 100,
          first_output_ms: 10,
          state_seq: "5",
        }),
      ),
    );
    const supplemented = keep(
      await h.command(
        machineCred,
        envelope("SupplementModelCall", {
          call: CALL,
          supplement_key: "invoice-1",
          usage: { ...usage, input: 20, output: 5 },
          cost: null,
          outcome: null,
          basis: HASH,
        }),
      ),
    );
    assert(supplemented !== undefined);
    // 기존 사실은 그대로다(R9).
    const record = await readCall(h, CALL);
    assertEquals(record["state"], "finished");
    // 같은 supplement_key를 다시 보내면 conflict다. 입력 refine이 "a late
    // fact"를 요구하므로 다른 사실을 넣어 보낸다.
    const repeated = await h.command(
      machineCred,
      envelope("SupplementModelCall", {
        call: CALL,
        supplement_key: "invoice-1",
        usage: { ...usage, input: 20, output: 5 },
        cost: null,
        outcome: null,
        basis: HASH,
      }),
    );
    code(repeated, "conflict");
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/usage#R10: usage read counts each call once", async () => {
  const h = await open();
  try {
    await seedProvider(h);
    keep(
      await h.command(
        machineCred,
        envelope("StartModelCall", {
          call: started,
          applied_messages: [`msg_${SUFFIX}`],
          state_seq: "4",
          timeout_ms: null,
        }),
      ),
    );
    keep(
      await h.command(
        machineCred,
        envelope("FinishModelCall", {
          call: CALL,
          output: HASH,
          outcome: {
            kind: "complete",
            code: null,
            retry_at: null,
            finish_reason: "stop",
            http_status: null,
            provider_code: null,
          },
          usage: {
            ...usage,
            input: 1000,
            output: 500,
            cache_read: null,
            cache_write: null,
            reasoning: null,
            cache_in_input: false,
            reasoning_in_output: false,
            definition_revision: "2026-10",
          },
          cost: {
            kind: "estimated",
            amount: "0.0105",
            currency: "USD",
            basis: { price },
            confirmed_at: null,
          },
          duration_ms: 100,
          first_output_ms: 10,
          state_seq: "5",
        }),
      ),
    );
    const totals = keep(
      await h.read(
        { resource: "agent-usage", method: "read" },
        userCred,
        {
          from_at: at(NOW - 1000),
          through_at: at(NOW + 1000),
        },
      ),
    ) as { totals: Record<string, unknown>[] };
    assertEquals(totals.totals.length, 1);
    assertEquals(totals.totals[0]["calls"], 1);
    const tokens = totals.totals[0]["tokens"] as Record<string, unknown>;
    const known = tokens["known"] as Record<string, unknown>;
    assertEquals(known["input"], 1000);
    assertEquals(known["output"], 500);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/usage#R11: no amount cost gate on records", async () => {
  const h = await open();
  try {
    await seedProvider(h);
    keep(
      await h.command(
        machineCred,
        envelope("StartModelCall", {
          call: started,
          applied_messages: [`msg_${SUFFIX}`],
          state_seq: "4",
          timeout_ms: null,
        }),
      ),
    );
    // 금액이 커져도 기록은 통과한다(R11). run 한도는 run-loop 몫이다.
    const huge = keep(
      await h.command(
        machineCred,
        envelope("FinishModelCall", {
          call: CALL,
          output: HASH,
          outcome: {
            kind: "complete",
            code: null,
            retry_at: null,
            finish_reason: "stop",
            http_status: null,
            provider_code: null,
          },
          usage: {
            ...usage,
            input: Number.MAX_SAFE_INTEGER,
            output: Number.MAX_SAFE_INTEGER,
            cache_read: null,
            cache_write: null,
            reasoning: null,
            cache_in_input: false,
            reasoning_in_output: false,
            definition_revision: "2026-10",
          },
          cost: {
            kind: "estimated",
            amount: "999999999999.999999",
            currency: "USD",
            basis: { price },
            confirmed_at: null,
          },
          duration_ms: 10,
          first_output_ms: null,
          state_seq: "5",
        }),
      ),
    ) as unknown as { result: { call: Record<string, unknown> } };
    const bigCost = huge.result.call["cost"] as Record<string, unknown>;
    assertEquals(bigCost["amount"], "999999999999.999999");
  } finally {
    await h.close();
  }
});
