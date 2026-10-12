import { assert, assertEquals } from "@std/assert";
import type { AuthenticatedContext } from "../../../../packages/contracts/platform/mod.ts";
import type { CatalogEntry } from "../../../../packages/contracts/lophn-agent/mod.ts";
import { formatAt } from "../../../../packages/base/clock.ts";
import { canonicalize, sha256Hex } from "../../../../packages/base/mod.ts";
import {
  createLedgerHarness,
  type LedgerHarness,
} from "../../../../apps/core/testing/ledger.ts";
import { nonTextTokenBound, textTokenUpperBound } from "./token-bound.ts";
import { workspaceModels } from "./store.ts";
import {
  requestOptionsWithinRun,
  resolveSelection,
  verificationOf,
  withinLimits,
} from "./selection.ts";

const NOW = Date.UTC(2026, 0, 1);
const AT = formatAt(NOW);
const PROVIDER = "pvd_01arz3ndektsv4rrffq69g5fav";
const OTHER_PROVIDER = "pvd_01arz3ndektsv4rrffq69g5faw";

// command는 route name을 scope operation으로 검사한다(platform/ledger executor).
const OPERATIONS = [
  "RegisterProvider",
  "DisconnectProvider",
  "ChangeModelDefaults",
  "ReadModelDefaults",
  "ChangeModelFavorites",
  "ReadModelFavorites",
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
function envelope(command: string, input: unknown, compare: unknown): {
  command: string;
  input: unknown;
  idempotency_key: string;
  compare: unknown;
  prepared: readonly string[];
} {
  idempotency++;
  return {
    command,
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

// 인증 없는 연결은 custom provider의 loopback에만 있다. 정의 key는 사람이 정한 이름이다.
const ANTHROPIC_DEFINITION = {
  key: "anthropic",
  display_name: "Anthropic",
  protocols: ["anthropic-messages"],
  auth_kinds: ["none"],
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

// defaults·favorites의 provider FK는 providers 표의 실제 행이다. 테스트에 loopback provider를 등록한다.
async function registerProvider(
  h: LedgerHarness,
  id = PROVIDER,
  port = 8080,
): Promise<void> {
  const registered = await h.command(userCred, {
    command: "RegisterProvider",
    input: {
      id,
      name: `Anthropic loopback ${port}`,
      definition: ANTHROPIC_DEFINITION,
      endpoint: `http://127.0.0.1:${port}/v1`,
      protocol: "anthropic-messages",
      credential: { kind: "none", preparation: null },
    },
    compare: {},
    idempotency_key: `k-provider-${port}`,
    prepared: [],
  });
  assert(
    registered.ok,
    registered.ok ? undefined : JSON.stringify(registered.error),
  );
}

// registration_test.ts의 catalog 자료(contracts/lophn-agent/testing)에 있는 anthropic model 둘이다.
// opus는 effort(low~maximum, 기본 high)와 speed(standard·fast) 축을 가지고 sonnet은 예산 방식 effort 축 하나다.
function choice(overrides: Record<string, unknown> = {}) {
  return {
    provider: PROVIDER,
    model_name: "claude-opus-4-8",
    option_values: { effort: "very_high", speed: "fast" },
    ...overrides,
  };
}

type DefaultsValue = {
  defaults: {
    lophn: Record<string, unknown> | null;
    context_engineer: Record<string, unknown> | null;
    app_engineer: Record<string, unknown> | null;
    operator: Record<string, unknown> | null;
    summaries: Record<string, unknown> | null;
    settings_seq: string;
  };
};

async function readDefaults(h: LedgerHarness): Promise<DefaultsValue> {
  return value(
    await h.read(
      { resource: "agent-model-defaults", method: "read" },
      userCred,
      {},
    ),
  ) as DefaultsValue;
}

async function changeDefaults(
  h: LedgerHarness,
  cred: AuthenticatedContext,
  input: unknown,
  seq: string,
) {
  return await h.command(
    cred,
    envelope("ChangeModelDefaults", input, { settings_seq: seq }),
  );
}

type FavoritesValue = {
  favorites: {
    items: { provider: string; model_name: string }[];
    settings_seq: string;
  };
};

async function readFavorites(h: LedgerHarness): Promise<FavoritesValue> {
  return value(
    await h.read(
      { resource: "model-favorites", method: "read" },
      userCred,
      {},
    ),
  ) as FavoritesValue;
}

async function changeFavorites(
  h: LedgerHarness,
  items: unknown,
  seq: string,
  cred: AuthenticatedContext = userCred,
) {
  return await h.command(
    cred,
    envelope("ChangeModelFavorites", { items }, { settings_seq: seq }),
  );
}

function resultOf<T>(
  result: Awaited<ReturnType<LedgerHarness["command"]>>,
): T {
  return (value(result as never) as { result: T }).result;
}

// === 순수 규칙 테스트(R10, R11, R13, R14, R16, R18, R19, R20, R24) ===

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
    options: [{
      id: "effort",
      label: "Effort",
      values: [
        { value: "low", label: "Low", wire: null },
        { value: "medium", label: "Medium", wire: null },
        { value: "high", label: "High", wire: null },
      ],
      default_value: "medium",
      budget: null,
    }],
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

function selection(overrides: Record<string, unknown> = {}) {
  return {
    purpose: "judgment" as const,
    provider: PROVIDER,
    credential_revision: 1,
    model_name: "claude-haiku-4-5",
    option_values: {},
    needs_tools: true,
    ...overrides,
  };
}

const providerNames = {
  modelListed(modelName: string): boolean | null {
    return modelName === "claude-haiku-4-5" || modelName === "gpt-x";
  },
};

Deno.test("lophn-agent/harness/model#R16 [agent-I15]: an axis left to the model takes the confirmed default and others send nothing", () => {
  // 맡김(축 없음)은 catalog가 확인한 default_value가 있으면 그 값으로 채운다.
  const filled = value(
    resolveSelection(selection(), entry(), providerNames, undefined),
  );
  assertEquals(filled.option_values, { effort: "medium" });
  // 고른 값은 그대로이고 기본값으로 바꾸지 않는다.
  const chosen = value(
    resolveSelection(
      selection({ option_values: { effort: "high" } }),
      entry(),
      providerNames,
      undefined,
    ),
  );
  assertEquals(chosen.option_values, { effort: "high" });
  // 기본값이 확인되지 않은 축은 맡김이어도 값을 만들지 않는다.
  const unknownDefault = value(
    resolveSelection(
      selection(),
      entry({
        options: [{
          id: "effort",
          label: "Effort",
          values: [{ value: "low", label: "Low", wire: null }],
          default_value: null,
          budget: null,
        }],
      }),
      providerNames,
      undefined,
    ),
  );
  assertEquals(unknownDefault.option_values, {});
  // option을 아직 모르는 model(null)은 맡김뿐이다.
  const noAxes = value(
    resolveSelection(
      selection(),
      entry({ options: null }),
      providerNames,
      undefined,
    ),
  );
  assertEquals(noAxes.option_values, {});
});

Deno.test("lophn-agent/harness/model#R24 [agent-I15]: an axis or value the model does not declare fails before the call", () => {
  // 없는 값은 가까운 값으로 바꾸지 않고 거절한다.
  code(
    resolveSelection(
      selection({ option_values: { effort: "maximum" } }),
      entry(),
      providerNames,
      undefined,
    ) as never,
    "invalid_input",
  );
  // 없는 축도 거절한다.
  code(
    resolveSelection(
      selection({ option_values: { speed: "fast" } }),
      entry(),
      providerNames,
      undefined,
    ) as never,
    "invalid_input",
  );
  // option을 모르는 model(null)에는 어떤 값도 고를 수 없다.
  code(
    resolveSelection(
      selection({ option_values: { effort: "low" } }),
      entry({ options: null }),
      providerNames,
      undefined,
    ) as never,
    "invalid_input",
  );
  // catalog 밖 model(명시 한계만 있음)도 option 값을 고를 수 없다.
  code(
    resolveSelection(
      selection({ model_name: "gpt-x", option_values: { effort: "low" } }),
      undefined,
      providerNames,
      {
        context_limit: 1000,
        input_limit: 600,
        output_limit: 400,
        supports_tools: true,
      },
    ) as never,
    "invalid_input",
  );
});

Deno.test("lophn-agent/harness/model#R18 [agent-I15]: a request cannot raise effort above the value the run started with", () => {
  const same = value(
    requestOptionsWithinRun({ effort: "medium" }, { effort: "medium" }),
  );
  assertEquals(same, { effort: "medium" });
  assertEquals(
    value(requestOptionsWithinRun({ effort: "high" }, { effort: "low" })),
    { effort: "low" },
  );
  // 더 높은 effort는 거절한다.
  code(
    requestOptionsWithinRun({ effort: "medium" }, { effort: "high" }) as never,
    "invalid_input",
  );
  code(
    requestOptionsWithinRun({ effort: "low" }, {
      effort: "very_high",
    }) as never,
    "invalid_input",
  );
  // 이름 순서 밖의 값은 비교할 수 없어 거절한다.
  code(
    requestOptionsWithinRun({ effort: "medium" }, { effort: "turbo" }) as never,
    "invalid_input",
  );
  // run이 effort를 맡김으로 시작했으면(고정한 값이 없으면) 고정할 것이 없다.
  assertEquals(
    value(requestOptionsWithinRun({}, { effort: "maximum" })),
    { effort: "maximum" },
  );
  // effort 밖 축은 순서가 없어 이 검사가 바꾸지 않는다.
  assertEquals(
    value(
      requestOptionsWithinRun(
        { effort: "high", speed: "standard" },
        { effort: "high", speed: "fast" },
      ),
    ),
    { effort: "high", speed: "fast" },
  );
});

Deno.test("lophn-agent/harness/model#R14 [agent-I15]: text token bound is the UTF-8 byte count, no chars/4 guess", () => {
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
});

Deno.test("lophn-agent/harness/model#R14 [agent-I15]: non-text with unknown size stops the call", () => {
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

Deno.test("lophn-agent/harness/model#R11 [agent-I15]: whole request, input or reserved output over a limit stops the send", () => {
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

Deno.test("lophn-agent/harness/model#R10 [agent-I15]: verification marks unverified when the list could not be checked", () => {
  assertEquals(verificationOf(true), "verified");
  assertEquals(verificationOf(false), "unverified");
  // 목록을 확인하지 못했으면(null) unverified로 저장한다.
  assertEquals(verificationOf(null), "unverified");
});

Deno.test("lophn-agent/harness/model#R10 [agent-I15]: a name outside the current provider list is rejected", () => {
  const rejected = resolveSelection(
    selection({ model_name: "not-listed-model" }),
    entry(),
    { modelListed: () => false },
    undefined,
  );
  assertEquals(rejected.ok, false);
  code(rejected as never, "not_found");
});

Deno.test("lophn-agent/harness/model#R10 [agent-I15]: an unchecked list stores unverified, model_test asserts the mark", () => {
  const model = value(
    resolveSelection(
      selection({ model_name: "checked-later" }),
      entry({ model_name: "checked-later" }),
      { modelListed: () => null },
      undefined,
    ),
  );
  // 목록 미조회면 unverified로 저장한다.
  assertEquals(model.verification, "unverified");
  assertEquals(model.basis.model_listed, "unknown");
});

Deno.test("lophn-agent/harness/model#R11 [agent-I15]: tool call unsupported models are rejected when tools are needed", () => {
  const rejected = resolveSelection(
    selection(),
    entry({ supports_tools: false }),
    providerNames,
    undefined,
  );
  // catalog 항목에서 tool을 쓰는 selection은 거절이다.
  assertEquals(rejected.ok, false);
  code(rejected as never, "invalid_input");
});

Deno.test("lophn-agent/harness/model#R11 [agent-I15]: a known text-unsupported model is rejected at selection", () => {
  code(
    resolveSelection(
      selection(),
      entry({ input_media: ["image"] }),
      providerNames,
      undefined,
    ) as never,
    "invalid_input",
  );
  code(
    resolveSelection(
      selection(),
      entry({ output_media: ["audio"] }),
      providerNames,
      undefined,
    ) as never,
    "invalid_input",
  );
});

Deno.test("lophn-agent/harness/model#R13 [agent-I15]: an out-of-catalog model needs confirmed info or explicit limits, no arbitrary guess", () => {
  // catalog 밖이면서 확인·명시 한계가 없으면 사용할 수 없다.
  const missing = resolveSelection(
    selection({ model_name: "unknown-model" }),
    undefined,
    { modelListed: () => null },
    undefined,
  );
  assertEquals(missing.ok, false);
  code(missing as never, "invalid_input");
  // 사람이 명시한 양의 한계와 text·tool 지원이 있으면 쓸 수 있다.
  const explicit = resolveSelection(
    selection({ model_name: "unknown-model" }),
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
  assertEquals(model.option_values, {});
});

Deno.test("lophn-agent/harness/model#R19 [agent-I15]: the first-cut judgment call uses text input and output only", () => {
  const model = value(
    resolveSelection(selection(), entry(), providerNames, undefined),
  );
  // 원본 첨부 매체 없이 text만 입력·출력이다. image·audio·video는 매체 계약 완성 전까지 없다.
  assertEquals(model.input_media, ["text"]);
  assertEquals(model.output_media, ["text"]);
});

Deno.test("lophn-agent/harness/model#R20 [agent-I15]: an unavailable choice leaves the reason and the fact of no further calls, organizing uses the same model", () => {
  // 사용 불가 판정(catalog 항목 없음 + 명시 한계 없음)에서 이유가 남는다.
  const unavailable = resolveSelection(
    selection({ purpose: "organizing", model_name: "unknown-model" }),
    undefined,
    { modelListed: () => null },
    undefined,
  );
  assertEquals(unavailable.ok, false);
  code(unavailable as never, "invalid_input");
  // 요약용 칸이 비어 agent model로 resolve하는 것은 구성 resolve이지 실패 뒤 fallback이 아니다.
  const organizingSameModel = value(
    resolveSelection(
      selection({ purpose: "organizing" }),
      entry(),
      providerNames,
      undefined,
    ),
  );
  assertEquals(organizingSameModel.purpose, "organizing");
  assertEquals(organizingSameModel.model_name, "claude-haiku-4-5");
});

Deno.test("lophn-agent/harness/provider#R28 lophn-agent/harness/model#R9: Disconnect가 provider를 지워도 고른 기본 model과 즐겨찾기는 남고 그 provider로 새로 저장하지는 못한다", async () => {
  const h = await open();
  try {
    await registerProvider(h);
    const saved = resultOf<DefaultsValue>(
      await changeDefaults(h, userCred, { lophn: choice() }, "0"),
    );
    const starred = value(
      await changeFavorites(
        h,
        [{ provider: PROVIDER, model_name: "claude-opus-4-8" }],
        "0",
      ),
    );
    assert(starred !== undefined);
    const provider = value(
      await h.read({ resource: "providers", method: "read" }, userCred, {
        provider: PROVIDER,
      }),
    ) as { provider: { revision: number } };
    const issued = await h.confirmation({
      action: "issue",
      request: {
        type: "confirmation_handle_register",
        window_id: "win-1",
        target_ref: PROVIDER,
        content_hash: await sha256Hex(canonicalize({ provider: PROVIDER })),
        allowed_decisions: ["DisconnectProvider"],
        expires_at: new Date(NOW + 600_000).toISOString(),
      },
    });
    assert(issued.ok, issued.ok ? undefined : JSON.stringify(issued.error));
    value(
      await h.command(userCred, {
        ...envelope(
          "DisconnectProvider",
          { provider: PROVIDER },
          { revision: provider.provider.revision },
        ),
        confirmation: (issued.value as { confirmation: string }).confirmation,
      } as never),
    );
    // 고른 선택은 그대로다. 그 provider를 고른 agent가 시작하지 않는 일은 resolve가 막는다.
    const after = await readDefaults(h);
    assertEquals(after.defaults.lophn, choice());
    assertEquals(
      (await readFavorites(h)).favorites.items.map((item) => item.provider),
      [PROVIDER],
    );
    // 없는 provider로 새로 저장하지는 못한다.
    code(
      await changeDefaults(
        h,
        userCred,
        { operator: choice() },
        saved.defaults.settings_seq,
      ),
      "not_found",
    );
  } finally {
    await h.close();
  }
});

// === ledger 통합 테스트(R8~R10, R12, R24, R26) ===

Deno.test("lophn-agent/harness/model#R8 [agent-I15]: defaults start empty and each role slot changes alone", async () => {
  const h = await open();
  try {
    await registerProvider(h);
    const before = await readDefaults(h);
    // 처음 값은 다섯 slot 모두 비어 있다(R9 처음 설치).
    assertEquals(before.defaults, {
      lophn: null,
      context_engineer: null,
      app_engineer: null,
      operator: null,
      summaries: null,
      settings_seq: "0",
    });

    const first = resultOf<DefaultsValue>(
      await changeDefaults(h, userCred, { lophn: choice() }, "0"),
    );
    // event seq가 새 settings_seq가 된다.
    const firstSeq = first.defaults.settings_seq;
    assert(firstSeq !== "0");
    assertEquals(first.defaults.lophn, choice());
    assertEquals(first.defaults.operator, null);

    // 다른 role을 바꿔도 lophn의 값은 그대로다.
    const second = resultOf<DefaultsValue>(
      await changeDefaults(
        h,
        userCred,
        {
          operator: choice({
            model_name: "claude-sonnet-4-5",
            option_values: { effort: "medium" },
          }),
          summaries: choice({ option_values: {} }),
        },
        firstSeq,
      ),
    );
    assert(BigInt(second.defaults.settings_seq) > BigInt(firstSeq));
    const after = await readDefaults(h);
    assertEquals(after.defaults, second.defaults);
    assertEquals(after.defaults.lophn, choice());
    assertEquals(after.defaults.operator?.model_name, "claude-sonnet-4-5");
    assertEquals(after.defaults.summaries?.option_values, {});
    assertEquals(after.defaults.context_engineer, null);
    assertEquals(after.defaults.app_engineer, null);

    // null은 그 slot만 비운다.
    const cleared = resultOf<DefaultsValue>(
      await changeDefaults(
        h,
        userCred,
        { lophn: null },
        second.defaults.settings_seq,
      ),
    );
    assertEquals(cleared.defaults.lophn, null);
    assertEquals(cleared.defaults.operator, second.defaults.operator);
    assertEquals(cleared.defaults.summaries, second.defaults.summaries);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/model#R8 [agent-I15]: the changed slots and the new snapshot ride the ModelDefaultsChanged event", async () => {
  const h = await open();
  try {
    await registerProvider(h);
    const first = resultOf<DefaultsValue>(
      await changeDefaults(
        h,
        userCred,
        { app_engineer: choice(), summaries: null },
        "0",
      ),
    );
    const events = value(
      await h.inspect(
        "select payload from events where type = 'ModelDefaultsChanged'",
        [],
      ),
    ) as { payload: string }[];
    assertEquals(events.length, 1);
    const payload = JSON.parse(events[0].payload) as {
      slots: string[];
      defaults: DefaultsValue["defaults"];
    };
    // 입력에 실은 slot만, 정해진 slot 순서로 싣는다.
    assertEquals(payload.slots, ["app_engineer", "summaries"]);
    assertEquals(payload.defaults.app_engineer, choice());
    assertEquals(payload.defaults.lophn, null);
    assertEquals(first.defaults.app_engineer, choice());
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/model#R9 [agent-I15]: a stale settings seq is a conflict and no row changes", async () => {
  const h = await open();
  try {
    await registerProvider(h);
    const first = resultOf<DefaultsValue>(
      await changeDefaults(h, userCred, { lophn: choice() }, "0"),
    );
    const stale = await changeDefaults(h, userCred, { lophn: null }, "0");
    code(stale as never, "conflict");
    // 거절된 변경은 아무 slot도 바꾸지 않는다.
    const after = await readDefaults(h);
    assertEquals(after.defaults, first.defaults);
    // 현재 seq로는 바뀐다.
    value(
      await changeDefaults(
        h,
        userCred,
        { lophn: null },
        first.defaults.settings_seq,
      ) as never,
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/model#R9 [agent-I15]: only user actors change model defaults and favorites", async () => {
  const h = await open();
  try {
    await registerProvider(h);
    // machine·agent는 user 전용 command에 쓸 수 없다.
    code(
      await changeDefaults(h, machineCred, { lophn: null }, "0") as never,
      "forbidden",
    );
    code(
      await changeDefaults(h, agentCred, { lophn: null }, "0") as never,
      "forbidden",
    );
    code(
      await changeFavorites(h, [], "0", machineCred) as never,
      "forbidden",
    );
    code(
      await changeFavorites(h, [], "0", agentCred) as never,
      "forbidden",
    );
    // 읽기는 user·machine 모두 된다.
    const read = await h.read(
      { resource: "agent-model-defaults", method: "read" },
      machineCred,
      {},
    );
    assertEquals(read.ok, true);
    const favorites = await h.read(
      { resource: "model-favorites", method: "read" },
      machineCred,
      {},
    );
    assertEquals(favorites.ok, true);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/model#R10 [agent-I15]: a defaults save rejects a model outside the provider list and keeps unchecked lists", async () => {
  const h = await open();
  try {
    await registerProvider(h);
    // 목록에 없는 이름은 저장 거절이고 어느 slot도 바뀌지 않는다.
    code(
      await changeDefaults(
        h,
        userCred,
        {
          lophn: choice(),
          operator: choice({ model_name: "not-a-model", option_values: {} }),
        },
        "0",
      ) as never,
      "invalid_input",
    );
    assertEquals((await readDefaults(h)).defaults.lophn, null);
    assertEquals((await readDefaults(h)).defaults.settings_seq, "0");
    // 없는 provider는 not_found다.
    code(
      await changeDefaults(
        h,
        userCred,
        { lophn: choice({ provider: OTHER_PROVIDER }) },
        "0",
      ) as never,
      "not_found",
    );
    // 목록을 확인하지 못한 이름(null)은 저장한다. 호출 때 unverified로 다룬다.
    const unchecked = resultOf<DefaultsValue>(
      await changeDefaults(
        h,
        userCred,
        {
          lophn: choice({ model_name: "list-unconfirmed", option_values: {} }),
        },
        "0",
      ),
    );
    assertEquals(unchecked.defaults.lophn?.model_name, "list-unconfirmed");
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/model#R24 [agent-I15]: a defaults save rejects an option axis or value the model does not declare", async () => {
  const h = await open();
  try {
    await registerProvider(h);
    // sonnet(예산 방식)에는 speed 축이 없다.
    code(
      await changeDefaults(
        h,
        userCred,
        {
          lophn: choice({
            model_name: "claude-sonnet-4-5",
            option_values: { speed: "fast" },
          }),
        },
        "0",
      ) as never,
      "invalid_input",
    );
    // opus의 effort에는 off가 없다.
    code(
      await changeDefaults(
        h,
        userCred,
        { lophn: choice({ option_values: { effort: "off" } }) },
        "0",
      ) as never,
      "invalid_input",
    );
    // catalog 항목이 없는 model(목록에는 있음)은 option 값 없이만 저장한다.
    code(
      await changeDefaults(
        h,
        userCred,
        {
          lophn: choice({
            model_name: "listed-without-catalog",
            option_values: { effort: "low" },
          }),
        },
        "0",
      ) as never,
      "invalid_input",
    );
    assertEquals((await readDefaults(h)).defaults.settings_seq, "0");
    const saved = resultOf<DefaultsValue>(
      await changeDefaults(
        h,
        userCred,
        {
          lophn: choice({
            model_name: "listed-without-catalog",
            option_values: {},
          }),
        },
        "0",
      ),
    );
    assertEquals(saved.defaults.lophn?.option_values, {});
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/model#R8 [agent-I15]: the defaults table holds one row per slot and nothing else about presets", async () => {
  const h = await open();
  try {
    await registerProvider(h);
    value(
      await changeDefaults(
        h,
        userCred,
        { lophn: choice(), summaries: choice({ option_values: {} }) },
        "0",
      ) as never,
    );
    const rows = value(
      await h.inspect(
        "select slot, provider, model_name, option_values from agent_model_defaults order by slot",
        [],
      ),
    ) as {
      slot: string;
      provider: string | null;
      model_name: string | null;
      option_values: string;
    }[];
    // 바꾼 slot만 행이 생기고 값은 그대로 저장된다.
    assertEquals(rows.map((row) => row.slot), ["lophn", "summaries"]);
    assertEquals(JSON.parse(rows[0].option_values), choice().option_values);
    assertEquals(JSON.parse(rows[1].option_values), {});
    const tables = value(
      await h.inspect(
        "select name from sqlite_master where type = 'table' and name in ('agent_model_defaults', 'model_favorites')",
        [],
      ),
    ) as { name: string }[];
    assertEquals(tables.map((table) => table.name).sort(), [
      "agent_model_defaults",
      "model_favorites",
    ]);
    // 옛 slot 이름은 저장하지 못한다.
    const old = await h.probeWrite(
      "insert into agent_model_defaults (slot, provider, model_name, option_values, settings_seq) values ('judgment', null, null, '{}', '1')",
      [],
    );
    assertEquals(old.ok, false);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/model#R26 [agent-I15]: favorites keep the order they were starred in across providers", async () => {
  const h = await open();
  try {
    await registerProvider(h);
    await registerProvider(h, OTHER_PROVIDER, 8081);
    const empty = await readFavorites(h);
    assertEquals(empty.favorites, { items: [], settings_seq: "0" });

    const a = { provider: PROVIDER, model_name: "claude-opus-4-8" };
    const b = { provider: OTHER_PROVIDER, model_name: "claude-sonnet-4-5" };
    const c = { provider: PROVIDER, model_name: "claude-sonnet-4-5" };
    const first = resultOf<FavoritesValue>(
      await changeFavorites(h, [b, a], "0"),
    );
    assertEquals(first.favorites.items, [b, a]);
    const firstSeq = first.favorites.settings_seq;
    assert(firstSeq !== "0");

    // 새로 찍은 것은 맨 끝에 붙고 provider로 다시 묶지 않는다.
    const second = resultOf<FavoritesValue>(
      await changeFavorites(h, [b, a, c], firstSeq),
    );
    assertEquals(second.favorites.items, [b, a, c]);
    assertEquals((await readFavorites(h)).favorites, second.favorites);

    // 끌어 옮긴 순서도 그대로 저장한다.
    const moved = resultOf<FavoritesValue>(
      await changeFavorites(h, [c, b, a], second.favorites.settings_seq),
    );
    assertEquals((await readFavorites(h)).favorites.items, [c, b, a]);

    // 하나를 끄면 나머지 순서는 그대로다.
    const removed = resultOf<FavoritesValue>(
      await changeFavorites(h, [c, a], moved.favorites.settings_seq),
    );
    assertEquals(removed.favorites.items, [c, a]);
    assertEquals((await readFavorites(h)).favorites.items, [c, a]);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/model#R26 [agent-I15]: a stale seq conflicts, a duplicate or unknown provider is rejected, and an emptied list still moves the seq", async () => {
  const h = await open();
  try {
    await registerProvider(h);
    const a = { provider: PROVIDER, model_name: "claude-opus-4-8" };
    const first = resultOf<FavoritesValue>(
      await changeFavorites(h, [a], "0"),
    );
    // 이전 seq는 conflict이고 목록은 그대로다.
    code(await changeFavorites(h, [], "0") as never, "conflict");
    assertEquals((await readFavorites(h)).favorites, first.favorites);
    // 같은 model을 두 번 싣는 목록은 거절한다.
    code(
      await changeFavorites(h, [a, a], first.favorites.settings_seq) as never,
      "invalid_input",
    );
    // 없는 provider는 not_found다.
    code(
      await changeFavorites(
        h,
        [{ provider: OTHER_PROVIDER, model_name: "x" }],
        first.favorites.settings_seq,
      ) as never,
      "not_found",
    );
    // 빈 목록으로 비워도 seq는 앞으로 가서 다음 변경이 그 seq를 비교한다.
    const emptied = resultOf<FavoritesValue>(
      await changeFavorites(h, [], first.favorites.settings_seq),
    );
    assertEquals(emptied.favorites.items, []);
    assert(
      BigInt(emptied.favorites.settings_seq) >
        BigInt(first.favorites.settings_seq),
    );
    assertEquals((await readFavorites(h)).favorites, emptied.favorites);
    code(
      await changeFavorites(h, [a], first.favorites.settings_seq) as never,
      "conflict",
    );
    value(
      await changeFavorites(h, [a], emptied.favorites.settings_seq) as never,
    );
    const events = value(
      await h.inspect(
        "select payload from events where type = 'ModelFavoritesChanged' order by seq",
        [],
      ),
    ) as { payload: string }[];
    assertEquals(events.length, 3);
    assertEquals(
      (JSON.parse(events[1].payload) as { items: unknown[] }).items,
      [],
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/model#R12 [agent-I15]: a favorite the catalog or provider list no longer has is kept and saved back unchanged", async () => {
  const h = await open();
  try {
    await registerProvider(h);
    const gone = { provider: PROVIDER, model_name: "retired-model" };
    const live = { provider: PROVIDER, model_name: "claude-opus-4-8" };
    // 목록에 없는 이름도 즐겨찾기로 저장한다(defaults와 달리 거절하지 않는다).
    const first = resultOf<FavoritesValue>(
      await changeFavorites(h, [gone, live], "0"),
    );
    assertEquals(first.favorites.items, [gone, live]);
    // 선택 화면이 통째로 되돌려 저장해도 사라진 항목은 제자리에 남는다.
    const again = resultOf<FavoritesValue>(
      await changeFavorites(h, [gone, live], first.favorites.settings_seq),
    );
    assertEquals(again.favorites.items, [gone, live]);
    assertEquals((await readFavorites(h)).favorites.items, [gone, live]);
    // 저장된 기본값도 catalog 변화로 지우지 않는다: 읽기는 catalog를 보지 않는다.
    value(
      await changeDefaults(h, userCred, { lophn: choice() }, "0") as never,
    );
    assertEquals((await readDefaults(h)).defaults.lophn, choice());
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/agents#R9 lophn-agent/harness/model#R8 [agent-I10a]: the Workspace layer of an agent is the role slots of the defaults, without empty slots and the summaries slot", () => {
  const choice = {
    provider: "pvd_01arz3ndektsv4rrffq69g5fav",
    model_name: "gpt-5",
    option_values: { effort: "high" },
  };
  assertEquals(
    workspaceModels({
      lophn: choice,
      context_engineer: null,
      app_engineer: null,
      operator: choice,
      summaries: { ...choice, model_name: "mini" },
      settings_seq: "4",
    }),
    { lophn: choice, operator: choice },
  );
  assertEquals(
    workspaceModels({
      lophn: null,
      context_engineer: null,
      app_engineer: null,
      operator: null,
      summaries: null,
      settings_seq: "0",
    }),
    {},
  );
});
