// lophn-app:// 요청을 view가 묶인 대상의 화면 byte로 바꾼다. byte는 core의 `app.screen_file`이
// 내주고(UI bundle 사본), 대상(앱·release·preview process)은 view가 정하며 페이지 주장은 없다.
// redirect, 허용하지 않은 MIME은 거절하고 CSP를 겹친다. 요청이 취소되면 upstream도 끊는다.
import {
  APP_SCHEME,
  appContentSecurityPolicy,
  type FetchHost,
  ownAppUrl,
} from "./network-policy.ts";

// session 정책이 webContents에서 정해 붙이는 header. 페이지가 같은 이름을 보내도 덮어쓴다.
export const VIEW_HEADER = "x-lophn-view";

/** core가 화면 byte를 낼 대상(`app.screen_file`의 target). live의 release가 null이면 지금 활성 release다. */
export type ScreenTarget =
  | { mode: "live"; app: string; release: string | null }
  | { mode: "preview"; app: string; process_nonce: string };

/** protocol 요청이 쓰는 view 하나의 고정 값. 페이지 주장이 아니라 registry가 정한다. */
export interface ProtocolView {
  view_session: string;
  appLabel: string;
  screen: string;
  target: ScreenTarget;
  hosts: readonly FetchHost[];
}

export interface UpstreamRequest {
  target: ScreenTarget;
  screen: string;
  /** screen 아래 상대 경로. */
  path: string;
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
  /** core가 그 대상의 화면을 내주지 못한다(process 교체·중지). registry가 묶음을 다시 읽는다. */
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

/**
 * view 안에서 여는 첫 주소. 페이지가 자기 view_session을 알 수 있게 이 view의 식별자만 query로
 * 싣는다. 다른 화면의 주소에는 붙지 않고 core로도 넘기지 않는다.
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
    let upstream: UpstreamResponse;
    try {
      upstream = await deps.upstream({
        target: view.target,
        screen: parsed.screen,
        path: parsed.asset.join("/"),
        signal: request.signal,
      });
    } catch {
      return plain(request.signal.aborted ? 499 : 503);
    }
    // 화면 byte는 redirect하지 않는다. 다른 대상으로 가는 길은 열지 않는다.
    if (upstream.status >= 300 && upstream.status < 400) {
      discard(upstream.body);
      return plain(502);
    }
    if (upstream.status === 503) {
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

/** core의 file route `app.screen_file`을 연다. 응답 상태·Content-Type·body는 core가 준 그대로이고 signal로 끊는다. */
export type ScreenFileOpen = (
  input: { target: ScreenTarget; screen: string; path: string },
  signal: AbortSignal,
) => Promise<
  { status: number; headers: Headers; body: ReadableStream<Uint8Array> | null }
>;

/** core 응답을 그대로 stream하는 upstream. MIME은 core의 Content-Type이고 허용 여부는 handler가 본다. */
export function createCoreUpstream(open: ScreenFileOpen): Upstream {
  return async (request) => {
    const response = await open({
      target: request.target,
      screen: request.screen,
      path: request.path,
    }, request.signal);
    return {
      // 입력 거절(400)은 없는 화면과 같은 404로 보인다.
      status: response.status === 400 ? 404 : response.status,
      headers: Object.fromEntries(response.headers),
      body: response.body,
    };
  };
}
