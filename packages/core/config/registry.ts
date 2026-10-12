// 등록된 SettingDefinition의 메모리 목록이다(R1, R4). 등록 검증은 여기서 끝난다.

import { err, ok, type Result } from "../../base/mod.ts";
import type {
  SettingDefinition,
  SettingsValidationError,
} from "../../protocol/config/mod.ts";
import { containsCredentialSecret, defaultsRevisionText } from "./model.ts";

const MESSAGE_KEY_FIELDS = [
  "display_name_key",
  "description",
  "value_meaning_key",
  "default_meaning_key",
  "risk_key",
  "revert_key",
] as const;

const KEY_PATTERN = /^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$/;

// 뜻·종류·기본값·허용값·층·적용 시점이 없으면 등록을 거절한다(R1, R4).
export function validateDefinition(
  definition: SettingDefinition,
): Result<void> {
  if (typeof definition.key !== "string" || !KEY_PATTERN.test(definition.key)) {
    return err({
      code: "invalid_input",
      message: "설정 항목 key가 등록된 항목 경로 모양이 아니다",
    });
  }
  if (typeof definition.owner !== "string" || definition.owner.length === 0) {
    return err({ code: "invalid_input", message: "설정 항목 owner가 없다" });
  }
  for (const field of MESSAGE_KEY_FIELDS) {
    const value = definition[field];
    if (typeof value !== "string" || value.length === 0 || !/\S/.test(value)) {
      return err({
        code: "invalid_input",
        message: `설정 항목의 ${field} 설명이 없다`,
      });
    }
  }
  if (
    !Array.isArray(definition.affected_features) ||
    definition.affected_features.length === 0
  ) {
    return err({
      code: "invalid_input",
      message: "설정 항목의 affected_features가 비어 있다",
    });
  }
  if (
    typeof definition.risk_key !== "string" || definition.risk_key.length === 0
  ) {
    return err({ code: "invalid_input", message: "설정 항목 risk_key가 없다" });
  }
  if (
    typeof definition.revert_key !== "string" ||
    definition.revert_key.length === 0
  ) {
    return err({
      code: "invalid_input",
      message: "설정 항목 revert_key가 없다",
    });
  }
  if (definition.value_type === undefined || definition.value_type === null) {
    return err({
      code: "invalid_input",
      message: "설정 항목 value_type이 없다",
    });
  }
  if (!Array.isArray(definition.layers) || definition.layers.length !== 1) {
    return err({
      code: "invalid_input",
      message: "일반 설정은 common 층 하나만 허용한다",
    });
  }
  if (
    definition.layers[0] !== "common" || definition.apply_at === undefined
  ) {
    return err({
      code: "invalid_input",
      message: "설정 항목의 층·적용 시점이 없다",
    });
  }
  if (definition.required && !definition.default_present) {
    // required이고 default가 없는 항목은 사람의 선택이 필수다(R4).
  }
  const constraints = (definition.constraints ?? {}) as Record<string, unknown>;
  if (
    constraints["secret_source"] !== undefined &&
    !Array.isArray(constraints["secret_source"])
  ) {
    return err({
      code: "invalid_input",
      message: "secret_source는 보호 참조 목록이어야 한다",
    });
  }
  return ok(undefined);
}

export class SettingRegistry {
  #definitions = new Map<string, SettingDefinition>();
  #defaultsRevision: string;

  constructor(definitions: readonly SettingDefinition[]) {
    for (const definition of definitions) {
      const checked = validateDefinition(definition);
      if (!checked.ok) throw new Error(checked.error.message);
      if (
        containsCredentialSecret(definition.description) ||
        containsCredentialSecret(definition.display_name_key)
      ) {
        throw new Error("설정 항목 설명에 secret 원문이 있다");
      }
      this.#definitions.set(definition.key, definition);
    }
    this.#defaultsRevision = defaultsRevisionText(definitions);
  }

  get defaultsRevision(): string {
    return this.#defaultsRevision;
  }

  get definitions(): readonly SettingDefinition[] {
    return [...this.#definitions.values()];
  }

  definition(key: string): SettingDefinition | undefined {
    return this.#definitions.get(key);
  }

  has(key: string): boolean {
    return this.#definitions.has(key);
  }

  validation(
    key: string,
    expected: string,
    remedy: string,
  ): SettingsValidationError {
    return { key, layer: "common", expected, remedy };
  }
}
