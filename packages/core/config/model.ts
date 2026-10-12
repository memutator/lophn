// settings 병합·검증·resolve의 순수 함수(platform/settings#R8, R9, R11-R16). IO 없다.
// 메시지는 항목·기대·고칠 방법만 알리고 secret 원문과 입력 문서 전체를 담지 않는다(R14).

import { err, ok, type Result } from "../../base/mod.ts";
import { matchCredential } from "../../base/redaction/mod.ts";
import type {
  EffectiveSetting,
  SettingChoice,
  SettingDefinition,
  SettingsValidationError,
} from "../../protocol/config/mod.ts";
import type { JsonValue } from "../../protocol/base/mod.ts";

// secret 원문 판정은 platform/redaction의 credential 규칙 하나를 쓴다.
export function containsCredentialSecret(text: string): boolean {
  return matchCredential(text) !== undefined;
}

export function secretInValue(value: unknown): boolean {
  switch (typeof value) {
    case "string":
      return containsCredentialSecret(value);
    case "number":
    case "boolean":
      return false;
    case "object": {
      if (value === null) return false;
      return Object.values(value).some((item) =>
        secretInValue(item as unknown)
      );
    }
    default:
      return false;
  }
}

function validationError(
  key: string,
  layer: "common",
  expected: string,
  remedy: string,
): SettingsValidationError {
  return { key, layer, expected, remedy };
}

function unwrapType(schema: unknown): unknown {
  let current = schema as {
    def?: { innerType?: unknown };
    unwrap?: () => unknown;
  };
  while (
    current !== null && typeof current === "object" &&
    typeof (current as { unwrap?: unknown }).unwrap === "function"
  ) {
    try {
      current = (current as { unwrap: () => unknown })
        .unwrap() as typeof current;
    } catch {
      return current;
    }
    if (current === undefined || current === null) return schema;
  }
  if (
    current !== null && typeof current === "object" &&
    current.def !== undefined &&
    (current.def as { innerType?: unknown }).innerType !== undefined
  ) {
    return unwrapType((current.def as { innerType: unknown }).innerType);
  }
  return current ?? schema;
}

function typeName(schema: unknown): string {
  const defType = (schema as { def?: { type?: unknown } }).def?.type;
  if (typeof defType === "string") return defType.replace("$ZodType", "");
  const constructor = (schema as { constructor?: { name?: string } })
    .constructor;
  return typeof constructor?.name === "string"
    ? constructor.name.replace(/^Zod/, "").replace("$ZodType", "").toLowerCase()
    : "unknown";
}

// value_type의 껍질을 벗긴 뒤 object면 항목별, array면 전체, 그 외 scalar 교체다(R8, R9).
function valueShape(definition: SettingDefinition): {
  kind: "object" | "array" | "scalar";
  type: string;
} {
  const unwrapped = unwrapType(definition.value_type);
  const type = typeName(unwrapped);
  if (type === "object") return { kind: "object", type };
  if (type === "array") return { kind: "array", type };
  return { kind: "scalar", type };
}

export function mergeValue(
  definition: SettingDefinition,
  lower: unknown,
  higher: unknown,
): unknown {
  const shape = valueShape(definition);
  if (shape.kind === "object") {
    const base =
      lower !== null && typeof lower === "object" && !Array.isArray(lower)
        ? lower as Record<string, unknown>
        : {};
    const override =
      higher !== null && typeof higher === "object" && !Array.isArray(higher)
        ? higher as Record<string, unknown>
        : {};
    const merged: Record<string, unknown> = {};
    for (
      const key of new Set([...Object.keys(base), ...Object.keys(override)])
    ) {
      merged[key] = Object.hasOwn(override, key) ? override[key] : base[key];
    }
    return merged;
  }
  return higher;
}

export function mergeChoices(
  definition: SettingDefinition,
  choices: readonly (SettingChoice | undefined)[],
): JsonValue | null {
  const merged = choices.length
    ? choices.slice(1).reduce<unknown>(
      (
        lower,
        higher,
      ) => (higher === undefined
        ? lower
        : mergeValue(definition, lower, higher)),
      choices[0],
    )
    : null;
  return (merged === undefined ? null : merged) as JsonValue;
}

export function effectiveSetting(
  definition: SettingDefinition,
  choice: SettingChoice | undefined,
  revision: number,
): EffectiveSetting {
  if (choice !== undefined) {
    return {
      key: definition.key,
      resolved: true,
      value: choice.value as JsonValue,
      source_layer: "common",
      choices: [choice],
      revision,
      apply_at: definition.apply_at,
    };
  }
  if (!definition.default_present) {
    return {
      key: definition.key,
      resolved: false,
      value: null,
      source_layer: null,
      choices: [],
      revision,
      apply_at: definition.apply_at,
    };
  }
  return {
    key: definition.key,
    resolved: true,
    value: definition.default as JsonValue,
    source_layer: "builtin",
    choices: [],
    revision,
    apply_at: definition.apply_at,
  };
}

// 한 층의 문법·알려진 항목·타입·범위·허용 층을 먼저 검사한다(R11, R12).
export function validateChoice(
  definitions: readonly SettingDefinition[],
  choice: unknown,
): Result<{ choice: SettingChoice }> {
  if (choice === null || typeof choice !== "object" || Array.isArray(choice)) {
    return err({
      code: "invalid_input",
      message: "setting choice가 object가 아니다",
    });
  }
  const record = choice as Record<string, unknown>;
  if (record["layer"] !== "common") {
    return err({
      code: "invalid_input",
      message: "일반 설정은 common 층만이다",
    });
  }
  if (typeof record["key"] !== "string" || record["key"].length === 0) {
    return err({
      code: "invalid_input",
      message: "setting key가 없다",
    });
  }
  const definition = definitions.find((candidate) =>
    candidate.key === record["key"]
  );
  if (definition === undefined) {
    return err({
      code: "invalid_input",
      message: "등록되지 않은 설정 항목이다",
    });
  }
  const { value } = record as { value?: unknown };
  const parsed = definition.value_type.safeParse(value);
  if (!parsed.success) {
    const expected = expectedDescription(definition);
    return err({
      code: "invalid_input",
      message: "설정 값이 항목 schema와 다르다",
      details: {
        validation: validationError(
          definition.key,
          "common",
          expected,
          remedyFor(definition),
        ),
      },
    });
  }
  const secretFound = findSecretPath(parsed.data);
  if (secretFound !== undefined) {
    return err({
      code: "forbidden",
      message: "설정에 secret 원문을 넣을 수 없다",
      details: {
        validation: validationError(
          definition.key,
          "common",
          "protected reference",
          "소유 concern이 허용한 보호 참조를 쓴다; 원문 값은 platform/secrets에 둔다",
        ),
      },
    });
  }
  return ok({
    choice: {
      layer: "common",
      key: definition.key,
      value: parsed.data as JsonValue,
    },
  });
}

function findSecretPath(
  value: unknown,
  path: number | string = "value",
): number | string | undefined {
  switch (typeof value) {
    case "string":
      return containsCredentialSecret(value) ? path : undefined;
    case "number":
    case "boolean":
      return undefined;
    case "object": {
      if (value === null) return undefined;
      const entries = Array.isArray(value)
        ? [...value.entries()]
        : Object.entries(value);
      for (const [key, item] of entries) {
        const found = findSecretPath(item as unknown, key);
        if (found !== undefined) return found;
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

function expectedDescription(definition: SettingDefinition): string {
  const shape = valueShape(definition);
  if (shape.kind === "scalar") {
    const unwrapped = unwrapType(definition.value_type) as { def?: unknown };
    const checks = (unwrapped as { def?: { checks?: readonly unknown[] } }).def
      ?.checks;
    if (Array.isArray(checks) && checks.length > 0) {
      return "value within allowed range or set";
    }
    return "value of the declared type";
  }
  return `value of type ${shape.kind}`;
}

function remedyFor(definition: SettingDefinition): string {
  if (Array.isArray(definition.affected_features) && definition.revert_key) {
    return `${definition.revert_key}`;
  }
  return "해당 항목의 schema에 맞는 값을 넣는다";
}

export function validateConstraints(
  definition: SettingDefinition,
  resolved: unknown,
): Result<void> {
  const constraints = (definition.constraints ?? {}) as Record<string, unknown>;
  // contract fixture 관례(minimum/maximimum)와 짧은 키(min/max)를 같은 선언으로 본다.
  const min = constraints["min"] ?? constraints["minimum"];
  const max = constraints["max"] ?? constraints["maximum"];
  if (
    typeof resolved === "number" && typeof min === "number" && resolved < min
  ) {
    return err({
      code: "invalid_input",
      message: "설정 값이 허용 범위 밖이다",
      details: {
        validation: validationError(
          definition.key,
          "common",
          `number >= ${String(min)}`,
          "허용 범위 안의 값을 넣는다",
        ),
      },
    });
  }
  if (
    typeof resolved === "number" && typeof max === "number" && resolved > max
  ) {
    return err({
      code: "invalid_input",
      message: "설정 값이 허용 범위 밖이다",
      details: {
        validation: validationError(
          definition.key,
          "common",
          `number <= ${String(max)}`,
          "허용 범위 안의 값을 넣는다",
        ),
      },
    });
  }
  const allowedValues = constraints["allowed_values"];
  if (Array.isArray(allowedValues)) {
    const matches = allowedValues.some((allowed: unknown) =>
      JSON.stringify(allowed) === JSON.stringify(resolved)
    );
    if (!matches) {
      return err({
        code: "invalid_input",
        message: "설정 값이 허용 값 밖이다",
        details: {
          validation: validationError(
            definition.key,
            "common",
            "one of the allowed values",
            "허용 목록에 있는 값을 넣는다",
          ),
        },
      });
    }
  }
  return ok(undefined);
}

// 소유 concern의 검증이 필요한 항목은 대상 관계를 이 모듈이 끝내지 않는다(R13).
export function requiresOwnerCheck(
  definition: SettingDefinition,
): boolean {
  const constraints = (definition.constraints ?? {}) as Record<string, unknown>;
  return (
    Object.hasOwn(constraints, "target_ref") ||
    Object.hasOwn(constraints, "relation")
  );
}

// 오프라인 미확인은 constraints가 허용할 때만 받는다(R13).
export function offlineAllowed(
  definition: SettingDefinition,
  resolved: { offline_unconfirmed?: boolean },
): boolean {
  const constraints = (definition.constraints ?? {}) as Record<string, unknown>;
  if (!resolved.offline_unconfirmed) return true;
  return constraints["allow_offline_unconfirmed"] === true;
}

// 내부 결정적 defaults hash. base sha256Hex는 비동기라 등록 검증에 못 쓴다.
function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const combined = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return combined.toString(16).padStart(14, "0");
}

export function defaultsRevisionText(
  definitions: readonly SettingDefinition[],
): string {
  const lines = definitions
    .map((definition) => {
      const defaultValue = definition.default_present
        ? JSON.stringify(definition.default)
        : "";
      return [
        definition.key,
        definition.owner,
        defaultValue,
        JSON.stringify(definition.constraints ?? {}),
      ].join("|");
    })
    .sort()
    .join("\n");
  return `reg-${hashText(lines)}`;
}
