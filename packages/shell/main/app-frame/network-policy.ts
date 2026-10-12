// 앱 view의 network 판정. session 기본 차단 위에서 자기 scheme·자기 앱 host와 apps/permissions가
// 부여한 fetch host만 통과시킨다. 판정은 URL을 파싱해 scheme·host·port를
// 따로 비교하고, redirect·WebSocket·subframe 요청도 같은 함수를 지난다.

export const APP_SCHEME = "lophn-app";

/** apps/permissions의 net.fetch scope. host는 정확한 hostname·IPv4·IPv6다. */
export interface FetchHost {
  host: string;
  port: number;
}

/** Electron webRequest의 resourceType 중 판정이 다르게 다루는 것. */
export type RequestKind = "mainFrame" | "subFrame" | "other";

export interface RequestCheck {
  url: string;
  kind: RequestKind;
  /** 이 view가 묶인 앱의 host label(`app-<ULID 소문자>`). */
  appLabel: string;
  hosts: readonly FetchHost[];
  /** loopback에서 막을 플랫폼 port(core API 등). 부여돼 있어도 막는다. */
  platformPorts: readonly number[];
}

function parse(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

function bareHost(hostname: string): string {
  const lower = hostname.toLowerCase();
  return lower.startsWith("[") && lower.endsWith("]")
    ? lower.slice(1, -1)
    : lower;
}

export function isLoopback(host: string): boolean {
  const bare = bareHost(host);
  return bare === "localhost" || bare === "::1" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bare);
}

/**
 * 자기 앱 주소인가. userinfo·port가 있으면 다른 대상으로 본다. label은 소문자 Crockford
 * ULID라 대소문자를 바꿔도 같은 앱으로만 풀린다. Chromium은 host를 소문자로 주고 Node URL은
 * custom scheme host를 그대로 두므로 여기서 소문자로 맞춘다.
 */
export function ownAppUrl(url: URL, appLabel: string): boolean {
  return url.protocol === `${APP_SCHEME}:` &&
    url.hostname.toLowerCase() === appLabel &&
    url.username === "" && url.password === "" && url.port === "";
}

function effectivePort(url: URL): number {
  if (url.port !== "") return Number(url.port);
  return url.protocol === "https:" || url.protocol === "wss:" ? 443 : 80;
}

/**
 * 부여한 host로 가는 바깥 요청인가. 운영 전송은 https·wss만이다(broker net/fetch와 같다).
 * userinfo가 있으면 거절한다. 플랫폼 port의 loopback은 부여가 있어도 거절한다.
 */
export function grantedUrl(
  url: URL,
  hosts: readonly FetchHost[],
  platformPorts: readonly number[],
): boolean {
  if (url.protocol !== "https:" && url.protocol !== "wss:") return false;
  if (url.username !== "" || url.password !== "") return false;
  const host = bareHost(url.hostname);
  const port = effectivePort(url);
  if (isLoopback(host) && platformPorts.includes(port)) return false;
  return hosts.some((grant) =>
    bareHost(grant.host) === host && grant.port === port
  );
}

/**
 * 요청 하나를 통과시킬지 정한다. main frame은 자기 앱 주소로만 간다. subframe과 그 밖의
 * 요청은 자기 앱 주소와 부여한 host만이다. data·blob은 페이지 안의 값이라 frame이 아닐 때만
 * 둔다. file·다른 앱·다른 scheme·임의 loopback은 모두 거절한다.
 */
export function requestAllowed(check: RequestCheck): boolean {
  const url = parse(check.url);
  if (url === undefined) return false;
  if (ownAppUrl(url, check.appLabel)) return true;
  if (check.kind === "mainFrame") return false;
  if (url.protocol === "data:" || url.protocol === "blob:") {
    return check.kind === "other";
  }
  return grantedUrl(url, check.hosts, check.platformPorts);
}

/** 탐색은 자기 앱의 같은 screen 안에서만이다. 다른 screen·scheme·외부 문서는 view 안에서 열지 않는다. */
export function navigationAllowed(
  url: string,
  appLabel: string,
  screen: string,
): boolean {
  const parsed = parse(url);
  if (parsed === undefined || !ownAppUrl(parsed, appLabel)) return false;
  return parsed.pathname.startsWith(`/${encodeURIComponent(screen)}/`);
}

function origin(scheme: "https" | "wss", grant: FetchHost): string {
  const host = bareHost(grant.host);
  const shown = host.includes(":") ? `[${host}]` : host;
  return `${scheme}://${shown}:${grant.port}`;
}

/**
 * 앱 응답에 겹치는 CSP. 기본은 자기 자원이고 바깥 연결은 부여한 host만이다. session 차단과
 * 같은 경계를 페이지 쪽에서도 한 번 더 건다. 앱이 보낸 CSP는 지우지 않고 함께 둔다.
 */
export function appContentSecurityPolicy(hosts: readonly FetchHost[]): string {
  const sorted = [...hosts].sort((a, b) =>
    a.host === b.host ? a.port - b.port : a.host < b.host ? -1 : 1
  );
  const https = sorted.map((grant) => origin("https", grant));
  const wss = sorted.map((grant) => origin("wss", grant));
  const join = (values: readonly string[]) =>
    values.length === 0 ? "" : ` ${values.join(" ")}`;
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${join(https)}`,
    "font-src 'self' data:",
    `media-src 'self' blob:${join(https)}`,
    `connect-src 'self'${join([...https, ...wss])}`,
    `frame-src 'self'${join(https)}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join("; ");
}
