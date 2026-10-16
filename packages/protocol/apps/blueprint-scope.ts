// 의존성 없는 blueprint 정본.
// Zod·Deno·node·npm·jsr·IO·앱 코드 실행이 없다.
// no-input hash의 정규 JSON null은 command·schema·release 결합을 대신하지 않는다.

import { SEMVER } from "./blueprint-types.ts";

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

// RFC 6901. 각 segment의 ~ 는 ~0 또는 ~1로만 끝난다.

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
