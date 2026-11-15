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

// 화면이 열리는 자리. tab은 앱 workspace와 앱 창, panel은 project dock·float와 전역 float,
// card는 대화, sidebar는 오른쪽 sidebar, tray는 작업 표시줄 tray popup이다.
// phone은 폰 앱이 그리는 React Native 화면이고 다른 자리와 같이 쓰지 못한다.
export type Place = "tab" | "panel" | "card" | "sidebar" | "tray" | "phone";

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

// 앱 안의 operation. 화면과 앱 자신이 쓰는 저수준 동작이다. lophn이 아는 것은 이름과 effect뿐이고
// effect는 write를 core로 보내 changeset을 뜨기 위해 필요하다. schema와 설명은 앱 code의 일이다.
export type OperationDeclaration = {
  name: string;
  // 화면 `OperationButton`이 쓰는 글.
  title: string;
  effect: ToolEffect;
};

// 앱이 골라 내놓는 바깥 명령. agent, 다른 앱, job, flow가 부른다.
export type CommandDeclaration = {
  name: string;
  description: string;
  // null이면 인자가 없다. null이 아니면 root type은 object다.
  inputSchema: InputSchema | null;
  // program이 강제하는 값이다. Gate와 runtime 권한이 쓴다.
  effect: ToolEffect;
  // 다른 앱의 agent에 보이는지.
  public: boolean;
};

export type ScreenDeclaration = {
  key: string;
  label: string;
  path: string;
  places: Place[];
  // 화면이 받는 인자. root type은 object다.
  params?: InputSchema;
  // tray popup의 크기(px). places에 tray가 있을 때만 둔다. 없는 쪽은 lophn 기본값이다.
  tray?: TraySize;
};

// 숫자면 고정, 범위면 화면 내용에 맞춰 그 안에서 늘고 준다.
export type TraySide = number | { min?: number; max?: number };
export type TraySize = { width?: TraySide; height?: TraySide };

export type PermissionKind =
  | "fs.read"
  | "fs.write"
  | "net.fetch"
  | "net.listen"
  | "secret.use"
  | "notify.send";

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
  | { name: string; oauth?: OAuthDeclaration }
  // notify.send는 scope가 없다. 빈 객체다.
  | Record<string, never>;

export type PermissionRequirement = {
  kind: PermissionKind;
  scope: PermissionScope;
  reason: string;
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

// 앱이 .lophn/skills/<name>/ 폴더로 내놓는 skill. commands는 이 선언의 command 이름이다.
// public이 true면 다른 agent에게도 주므로 그 commands는 모두 public command여야 한다.
export type SkillDeclaration = {
  name: string;
  public: boolean;
  commands: string[];
};

// 앱이 내는 key. 맞는 것은 앱 page(guest preload)가 하고, shell은 Settings에 줄로 보이고 바꾸게만 한다.
// `key.mac`이 없으면 `key.other`와 같다. 홑 타이고 modifier가 있거나 F1~F12여야 한다(글 입력을 삼키지 않게).
export type AppKeyDeclaration = {
  id: string;
  title: string;
  key: { mac?: string; other: string };
  // Settings 줄의 context 이름. 없으면 `app:<app id>`다.
  context?: string;
};

// 앱이 내는 event. 일이 일어난 뒤의 알림이고 payload는 object schema(command의 inputSchema와 같은 규칙)다.
// 발행한 쪽이 선언하지 않은 event는 core가 받지 않는다.
export type EventDeclaration = {
  name: string;
  description: string;
  payloadSchema: InputSchema;
};

// 다른 앱(그 앱의 slug)이나 lophn(`lophn`)이 낸 event를 받겠다는 선언. handler 이름은 `on.<source>.<event>`로 정해지고
// operation·command와 같은 handler 이름 공간을 쓴다(`subscriptionHandlerName`).
export type SubscriptionDeclaration = {
  source: string;
  event: string;
};

// core가 event의 발행자일 때 source로 쓰는 이름이다.
export const LOPHN_EVENT_SOURCE = "lophn";

export function subscriptionHandlerName(
  subscription: SubscriptionDeclaration,
): string {
  return `on.${subscription.source}.${subscription.event}`;
}

export type AppDeclaration = {
  name: string;
  description: string;
  // bundle 안 이미지 파일의 경로(`/assets/icon.svg`, svg·png·webp)나 lucide icon 이름(`lucide:folder-kanban`).
  // lophn이 앱을 보이는 자리에 쓴다.
  icon?: string;
  // 없어도 된다. skill 폴더는 commit의 .lophn/skills/<name>/SKILL.md다.
  skills?: SkillDeclaration[];
  // 없어도 된다. 칸이 없는 옛 선언의 hash는 그대로다.
  keys?: AppKeyDeclaration[];
  // 없어도 된다. 칸이 없는 옛 선언의 hash는 그대로다.
  events?: EventDeclaration[];
  subscriptions?: SubscriptionDeclaration[];
  screens: ScreenDeclaration[];
  // operation과 command의 이름은 합쳐 하나다. handler는 이름 하나로 등록한다.
  operations: OperationDeclaration[];
  commands: CommandDeclaration[];
  permissions: PermissionRequirement[];
  app_connections: AppCommandUseDeclaration[];
  sdk_dependencies: SDKDependency[];
};

// slug를 주면 command의 wire 이름(`<slug>_<command>`)도 본다. 안 주면 모양만 본다.
export type DeclarationOptions = { app?: string; slug?: string };

export const DECLARATION_KEYS = [
  "app_connections",
  "commands",
  "description",
  "events",
  "icon",
  "keys",
  "name",
  "operations",
  "permissions",
  "screens",
  "sdk_dependencies",
  "skills",
  "subscriptions",
] as const;

// icon, skills, keys, events, subscriptions는 칸이 없어도 된다.
const OPTIONAL_KEYS: readonly string[] = [
  "icon",
  "skills",
  "keys",
  "events",
  "subscriptions",
];
export const DECLARATION_REQUIRED_KEYS = DECLARATION_KEYS.filter(
  (key) => !OPTIONAL_KEYS.includes(key),
);

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
// 앱 slug는 `lophn <slug> <command>`의 첫 낱말이라 내장 명령 묶음의 첫 낱말과 겹치면 안 된다(`lophn run …`이
// 앱 command인지 내장 명령인지 가를 수 없다). 새 내장 명령 묶음을 더하면 여기도 더한다(cli/commands/domain-names_test.ts가 잡는다).
// 내장 tool의 자원 이름과 `mcp`도 지금처럼 쓰지 못한다. 순수 declaration graph가 보도록 이 file에 둔다.
export const RESERVED_APP_SLUGS: readonly string[] = [
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
  "run",
  "help",
  "version",
  "hook",
  "harness",
  "ext",
  "tab",
  "browser",
  "team",
  // core가 event의 발행자일 때 쓰는 source 이름과 겹치면 안 된다.
  "lophn",
  "login",
];
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
