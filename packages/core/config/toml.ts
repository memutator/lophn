// settings 교환 TOML의 parse·export 순수 함수.
// UTF-8 TOML 1.0 format version 1만 받는다. JSON5·YAML·환경 치환·include·
// command 실행·원격 URL은 문법 자체가 없으므로 parse가 거절한다.
// 메시지는 기대 format·고칠 방법만 알리고 입력 문서 전체와 값 원문을 담지 않는다.

import { parse, stringify } from "@std/toml";
import { err, ok, type Result } from "../../base/mod.ts";
import {
  type SettingMutation,
  SETTINGS_EXCHANGE_FORMAT,
  SETTINGS_EXCHANGE_FORMAT_VERSION,
} from "../../protocol/config/mod.ts";
import { containsCredentialSecret } from "./model.ts";

// format version 1의 TOML 문서 구조. domain model이 구조 확정을
// 미뤄 두었으므로 이 모듈이 첫 구조를 고정한다:
// [exchange] 표에 format·toml_version·encoding·format_version을 두고,
// [settings."layer.key"] 표 하나가 setting mutation 하나다. set은 value,
// delete는 remove = true다.
const EXCHANGE_TABLE = "exchange";
const SETTINGS_TABLE_PREFIX = "settings.";

export type SettingsExchangeDocument = {
  format_version: number;
  mutations: SettingMutation[];
};

export type SettingsExportInput = {
  mutations: readonly SettingMutation[];
};

function exchangeTable(): Record<string, string | number> {
  return {
    format: SETTINGS_EXCHANGE_FORMAT.format,
    toml_version: SETTINGS_EXCHANGE_FORMAT.toml_version,
    encoding: SETTINGS_EXCHANGE_FORMAT.encoding,
    format_version: SETTINGS_EXCHANGE_FORMAT.format_version,
  };
}

// TOML 1.0에 null이 없다. null 값은 stringify가 throw하므로 export 전에 거절한다.
function rejectNull(
  value: unknown,
  path: string,
): Result<void> {
  if (value === null) {
    return err({
      code: "invalid_input",
      message: "TOML 교환 문서에 null 값을 넣을 수 없다. 선택 삭제는 remove다",
      details: { key: path },
    });
  }
  if (typeof value !== "object") return ok(undefined);
  if (Array.isArray(value)) {
    for (const item of value) {
      const checked = rejectNull(item, path);
      if (!checked.ok) return checked;
    }
    return ok(undefined);
  }
  for (const [key, item] of Object.entries(value)) {
    const checked = rejectNull(item, `${path}.${key}`);
    if (!checked.ok) return checked;
  }
  return ok(undefined);
}

function mutationValue(mutation: SettingMutation): {
  remove?: boolean;
  value?: unknown;
} {
  if (mutation.action === "delete") return { remove: true };
  return { value: mutation.value };
}

// 등록 항목 값만 내보낸다. secret 원문은 값 검증에서 이미 거절되므로
// 여기서는 문자열 값의 credential 규칙을 다시 본다(방어적 redaction).
export function exportSettingsTOML(
  input: SettingsExportInput,
): Result<string> {
  if (input.mutations.length === 0) {
    return err({
      code: "invalid_input",
      message: "내보낼 설정 변경이 없다",
    });
  }
  const seen = new Set<string>();
  const document: Record<string, unknown> = {
    [EXCHANGE_TABLE]: exchangeTable(),
  };
  const settings: Record<string, unknown> = {};
  for (const mutation of input.mutations) {
    if (seen.has(mutation.key)) {
      return err({
        code: "invalid_input",
        message: "같은 항목의 변경이 두 개다",
        details: { key: mutation.key },
      });
    }
    seen.add(mutation.key);
    const entry = mutationValue(mutation);
    const value = entry.value;
    if (value !== undefined) {
      const checked = rejectNull(value, mutation.key);
      if (!checked.ok) return checked;
      if (typeof value === "string" && containsCredentialSecret(value)) {
        return err({
          code: "forbidden",
          message: "설정 값에 credential 모양의 문자열이 있다",
          details: { key: mutation.key },
        });
      }
    }
    settings[mutation.key] = entry;
  }
  document["settings"] = settings;
  let text: string;
  try {
    text = stringify(document);
  } catch {
    return err({
      code: "invalid_input",
      message: "설정 값을 TOML로 내보내지 못했다",
    });
  }
  return ok(text);
}

// 환경 치환·include·command·원격 URL 모양의 문자열은 값으로 받지 않는다.
const SUBSTITUTION_PATTERN = /\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*/;

function rejectedValuePattern(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (containsCredentialSecret(value)) return "credential";
  if (SUBSTITUTION_PATTERN.test(value)) return "environment substitution";
  return undefined;
}

function rejectUnsafeStrings(
  value: unknown,
  path: string,
): Result<void> {
  const pattern = rejectedValuePattern(value);
  if (pattern !== undefined) {
    return err({
      code: "forbidden",
      message: `설정 값에 ${pattern} 모양의 문자열을 넣을 수 없다`,
      details: { key: path },
    });
  }
  if (value === null || typeof value !== "object") return ok(undefined);
  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as [string, unknown])
    : Object.entries(value);
  for (const [key, item] of entries) {
    const checked = rejectUnsafeStrings(item, `${path}.${key}`);
    if (!checked.ok) return checked;
  }
  return ok(undefined);
}

// parse는 UTF-8 TOML 1.0 format version 1 교환 문서만 받는다.
// mutation 검사는 소유 concern의 validateChoice·ApplySettings가 한다. 여기서는
// 문서 모양·허용되지 않은 값 모양만 거절한다.
export function parseSettingsTOML(
  text: string,
): Result<SettingsExchangeDocument> {
  if (!/\S/.test(text)) {
    return err({
      code: "invalid_input",
      message: "빈 교환 문서다",
    });
  }
  let document: unknown;
  try {
    document = parse(text);
  } catch {
    return err({
      code: "invalid_input",
      message:
        "UTF-8 TOML 1.0이 아니다. JSON5·YAML·환경 치환·include·command·원격 URL은 교환 문서가 아니다",
    });
  }
  if (
    document === null || typeof document !== "object" || Array.isArray(document)
  ) {
    return err({
      code: "invalid_input",
      message: "교환 문서가 TOML 표가 아니다",
    });
  }
  const record = document as Record<string, unknown>;
  const exchange = record[EXCHANGE_TABLE];
  if (
    exchange === undefined || exchange === null || typeof exchange !== "object"
  ) {
    return err({
      code: "invalid_input",
      message: "교환 문서에 format 표가 없다",
      details: {
        expected:
          `[${EXCHANGE_TABLE}] with format_version ${SETTINGS_EXCHANGE_FORMAT_VERSION}`,
      },
    });
  }
  const meta = exchange as Record<string, unknown>;
  if (meta["format"] !== SETTINGS_EXCHANGE_FORMAT.format) {
    return err({
      code: "invalid_input",
      message: "교환 format이 TOML이 아니다",
      details: { expected: SETTINGS_EXCHANGE_FORMAT.format },
    });
  }
  const version = meta["format_version"];
  if (typeof version !== "number" || !Number.isInteger(version)) {
    return err({
      code: "invalid_input",
      message: "format_version이 정수가 아니다",
      details: { expected: SETTINGS_EXCHANGE_FORMAT_VERSION },
    });
  }
  if (version !== SETTINGS_EXCHANGE_FORMAT_VERSION) {
    // 알 수 없는 version은 전체 거절한다. 옛 항목 변환은 실제 항목
    // 변경이 있는 lophn update에서 명시적으로 제공한다.
    return err({
      code: "invalid_input",
      message: "모르는 교환 format version이다",
      details: { expected: SETTINGS_EXCHANGE_FORMAT_VERSION, got: version },
    });
  }
  const settings = record["settings"];
  if (
    settings === undefined || settings === null || typeof settings !== "object"
  ) {
    return err({
      code: "invalid_input",
      message: "교환 문서에 설정 표가 없다",
      details: { expected: `[${SETTINGS_TABLE_PREFIX}"layer.key"]` },
    });
  }
  const mutations: SettingMutation[] = [];
  const seen = new Set<string>();
  for (
    const [key, entry] of Object.entries(settings as Record<string, unknown>)
  ) {
    if (seen.has(key)) {
      return err({
        code: "invalid_input",
        message: "같은 항목의 변경이 두 개다",
        details: { key },
      });
    }
    seen.add(key);
    if (!key.includes(".")) {
      return err({
        code: "invalid_input",
        message: "설정 항목 key가 등록된 항목 경로 모양이 아니다",
        details: { key },
      });
    }
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return err({
        code: "invalid_input",
        message: "설정 항목이 표가 아니다",
        details: { key },
      });
    }
    const table = entry as Record<string, unknown>;
    const extra = Object.keys(table).filter((name) =>
      name !== "value" && name !== "remove"
    );
    if (extra.length > 0) {
      return err({
        code: "invalid_input",
        message: "설정 항목 표에 value·remove 밖의 필드가 있다",
        details: { key },
      });
    }
    const hasValue = Object.hasOwn(table, "value");
    const remove = table["remove"];
    if (remove !== undefined && remove !== true) {
      return err({
        code: "invalid_input",
        message: "remove는 true만이다",
        details: { key },
      });
    }
    if (hasValue && remove === true) {
      return err({
        code: "invalid_input",
        message: "value와 remove를 같이 넣을 수 없다",
        details: { key },
      });
    }
    if (!hasValue && remove !== true) {
      return err({
        code: "invalid_input",
        message: "value나 remove가 없다",
        details: { key },
      });
    }
    if (remove === true) {
      mutations.push({ layer: "common", key, action: "delete" });
      continue;
    }
    const value = table["value"];
    const checked = rejectUnsafeStrings(value, key);
    if (!checked.ok) return checked;
    mutations.push({
      layer: "common",
      key,
      action: "set",
      value: value as never,
    });
  }
  if (mutations.length === 0) {
    return err({
      code: "invalid_input",
      message: "교환 문서에 설정 변경이 없다",
    });
  }
  return ok({ format_version: version, mutations });
}
