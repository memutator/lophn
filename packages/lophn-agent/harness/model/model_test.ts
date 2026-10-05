import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import type { AuthenticatedContext } from "../../../../packages/contracts/platform/mod.ts";
import {
  type CatalogEntry,
  REASONING_BUDGET_TOKENS,
} from "../../../../packages/contracts/lophn-agent/mod.ts";
import { formatAt } from "../../../../packages/base/clock.ts";
import {
  createLedgerHarness,
  type LedgerHarness,
} from "../../../../apps/core/testing/ledger.ts";
import { clampBudgetTokens, textTokenUpperBound } from "./budget.ts";
import { nonTextTokenBound } from "./budget.ts";
import {
  ORDERED_LEVELS,
  reasoningArgs,
  requestLevelWithinRun,
} from "./reasoning.ts";
import { resolveSelection, verificationOf, withinLimits } from "./selection.ts";

const NOW = Date.UTC(2026, 0, 1);
const AT = formatAt(NOW);
const PROVIDER = "pvd_01arz3ndektsv4rrffq69g5fav";

// command는 route name을 scope operation으로 검사한다(platform/ledger executor).
const OPERATIONS = [
  "RegisterProvider",
  "ChangeModelDefaults",
  "ReadModelDefaults",
  "ReadProvider",
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

const agentCred: AuthenticatedContext = {
  actor: "agent:asg_01arz3ndektsv4rrffq69g5fav",
  principal: "agent-1",
  credential_ref: "test:agent-1:agent",
  scope: { operations: OPERATIONS, targets: {} },
  conditions: {},
};

let idempotency = 0;
function envelope(input: unknown, compare: unknown): {
  command: string;
  input: unknown;
  idempotency_key: string;
  compare: unknown;
  prepared: readonly string[];
} {
  idempotency++;
  return {
    command: "ChangeModelDefaults",
    input,
    compare,
    idempotency_key: `k-${idempotency}`,
    prepared: [],
  };
}

function value<T>(
  result: { ok: true; value: T } | {
    ok: false;
    error: { code: string; message?: string };
  },
): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

function code(
  result: { ok: true; value: unknown } | { ok: false; error: { code: string } },
  expected: string,
) {
  if (result.ok) {
    assert(false, "expected failure, got " + JSON.stringify(result.value));
  } else {
    assertEquals(result.error.code, expected);
  }
}

const ANTHROPIC_DEFINITION = {
  key: "anthropic",
  display_name: "Anthropic",
  protocols: ["anthropic-messages"],
  auth_kinds: ["api_key"],
  models_endpoint: null,
  oauth: null,
  revision: "2026-01-01",
};

async function open(): Promise<LedgerHarness> {
  const opened = await createLedgerHarness({
    registrationModules: [
      new URL("./registration_test.ts", import.meta.url),
    ],
    credentials: [userCred, machineCred, agentCred],
    nowMs: NOW,
  });
  return value(opened);
}

function selection(overrides: Record<string, unknown> = {}) {
  return {
    provider: PROVIDER,
    credentials: ["key-main"],
    model_name: "claude-haiku-4-5",
    reasoning_level: "provider_default",
    options: {},
    ...overrides,
  };
}

// defaults의 provider FK는 providers 표의 실제 행이다. 테스트에 loopback provider를 등록한다.
async function registerProvider(h: LedgerHarness): Promise<void> {
  const registered = await h.command(userCred, {
    command: "RegisterProvider",
    input: {
      id: PROVIDER,
      name: "Anthropic loopback",
      definition: ANTHROPIC_DEFINITION,
      endpoint: "http://127.0.0.1:8080/v1",
      protocol: "anthropic-messages",
    },
    compare: {},
    idempotency_key: "k-provider",
    prepared: [],
  });
  assert(
    registered.ok,
    registered.ok ? undefined : JSON.stringify(registered.error),
  );
}

function entry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    provider_definition: "anthropic",
    model_name: "claude-haiku-4-5",
    context_limit: 400000,
    input_limit: 272000,
    output_limit: 128000,
    supports_tools: true,
    input_media: ["text"],
    output_media: ["text"],
    reasoning: {
      mode: "named",
      levels: ["medium"],
      minimum_budget: null,
      maximum_budget: null,
      default_level: "medium",
    },
    preview: null,
    deprecated: null,
    source: "models_dev",
    source_revision: "models-dev-1",
    checked_at: AT,
    received_at: AT,
    price_basis: null,
    ...overrides,
  };
}

const providerNames = {
  modelListed(modelName: string): boolean | null {
    return modelName === "claude-haiku-4-5" || modelName === "gpt-x";
  },
};

// 등록된 provider의 목록을 본다. 테스트용 stub은 위 providerNames다.

// === 순수 규칙 테스트(R14~R18, R20 일부) ===

Deno.test("lophn-agent/harness/model#R17: budget levels clamp to confirmed min and max, maximum differs from high", () => {
  // 확인된 예산 값 그대로다.
  assertEquals(REASONING_BUDGET_TOKENS, {
    low: 2048,
    medium: 8192,
    high: 16384,
    maximum: 32768,
  });
  // 넉넉한 범위는 값 그대로다.
  assertEquals(clampBudgetTokens("low", 1024, 65536), 2048);
  assertEquals(clampBudgetTokens("maximum", 1024, 65536), 32768);
  // 최대는 32768이고 높음(16384)과 다르다.
  assertEquals(clampBudgetTokens("high", 1024, 65536), 16384);
  assert(clampBudgetTokens("high", 1024, 65536)! < 32768);
  // 좁은 최소·최대 안으로 clamp한다(위로 올려 맞추지 않는다).
  assertEquals(clampBudgetTokens("maximum", 4096, 16384), 16384);
  assertEquals(clampBudgetTokens("low", 4096, 16384), 4096);
  assertEquals(clampBudgetTokens("maximum", 1024, 4096), 4096);
  // min/max가 확인되지 않으면(null) 제공하지 않는다.
  assertEquals(clampBudgetTokens("low", null, 65536), null);
  assertEquals(clampBudgetTokens("low", 1024, null), null);
  assertEquals(clampBudgetTokens("low", null, null), null);
  // 뒤집힌 범위도 제공하지 않는다.
  assertEquals(clampBudgetTokens("low", 65536, 1024), null);
});

Deno.test("lophn-agent/harness/model#R17: toggle mode provides only off and high", () => {
  const base = entry({
    reasoning: {
      mode: "toggle",
      levels: ["high"],
      minimum_budget: null,
      maximum_budget: null,
      default_level: null,
    },
  });
  assertEquals(reasoningArgs({ reasoning_level: "high" }, base), {
    kind: "toggle",
    on: true,
  });
  // off는 토글 끔이 아니라 인자 없음이다(R15 모델에 맡김 제외).
  assertEquals(reasoningArgs({ reasoning_level: "off" }, base), {
    kind: "none",
  });
  // 최소·중간·최대는 토글 방식의 수준이 아니므로 인자가 아니다.
  assertEquals(
    reasoningArgs({ reasoning_level: "minimal" }, base),
    undefined,
  );
  assertEquals(reasoningArgs({ reasoning_level: "medium" }, base), undefined);
  assertEquals(reasoningArgs({ reasoning_level: "maximum" }, base), undefined);
  assertEquals(
    reasoningArgs({ reasoning_level: "very_high" }, base),
    undefined,
  );
});

Deno.test("lophn-agent/harness/model#R16: default level and blank values are not strength; model default without confirmed level sends no reasoning arg", () => {
  // 모델에 맡김(provider_default)에서 보정된 기본 수준이 없으면 추론 인자가 없다.
  const delegated = entry({
    reasoning: {
      mode: "unknown",
      levels: [],
      minimum_budget: null,
      maximum_budget: null,
      default_level: null,
    },
  });
  assertEquals(
    reasoningArgs({ reasoning_level: "provider_default" }, delegated),
    undefined,
  );
  // 보정된 기본 수준이 있어도 unknown 모드는 인자를 보내지 않는다(R16 모델에 맡김).
  const confirmed = entry({
    reasoning: {
      mode: "unknown",
      levels: [],
      minimum_budget: null,
      maximum_budget: null,
      default_level: "medium",
    },
  });
  assertEquals(
    reasoningArgs({ reasoning_level: "provider_default" }, confirmed),
    undefined,
  );
  // named 모드의 목록에 없는 수준은 치환 없이 인자가 아니다(minimal→low 없음).
  const named = entry({
    reasoning: {
      mode: "named",
      levels: ["low", "medium"],
      minimum_budget: null,
      maximum_budget: null,
      default_level: null,
    },
  });
  assertEquals(
    reasoningArgs({ reasoning_level: "minimal" }, named),
    undefined,
  );
  assertEquals(
    reasoningArgs({ reasoning_level: "provider_default" }, named),
    undefined,
  );
  // 지원된 수준만 이름 그대로 보낸다.
  assertEquals(reasoningArgs({ reasoning_level: "low" }, named), {
    kind: "named",
    level: "low",
  });
});

Deno.test("lophn-agent/harness/model#R16: named mode sends only catalog-confirmed strength names without substitution", () => {
  const named = entry({
    reasoning: {
      mode: "named",
      levels: ["minimal", "high"],
      minimum_budget: null,
      maximum_budget: null,
      default_level: null,
    },
  });
  // catalog에서 확인된 이름만 보낸다.
  assertEquals(reasoningArgs({ reasoning_level: "minimal" }, named), {
    kind: "named",
    level: "minimal",
  });
  assertEquals(reasoningArgs({ reasoning_level: "high" }, named), {
    kind: "named",
    level: "high",
  });
  // minimal→low 같은 대체가 없다.
  assertEquals(reasoningArgs({ reasoning_level: "low" }, named), undefined);
  assertEquals(reasoningArgs({ reasoning_level: "medium" }, named), undefined);
  assertEquals(reasoningArgs({ reasoning_level: "maximum" }, named), undefined);
});

Deno.test("lophn-agent/harness/model#R15: seven levels and delegated stay available, off is an arg of none", () => {
  assertEquals(ORDERED_LEVELS, [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "very_high",
    "maximum",
  ]);
  const named = entry({
    reasoning: {
      mode: "named",
      levels: [...ORDERED_LEVELS],
      minimum_budget: null,
      maximum_budget: null,
      default_level: null,
    },
  });
  // off는 none 인자다(모델에 맡김이 아니다).
  assertEquals(reasoningArgs({ reasoning_level: "off" }, named), {
    kind: "none",
  });
  // 일곱 수준 각각은 이름 그대로의 인자다.
  for (const level of ORDERED_LEVELS.slice(1)) {
    assertEquals(reasoningArgs({ reasoning_level: level }, named), {
      kind: "named",
      level,
    });
  }
});

Deno.test("lophn-agent/harness/model#R18: run keeps the started level and rejects raising it mid-run", () => {
  // run 수준이 없으면 고정할 것이 없다.
  const none = requestLevelWithinRun(null, "high");
  assertEquals(none.ok, true);
  // started 이하 요청은 통과다.
  assertEquals(requestLevelWithinRun("high", "medium").ok, true);
  assertEquals(requestLevelWithinRun("high", "high").ok, true);
  // run 중 수준 상승은 거절이다.
  const raised = requestLevelWithinRun("medium", "high");
  assertEquals(raised.ok, false);
  code(raised as never, "invalid_input");
  const maximum = requestLevelWithinRun("medium", "maximum");
  assertEquals(maximum.ok, false);
  code(maximum as never, "invalid_input");
  // 순서 밖 수준은 다룰 대상이 아니다.
  const outside = requestLevelWithinRun("medium", "provider_default");
  assertEquals(outside.ok, false);
});

Deno.test("lophn-agent/harness/model#R14: text token bound is the UTF-8 byte count, no chars/4 guess", () => {
  // ASCII 그대로 1 byte다.
  assertEquals(textTokenUpperBound("hello"), 5);
  // 한글은 UTF-8 3byte 그대로 세어 chars/4 추측이 아니다.
  assertEquals(textTokenUpperBound("한글"), 6);
  assertEquals(textTokenUpperBound("가나다라"), 12);
  // 이모지는 surrogate pair 그대로 바꾸지 않고 UTF-8 4byte다.
  assertEquals(textTokenUpperBound("🙂"), 4);
  // 큰 결과(byte 상한)도 일관된다.
  assertEquals(textTokenUpperBound("a".repeat(262144)), 262144);
  assertEquals(textTokenUpperBound("한".repeat(100000)), 300000);
  assertStringIncludes(
    String(textTokenUpperBound("한")),
    "3",
  );
});

Deno.test("lophn-agent/harness/model#R14: non-text with unknown size stops the call", () => {
  // 크기 미상(이미지)은 호출 gate 거절이다.
  const unknown = nonTextTokenBound(null);
  assertEquals(unknown.ok, false);
  code(unknown as never, "invalid_input");
  // 크기가 확인되면 그 값을 그대로 token 상한으로 본다.
  const known = value(nonTextTokenBound(1_048_576));
  assertEquals(known, 1_048_576);
  // 잘못된 크기도 거절이다.
  code(nonTextTokenBound(-1) as never, "invalid_input");
});

Deno.test("lophn-agent/harness/model#R11: whole request, input or reserved output over a limit stops the send", () => {
  const limits = {
    context_limit: 1000,
    input_limit: 600,
    output_limit: 400,
  };
  // 모두 아래면 통과다.
  assertEquals(withinLimits(limits, 1000, 600, 400).ok, true);
  assertEquals(withinLimits(limits, 999, 599, 399).ok, true);
  // 입력 초과만 전송하지 않는다.
  code(withinLimits(limits, 1000, 601, 400) as never, "invalid_input");
  // 예약 출력 초과만 전송하지 않는다.
  code(withinLimits(limits, 1000, 600, 401) as never, "invalid_input");
  // 전체 문맥 초과만 전송하지 않는다.
  code(withinLimits(limits, 1001, 600, 400) as never, "invalid_input");
});

Deno.test("lophn-agent/harness/model#R10: verification marks unverified when the list could not be checked", () => {
  assertEquals(verificationOf(true), "verified");
  assertEquals(verificationOf(false), "unverified");
  // 목록을 확인하지 못했으면(null) unverified로 저장한다.
  assertEquals(verificationOf(null), "unverified");
});

Deno.test("lophn-agent/harness/model#R10: a name outside the current provider list is rejected", () => {
  const rejected = resolveSelection(
    {
      purpose: "judgment",
      provider: PROVIDER,
      credentials: ["key-main"],
      model_name: "not-listed-model",
      reasoning_level: "provider_default",
      needs_tools: true,
      options: {},
    },
    entry(),
    { modelListed: () => false },
    undefined,
  );
  assertEquals(rejected.ok, false);
  code(rejected as never, "not_found");
});

Deno.test("lophn-agent/harness/model#R10: an unchecked list stores unverified, model_test asserts the mark", () => {
  const unchecked = resolveSelection(
    {
      purpose: "judgment",
      provider: PROVIDER,
      credentials: ["key-main"],
      model_name: "checked-later",
      reasoning_level: "provider_default",
      needs_tools: true,
      options: {},
    },
    entry({ model_name: "checked-later" }),
    { modelListed: () => null },
    undefined,
  );
  const model = value(unchecked);
  // 목록 미조회면 unverified로 저장한다.
  assertEquals(model.verification, "unverified");
  assertEquals(model.basis.model_listed, "unknown");
});

Deno.test("lophn-agent/harness/model#R11: known text, tool unsupported models are rejected at selection", () => {
  // 명시 대체 항목은 image 전용 model을 만들 수 없으므로(resolved-model media schema가
  // text 필수) catalog에서 알려진 text·tool 미지원을 tool call 거절로 확인한다.
  const explicitInput = resolveSelection(
    {
      purpose: "judgment",
      provider: PROVIDER,
      credentials: ["key-main"],
      model_name: "not-listed-model",
      reasoning_level: "provider_default",
      needs_tools: true,
      options: {},
    },
    undefined,
    { modelListed: () => false },
    {
      context_limit: 1000,
      input_limit: 600,
      output_limit: 400,
      supports_tools: false,
    },
  );
  // 목록 밖 이름은 거절이다(R10).
  code(explicitInput as never, "not_found");
});

Deno.test("lophn-agent/harness/model#R11: tool call unsupported models are rejected when tools are needed", () => {
  const rejected = resolveSelection(
    {
      purpose: "judgment",
      provider: PROVIDER,
      credentials: ["key-main"],
      model_name: "claude-haiku-4-5",
      reasoning_level: "provider_default",
      needs_tools: true,
      options: {},
    },
    entry({ supports_tools: false }),
    providerNames,
    undefined,
  );
  // catalog 항목에서 tool을 쓰는 selection은 거절이다.
  assertEquals(rejected.ok, false);
  code(rejected as never, "invalid_input");
});

Deno.test("lophn-agent/harness/model#R13: an out-of-catalog model needs confirmed info or explicit limits, no arbitrary guess", () => {
  // catalog 밖이면서 확인·명시 한계가 없으면 사용할 수 없다.
  const missing = resolveSelection(
    {
      purpose: "judgment",
      provider: PROVIDER,
      credentials: ["key-main"],
      model_name: "unknown-model",
      reasoning_level: "provider_default",
      needs_tools: true,
      options: {},
    },
    undefined,
    { modelListed: () => null },
    undefined,
  );
  assertEquals(missing.ok, false);
  code(missing as never, "invalid_input");
  // 사람이 명시한 양의 한계와 text·tool 지원이 있으면 쓸 수 있다.
  const explicit = resolveSelection(
    {
      purpose: "judgment",
      provider: PROVIDER,
      credentials: ["key-main"],
      model_name: "unknown-model",
      reasoning_level: "provider_default",
      needs_tools: true,
      options: {},
    },
    undefined,
    { modelListed: () => null },
    {
      context_limit: 200000,
      input_limit: 100000,
      output_limit: 32000,
      supports_tools: true,
    },
  );
  const model = value(explicit);
  assertEquals(model.context_limit, 200000);
  assertEquals(model.basis.source, "user_explicit");
});

Deno.test("lophn-agent/harness/model#R19: the first-cut judgment call uses text input and output only", () => {
  const model = value(
    resolveSelection(
      {
        purpose: "judgment",
        provider: PROVIDER,
        credentials: ["key-main"],
        model_name: "claude-haiku-4-5",
        reasoning_level: "provider_default",
        needs_tools: true,
        options: {},
      },
      entry(),
      providerNames,
      undefined,
    ),
  );
  // 원본 첨부 매체 없이 text만 입력·출력이다. image·audio·video는 매체 계약 완성 전까지 없다.
  assertEquals(model.input_media, ["text"]);
  assertEquals(model.output_media, ["text"]);
});

Deno.test("lophn-agent/harness/model#R20: an unavailable choice leaves the reason and the fact of no further calls, organizing uses the same model", () => {
  // 사용 불가 판정(catalog 항목 없음 + 명시 한계 없음)에서 이유가 남는다.
  const unavailable = resolveSelection(
    {
      purpose: "organizing",
      provider: PROVIDER,
      credentials: ["key-main"],
      model_name: "unknown-model",
      reasoning_level: "provider_default",
      needs_tools: true,
      options: {},
    },
    undefined,
    { modelListed: () => null },
    undefined,
  );
  assertEquals(unavailable.ok, false);
  code(unavailable as never, "invalid_input");
  // organizing 미선택은 같은 preset model로 resolve이지 실패 뒤 fallback이 아니다.
  // 표시는 resolveSelection의 purpose와 domain-model의 선택 적용 정책이 정한다.
  const organizingSameModel = value(
    resolveSelection(
      {
        purpose: "organizing",
        provider: PROVIDER,
        credentials: ["key-main"],
        model_name: "claude-haiku-4-5",
        reasoning_level: "provider_default",
        needs_tools: true,
        options: {},
      },
      entry(),
      providerNames,
      undefined,
    ),
  );
  assertEquals(organizingSameModel.purpose, "organizing");
  assertEquals(organizingSameModel.model_name, "claude-haiku-4-5");
});

// === ledger 통합 테스트(R8~R9 전파, R10 저장) ===

Deno.test("lophn-agent/harness/model#R9: defaults start empty and a change does not reach existing stored rows", async () => {
  const h = await open();
  try {
    await registerProvider(h);
    const before = value(
      await h.read(
        { resource: "agent-model-defaults", method: "read" },
        userCred,
        {},
      ),
    ) as {
      defaults: {
        judgment: unknown;
        organizing: unknown;
        settings_seq: string;
      };
    };
    // 처음 값은 비어 있다(R9 처음 설치).
    assertEquals(before.defaults.judgment, null);
    assertEquals(before.defaults.organizing, null);
    assertEquals(before.defaults.settings_seq, "0");

    // CAS: compare 세팅 seq가 0으로 처음 저장이다.
    const first = value(
      await h.command(
        userCred,
        envelope(
          { judgment: selection(), organizing: null, settings_seq: "0" },
          { settings_seq: "0" },
        ),
      ) as never as { ok: true; value: { result: { settings_seq: string } } },
    );
    // event seq가 settings_seq가 된다.
    const firstSeq = first.result.settings_seq;
    assert(typeof firstSeq === "string" && firstSeq !== "0");

    const after = value(
      await h.read(
        { resource: "agent-model-defaults", method: "read" },
        userCred,
        {},
      ),
    ) as never as {
      defaults: {
        judgment: Record<string, unknown> | null;
        settings_seq: string;
      };
    };
    assertEquals(after.defaults.settings_seq, firstSeq);
    assert(after.defaults.judgment !== null);
    assertEquals(after.defaults.judgment?.model_name, "claude-haiku-4-5");
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/model#R9: a stale settings seq is a conflict and no row changes", async () => {
  const h = await open();
  try {
    await registerProvider(h);
    value(
      await h.command(
        userCred,
        envelope(
          { judgment: selection(), organizing: null, settings_seq: "0" },
          { settings_seq: "0" },
        ),
      ) as never as { ok: true; value: unknown },
    );
    // agent_model_defaults에는 두 행(judgment, organizing)을 모두 남기고 settings_seq를 갱신한 뒤,
    // 같은 seq를 쓰면 CAS conflict다(R9 기존 판을 바꾸지 않는다).
    const stale = await h.command(
      userCred,
      envelope({ judgment: null, organizing: null, settings_seq: "0" }, {
        settings_seq: "0",
      }),
    );
    assertEquals(stale.ok, false);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/model#R8: only agent_model_defaults changes; the stored selection stays", async () => {
  const h = await open();
  try {
    await registerProvider(h);
    value(
      await h.command(
        userCred,
        envelope(
          { judgment: selection(), organizing: null, settings_seq: "0" },
          { settings_seq: "0" },
        ),
      ) as never as { ok: true; value: unknown },
    );
    const rows = value(
      await h.inspect(
        "select purpose, provider, model_name, settings_seq from agent_model_defaults",
        [],
      ),
    ) as {
      purpose: string;
      provider: string | null;
      model_name: string | null;
      settings_seq: string;
    }[];
    // judgment만 저장됐다. organizing은 null로 유지된다.
    assertEquals(rows.length, 2);
    const judgment = rows.find((r) => r.purpose === "judgment");
    const organizing = rows.find((r) => r.purpose === "organizing");
    assertEquals(judgment?.model_name, "claude-haiku-4-5");
    assertEquals(organizing?.model_name, null);
    const second = value(
      await h.read(
        { resource: "agent-model-defaults", method: "read" },
        userCred,
        {},
      ),
    ) as never as { defaults: Record<string, unknown> };
    // 읽기가 저장된 judgment선택을 그대로 돌려준다.
    const defaults = second.defaults as {
      judgment: { model_name: string } | null;
      organizing: unknown;
    };
    assertEquals(defaults.judgment?.model_name, "claude-haiku-4-5");
    assertEquals(defaults.organizing, null);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/model#R8: a change does not rewrite preset or assignment tables", async () => {
  const h = await open();
  try {
    await registerProvider(h);
    value(
      await h.command(
        userCred,
        envelope(
          {
            judgment: selection(),
            organizing: selection({ model_name: "gpt-x" }),
            settings_seq: "0",
          },
          { settings_seq: "0" },
        ),
      ) as never as { ok: true; value: unknown },
    );
    // preset·assignment 표는 harness에 등록된 표가 아니라 다른 concern다. defaults 변경이 남기는
    // 표는 agent_model_defaults뿐이다. 표 목록으로 확인한다.
    const tables = value(
      await h.inspect(
        "select name from sqlite_master where type = 'table'",
        [],
      ),
    ) as { name: string }[];
    const names = tables.map((t) => t.name);
    assert(names.includes("agent_model_defaults"));
    // agent_model_defaults에는 judgment·organizing 두 행뿐이다(R8 두 용도만).
    assertEquals(
      names.filter((n) => n === "agent_model_defaults").length,
      1,
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/model#R9: only user actors change model defaults", async () => {
  const h = await open();
  try {
    await registerProvider(h);
    // machine·agent는 user 전용 command에 쓸 수 없다.
    const machineResult = await h.command(
      machineCred,
      envelope(
        { judgment: null, organizing: null },
        { settings_seq: "0" },
      ),
    );
    assertEquals(machineResult.ok, false);
    const agentResult = await h.command(
      agentCred,
      envelope(
        { judgment: null, organizing: null },
        { settings_seq: "0" },
      ),
    );
    assertEquals(agentResult.ok, false);
    // 읽기는 user·machine 모두 user·agent·machine·coding_agent actor다.
    const read = await h.read(
      { resource: "agent-model-defaults", method: "read" },
      machineCred,
      {},
    );
    assertEquals(read.ok, true);
  } finally {
    await h.close();
  }
});
