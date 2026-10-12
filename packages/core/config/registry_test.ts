import { assert, assertEquals, assertFalse } from "@std/assert";
import { z } from "zod";
import type { Result } from "../../base/mod.ts";
import type {
  JsonValue,
  SettingDefinition,
} from "../../protocol/server/mod.ts";
import {
  containsCredentialSecret,
  defaultsRevisionText,
  effectiveSetting,
  mergeValue,
  offlineAllowed,
  requiresOwnerCheck,
  validateChoice,
  validateConstraints,
} from "./mod.ts";
import { SettingRegistry, validateDefinition } from "./registry.ts";

const width: SettingDefinition<z.ZodNumber> = {
  key: "shell.reading_width",
  owner: "shell/workspace",
  display_name_key: "settings.reading_width.name",
  description: "settings.reading_width.description",
  value_meaning_key: "settings.reading_width.value",
  default_meaning_key: "settings.reading_width.default",
  affected_features: ["shell/workspace"],
  risk_key: "settings.reading_width.risk",
  revert_key: "settings.reading_width.revert",
  value_type: z.number().int().min(40).max(120),
  default_present: true,
  default: 80,
  required: false,
  constraints: { minimum: 40, maximum: 120, unit: "characters" },
  layers: ["common"],
  apply_at: "current_check",
  apply_at_key: "settings.reading_width.apply_at",
  machine_local: false,
};

const tracked: SettingDefinition<
  z.ZodObject<{ patterns: z.ZodArray<z.ZodString> }>
> = {
  key: "documents.tracking",
  owner: "documents/tracking",
  display_name_key: "settings.tracking.name",
  description: "settings.tracking.description",
  value_meaning_key: "settings.tracking.value",
  default_meaning_key: "settings.tracking.default",
  affected_features: ["documents/tracking"],
  risk_key: "settings.tracking.risk",
  revert_key: "settings.tracking.revert",
  value_type: z.object({ patterns: z.array(z.string()) }),
  default_present: true,
  default: { patterns: ["**/*.md"] },
  required: false,
  constraints: {},
  layers: ["common"],
  apply_at: "next_run",
  apply_at_key: "settings.tracking.apply_at",
  machine_local: false,
};

const nullableDefault: SettingDefinition<z.ZodNullable<z.ZodString>> = {
  key: "coding.harness",
  owner: "coding-agent/harnesses",
  display_name_key: "settings.harness.name",
  description: "settings.harness.description",
  value_meaning_key: "settings.harness.value",
  default_meaning_key: "settings.harness.default",
  affected_features: ["coding-agent/harnesses"],
  risk_key: "settings.harness.risk",
  revert_key: "settings.harness.revert",
  value_type: z.nullable(z.string()),
  default_present: true,
  default: null,
  required: false,
  constraints: {},
  layers: ["common"],
  apply_at: "next_run",
  apply_at_key: "settings.harness.apply_at",
  machine_local: false,
};

const noDefault: SettingDefinition<z.ZodString> = {
  key: "agent.account",
  owner: "lophn-agent/presets",
  display_name_key: "settings.account.name",
  description: "settings.account.description",
  value_meaning_key: "settings.account.value",
  default_meaning_key: "settings.account.default",
  affected_features: ["lophn-agent/presets"],
  risk_key: "settings.account.risk",
  revert_key: "settings.account.revert",
  value_type: z.string(),
  default_present: false,
  required: true,
  constraints: {},
  layers: ["common"],
  apply_at: "next_call",
  apply_at_key: "settings.account.apply_at",
  machine_local: false,
};

function choice(key: string, value: JsonValue) {
  return { layer: "common" as const, key, value };
}

function code(result: Result<unknown>): string {
  assertFalse(result.ok);
  return result.error.code;
}

function validation(result: Result<unknown>) {
  assertFalse(result.ok);
  const details = result.error.details as
    | { validation?: { expected: string; remedy: string; key: string } }
    | undefined;
  assert(details?.validation !== undefined);
  return details.validation;
}

Deno.test("platform/settings#R1, platform/settings#R4: 설명·종류·기본값·허용값·층·적용 시점이 없으면 등록을 거절한다", () => {
  assertEquals(SettingRegistry, SettingRegistry);
  assertEquals(
    code(
      validateDefinition({
        ...width,
        description: undefined as unknown as string,
      }),
    ),
    "invalid_input",
  );
  assertEquals(
    code(
      validateDefinition({
        ...width,
        value_type: undefined as unknown as z.ZodNumber,
      }),
    ),
    "invalid_input",
  );
  assertEquals(
    code(validateDefinition({ ...width, layers: [] })),
    "invalid_input",
  );
  assertEquals(
    code(validateDefinition({ ...width, affected_features: [] })),
    "invalid_input",
  );
  assertEquals(
    code(
      validateDefinition({
        ...width,
        apply_at: undefined as unknown as "current_check",
      }),
    ),
    "invalid_input",
  );
  assertEquals(
    code(validateDefinition({ ...width, key: "ReadingWidth" })),
    "invalid_input",
  );
  assert(validateDefinition(width).ok);
  const registry = new SettingRegistry([width, tracked]);
  assertEquals(registry.defaultsRevision.length > 0, true);
});

Deno.test("platform/settings#R1: 공개 목록 밖의 항목은 거절하고 선택하지 않은 항목은 registry에 없다", () => {
  const registry = new SettingRegistry([width, tracked]);
  assertFalse(registry.has("shell.width"));
  assert(registry.has("shell.reading_width"));
});

Deno.test("platform/settings#R4: 필수 선택은 임의 값으로 채우지 않고 resolved=false다", () => {
  const state = effectiveSetting(noDefault, undefined, 0);
  assertFalse(state.resolved);
  assertEquals(state.value, null);
  assertEquals(state.source_layer, null);
});

Deno.test("platform/settings#R8: 낮은 두 원소 목록에 높은 한 원소 목록은 한 원소만 남는다", () => {
  const merged = mergeValue(tracked, { patterns: ["a.md", "b.md"] }, {
    patterns: ["c.md"],
  });
  assertEquals(merged, { patterns: ["c.md"] });
});

Deno.test("platform/settings#R8: object는 항목별로 병합하고 생략 항목은 낮은 층을 따른다", () => {
  const lower = { patterns: ["a.md"], use_gitignore: true };
  const higher = { patterns: ["c.md"] };
  assertEquals(mergeValue(tracked, lower, higher), {
    patterns: ["c.md"],
    use_gitignore: true,
  });
});

Deno.test("platform/settings#R8, platform/settings#R9: 생략은 낮은 층을 따르고 명시 null·false·빈 목록은 교체다", () => {
  assertEquals(mergeValue(tracked, { patterns: ["a.md"] }, {}), {
    patterns: ["a.md"],
  });
  assertEquals(mergeValue(tracked, { patterns: ["a.md"] }, { patterns: [] }), {
    patterns: [],
  });
  assertEquals(mergeValue(nullableDefault, "c1", null), null);
  assertEquals(mergeValue(width, 80, false), false);
});

Deno.test("platform/settings#R9: nullable 기본 harness를 null로 저장한 것과 선택 기록 삭제를 구별한다", () => {
  const registry = new SettingRegistry([nullableDefault]);
  const explicit = effectiveSetting(
    nilDefault(registry),
    choice("coding.harness", null),
    3,
  );
  assertEquals(explicit.resolved, true);
  assertEquals(explicit.value, null);
  assertEquals(explicit.source_layer, "common");
  assertEquals(explicit.choices.length, 1);
  const chosen = effectiveSetting(
    nullableDefault,
    choice("coding.harness", "c1"),
    3,
  );
  assertEquals(chosen.value, "c1");
  assertEquals(chosen.source_layer, "common");
  const builtin = effectiveSetting(nullableDefault, undefined, 3);
  assertEquals(builtin.resolved, true);
  assertEquals(builtin.value, null);
  assertEquals(builtin.source_layer, "builtin");
  assertEquals(builtin.choices.length, 0);
});

function nilDefault(
  _registry: SettingRegistry,
): SettingDefinition<z.ZodNullable<z.ZodString>> {
  return nullableDefault;
}

Deno.test("platform/settings#R2: 내장 기본값을 바꾸면 선택하지 않은 항목만 새 기본값을 따른다", () => {
  const before = new SettingRegistry([tracked]);
  const chosen = effectiveSetting(
    tracked,
    choice("documents.tracking", { patterns: ["user.md"] }),
    1,
  );
  assertEquals(chosen.source_layer, "common");
  // default 변경을 반영한 registry
  const after = new SettingRegistry([{
    ...tracked,
    default: { patterns: ["new-default.md"] },
  }]);
  const defaultChanged = effectiveSetting(
    after.definition("documents.tracking") ?? tracked,
    undefined,
    2,
  );
  assertEquals(defaultChanged.value, { patterns: ["new-default.md"] });
  assertEquals(defaultChanged.source_layer, "builtin");
  // 선택한 항목은 여전히 사용자 선택을 유지한다
  const kept = effectiveSetting(
    tracked,
    choice("documents.tracking", { patterns: ["user.md"] }),
    2,
  );
  assertEquals(kept.value, { patterns: ["user.md"] });
  assert(before.defaultsRevision !== after.defaultsRevision);
});

Deno.test("platform/settings#R10: 항목마다 적용값·정한 층·선택 근거를 조회한다", () => {
  const state = effectiveSetting(width, choice(width.key, 90), 5);
  assertEquals(state.value, 90);
  assertEquals(state.source_layer, "common");
  assertEquals(state.choices, [choice(width.key, 90)]);
  assertEquals(state.revision, 5);
  assertEquals(state.apply_at, "current_check");
});

Deno.test("platform/settings#R11, platform/settings#R14: 문법 단계 오류는 항목·기대·고칠 방법을 알린다", () => {
  const registry = new SettingRegistry([width, tracked]);
  const unknownCode = code(
    validateChoice(registry.definitions, choice("shell.width", 90)),
  );
  assertEquals(unknownCode, "invalid_input");
  const typeError = validateChoice(
    registry.definitions,
    choice("shell.reading_width", "wide"),
  );
  assertEquals(code(typeError), "invalid_input");
  const detail = validation(typeError);
  assertEquals(detail.key, "shell.reading_width");
  assert(detail.expected.length > 0);
  assert(detail.remedy.length > 0);
});

Deno.test("platform/settings#R11, platform/settings#R12: 타입이 다르면 변환 없이 거절한다", () => {
  const registry = new SettingRegistry([width]);
  assertEquals(
    code(
      validateChoice(registry.definitions, choice("shell.reading_width", "80")),
    ),
    "invalid_input",
  );
  assertEquals(
    code(
      validateChoice(registry.definitions, choice("shell.reading_width", 300)),
    ),
    "invalid_input",
  );
  assertEquals(
    code(
      validateChoice(registry.definitions, {
        layer: "common",
        key: "shell.reading_width",
        value: 90.5,
      }),
    ),
    "invalid_input",
  );
});

Deno.test("platform/settings#R11: 허용 층 밖 입력은 거절한다", () => {
  const registry = new SettingRegistry([width]);
  assertEquals(
    code(
      validateChoice(registry.definitions, {
        layer: "session",
        key: "shell.reading_width",
        value: 90,
      }),
    ),
    "invalid_input",
  );
});

Deno.test("platform/settings#R11, platform/settings#R13: 숫자 범위와 대상 관계는 constraints 선언에 따른다", () => {
  assertEquals(
    code(validateConstraints(width, 39)),
    "invalid_input",
  );
  assertEquals(
    code(validateConstraints(width, 121)),
    "invalid_input",
  );
  assertEquals(validateConstraints(width, 40).ok, true);
  assert(
    requiresOwnerCheck({
      ...tracked,
      constraints: { target_ref: "documents.tracking_root" },
    }),
  );
  assertFalse(requiresOwnerCheck(tracked));
  assertFalse(offlineAllowed(width, { offline_unconfirmed: true }));
  assert(
    offlineAllowed({
      ...width,
      constraints: { allow_offline_unconfirmed: true },
    }, { offline_unconfirmed: true }),
  );
});

Deno.test("platform/settings#R13: offline 미확인은 소유 concern이 허용할 때만 받는다", () => {
  assert(offlineAllowed(width, {}));
  assertFalse(offlineAllowed(width, { offline_unconfirmed: true }));
});

Deno.test("platform/settings#R15: secret 원문을 거절하고 문자열 검사는 platform/redaction 규칙 shape을 따른다", () => {
  assert(containsCredentialSecret("sk-abcdef0123456789abcdef"));
  assert(containsCredentialSecret("ghp_abcdef0123456789abcdef0123456789"));
  assertFalse(containsCredentialSecret("80"));
  const textSetting = {
    ...width,
    key: "shell.note_text",
    value_type: z.string().min(1),
  } as unknown as SettingDefinition<z.ZodString>;
  const registry = new SettingRegistry([textSetting]);
  const rejected = validateChoice(
    registry.definitions,
    choice("shell.note_text", "sk-abcdef0123456789abcdef"),
  );
  assertEquals(code(rejected), "forbidden");
  const detail = validation(rejected);
  assertEquals(detail.expected, "protected reference");
});

Deno.test("platform/settings#R16: 권한·안전 규칙을 푸는 항목은 일반 설정 층에 없다", () => {
  const registry = new SettingRegistry([
    width,
    tracked,
    nullableDefault,
    noDefault,
  ]);
  const allKeys = registry.definitions.map((definition) => definition.key);
  assertFalse(allKeys.includes("security.danger"));
  assertFalse(allKeys.includes("identity.allow_all"));
  assert(!allKeys.some((key) => key.startsWith("security.")));
  assert(!allKeys.some((key) => key.startsWith("identity.")));
});

Deno.test("platform/settings#R1: defaults_revision은 항목·기본값 판이 바뀌면 바뀐다", () => {
  const base = defaultsRevisionText([width, tracked]);
  assertEquals(defaultsRevisionText([width, tracked]), base);
  assert(
    defaultsRevisionText([{ ...tracked, default: { patterns: [] } }]) !== base,
  );
  assert(defaultsRevisionText([tracked]) !== base);
});
