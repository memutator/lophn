// lophn-agent/harness/usage의 R1–R11 테스트. 테스트는 실제 provider를 부르지 않는다.
// createLedgerHarness + temp dir SQLite. 사실 기록은 model_calls 표의 값만 본다.
import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../../../packages/contracts/platform/mod.ts";
import {
  createLedgerHarness,
  type LedgerHarness,
} from "../../../../apps/core/testing/ledger.ts";
import { callFromRow } from "./model.ts";
import type { ModelCallRecord } from "../../../../packages/contracts/lophn-agent/mod.ts";
import { buildTotals } from "./work.ts";

const NOW = Date.UTC(2026, 0, 1);
const SUFFIX = "01arz3ndektsv4rrffq69g5fav";
const CALL = `mcl_${SUFFIX}`;
const CALL2 = "mcl_01arz3ndektsv4rrffq69g5fax";
const RUN = `run_${SUFFIX}`;
const RECEIVER_RUN = "run_01arz3ndektsv4rrffq69g5fax";
const SENDER_RUN = "run_0harz3ndektsv4rrffq69g5fbz";
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
  credential_revision: null,
  options: {},
  option_values: { requested: {}, applied: {} },
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
  agent_hash: "ab".repeat(32),
  purpose: "judgment" as const,
  attempt_kind: "initial" as const,
  attempt_order: 1,
  retry_of: null,
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
    // model-calls CAS는 state_seq다. 시작은 판 순번 4를 선언하고 저장한다.
    // 마침은 저장된 5로 보완 기준이 바뀌므로, 끝난 뒤 보완은 extra에서 5를 보낸다.
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
        key: "my-local",
        display_name: "My local",
        protocols: ["openai-responses"],
        auth_kinds: ["none"],
        models_endpoint: null,
        oauth: null,
        revision: "2026-01-01",
      },
      endpoint: "http://127.0.0.1:8080/v1",
      protocol: "openai-responses",
      credential: { kind: "none", preparation: null },
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

// 시작 기록을 저장하고 완료까지 옮긴다. usage·cost는 호출마다 다르게 쓴다.
async function startCall(
  h: LedgerHarness,
  call: Record<string, unknown>,
): Promise<void> {
  keep(
    await h.command(
      machineCred,
      envelope("StartModelCall", {
        call,
        applied_messages: [],
        state_seq: "4",
      }),
    ),
  );
}

async function readUsage(
  h: LedgerHarness,
  input: Record<string, unknown>,
): Promise<UsageTotalLike[]> {
  const read = keep(
    await h.read({ resource: "agent-usage", method: "read" }, userCred, input),
  ) as { totals: UsageTotalLike[] };
  return read.totals;
}

Deno.test("lophn-agent/harness/usage#R1: a started call stores once and repeats reject", async () => {
  const h = await open();
  try {
    await seedProvider(h);
    const first = await h.command(
      machineCred,
      envelope("StartModelCall", {
        call: started,
        applied_messages: [],
        state_seq: "4",
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
      }, { idempotency_key: `k-${idempotency + 1}` }),
    );
    code(repeated, "conflict");
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/usage#R1: retry attempts are one record each", async () => {
  const h = await open();
  try {
    await seedProvider(h);
    keep(
      await h.command(
        machineCred,
        envelope("StartModelCall", {
          call: started,
          applied_messages: [],
          state_seq: "4",
        }),
      ),
    );
    keep(
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
          duration_ms: 50,
          first_output_ms: null,
          state_seq: "5",
        }),
      ),
    );
    // retry attempt는 새 기록이다(retry_of가 이전 기록을 참조한다).
    const retry = {
      ...started,
      id: CALL2,
      attempt_kind: "retry" as const,
      attempt_order: 2,
      retry_of: CALL,
    };
    keep(
      await h.command(
        machineCred,
        envelope("StartModelCall", {
          call: retry,
          applied_messages: [],
          state_seq: "4",
        }),
      ),
    );
    const record = await readCall(h, CALL2);
    assertEquals(record["attempt_kind"], "retry");
    assertEquals(record["retry_of"], CALL);
    // 같은 retry 기록을 다시 시작하면 conflict다.
    const repeated = await h.command(
      machineCred,
      envelope("StartModelCall", {
        call: retry,
        applied_messages: [],
        state_seq: "4",
      }),
    );
    code(repeated, "conflict");
    const list = keep(
      await h.read({ resource: "model-calls", method: "list" }, userCred, {
        run: RUN,
      }),
    ) as { calls: { id: string }[] };
    assertEquals(list.calls.length, 2);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/usage#R1: a call after a credential failure is a new record, never a move to another credential", async () => {
  const h = await open();
  try {
    await seedProvider(h);
    keep(
      await h.command(
        machineCred,
        envelope("StartModelCall", {
          call: started,
          applied_messages: [],
          state_seq: "4",
        }),
      ),
    );
    keep(
      await h.command(
        machineCred,
        envelope("FinishModelCall", {
          call: CALL,
          output: null,
          outcome: {
            kind: "failed",
            code: "credential_unavailable",
            retry_at: null,
            finish_reason: null,
            http_status: 401,
            provider_code: null,
          },
          usage,
          cost: unknownCost,
          duration_ms: 30,
          first_output_ms: null,
          state_seq: "5",
        }),
      ),
    );
    // 같은 provider의 retry도 새 기록이다. 다른 credential로 옮기는 시도는 없다.
    const retried = {
      ...started,
      id: CALL2,
      attempt_kind: "retry" as const,
      attempt_order: 2,
      retry_of: CALL,
    };
    keep(
      await h.command(
        machineCred,
        envelope("StartModelCall", {
          call: retried,
          applied_messages: [],
          state_seq: "4",
        }),
      ),
    );
    const record = await readCall(h, CALL2);
    assertEquals(record["attempt_kind"], "retry");
    assertEquals(record["retry_of"], CALL);
    assertEquals("credential_change_of" in record, false);
    assertEquals("credential_key" in (record["model"] as object), false);
    const list = keep(
      await h.read({ resource: "model-calls", method: "list" }, userCred, {
        run: RUN,
      }),
    ) as { calls: { id: string }[] };
    assertEquals(list.calls.length, 2);
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
        applied_messages: [],
        state_seq: "4",
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

Deno.test("lophn-agent/harness/usage#R2 [agent-I10b]: a call records use, agent hash, choice, option values, model and billing route", async () => {
  const h = await open();
  try {
    await seedProvider(h);
    const optionValues = {
      requested: { effort: "very_high" },
      applied: { effort: "high" },
    };
    keep(
      await h.command(
        machineCred,
        envelope("StartModelCall", {
          call: {
            ...started,
            model: { ...model, option_values: optionValues },
          },
          applied_messages: [],
          state_seq: "4",
        }),
      ),
    );
    const record = await readCall(h, CALL);
    assertEquals(record["model_use"], "judgment");
    assertEquals(record["agent_hash"], "ab".repeat(32));
    assertEquals("preset" in record, false);
    assertEquals(record["purpose"], "judgment");
    assertEquals((record["model"] as Record<string, unknown>)["name"], "gpt");
    assertEquals(
      (record["model"] as Record<string, unknown>)["option_values"],
      optionValues,
    );
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
          applied_messages: [],
          state_seq: "4",
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
          applied_messages: [],
          state_seq: "4",
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
          applied_messages: [],
          state_seq: "4",
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
          applied_messages: [],
          state_seq: "4",
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
          applied_messages: [],
          state_seq: "4",
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
    // unknown 비용은 call 본문에 붙는다(R6).
    assertEquals(finished.result.call["cost"], unknownCost);
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
          applied_messages: [],
          state_seq: "4",
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
          applied_messages: [],
          state_seq: "4",
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
          applied_messages: [],
          state_seq: "4",
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
        }, { compare: { state_seq: "5" } }),
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
      }, { compare: { state_seq: "5" } }),
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
          applied_messages: [],
          state_seq: "4",
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
          applied_messages: [],
          state_seq: "4",
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

Deno.test("lophn-agent/harness/usage#R2: supplement CAS rejects a stale state_seq", async () => {
  const h = await open();
  try {
    await seedProvider(h);
    keep(
      await h.command(
        machineCred,
        envelope("StartModelCall", {
          call: started,
          applied_messages: [],
          state_seq: "4",
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
    // 보완도 state_seq CAS를 본다. 잘못된 기준은 conflict다.
    const stale = await h.command(
      machineCred,
      envelope("SupplementModelCall", {
        call: CALL,
        supplement_key: "invoice-1",
        usage: { ...usage, input: 20, output: 5 },
        cost: null,
        outcome: null,
        basis: HASH,
      }, { compare: { state_seq: "9" } }),
    );
    code(stale, "conflict");
    // 관문을 통과한 기준은 통과한다.
    keep(
      await h.command(
        machineCred,
        envelope("SupplementModelCall", {
          call: CALL,
          supplement_key: "invoice-1",
          usage: { ...usage, input: 20, output: 5 },
          cost: null,
          outcome: null,
          basis: HASH,
        }, { compare: { state_seq: "5" } }),
      ),
    );
    const record = await readCall(h, CALL);
    assertEquals(record["state"], "finished");
  } finally {
    await h.close();
  }
});

type UsageTotalLike = {
  group: Record<string, unknown>;
  calls: number;
  tokens: { known: Record<string, unknown>; unknown_calls: number };
  costs: Record<string, unknown>[];
  missing_records: number;
  complete: boolean;
};

async function readRows(h: LedgerHarness): Promise<ModelCallRecord[]> {
  const rows = (await h.inspect(
    `select id, run, session, model_use, agent_hash, purpose,
       attempt_kind, attempt_order, retry_of,
       provider, credential_revision, model_name, protocol,
       call_model, input, context_basis, output, state, state_seq,
       started_at, finished_at, duration_ms, first_output_ms, outcome,
       usage, cost
     from model_calls order by id`,
    [],
  )) as { ok: boolean; value?: Record<string, unknown>[] };
  assert(rows.ok);
  return (rows.value ?? []).map((row) => callFromRow(row as never));
}

Deno.test("lophn-agent/harness/usage#R10: rebuild gives the same totals", async () => {
  const h = await open();
  try {
    await seedProvider(h);
    keep(
      await h.command(
        machineCred,
        envelope("StartModelCall", {
          call: started,
          applied_messages: [],
          state_seq: "4",
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
    // read handler의 합계. derived 재생성은 같은 값이어야 한다(plan 마지막 줄).
    const read = keep(
      await h.read(
        { resource: "agent-usage", method: "read" },
        userCred,
        {
          from_at: at(NOW - 1000),
          through_at: at(NOW + 1000),
        },
      ),
    ) as { totals: UsageTotalLike[] };
    // ledger 행을 ModelCallRecord로 옮겨 다시 모은다.
    const loaded = await readRows(h);
    const rebuilt = buildTotals(loaded);
    assertEquals(rebuilt.calls, read.totals[0]!["calls"]);
    assertEquals(rebuilt.tokens, read.totals[0]!["tokens"]);
    assertEquals(rebuilt.costs, read.totals[0]!["costs"]);
    assertEquals(rebuilt.missing_records, read.totals[0]!["missing_records"]);
    assertEquals(rebuilt.complete, read.totals[0]!["complete"]);
  } finally {
    await h.close();
  }
});

// R9: 가격 갱신·사후 청구가 와도 최초 사실(끝난 본문·결과·최초 비용)은
// 덮지 않는다. 새 근거는 model_call_supplements 행으로 별도로 남는다.
Deno.test(
  "lophn-agent/harness/usage#R9: price refresh keeps the first cost, supplement shows apart",
  async () => {
    const h = await open();
    try {
      await seedProvider(h);
      await startCall(h, started);
      // 최초 비용은 그 시점 가격(basis price)으로 매긴 estimated다(R8).
      const firstCost = {
        kind: "estimated" as const,
        amount: "0.0105",
        currency: "USD",
        basis: { price },
        confirmed_at: null,
      };
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
            cost: firstCost,
            duration_ms: 100,
            first_output_ms: 10,
            state_seq: "5",
          }),
        ),
      );
      // 가격이 바뀐 뒤(새 판 revision을 새 근거에 남긴다) 사후 청구를 보완으로
      // 연결한다. 새 근거는 reported 종류다(R7).
      const confirmed = {
        kind: "reported" as const,
        amount: "0.0120",
        currency: "USD",
        basis: { price_revision: "2026-11" },
        confirmed_at: at(NOW + 86_400_000),
      };
      keep(
        await h.command(
          machineCred,
          envelope("SupplementModelCall", {
            call: CALL,
            supplement_key: "invoice-1",
            usage: null,
            cost: confirmed,
            outcome: null,
            basis: null,
          }, { compare: { state_seq: "5" } }),
        ),
      );
      // 옛 추정이 그대로 남아 있다(R9). 새 근거로 덮지 않는다.
      const record = await readCall(h, CALL);
      assertEquals(record["cost"], firstCost);
      assertEquals(
        (record["usage"] as Record<string, unknown>)["input"],
        1000,
      );
      // 새 근거는 supplements 표에 별도 행으로 보인다(R9).
      const supplements = (await h.inspect(
        `select call, supplement_key, cost, basis, at
         from model_call_supplements where call = ? order by supplement_key`,
        [CALL],
      )) as { ok: boolean; value?: Record<string, unknown>[] };
      assert(supplements.ok);
      const rows = supplements.value ?? [];
      assertEquals(rows.length, 1);
      assertEquals(rows[0]!["supplement_key"], "invoice-1");
      assertEquals(JSON.parse(String(rows[0]!["cost"])), confirmed);
      // 같은 supplement_key 재전송은 conflict다. 옛 근거와 새 근거가 합쳐져
      // 저장되지 않는다.
      const overwritten = await h.command(
        machineCred,
        envelope("SupplementModelCall", {
          call: CALL,
          supplement_key: "invoice-1",
          usage: { ...usage, input: 9, output: 9 },
          cost: null,
          outcome: null,
          basis: HASH,
        }, { compare: { state_seq: "5" } }),
      );
      code(overwritten, "conflict");
      const after = (await h.inspect(
        "select call from model_call_supplements where call = ?",
        [CALL],
      )) as { ok: boolean; value?: Record<string, unknown>[] };
      assert(after.ok);
      assertEquals((after.value ?? []).length, 1);
    } finally {
      await h.close();
    }
  },
);

// R10: handoff 받는 run의 call은 실제 수신 run에 귀속한다. model_calls.run이
// 수신 run이므로 수신 run 합계가 그 call을 한 번 세고, 보낸 run 합계는 그
// call을 세지 않는다(비용을 보낸 run으로 바꾸지 않는다).
Deno.test(
  "lophn-agent/harness/usage#R10: a handoff receiver run call counts for the receiver only",
  async () => {
    const h = await open();
    try {
      await seedProvider(h);
      // handoff 수신 run에서 실제로 보낸 call. 보낸 run은 비용 행에 기록되지
      // 않는다(research handoff: 비용은 실제 수신 ModelCall 한 번).
      const received = {
        ...started,
        id: CALL2,
        run: RECEIVER_RUN,
      };
      await startCall(h, received);
      keep(
        await h.command(
          machineCred,
          envelope("FinishModelCall", {
            call: CALL2,
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
              input: 700,
              output: 300,
              cache_read: null,
              cache_write: null,
              reasoning: null,
              cache_in_input: false,
              reasoning_in_output: false,
              definition_revision: "2026-10",
            },
            cost: {
              kind: "estimated",
              amount: "0.0150",
              currency: "USD",
              basis: { price },
              confirmed_at: null,
            },
            duration_ms: 80,
            first_output_ms: 8,
            state_seq: "5",
          }),
        ),
      );
      // 수신 run 합계는 이 call을 한 번 센다(R10).
      const receiver = await readUsage(h, {
        run: RECEIVER_RUN,
        from_at: at(NOW - 1000),
        through_at: at(NOW + 1000),
      });
      assertEquals(receiver.length, 1);
      assertEquals(receiver[0]!["calls"], 1);
      assertEquals(receiver[0]!["group"]["run"], RECEIVER_RUN);
      assertEquals(receiver[0]!["tokens"]["known"]["input"], 700);
      assertEquals(receiver[0]!["tokens"]["known"]["output"], 300);
      // 보낸 run 합계는 이 call을 세지 않는다(보낸 run 비용으로 바꾸지 않는다).
      const sender = await readUsage(h, {
        run: SENDER_RUN,
        from_at: at(NOW - 1000),
        through_at: at(NOW + 1000),
      });
      assertEquals(sender.length, 1);
      assertEquals(sender[0]!["calls"], 0);
      assertEquals(sender[0]!["complete"], true);
      // 기간 전체 합계는 같은 call을 한 번만 센다.
      const whole = await readUsage(h, {
        from_at: at(NOW - 1000),
        through_at: at(NOW + 1000),
      });
      assertEquals(whole.length, 1);
      assertEquals(whole[0]!["calls"], 1);
      assertEquals(whole[0]!["missing_records"], 0);
    } finally {
      await h.close();
    }
  },
);

// R10: 같은 호출의 재전송 수신은 이중 계산되지 않는다. 같은 idempotency_key로 온
// 재전송은 저장된 결과로 돌아오고(executor replay) 새 기록·새 시도가 없으므로
// 합계도 한 번 센다.
Deno.test(
  "lophn-agent/harness/usage#R10: a resent receipt does not double the spend",
  async () => {
    const h = await open();
    try {
      await seedProvider(h);
      await startCall(h, started);
      // 같은 envelope 객체를 두 번 보낸다. idempotency_key와 입력 fingerprint가
      // 같으므로 두 번째 수신은 재전송 replay다(platform ledger R13).
      const receipt = envelope("FinishModelCall", {
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
      });
      const first = keep(
        await h.command(machineCred, receipt),
      ) as unknown as { replayed: boolean };
      assertEquals(first.replayed, false);
      const again = keep(
        await h.command(machineCred, receipt),
      ) as unknown as { replayed: boolean };
      assertEquals(again.replayed, true);
      // 재생이 새 기록을 만들지 않았다. model_calls 행은 하나뿐이다.
      const loaded = await readRows(h);
      assertEquals(loaded.length, 1);
      // 합계도 재생을 다시 세지 않는다(R10).
      const totals = await readUsage(h, {
        from_at: at(NOW - 1000),
        through_at: at(NOW + 1000),
      });
      assertEquals(totals.length, 1);
      assertEquals(totals[0]!["calls"], 1);
      assertEquals(totals[0]!["missing_records"], 0);
      assertEquals(totals[0]!["complete"], true);
      assertEquals(totals[0]!["tokens"]["known"]["output"], 500);
      const costs = totals[0]!["costs"] as Record<string, unknown>[];
      assertEquals(costs.length, 1);
      assertEquals(costs[0]!["calls"], 1);
      assertEquals(costs[0]!["amount"], "0.0105");
    } finally {
      await h.close();
    }
  },
);

Deno.test("lophn-agent/harness/usage#R2 [agent-I16b]: a Compact summary call is recorded with a session and no run, one attempt order per session", async () => {
  const h = await open();
  try {
    await seedProvider(h);
    const summary = {
      ...started,
      run: null,
      model_use: "organizing" as const,
      agent_hash: null,
      purpose: "conversation_compression" as const,
    };
    await startCall(h, summary);
    const recorded = await readCall(h, CALL);
    assertEquals(recorded["run"], null);
    assertEquals(recorded["session"], SESSION);
    assertEquals(recorded["agent_hash"], null);
    assertEquals(recorded["model_use"], "organizing");
    assertEquals(recorded["purpose"], "conversation_compression");

    // 같은 session의 같은 시도 순번을 다시 쓸 수 없다. 다음 시도는 다음 순번이다.
    const again = await h.command(
      machineCred,
      envelope("StartModelCall", {
        call: { ...summary, id: CALL2 },
        applied_messages: [],
        state_seq: "4",
      }),
    );
    code(again, "conflict");
    await startCall(h, { ...summary, id: CALL2, attempt_order: 2 });
    const list = keep(
      await h.read({ resource: "model-calls", method: "list" }, userCred, {
        session: SESSION,
      }),
    ) as { calls: { id: string; run: string | null }[] };
    assertEquals(list.calls.map((entry) => entry.id), [CALL, CALL2]);
    assert(list.calls.every((entry) => entry.run === null));

    // 끝난 요약 call은 run 있는 call과 같은 길로 완료된다.
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
            finish_reason: "end_turn",
            http_status: 200,
            provider_code: null,
          },
          usage,
          cost: unknownCost,
          duration_ms: 10,
          first_output_ms: 5,
          state_seq: "5",
        }),
      ),
    );
    assertEquals((await readCall(h, CALL))["state"], "finished");
  } finally {
    await h.close();
  }
});
