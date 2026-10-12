// 의존성 없는 blueprint 정본(apps/blueprint#R16).
// Zod·Deno·node·npm·jsr·IO·앱 코드 실행이 없다.
// no-input hash의 정규 JSON null은 command·schema·release 결합을 대신하지 않는다.

import {
  exactKeys,
  type FormatRef,
  invalid,
  isObject,
  type JsonValue,
  LISTEN_HOSTS,
  MESSAGE_KEY,
  nonBlank,
  type PermissionKind,
  type PermissionScope,
  PROBLEM_CODE,
  type ProblemCodeDeclaration,
  rejectSurrogate,
  SECRET_NAME,
  SEMVER,
  SHA256,
  type ValidationResult,
} from "./blueprint-types.ts";
import { canonicalJson } from "./blueprint-json.ts";

export function lexicalPath(
  value: unknown,
  listen: boolean,
): string | undefined {
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

function ipv4(value: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return false;
  return value.split(".").every((part) =>
    part === "0" || !part.startsWith("0")
  ) && value.split(".").every((part) => Number(part) <= 255);
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
  const expand = (part: string): string[] => part === "" ? [] : part.split(":");
  const left = expand(halves[0]!);
  const right = halves.length === 2 ? expand(halves[1]!) : [];
  const groups = [...left, ...right];
  if (groups.some((group) => group === "")) return false;
  const last = groups.at(-1);
  const embedded = last !== undefined && ipv4(last) &&
    (halves.length === 1 || right.at(-1) === last);
  if (last !== undefined && dotted(last) && !embedded) return false;
  const count = groups.length + (embedded ? 1 : 0);
  if (halves.length === 1) {
    if (count !== 8) return false;
  } else if (count >= 8) return false;
  return groups.every((group, index) =>
    index === groups.length - 1 && embedded
      ? true
      : /^[0-9A-Fa-f]{1,4}$/.test(group)
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
    value.includes(":") || value.includes("*") || value.startsWith(".") ||
    value.endsWith(".")
  ) {
    return "invalid host";
  }
  return /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*$/
      .test(value)
    ? undefined
    : "invalid host";
}

export function portOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) &&
      value >= 1 && value <= 65535
    ? value
    : undefined;
}

export function permissionScope(
  kind: PermissionKind,
  value: unknown,
): ValidationResult<PermissionScope> {
  if (!isObject(value)) return invalid("permission scope must be an object");
  const keys = kind.startsWith("fs.")
    ? ["path", "recursive"]
    : kind.startsWith("net.")
    ? ["host", "port"]
    : kind === "secret.use"
    ? ["name"]
    : ["key"];
  const unexpected = exactKeys(value, keys, keys);
  if (unexpected) return invalid(`permission scope ${unexpected}`);
  if (kind === "fs.read" || kind === "fs.write") {
    if (lexicalPath(value.path, false)) {
      return invalid("permission path must be absolute and lexical");
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
  if (kind === "secret.use") {
    if (typeof value.name !== "string" || !SECRET_NAME.test(value.name)) {
      return invalid("secret name is invalid");
    }
    return { ok: true, value: { name: value.name } };
  }
  if (!nonBlank(value.key)) return invalid("document key is blank");
  return { ok: true, value: { key: value.key as string } };
}

export function scopeKey(kind: string, scope: PermissionScope): string {
  return `${kind}:${canonicalJson(scope as JsonValue)}`;
}

export function screenPath(value: unknown): string | undefined {
  if (
    typeof value !== "string" || !value.startsWith("/") || value.includes("\\")
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

// RFC 6901. 각 segment의 ~ 는 ~0 또는 ~1로만 끝난다.
export function pointer(value: unknown): boolean {
  if (typeof value !== "string" || rejectSurrogate(value)) return false;
  if (value === "") return true;
  if (!value.startsWith("/")) return false;
  return value.split("/").slice(1).every((part) => !/~(?![01])/.test(part));
}

export function problemCode(
  value: unknown,
): ValidationResult<ProblemCodeDeclaration> {
  if (!isObject(value)) return invalid("problem code must be an object");
  const unexpected = exactKeys(
    value,
    ["code", "fixer", "message", "message_key"],
    ["code", "fixer", "message", "message_key"],
  );
  if (unexpected) return invalid(`problem code ${unexpected}`);
  if (typeof value.code !== "string" || !PROBLEM_CODE.test(value.code)) {
    return invalid("problem code is invalid");
  }
  if (
    typeof value.message_key !== "string" ||
    !MESSAGE_KEY.test(value.message_key)
  ) {
    return invalid("problem message_key is invalid");
  }
  if (
    typeof value.message !== "string" || !/\S/.test(value.message) ||
    /[\r\n{}]/.test(value.message) || rejectSurrogate(value.message)
  ) {
    return invalid("problem message must be one fixed line");
  }
  if (value.fixer !== "coding_agent" && value.fixer !== "user") {
    return invalid("problem fixer is invalid");
  }
  return {
    ok: true,
    value: {
      code: value.code,
      message_key: value.message_key,
      message: value.message,
      fixer: value.fixer,
    },
  };
}

export function formatRef(value: unknown): ValidationResult<FormatRef> {
  if (!isObject(value)) return invalid("document format must be an object");
  const unexpected = exactKeys(
    value,
    ["explicit", "module_hash", "name"],
    ["explicit", "module_hash", "name"],
  );
  if (unexpected) return invalid(`document format ${unexpected}`);
  if (
    !nonBlank(value.name) || typeof value.module_hash !== "string" ||
    !SHA256.test(value.module_hash) || typeof value.explicit !== "boolean"
  ) {
    return invalid("document format is invalid");
  }
  return {
    ok: true,
    value: {
      name: value.name,
      module_hash: value.module_hash,
      explicit: value.explicit,
    },
  };
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
  return pre.split(".").every((part) =>
    /^\d+$/.test(part) ? numericId(part) : true
  );
}
