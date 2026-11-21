// 의존성 없는 선언 정본.
// Zod·node·npm·IO·앱 코드 실행이 없다.
// no-input hash의 정규 JSON null은 tool·schema·release 결합을 대신하지 않는다.

import { canonicalJson } from "./json.ts";
import {
  defineOwn,
  exactKeys,
  invalid,
  isObject,
  type JsonValue,
  LISTEN_HOSTS,
  OAUTH_RESERVED_PARAMS,
  type OAuthDeclaration,
  ownKeys,
  type PermissionKind,
  type PermissionScope,
  PHONE_CAPABILITIES,
  SECRET_NAME,
  SEMVER,
  type ValidationResult,
} from "./types.ts";

function lexicalPath(value: unknown, listen: boolean): string | undefined {
  if (typeof value !== "string" || value === "" || /\p{Cc}/u.test(value)) {
    return "path must be an absolute lexical path";
  }
  const posix = value.startsWith("/");
  const drive = /^[A-Za-z]:[\\/]/.test(value);
  const unc = /^\\\\[^\\]+\\[^\\]+/.test(value);
  if (!posix && !drive && !unc) return "path must be an absolute lexical path";
  if (value.split(/[\\/]/).some((part) => part === "." || part === "..")) {
    return "path must be an absolute lexical path";
  }
  if (listen && !posix && !/^[A-Za-z]:[\\/]/.test(value) && !unc) {
    return "path must be an absolute lexical path";
  }
  return;
}

// 선언의 fs 경로: 절대 lexical 경로이거나 사람의 home 기준 `~`·`~/…`(슬래시만)다. `~`는 선언에 적힌 글 그대로 저장하고 동의 글에도
// 그대로 보인다. 펴는 것은 앱 code(`@lophn/cap-fs`)다. 그래서 한 선언이 컴퓨터마다 다른 home에서 돈다.
export function permissionPath(value: unknown): string | undefined {
  if (typeof value === "string" && (value === "~" || value.startsWith("~/"))) {
    return /\p{Cc}|\\/u.test(value) ||
      value.split("/").some((part) => part === "." || part === "..")
      ? "path must be absolute or start with ~/ and be lexical"
      : undefined;
  }
  return lexicalPath(value, false);
}

function ipv4(value: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return false;
  return (
    value.split(".").every((part) => part === "0" || !part.startsWith("0")) &&
    value.split(".").every((part) => Number(part) <= 255)
  );
}

function dotted(value: string): boolean {
  return /^\d+(?:\.\d+){3}$/.test(value);
}

function ipv6(value: string): boolean {
  if (value.includes("%") || value.includes("]") || value.includes("[")) {
    return false;
  }
  const halves = value.split("::");
  if (halves.length > 2) return false;
  const expand = (part: string): string[] =>
    part === "" ? [] : part.split(":");
  const left = expand(halves[0]!);
  const right = halves.length === 2 ? expand(halves[1]!) : [];
  const groups = [...left, ...right];
  if (groups.some((group) => group === "")) return false;
  const last = groups.at(-1);
  const embedded =
    last !== undefined &&
    ipv4(last) &&
    (halves.length === 1 || right.at(-1) === last);
  if (last !== undefined && dotted(last) && !embedded) return false;
  const count = groups.length + (embedded ? 1 : 0);
  if (halves.length === 1) {
    if (count !== 8) return false;
  } else if (count >= 8) return false;
  return groups.every((group, index) =>
    index === groups.length - 1 && embedded
      ? true
      : /^[0-9A-Fa-f]{1,4}$/.test(group),
  );
}

// DNS, IPv4, IPv6 lexical host. wildcard·zone·port suffix는 거절한다.
export function hostOf(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 253) {
    return "invalid host";
  }
  if (value === "localhost") return;
  if (dotted(value)) return ipv4(value) ? undefined : "invalid host";
  if (ipv6(value)) return;
  if (
    value.includes(":") ||
    value.includes("*") ||
    value.startsWith(".") ||
    value.endsWith(".")
  ) {
    return "invalid host";
  }
  return /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*$/.test(
    value,
  )
    ? undefined
    : "invalid host";
}

function portOf(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= 65535
    ? value
    : undefined;
}

function oauthEndpoint(value: unknown): boolean {
  if (typeof value !== "string" || value.length > 2048) return false;
  if (value.includes("#")) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  return (
    url.protocol === "http:" &&
    (url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]")
  );
}

// secret.use의 oauth 블록 검사와 정규화. activation의 선언 비교가 순서만 바뀐 선언을 같게 보도록
// 키 순서·scopes 정렬·빈 params 제거를 여기서 정한다. 같은 함수를 permissions.ts의 Zod 사본이 부른다.
export function oauthScope(value: unknown): ValidationResult<OAuthDeclaration> {
  if (!isObject(value)) return invalid("oauth must be an object");
  const bad = exactKeys(
    value,
    ["authorization_endpoint", "token_endpoint", "scopes", "params"],
    ["authorization_endpoint", "token_endpoint", "scopes"],
  );
  if (bad) return invalid(`oauth ${bad}`);
  if (!oauthEndpoint(value.authorization_endpoint)) {
    return invalid(
      "oauth authorization_endpoint must be https or loopback http",
    );
  }
  if (!oauthEndpoint(value.token_endpoint)) {
    return invalid("oauth token_endpoint must be https or loopback http");
  }
  const scopes = value.scopes;
  if (
    !Array.isArray(scopes) ||
    scopes.length > 32 ||
    scopes.some(
      (scope) =>
        typeof scope !== "string" ||
        scope.length < 1 ||
        scope.length > 200 ||
        /[\s\p{Cc}"\\]/u.test(scope),
    )
  ) {
    return invalid("oauth scopes must be up to 32 plain tokens");
  }
  const oauth: OAuthDeclaration = {
    authorization_endpoint: value.authorization_endpoint as string,
    token_endpoint: value.token_endpoint as string,
    scopes: [...new Set(scopes as string[])].sort(),
  };
  if (value.params !== undefined) {
    if (!isObject(value.params)) {
      return invalid("oauth params must be an object");
    }
    const keys = ownKeys(value.params);
    if (!keys || keys.length > 8) {
      return invalid("oauth params must have at most 8 entries");
    }
    const params: Record<string, string> = {};
    for (const key of keys.sort()) {
      const item = value.params[key];
      if (
        !/^[A-Za-z0-9_.-]{1,64}$/.test(key) ||
        (OAUTH_RESERVED_PARAMS as readonly string[]).includes(key)
      ) {
        return invalid("oauth params key is invalid or reserved");
      }
      if (
        typeof item !== "string" ||
        item.length < 1 ||
        item.length > 256 ||
        /\p{Cc}/u.test(item)
      ) {
        return invalid("oauth params value is invalid");
      }
      defineOwn(params, key, item);
    }
    if (keys.length > 0) oauth.params = params;
  }
  return { ok: true, value: oauth };
}

export function permissionScope(
  kind: PermissionKind,
  value: unknown,
): ValidationResult<PermissionScope> {
  if (!isObject(value)) return invalid("permission scope must be an object");
  if (kind === "notify.send") {
    const unexpected = exactKeys(value, [], []);
    return unexpected
      ? invalid(`permission scope ${unexpected}`)
      : { ok: true, value: {} };
  }
  if (kind === "phone.use") {
    const unexpected = exactKeys(value, ["capability"], ["capability"]);
    if (unexpected) return invalid(`permission scope ${unexpected}`);
    if (
      !(PHONE_CAPABILITIES as readonly unknown[]).includes(value.capability)
    ) {
      return invalid(
        `phone.use capability must be one of ${PHONE_CAPABILITIES.join(", ")}`,
      );
    }
    return { ok: true, value: { capability: value.capability as string } };
  }
  const keys = kind.startsWith("fs.")
    ? ["path", "recursive"]
    : kind.startsWith("net.")
      ? ["host", "port"]
      : ["name", "oauth"];
  const unexpected = exactKeys(
    value,
    keys,
    kind === "secret.use" ? ["name"] : keys,
  );
  if (unexpected) return invalid(`permission scope ${unexpected}`);
  if (kind === "fs.read" || kind === "fs.write") {
    if (permissionPath(value.path)) {
      return invalid(
        "permission path must be absolute or start with ~/ and be lexical",
      );
    }
    if (typeof value.recursive !== "boolean") {
      return invalid("permission recursive must be boolean");
    }
    return {
      ok: true,
      value: { path: value.path as string, recursive: value.recursive },
    };
  }
  if (kind === "net.fetch" || kind === "net.listen") {
    if (hostOf(value.host)) return invalid("permission host is invalid");
    const port = portOf(value.port);
    if (port === undefined) return invalid("permission port must be 1..65535");
    const host = value.host as string;
    if (kind === "net.listen" && !LISTEN_HOSTS.has(host)) {
      return invalid("listen host must be localhost, 127.0.0.1, or ::1");
    }
    return { ok: true, value: { host, port } };
  }
  if (typeof value.name !== "string" || !SECRET_NAME.test(value.name)) {
    return invalid("secret name is invalid");
  }
  if (value.oauth === undefined) {
    return { ok: true, value: { name: value.name } };
  }
  const oauth = oauthScope(value.oauth);
  if (!oauth.ok) return oauth;
  return { ok: true, value: { name: value.name, oauth: oauth.value } };
}

export function scopeKey(kind: string, scope: PermissionScope): string {
  return `${kind}:${canonicalJson(scope as JsonValue)}`;
}

export function screenPath(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.includes("\\")
  ) {
    return "screen path must be an internal absolute path";
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//")) {
    return "screen path must not have a scheme or authority";
  }
  if (value.split("/").some((part) => part === "." || part === "..")) {
    return "screen path must not contain . or ..";
  }
  return;
}

export const LUCIDE_ICON_PREFIX = "lucide:";

// icon은 bundle 안 이미지 경로(screen path와 같은 규칙에 이미지 확장자만 더한다)이거나 `lucide:<이름>`이다.
// 파일이 bundle에 있는지, lucide 이름이 있는 이름인지는 release 준비가 본다.
export function iconPath(value: unknown): string | undefined {
  if (typeof value === "string" && value.startsWith(LUCIDE_ICON_PREFIX)) {
    return /^lucide:[a-z0-9]+(-[a-z0-9]+)*$/.test(value) && value.length <= 80
      ? undefined
      : "icon lucide name must be a kebab-case lucide icon name like lucide:folder-kanban";
  }
  const bad = screenPath(value);
  if (bad) return bad.replace("screen path", "icon path");
  if (!/\.(svg|png|webp)$/.test(value as string)) {
    return "icon path must end with .svg, .png or .webp, or be lucide:<name>";
  }
  return;
}

function numericId(value: string): boolean {
  return value === "0" || !/^0\d/.test(value);
}

// SemVer 2.0.0 하나. numeric prerelease의 선행 0은 거절하고 build metadata는 그대로 둔다.
export function semver(value: unknown): value is string {
  if (typeof value !== "string" || !SEMVER.test(value)) return false;
  const match = SEMVER.exec(value);
  const pre = match?.[4];
  if (pre === undefined) return true;
  return pre
    .split(".")
    .every((part) => (/^\d+$/.test(part) ? numericId(part) : true));
}
