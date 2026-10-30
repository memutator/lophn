// 의존성 없는 선언 정본.
// Zod·node·npm·IO·앱 코드 실행이 없다.
// no-input hash의 정규 JSON null은 tool·schema·release 결합을 대신하지 않는다.

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

export type ToolEffect = "read" | "write" | "external";

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

// MCP tool 모양의 선언. effect와 public은 lophn 칸이다.
export type ToolDeclaration = {
  name: string;
  title: string;
  description: string;
  // null이면 인자가 없다. null이 아니면 root type은 object다.
  inputSchema: InputSchema | null;
  // 없으면 칸을 두지 않는다. root type은 object다.
  outputSchema?: InputSchema;
  // program이 강제하는 값이다. Gate와 runtime 권한이 쓴다.
  effect: ToolEffect;
  // 다른 domain에 보이는지.
  public: boolean;
  // tool이 다루는 객체의 domain. 이 앱의 domain 이름 중 하나다.
  domain: string;
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
  | "secret.use";

// secret.use의 OAuth 블록. 끝점은 https이거나 loopback http다(검사는 scope.ts의 oauthScope).
export type OAuthDeclaration = {
  authorization_endpoint: string;
  token_endpoint: string;
  // 정규화 때 정렬하고 중복을 없앤다.
  scopes: string[];
  // authorize URL에 더할 추가 parameter. 비면 칸을 두지 않는다.
  params?: Record<string, string>;
};

// core가 authorize URL을 만들 때도 같은 목록으로 params의 덮어쓰기를 막는다.
export const OAUTH_RESERVED_PARAMS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "scope",
  "state",
  "code_challenge",
  "code_challenge_method",
  "code_verifier",
  "client_secret",
  "grant_type",
] as const;

export type PermissionScope =
  | { path: string; recursive: boolean }
  | { host: string; port: number }
  | { name: string; oauth?: OAuthDeclaration };

export type PermissionRequirement = {
  kind: PermissionKind;
  scope: PermissionScope;
  reason: string;
};

export type AppToolUseDeclaration = {
  app: string;
  tools: string[];
  reason: string;
};

export type SDKDependency = {
  name: string;
  version: string;
};

export type AppDeclaration = {
  name: string;
  description: string;
  screens: ScreenDeclaration[];
  tools: ToolDeclaration[];
  permissions: PermissionRequirement[];
  app_connections: AppToolUseDeclaration[];
  sdk_dependencies: SDKDependency[];
};

// domains를 주면 모든 tool의 domain이 이 안에 있어야 한다. 안 주면 모양만 본다.
export type DeclarationOptions = { app?: string; domains?: readonly string[] };

export const DECLARATION_KEYS = [
  "app_connections",
  "description",
  "name",
  "permissions",
  "screens",
  "sdk_dependencies",
  "tools",
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
// slugSchema(protocol/projects/values.ts)와 같은 규칙. 이 file은 의존성이 없어 따로 쓴다.
const DOMAIN_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
// 앱 tool의 agent 이름은 `<domain>_<tool>`이다. tool.load 묶음 규칙이 wire 이름 첫 `_` 앞을 묶음 이름으로 보므로,
// 내장 tool의 자원 이름(wire 이름 첫 `_` 앞)과 `mcp`는 domain 이름이 될 수 없다. 새 내장 자원을 더하면 여기도 더한다
// (core/main/tool-names_test.ts가 잡는다). 순수 declaration graph가 보도록 이 file에 둔다.
export const RESERVED_DOMAIN_NAMES: readonly string[] = [
  "file",
  "pdf",
  "image",
  "shell",
  "web",
  "call",
  "reply",
  "cancel",
  "session",
  "ask",
  "skill",
  "tool",
  "app",
  "agent",
  "domain",
  "declaration",
  "package",
  "release",
  "preview",
  "kind",
  "settings",
  "visual",
  "workflow",
  "job",
  "mcp",
];
export function isDomainName(name: string): boolean {
  return (
    name.length <= 63 &&
    DOMAIN_NAME.test(name) &&
    !RESERVED_DOMAIN_NAMES.includes(name)
  );
}
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
  return Object.keys(value);
}

// JSON key는 prototype setter를 호출하지 않는 own data property로 복사한다.
export function defineOwn<T>(object: Record<string, T>, key: string, value: T) {
  Object.defineProperty(object, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
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
  return (
    typeof value === "string" && value.trim() !== "" && !rejectSurrogate(value)
  );
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
      return `{${keys
        .map(
          (key) =>
            `${JSON.stringify(key)}:${stableJson(value[key] as JsonValue)}`,
        )
        .join(",")}}`;
    }
    default:
      return "null";
  }
}

function jsonType(value: JsonValue): InputType | undefined {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return "boolean";
    case "string":
      return rejectSurrogate(value) ? undefined : "string";
    case "number":
      return Number.isFinite(value)
        ? Number.isInteger(value)
          ? "integer"
          : "number"
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

function copyJson(value: unknown, seen: Set<object>): JsonValue | undefined {
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
    defineOwn(copy, key, copied as JsonValue);
  }
  seen.delete(value);
  return copy;
}

export function asJson(value: unknown): JsonValue | undefined {
  return copyJson(value, new Set());
}
