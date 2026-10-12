// lophn-app:// 요청을 view에 묶인 연결의 앱 socket `/screens/<screen>/…`으로 넘긴다
// (architecture/shell 5.2). socket 경로·인증 header는 main에만 있고 view·preload로 가지 않는다.
// 응답은 모으지 않고 stream으로 돌려주며, 요청이 취소되면 upstream도
// 끊는다. 다른 연결로의 redirect, 허용하지 않은 MIME은 거절하고 CSP를 겹친다.
import { request as httpRequest } from "node:http";
import { Readable } from "node:stream";

import {
  APP_SCHEME,
  appContentSecurityPolicy,
  type FetchHost,
  ownAppUrl,
} from "./network-policy.ts";

// Unix socket HTTP의 가상 host.
export const SOCKET_HOST = "lophn.invalid";

// session 정책이 webContents에서 정해 붙이는 header. 페이지가 같은 이름을 보내도 덮어쓴다.
export const VIEW_HEADER = "x-lophn-view";

/** protocol 요청이 쓰는 view 하나의 고정 값. 페이지 주장이 아니라 registry가 정한다. */
export interface ProtocolView {
  view_session: string;
  appLabel: string;
  screen: string;
  size: string;
  endpoint: string;
  authorization: string;
  hosts: readonly FetchHost[];
}

export interface UpstreamRequest {
  endpoint: string;
  path: string;
  authorization: string;
  signal: AbortSignal;
}

export interface UpstreamResponse {
  status: number;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  body: ReadableStream<Uint8Array> | null;
}

export type Upstream = (request: UpstreamRequest) => Promise<UpstreamResponse>;

export interface AppProtocolDeps {
  /** header 값(없으면 null)에서 이 session의 view를 찾는다. 다른 앱의 view는 돌려주지 않는다. */
  viewFor(token: string | null, appLabel: string): ProtocolView | undefined;
  upstream: Upstream;
  /** 앱이 연결을 받지 않는다(만료·회수). registry가 연결을 다시 얻는다. */
  stale(view_session: string): void;
}

// 앱 화면 자원으로 내줄 수 있는 MIME. 이 밖은 sniffing 없이 거절한다.
const SAFE_MEDIA_TYPES = new Set([
  "text/html",
  "text/css",
  "text/javascript",
  "application/javascript",
  "application/json",
  "application/wasm",
  "text/plain",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/svg+xml",
  "image/x-icon",
  "font/woff",
  "font/woff2",
  "font/ttf",
  "font/otf",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "video/mp4",
  "video/webm",
]);

function plain(status: number): Response {
  return new Response(null, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    },
  });
}

// bundle 안 경로만. 경로 이탈·scheme·authority·빈 마디·제어 문자를 막는다.
function safeSegment(segment: string): boolean {
  return segment.length > 0 && segment !== "." && segment !== ".." &&
    !segment.includes("/") && !segment.includes("\\") &&
    !segment.includes(":") && !/\p{Cc}/u.test(segment);
}

function decode(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

/**
 * view 주소 하나를 `{screen, asset}`으로 좁힌다. scheme·host label·userinfo·port가 이 앱이
 * 아니면 undefined다. custom scheme host는 소문자로 바뀌므로 소문자 label과 비교한다.
 */
export function parseAppUrl(
  value: string,
  appLabel: string,
): { screen: string; asset: string[] } | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (!ownAppUrl(url, appLabel)) return undefined;
  const raw = url.pathname.split("/").slice(1);
  if (raw.length < 2) return undefined;
  const parts = raw.map(decode);
  if (parts.some((part) => part === undefined || !safeSegment(part))) {
    return undefined;
  }
  const [screen = "", ...asset] = parts as string[];
  return { screen, asset };
}

function encodePath(screen: string, asset: readonly string[]): string {
  return [screen, ...asset].map(encodeURIComponent).join("/");
}

/** 앱 socket의 화면 경로. 페이지 query는 넘기지 않고 main이 정한 size·view_session만 붙인다. */
export function screenPath(
  view: Pick<ProtocolView, "size" | "view_session">,
  screen: string,
  asset: readonly string[],
): string {
  const query = new URLSearchParams({
    size: view.size,
    view_session: view.view_session,
  });
  return `/screens/${encodePath(screen, asset)}?${query}`;
}

/**
 * view 안에서 여는 첫 주소. 페이지가 자기 view_session을 알 수 있게 이 view의 식별자만 query로 싣는다
 * (apps/agent-context). 앱 socket으로는 넘기지 않고(`screenPath`가 main이 정한 값만 붙인다) 다른 화면의
 * 주소에는 붙지 않는다.
 */
export function appEntryUrl(
  appLabel: string,
  screen: string,
  viewSession?: string,
): string {
  const base = `${APP_SCHEME}://${appLabel}/${
    encodeURIComponent(screen)
  }/index.html`;
  return viewSession === undefined
    ? base
    : `${base}?${new URLSearchParams({ view_session: viewSession })}`;
}

function header(
  headers: UpstreamResponse["headers"],
  name: string,
): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function mediaType(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const base = (value.split(";", 1)[0] ?? "").trim().toLowerCase();
  return SAFE_MEDIA_TYPES.has(base) ? base : undefined;
}

/**
 * upstream redirect는 같은 연결·같은 screen 안일 때만 이 view의 주소로 바꿔 돌려준다.
 * 다른 screen·다른 host·다른 scheme은 다른 연결이라 따르지 않는다.
 */
function redirectTarget(
  location: string | undefined,
  base: string,
  view: ProtocolView,
): string | undefined {
  if (location === undefined) return undefined;
  let target: URL;
  try {
    target = new URL(location, `http://${SOCKET_HOST}${base}`);
  } catch {
    return undefined;
  }
  if (target.protocol !== "http:" || target.host !== SOCKET_HOST) {
    return undefined;
  }
  const raw = target.pathname.split("/").slice(1);
  if (raw[0] !== "screens" || raw.length < 3) return undefined;
  const parts = raw.slice(1).map(decode);
  if (parts.some((part) => part === undefined || !safeSegment(part))) {
    return undefined;
  }
  const [screen = "", ...asset] = parts as string[];
  if (screen !== view.screen) return undefined;
  return `${APP_SCHEME}://${view.appLabel}/${encodePath(screen, asset)}`;
}

function discard(body: ReadableStream<Uint8Array> | null): void {
  if (body !== null) void body.cancel().catch(() => {});
}

/**
 * session 하나의 lophn-app handler를 만든다. `appLabel`은 그 session이 묶인 앱이다.
 * 모르는 view, 다른 screen, 깨진 경로는 모두 같은 404다(있는지 새지 않는다).
 */
export function createAppProtocolHandler(
  deps: AppProtocolDeps,
  appLabel: string,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "GET") return plain(405);
    const parsed = parseAppUrl(request.url, appLabel);
    const view = deps.viewFor(request.headers.get(VIEW_HEADER), appLabel);
    if (
      parsed === undefined || view === undefined ||
      parsed.screen !== view.screen
    ) {
      return plain(404);
    }
    const path = screenPath(view, parsed.screen, parsed.asset);
    let upstream: UpstreamResponse;
    try {
      upstream = await deps.upstream({
        endpoint: view.endpoint,
        path,
        authorization: view.authorization,
        signal: request.signal,
      });
    } catch {
      return plain(request.signal.aborted ? 499 : 503);
    }
    if (upstream.status >= 300 && upstream.status < 400) {
      discard(upstream.body);
      const location = redirectTarget(
        header(upstream.headers, "location"),
        path,
        view,
      );
      if (location === undefined) return plain(502);
      return new Response(null, {
        status: upstream.status === 301 || upstream.status === 308 ? 308 : 307,
        headers: { location, "cache-control": "no-store" },
      });
    }
    if (upstream.status === 401) {
      discard(upstream.body);
      deps.stale(view.view_session);
      return plain(503);
    }
    if (upstream.status !== 200) {
      discard(upstream.body);
      return plain(
        upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502,
      );
    }
    const contentType = header(upstream.headers, "content-type");
    if (mediaType(contentType) === undefined) {
      discard(upstream.body);
      return plain(502);
    }
    const headers = new Headers({
      "content-type": contentType!,
      "x-content-type-options": "nosniff",
      // release가 바뀌면 옛 판의 byte를 cache가 대신 내주지 않게 한다.
      "cache-control": "no-store",
    });
    headers.append(
      "content-security-policy",
      appContentSecurityPolicy(view.hosts),
    );
    const own = header(upstream.headers, "content-security-policy");
    // 앱이 보낸 CSP는 함께 걸어 더 좁히기만 한다.
    if (own !== undefined) headers.append("content-security-policy", own);
    return new Response(upstream.body, { status: 200, headers });
  };
}

/**
 * main의 Node client. `socketPath`로 앱 socket에 직접 붙는다. 요청 취소는 upstream 요청과
 * 응답 stream을 끊는다. 응답 body는 back-pressure가 있는 web stream으로 넘겨 메모리에
 * 모으지 않는다.
 */
export const nodeUpstream: Upstream = (input) =>
  new Promise((resolve, reject) => {
    if (input.signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const outgoing = httpRequest({
      socketPath: input.endpoint,
      path: input.path,
      method: "GET",
      headers: { host: SOCKET_HOST, authorization: input.authorization },
    });
    const abort = () => outgoing.destroy(new Error("aborted"));
    input.signal.addEventListener("abort", abort, { once: true });
    outgoing.once("error", (error) => {
      input.signal.removeEventListener("abort", abort);
      reject(error);
    });
    outgoing.once("response", (incoming) => {
      incoming.once("close", () => {
        input.signal.removeEventListener("abort", abort);
      });
      resolve({
        status: incoming.statusCode ?? 502,
        headers: incoming.headers,
        body: Readable.toWeb(incoming) as ReadableStream<Uint8Array>,
      });
    });
    outgoing.end();
  });
