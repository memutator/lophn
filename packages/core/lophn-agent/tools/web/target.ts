// web.fetch가 가도 되는 주소인지 본다. 순수 함수다.
// 주소 literal만 판정한다. host 이름이 사설 주소로 풀리는 경우(DNS)는 보지 않는다.

import { err, ok, type Result } from "../../../../base/mod.ts";

function denied(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

function ipv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const numbers = parts.map((
    part,
  ) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  return numbers.every((n) => n >= 0 && n <= 255) ? numbers : null;
}

function privateV4([a, b]: number[]): boolean {
  return a === 127 || a === 10 || a === 0 ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254);
}

function privateV6(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (bare === "::1" || bare === "::") return true;
  // fe80::/10 (fe80 ~ febf)
  if (/^fe[89ab]/.test(bare)) return true;
  // fc00::/7 (unique local)
  if (/^f[cd]/.test(bare)) return true;
  // ::ffff:a.b.c.d 와 URL이 정규화한 ::ffff:7f00:1
  const mapped = bare.match(/^::ffff:(.+)$/);
  if (mapped) {
    const rest = mapped[1]!;
    const v4 = ipv4(rest);
    if (v4) return privateV4(v4);
    const hex = rest.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const high = parseInt(hex[1]!, 16);
      const low = parseInt(hex[2]!, 16);
      return privateV4([high >> 8, high & 255, low >> 8, low & 255]);
    }
  }
  return false;
}

export function checkFetchTarget(url: string): Result<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return denied("not a valid url");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return denied("only http and https urls are allowed");
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  const v4 = ipv4(host);
  if (
    host === "localhost" || host.endsWith(".localhost") ||
    (v4 !== null && privateV4(v4)) || (host.startsWith("[") && privateV6(host))
  ) {
    return denied("local and private addresses are not allowed");
  }
  return ok(parsed);
}
