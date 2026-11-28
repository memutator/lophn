// 주소 칸 입력 정리. 거절은 decideNavigation이 하므로 여기서는 scheme을 채우거나,
// searchUrl이 주어졌을 때 주소가 아닌 입력을 검색 URL로 바꾼다.
import { buildSearchUrl } from "../../../protocol/shell/browser-search.ts";

const KEEP_SCHEMES =
  /^(about|mailto|tel|javascript|data|file|blob|chrome|devtools):/i;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6_AUTHORITY = /^(\[[0-9a-fA-F:]+\])(?::(\d+))?$/;
const TLD = /^(?:[a-z]{2,}|xn--[a-z0-9-]+|\p{Letter}{2,})$/iu;
const SINGLE_LABEL = /^[a-z0-9-]+$/i;

function validPort(text: string): boolean {
  if (!/^\d+$/.test(text)) return false;
  const n = Number(text);
  return n >= 1 && n <= 65535;
}

function isIpv4(host: string): boolean {
  const match = IPV4.exec(host);
  if (match === null) return false;
  return match.slice(1).every((part) => Number(part) <= 255);
}

/** scheme 없는 입력이 웹 주소 모양이면 scheme을 붙여 돌려주고, 아니면 null(검색어)이다. */
function addressWithScheme(t: string): string | null {
  if (/\s/.test(t)) return null;
  const authority = t.split(/[/?#]/, 1)[0] ?? "";
  if (authority === "" || authority.includes("@")) return null;

  const ipv6 = IPV6_AUTHORITY.exec(authority);
  if (ipv6 !== null) {
    if (ipv6[2] !== undefined && !validPort(ipv6[2])) return null;
    const scheme = ipv6[1]?.toLowerCase() === "[::1]" ? "http" : "https";
    return `${scheme}://${t}`;
  }

  let host = authority;
  let hasPort = false;
  const colon = authority.indexOf(":");
  if (colon !== -1) {
    const portText = authority.slice(colon + 1);
    if (colon === 0 || !validPort(portText)) return null;
    host = authority.slice(0, colon);
    hasPort = true;
  }

  const lower = host.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost")) {
    return `http://${t}`;
  }
  if (isIpv4(lower)) {
    return lower === "127.0.0.1" ? `http://${t}` : `https://${t}`;
  }
  if (hasPort && SINGLE_LABEL.test(host)) {
    return `https://${t}`;
  }
  if (host.startsWith(".") || host.includes("..")) return null;
  const trimmed = host.endsWith(".") ? host.slice(0, -1) : host;
  const dot = trimmed.lastIndexOf(".");
  if (dot <= 0) return null;
  const tld = trimmed.slice(dot + 1);
  if (!TLD.test(tld)) return null;
  return `https://${t}`;
}

export function normalizeAddress(
  text: string,
  options?: { searchUrl?: string },
): string | null {
  const t = text.trim();
  if (t === "") return null;
  if (t.includes("://") || KEEP_SCHEMES.test(t)) return t;
  if (options?.searchUrl !== undefined) {
    const candidate = addressWithScheme(t);
    if (candidate !== null) {
      try {
        new URL(candidate);
        return candidate;
      } catch {
        // 주소로 해석하지 못하면 검색어로 넘긴다.
      }
    }
    return buildSearchUrl(options.searchUrl, t);
  }
  const host = (t.split(/[/?#]/, 1)[0] ?? "").replace(/:\d*$/, "");
  const withScheme =
    host === "localhost" || host === "127.0.0.1"
      ? `http://${t}`
      : `https://${t}`;
  try {
    new URL(withScheme);
  } catch {
    return null;
  }
  return withScheme;
}
