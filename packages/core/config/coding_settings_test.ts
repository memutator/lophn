import { assert, assertEquals, assertFalse } from "@std/assert";
import type { Result } from "../../base/mod.ts";
import {
  type AuthenticatedContext,
  type SqlRow,
} from "../../protocol/server/mod.ts";

// coding-agent harness 설정 검증 연결 테스트(platform/settings#R31, platform#T35).
// merge_test.ts와 같은 타입 경계다. platform ledger 모듈과 settings 모듈의 전체
// 타입을 부르지 않는다.
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
  const specifier = "../testing/ledger.ts";
  const harness = await import(specifier);
  return harness.createLedgerHarness(options);
}

const registration = new URL("./harness-fixture_test.ts", import.meta.url);

const OPERATIONS = [
  "SettingsDefinitions",
  "GetSettings",
  "SettingsHistory",
  "ApplySettings",
  "ReloadSettings",
  "settings.tests.record_choice",
];

function credential(actor = "user"): AuthenticatedContext {
  return {
    actor,
    principal: "test-user",
    credential_ref: `test:test-user:${actor}`,
    scope: { operations: [...OPERATIONS], targets: {} },
    conditions: {},
  };
}

const user = credential();

function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

function failure<T>(result: Result<T>): { code: string; message: string } {
  assert(!result.ok, "거절을 기다렸다");
  return { code: result.error.code, message: result.error.message };
}

function applyEnvelope(
  key: string,
  mutations: unknown,
  revision: number,
  defaults_revision: string,
): CommandEnvelope {
  return {
    command: "ApplySettings",
    input: { changes: mutations },
    idempotency_key: key,
    compare: { revision, defaults_revision },
    prepared: [],
  };
}

async function state(
  harness: LedgerHarness,
): Promise<{ revision: number; defaults_revision: string }> {
  const rows = value(
    await harness.inspect(
      "select revision, defaults_revision from settings_state where key = 1",
      [],
    ),
  );
  const definitions = value(
    await harness.read(
      { resource: "settings", method: "definitions" },
      user,
      {},
    ),
  ) as { defaults_revision: string };
  return {
    revision: Number(rows[0]?.["revision"] ?? 0),
    defaults_revision: String(
      rows[0]?.["defaults_revision"] ?? definitions.defaults_revision,
    ),
  };
}

function choiceMutation(key: string, value: unknown): unknown {
  return { layer: "common", key, action: "set", value };
}

async function choices(
  harness: LedgerHarness,
): Promise<Map<string, unknown>> {
  const rows = value(
    await harness.inspect(
      "select key, value from setting_choices",
      [],
    ),
  );
  return new Map(
    rows.map((row) => [String(row["key"]), JSON.parse(String(row["value"]))]),
  );
}

// 소유 concern(coding-agent/harnesses)의 schema가 enabled·기본 harness·profile
// 선택을 검증하고 실행 파일 경로·감지·receipt 자료는 일반 설정이 아니다(R31).
Deno.test(
  "platform/settings#R31: enabled·기본 harness·profile 선택은 소유 concern의 schema 검증을 따른다",
  async () => {
    const opened = await createLedgerHarness({
      registrationModules: [registration],
      credentials: [user],
    });
    if (!opened.ok) throw new Error(opened.error.code);
    const harness = opened.value;
    try {
      const defaults = (await state(harness)).defaults_revision;
      // 소유 contract의 value_type이 받는 값은 적용된다. 기본 harness는
      // HARNESS_IDS 목록의 codex다(R31).
      const codex = value(
        await harness.command(
          user,
          applyEnvelope(
            "r31-codex",
            [choiceMutation("coding-agent.default_harness", "codex")],
            0,
            defaults,
          ),
        ),
      );
      assertEquals((codex.result as { changed: boolean }).changed, true);
      // enabled은 boolean이다. false도 소유 schema가 허용한 값이다(R31).
      const disabled = value(
        await harness.command(
          user,
          applyEnvelope(
            "r31-disabled",
            [choiceMutation("coding-agent.harnesses.enabled", false)],
            1,
            defaults,
          ),
        ),
      );
      assertEquals((disabled.result as { changed: boolean }).changed, true);
      // profile은 1-128자 문자열이다(R31).
      const profile = value(
        await harness.command(
          user,
          applyEnvelope(
            "r31-profile",
            [choiceMutation("coding-agent.harnesses.profile", "review")],
            2,
            defaults,
          ),
        ),
      );
      assertEquals((profile.result as { changed: boolean }).changed, true);
      const get = value(
        await harness.read({ resource: "settings", method: "get" }, user, {
          keys: [
            "coding-agent.default_harness",
            "coding-agent.harnesses.enabled",
            "coding-agent.harnesses.profile",
          ],
        }),
      ) as {
        settings: {
          key: string;
          value: unknown;
          source_layer: string | null;
        }[];
      };
      const byKey = new Map(get.settings.map((s) => [s.key, s]));
      assertEquals(byKey.get("coding-agent.default_harness")?.value, "codex");
      assertEquals(byKey.get("coding-agent.harnesses.enabled")?.value, false);
      assertEquals(
        byKey.get("coding-agent.harnesses.profile")?.value,
        "review",
      );
      // 저장 선택은 common 층이다(R31).
      assertEquals(
        byKey.get("coding-agent.default_harness")?.source_layer,
        "common",
      );
    } finally {
      await harness.close();
    }
  },
);

// 소유 schema가 거절하는 값(enabled 비boolean, 모르는 harness ID, profile 128자
// 초과·빈 문자열)은 settings apply도 거절이고 판은 그대로다(R31).
Deno.test(
  "platform/settings#R31: 소유 schema 밖의 harness 설정 값은 invalid_input이고 판을 바꾸지 않는다",
  async () => {
    const opened = await createLedgerHarness({
      registrationModules: [registration],
      credentials: [user],
    });
    if (!opened.ok) throw new Error(opened.error.code);
    const harness = opened.value;
    try {
      const defaults = (await state(harness)).defaults_revision;
      // 모르는 harness ID는 harnessIdSchema가 거절이다(R31).
      const unknownHarness = failure(
        await harness.command(
          user,
          applyEnvelope(
            "r31-unknown-harness",
            [choiceMutation("coding-agent.default_harness", "cursor")],
            0,
            defaults,
          ),
        ),
      );
      assertEquals(unknownHarness.code, "invalid_input");
      // enabled에 boolean 밖 값은 거절이다(R31).
      const badEnabled = failure(
        await harness.command(
          user,
          applyEnvelope(
            "r31-bad-enabled",
            [choiceMutation("coding-agent.harnesses.enabled", "yes")],
            0,
            defaults,
          ),
        ),
      );
      assertEquals(badEnabled.code, "invalid_input");
      // profile의 128자 초과는 거절이다(R31).
      const longProfile = failure(
        await harness.command(
          user,
          applyEnvelope(
            "r31-long-profile",
            [choiceMutation("coding-agent.harnesses.profile", "a".repeat(129))],
            0,
            defaults,
          ),
        ),
      );
      assertEquals(longProfile.code, "invalid_input");
      // profile의 빈 문자열은 거절이다(R31).
      const emptyProfile = failure(
        await harness.command(
          user,
          applyEnvelope(
            "r31-empty-profile",
            [choiceMutation("coding-agent.harnesses.profile", "")],
            0,
            defaults,
          ),
        ),
      );
      assertEquals(emptyProfile.code, "invalid_input");
      // 거절 뒤에도 선택은 없고 판은 0이다(R31, 실패는 판을 유지한다).
      const get = value(
        await harness.read({ resource: "settings", method: "get" }, user, {
          keys: [
            "coding-agent.default_harness",
            "coding-agent.harnesses.enabled",
            "coding-agent.harnesses.profile",
          ],
        }),
      ) as {
        settings: {
          key: string;
          value: unknown;
          source_layer: string | null;
        }[];
        revision: number;
      };
      assertEquals(get.revision, 0);
      const byKey = new Map(get.settings.map((s) => [s.key, s]));
      // 선택이 없으면 내장 기본값을 따른다(R31).
      assertEquals(byKey.get("coding-agent.default_harness")?.value, null);
      assertEquals(
        byKey.get("coding-agent.default_harness")?.source_layer,
        "builtin",
      );
      assertEquals(byKey.get("coding-agent.harnesses.enabled")?.value, true);
      // default_present: false인 profile은 resolved false다(R31).
      const profile = byKey.get("coding-agent.harnesses.profile");
      assertEquals(profile?.source_layer, null);
    } finally {
      await harness.close();
    }
  },
);

// 기본 harness가 비면(명시 null의 common 선택) 소유 concern의 단일 후보 제안·
// 여러 후보 선택 규칙이 계산 자리다. 후보 실행 경로·감지 결과를 common 선택으로
// 저장하지 않는다(R31 확인).
Deno.test(
  "platform/settings#R31: 기본 harness null은 제안 계산을 남기고 후보 경로·감지를 common 선택으로 저장하지 않는다",
  async () => {
    const opened = await createLedgerHarness({
      registrationModules: [registration],
      credentials: [user],
    });
    if (!opened.ok) throw new Error(opened.error.code);
    const harness = opened.value;
    try {
      const defaults = (await state(harness)).defaults_revision;
      // 명시 null도 explicit 선택이다(value_type의 nullable schema, R31).
      const cleared = value(
        await harness.command(
          user,
          applyEnvelope(
            "r31-clear",
            [choiceMutation("coding-agent.default_harness", null)],
            0,
            defaults,
          ),
        ),
      );
      assertEquals((cleared.result as { changed: boolean }).changed, true);
      const get = value(
        await harness.read({ resource: "settings", method: "get" }, user, {
          keys: ["coding-agent.default_harness"],
        }),
      ) as {
        settings: {
          value: unknown;
          source_layer: string | null;
          choices: unknown[];
        }[];
      };
      assertEquals(get.settings[0].value, null);
      assertEquals(get.settings[0].source_layer, "common");
      assertEquals(get.settings[0].choices.length, 1);
      // 후보 감지 자료(실행 파일 경로·source·executable result)는
      // harnessCandidateSchema 모양이고 일반 설정 항목이 아니다(R31). registry에
      // 그런 항목이 등록되지 않았는지 본다.
      const definitions = value(
        await harness.read(
          { resource: "settings", method: "definitions" },
          user,
          {},
        ),
      ) as { definitions: { key: string; machine_local: boolean }[] };
      assert(
        definitions.definitions.some((definition) =>
          definition.key === "coding-agent.default_harness"
        ),
      );
      assertFalse(
        definitions.definitions.some((definition) =>
          definition.key.startsWith("coding-agent.harnesses.path") ||
          definition.key.startsWith("coding-agent.harnesses.detection") ||
          definition.key.startsWith("coding-agent.harnesses.receipt")
        ),
      );
      // 감지·receipt 모양의 값은 choice로 받지 않는다(등록되지 않은 항목, R31).
      const pathChoice = failure(
        await harness.command(
          user,
          applyEnvelope(
            "r31-path-choice",
            [
              choiceMutation("coding-agent.harnesses.receipt", {
                path: "/usr/local/bin/codex",
                source: "PATH",
                executable_result: "verified",
              }),
            ],
            1,
            defaults,
          ),
        ),
      );
      assertEquals(pathChoice.code, "invalid_input");
      // 선택 원본에는 명시 null 하나만 남는다(R31).
      const stored = await choices(harness);
      assertEquals(stored.size, 1);
      assertEquals(stored.get("coding-agent.default_harness"), null);
    } finally {
      await harness.close();
    }
  },
);

// 실행 파일 경로·감지·receipt·session 관측은 machine-local 자료로 분리되고
// 설정 TOML export에 섞이지 않는다(R31).
Deno.test(
  "platform/settings#R31: harness 설정 export는 TOML 원본이고 경로·감지·receipt 자료가 없다",
  async () => {
    const { exportSettingsTOML } = await import("./mod.ts");
    const opened = await createLedgerHarness({
      registrationModules: [registration],
      credentials: [user],
    });
    if (!opened.ok) throw new Error(opened.error.code);
    const harness = opened.value;
    try {
      const defaults = (await state(harness)).defaults_revision;
      // harness 설정 3개를 적용한다.
      value(
        await harness.command(
          user,
          applyEnvelope(
            "r31-export",
            [
              choiceMutation("coding-agent.harnesses.enabled", true),
              choiceMutation("coding-agent.default_harness", "claude"),
              choiceMutation("coding-agent.harnesses.profile", "review"),
            ],
            0,
            defaults,
          ),
        ),
      );
      const get = value(
        await harness.read({ resource: "settings", method: "get" }, user, {}),
      ) as {
        settings: {
          key: string;
          resolved: boolean;
          value: unknown;
          choices: { layer: string; key: string; value: unknown }[];
        }[];
      };
      // export는 common 선택(명시 선택)만 옮긴다. machine-local 항목·관측은
      // 값 검증에서 이미 registry에 없으므로 export 입력에 들어오지 않는다(R31).
      const chosen = get.settings.flatMap((setting) =>
        setting.choices.map((choice) => ({
          layer: "common" as const,
          key: setting.key,
          action: "set" as const,
          value: choice.value as never,
        }))
      );
      assert(chosen.length > 0);
      const text = value(exportSettingsTOML({ mutations: chosen }));
      // TOML 1.0 format version 1 원본이다(R31).
      assert(text.includes("[exchange]"));
      assert(text.includes(`format_version = 1`));
      // 소유 설정의 선택 값은 두고 실행 경로·감지·receipt 모양은 없다(R31).
      assert(text.includes(`[settings."coding-agent.default_harness"]`));
      assert(text.includes('"claude"'));
      assertFalse(/\/(usr|bin|home)\//.test(text));
      assertFalse(text.includes("executable_result"));
      assertFalse(text.includes("detected"));
      // machine_local 항목이 export 대상으로 들어오지 않는지 정확히 본다(R31).
      const machineLocalChosen = get.settings.filter((setting) =>
        setting.key === "coding-agent.harnesses.enabled"
      ).flatMap((setting) => setting.choices);
      assertEquals(machineLocalChosen.length, 1);
    } finally {
      await harness.close();
    }
  },
);
