import { assert, assertEquals, assertFalse } from "@std/assert";
import type { Result } from "../../base/mod.ts";
import type {
  AuthenticatedContext,
  SqlRow,
} from "../../contracts/platform/mod.ts";

// harness 값 타입만 선언한다. platform ledger 모듈과 settings 모듈의 전체
// 타입을 부르지 않기 위해서다(packages/documents/projects/ledger_test.ts 관례).
type CommandEnvelope = {
  command: string;
  input: unknown;
  idempotency_key: string;
  compare: unknown;
  prepared: readonly string[];
};
type LedgerHarness = {
  command(
    ctx: AuthenticatedContext,
    envelope: CommandEnvelope,
  ): Promise<Result<{ result: unknown; replayed: boolean }>>;
  read(
    route: { resource: string; method: string },
    ctx: AuthenticatedContext,
    input: unknown,
  ): Promise<Result<unknown>>;
  inspect(
    query: string,
    params?: readonly unknown[],
  ): Promise<Result<SqlRow[]>>;
  close(): Promise<void>;
};
async function createLedgerHarness(options: {
  registrationModules: readonly URL[];
  credentials?: readonly AuthenticatedContext[];
}): Promise<Result<LedgerHarness>> {
  const specifier = "../../../apps/core/testing/ledger.ts";
  const harness = await import(specifier);
  return harness.createLedgerHarness(options);
}

const registration = new URL("./harness-fixture_test.ts", import.meta.url);

function credential(actor = "user"): AuthenticatedContext {
  return {
    actor,
    principal: "test-user",
    credential_ref: `test:test-user:${actor}`,
    scope: {
      operations: ["SettingsDefinitions", "GetSettings", "settings.tests.record_choice"],
      targets: {},
    },
    conditions: {},
  };
}

const user = credential();

function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

function rows(result: Result<SqlRow[]>): SqlRow[] {
  return value(result);
}

function envelope(
  command: string,
  key: string,
  input: unknown,
): CommandEnvelope {
  return { command, input, compare: {}, idempotency_key: key, prepared: [] };
}

// 원본 표 기록은 writer transaction 안에서 dispatch하는 record-choice로 남긴다(R2).
function recordChoice(
  key: string,
  value: string,
  idempotencyKey: string,
): CommandEnvelope {
  return envelope("settings.tests.record_choice", idempotencyKey, { key, value });
}

Deno.test("platform/settings#R2, platform/settings#R10: 선택 원본은 ledger에 두고 항목마다 적용값·층·선택을 조회한다", async () => {
  const opened = await createLedgerHarness({
    registrationModules: [registration],
    credentials: [user],
  });
  if (!opened.ok) throw new Error(opened.error.code);
  const harness = opened.value;
  try {
    // 사용자 선택을 원본 표에 기록한다(R2).
    value(await harness.command(user, recordChoice("shell.reading_width", "90", "choice-90")));
    const get = value(
      await harness.read({ resource: "settings", method: "get" }, user, {}),
    ) as { settings: { key: string; resolved: boolean; value: unknown; source_layer: string | null; choices: unknown[] }[]; revision: number };
    const width = get.settings.find((setting) => setting.key === "shell.reading_width");
    assert(width !== undefined);
    assertEquals(width.resolved, true);
    assertEquals(width.value, 90);
    assertEquals(width.source_layer, "common");
    assertEquals(width.choices.length, 1);
    // 선택하지 않은 항목은 내장 기본값을 따른다.
    const tracking = get.settings.find((setting) => setting.key === "documents.tracking");
    assert(tracking !== undefined);
    assertEquals(tracking.resolved, true);
    assertEquals(tracking.source_layer, "builtin");
    assertEquals(tracking.value, { patterns: ["**/*.md"] });
    assertEquals(tracking.choices.length, 0);
  } finally {
    await harness.close();
  }
});

Deno.test("platform/settings#R2: 명시 선택과 선택 기록 삭제를 구별하고 null도 명시값이다", async () => {
  const opened = await createLedgerHarness({
    registrationModules: [registration],
    credentials: [user],
  });
  if (!opened.ok) throw new Error(opened.error.code);
  const harness = opened.value;
  try {
    value(await harness.command(user, recordChoice("coding.harness", "null", "choice-null")));
    const get = value(
      await harness.read({ resource: "settings", method: "get" }, user, {
        keys: ["coding.harness"],
      }),
    ) as { settings: { key: string; resolved: boolean; value: unknown; source_layer: string | null; choices: unknown[] }[] };
    const harness_choice = get.settings[0];
    assertEquals(harness_choice.resolved, true);
    assertEquals(harness_choice.value, null);
    assertEquals(harness_choice.source_layer, "common");
    assertEquals(harness_choice.choices.length, 1);
    // 기록이 없는 항목은 builtin 기본값(null)이고 선택 근거가 없다.
    const absent = value(
      await harness.read({ resource: "settings", method: "get" }, user, {
        keys: ["documents.tracking"],
      }),
    ) as { settings: { key: string; resolved: boolean; value: unknown; source_layer: string | null; choices: unknown[] }[] };
    assertEquals(absent.settings[0].resolved, true);
    assertEquals(absent.settings[0].source_layer, "builtin");
    assertEquals(absent.settings[0].choices.length, 0);
  } finally {
    await harness.close();
  }
});

Deno.test("platform/settings#R6, platform/settings#R16: 작업 자료·환경변수 출처는 층이 아니고 안전 규칙 항목도 없다", async () => {
  const opened = await createLedgerHarness({
    registrationModules: [registration],
    credentials: [user],
  });
  if (!opened.ok) throw new Error(opened.error.code);
  const harness = opened.value;
  try {
    const definitions = value(
      await harness.read(
        { resource: "settings", method: "definitions" },
        user,
        {},
      ),
    ) as { definitions: { key: string; layers: string[] }[] };
    const layers = definitions.definitions.flatMap((definition) => definition.layers);
    assertEquals([...new Set(layers)], ["common"]);
    assert(
      !definitions.definitions.some((definition) =>
        definition.key.startsWith("security.") ||
        definition.key.startsWith("identity.")
      ),
    );
    // 작업 자료·환경변수 출처 항목은 등록되지 않는다.
    assertFalse(definitions.definitions.some((definition) => definition.key === "session.work_dir"));
    assertFalse(definitions.definitions.some((definition) => definition.key === "env.path"));
    const choices = rows(
      await harness.inspect("select count(*) as count from setting_choices", []),
    );
    assertEquals(Number(choices[0]?.["count"]), 0);
  } finally {
    await harness.close();
  }
});

Deno.test("platform/settings#R5, platform/settings#R8: common이 builtin보다 우선하고 object는 항목별로 합쳐진다", async () => {
  const opened = await createLedgerHarness({
    registrationModules: [registration],
    credentials: [user],
  });
  if (!opened.ok) throw new Error(opened.error.code);
  const harness = opened.value;
  try {
    // builtin: { patterns: ["**/*.md"] }, common 선택: { patterns: ["user/*.md"] }
    value(
      await harness.command(
        user,
        recordChoice(
          "documents.tracking",
          JSON.stringify({ patterns: ["user/*.md"] }),
          "choice-tracking",
        ),
      ),
    );
    const get = value(
      await harness.read({ resource: "settings", method: "get" }, user, {
        keys: ["documents.tracking"],
      }),
    ) as { settings: { value: unknown; source_layer: string }[] };
    assertEquals(get.settings[0].source_layer, "common");
    assertEquals(get.settings[0].value, { patterns: ["user/*.md"] });
  } finally {
    await harness.close();
  }
});
