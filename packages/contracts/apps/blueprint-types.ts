// 의존성 없는 blueprint 정본(apps/blueprint#R16).
// Zod·Deno·node·npm·jsr·IO·앱 코드 실행이 없다.
// no-input hash의 정규 JSON null은 command·schema·release 결합을 대신하지 않는다.

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | JsonObject;

export type JsonObject = { [key: string]: JsonValue };

export type ValidationError = { code: "invalid_input"; message: string };

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ValidationError };

export type ScreenSize = "full" | "panel" | "card";

export type CommandEffect = "read" | "write" | "external";

export type InputType =
  | "object"
  | "array"
  | "string"
  | "integer"
  | "number"
  | "boolean"
  | "null";

export type InputSchema = {
  type: InputType;
  description?: string;
  enum?: JsonValue[];
  default?: JsonValue;
  properties?: { [key: string]: InputSchema };
  required?: string[];
  additionalProperties?: false;
  items?: InputSchema;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
};

export type CommandRevertDeclaration = {
  supported: boolean;
  command?: string;
};

export type CommandDeclaration = {
  key: string;
  label: string;
  description: string;
  effect: CommandEffect;
  confirm: boolean;
  input: InputSchema | null;
  revert: CommandRevertDeclaration;
};

export type ScreenDeclaration = {
  key: string;
  label: string;
  path: string;
  sizes: ScreenSize[];
};

export type PermissionKind =
  | "fs.read"
  | "fs.write"
  | "net.fetch"
  | "net.listen"
  | "secret.use"
  | "document.save";

export type PermissionScope =
  | { path: string; recursive: boolean }
  | { host: string; port: number }
  | { name: string }
  | { key: string };

export type PermissionRequirement = {
  kind: PermissionKind;
  scope: PermissionScope;
  reason: string;
};

export type AutomationWhen =
  | { kind: "on_start" }
  | { kind: "interval"; interval_ms: number };

export type AutomationDeclaration = {
  key: string;
  label: string;
  when: AutomationWhen;
  command: string;
  input?: JsonValue;
};

export type FormatRef = {
  name: string;
  module_hash: string;
  explicit: boolean;
};

export type DocumentDeclaration = {
  key: string;
  name: string;
  description: string;
  format: FormatRef;
  document?: string;
};

export type AnnotationTargetDeclaration = {
  key: string;
  label: string;
  write_command: string;
};

export type AgentContextDeclaration = {
  screen: string;
  read_command: string;
  sensitive_paths: string[];
  annotation_targets: AnnotationTargetDeclaration[];
};

export type AppCommandUseDeclaration = {
  app: string;
  commands: string[];
  reason: string;
};

export type SDKDependency = {
  name: string;
  version: string;
};

// packages/contracts/problems의 ProblemCodeDeclaration과 같은 구조다. import하지 않는다.
export type ProblemCodeDeclaration = {
  code: string;
  message_key: string;
  message: string;
  fixer: "coding_agent" | "user";
};

export type Blueprint = {
  name: string;
  description: string;
  screens: ScreenDeclaration[];
  commands: CommandDeclaration[];
  automatic_tasks: AutomationDeclaration[];
  permissions: PermissionRequirement[];
  problem_codes: ProblemCodeDeclaration[];
  documents: DocumentDeclaration[];
  agent_context: AgentContextDeclaration[];
  app_connections: AppCommandUseDeclaration[];
  sdk_dependencies: SDKDependency[];
};

export type BlueprintOptions = { app?: string };

export const BLUEPRINT_KEYS = [
  "agent_context",
  "app_connections",
  "automatic_tasks",
  "commands",
  "description",
  "documents",
  "name",
  "permissions",
  "problem_codes",
  "screens",
  "sdk_dependencies",
] as const;

export const INPUT_KEYS = [
  "additionalProperties",
  "default",
  "description",
  "enum",
  "items",
  "maxItems",
  "maxLength",
  "maximum",
  "minItems",
  "minLength",
  "minimum",
  "properties",
  "required",
  "type",
] as const;

export const INPUT_TYPES = new Set<InputType>([
  "object",
  "array",
  "string",
  "integer",
  "number",
  "boolean",
  "null",
]);

export const APP_ID = /^app_[0-7][0-9a-hjkmnp-tv-z]{25}$/;
export const DOC_ID = /^doc_[0-7][0-9a-hjkmnp-tv-z]{25}$/;
export const SHA256 = /^[0-9a-f]{64}$/;
export const PROBLEM_CODE = /^[a-z][a-z0-9_]{1,47}$/;
export const MESSAGE_KEY = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9_-]*){2,}$/;
export const SECRET_NAME = /^[A-Za-z0-9_.:-]+$/;
export const PACKAGE_NAME = /^@(?:me|lophn)\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
export const LISTEN_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function invalid(message: string): ValidationResult<never> {
  return { ok: false, error: { code: "invalid_input", message } };
}

export function isObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function ownKeys(value: Record<string, unknown>): string[] | undefined {
  if (Object.getOwnPropertySymbols(value).length > 0) return;
  const keys = Object.keys(value);
  if (keys.some((key) => key === "__proto__" || key === "prototype")) return;
  return keys;
}

export function rejectSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return true;
  }
  return false;
}

export function lengthOf(value: string): number {
  return [...value].length;
}

export function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" &&
    !rejectSurrogate(value);
}

export function singleLine(value: unknown): value is string {
  return nonBlank(value) && !/[\r\n]/.test(value);
}

export function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
): string | undefined {
  const keys = ownKeys(value);
  if (!keys) return "unsupported object key";
  const known = new Set(allowed);
  for (const key of keys) {
    if (!known.has(key)) return `unknown field ${key}`;
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) return `missing field ${key}`;
  }
}

export function integerBound(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

export function numberBound(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function sameJson(left: JsonValue, right: JsonValue): boolean {
  return stableJson(left) === stableJson(right);
}

function stableJson(value: JsonValue): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
    case "number":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((item) => stableJson(item)).join(",")}]`;
      }
      const keys = Object.keys(value).sort();
      return `{${
        keys.map((key) =>
          `${JSON.stringify(key)}:${stableJson(value[key] as JsonValue)}`
        ).join(",")
      }}`;
    }
    default:
      return "null";
  }
}

export function jsonType(value: JsonValue): InputType | undefined {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return "boolean";
    case "string":
      return rejectSurrogate(value) ? undefined : "string";
    case "number":
      return Number.isFinite(value)
        ? Number.isInteger(value) ? "integer" : "number"
        : undefined;
    case "object":
      return Array.isArray(value) ? "array" : "object";
    default:
      return;
  }
}

export function matchesType(type: InputType, value: JsonValue): boolean {
  const actual = jsonType(value);
  if (actual === undefined) return false;
  return type === "number"
    ? actual === "number" || actual === "integer"
    : actual === type;
}

export function copyJson(
  value: unknown,
  seen: Set<object>,
): JsonValue | undefined {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    return rejectSurrogate(value) ? undefined : value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== "object") return;
  if (seen.has(value)) return;
  if (Array.isArray(value)) {
    if (Object.getOwnPropertySymbols(value).length > 0) return;
    seen.add(value);
    const copy: JsonValue[] = [];
    for (const item of value) {
      const copied = copyJson(item, seen);
      if (copied === undefined && item !== null) return;
      copy.push(copied as JsonValue);
    }
    seen.delete(value);
    return copy;
  }
  if (!isObject(value)) return;
  const keys = ownKeys(value);
  if (!keys) return;
  seen.add(value);
  const copy: JsonObject = {};
  for (const key of keys) {
    if (rejectSurrogate(key)) return;
    const copied = copyJson(value[key], seen);
    if (copied === undefined && value[key] !== null) return;
    copy[key] = copied as JsonValue;
  }
  seen.delete(value);
  return copy;
}

export function asJson(value: unknown): JsonValue | undefined {
  return copyJson(value, new Set());
}
