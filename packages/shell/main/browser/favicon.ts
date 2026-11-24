// page favicon을 shell 화면이 그릴 수 있는 data URL로 바꾼다. shell CSP는 img-src data:만 받고,
// shell 화면이 인터넷에 직접 요청하지 않게 main이 그 page의 session으로 받아 온다.
const BODY_MAX = 48 * 1024;
// 48KB를 넘는 고해상도 PNG는 내려받은 뒤 32px PNG로 줄여 쓴다. .ico는 nativeImage가 이 Electron에서
// 디코딩하지 못하므로 resize가 null을 돌려주고 그대로 버린다(48KB 이하 .ico는 위의 통과 경로로 간다).
const FETCH_MAX = 2 * 1024 * 1024;
const DATA_URL_MAX = 65536;

// 이미지가 아닌 문서·오류 페이지(WAF 챌린지 등)는 디코딩을 시도하지 않는다.
const NON_IMAGE_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "application/json",
  "application/xml",
  "text/xml",
  "text/javascript",
  "application/javascript",
  "text/css",
]);

type Fetch = (url: string) => Promise<{
  ok: boolean;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

/** 큰 이미지나 content-type이 빠진 이미지 바이트를 작은 PNG로 바꾼다. 디코딩 못 하면 null. */
export type FaviconResize = (body: Buffer) => Buffer | null;

/**
 * favicon 요청에 실을 `Referer` 헤더 값. Electron `session.fetch`는 기본
 * `strict-origin-when-cross-origin` 정책에 어긋나는 `Referer`(cross-origin에 path 포함,
 * https→http 다운그레이드)를 `ERR_BLOCKED_BY_CLIENT`로 차단한다. same-origin 요청도
 * cross-origin redirect를 탈 수 있으므로 origin(`/`)만 싣는다.
 */
export function faviconReferer(
  pageUrl: string,
  targetUrl: string,
): string | undefined {
  let page: URL;
  let target: URL;
  try {
    page = new URL(pageUrl);
    target = new URL(targetUrl);
  } catch {
    return undefined;
  }
  if (page.protocol !== "http:" && page.protocol !== "https:") {
    return undefined;
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return undefined;
  }
  if (page.protocol === "https:" && target.protocol === "http:") {
    return undefined;
  }
  return `${page.origin}/`;
}

/** 바꿀 수 없으면(다른 scheme, 실패, 너무 큼, image 아님) null. */
export async function faviconData(
  url: string,
  fetch: Fetch,
  resize?: FaviconResize,
): Promise<string | null> {
  if (url.startsWith("data:")) {
    return url.startsWith("data:image/") && url.length <= DATA_URL_MAX
      ? url
      : null;
  }
  if (!url.startsWith("http://") && !url.startsWith("https://")) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const type = response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase();
    const body = await response.arrayBuffer();
    if (body.byteLength === 0 || body.byteLength > FETCH_MAX) return null;
    if (
      type !== undefined &&
      type.startsWith("image/") &&
      body.byteLength <= BODY_MAX
    ) {
      const data = `data:${type};base64,${Buffer.from(body).toString("base64")}`;
      return data.length <= DATA_URL_MAX ? data : null;
    }
    if (
      resize === undefined ||
      (type !== undefined && NON_IMAGE_TYPES.has(type))
    ) {
      return null;
    }
    const png = resize(Buffer.from(body));
    if (png === null || png.byteLength === 0 || png.byteLength > BODY_MAX) {
      return null;
    }
    const data = `data:image/png;base64,${png.toString("base64")}`;
    return data.length <= DATA_URL_MAX ? data : null;
  } catch {
    return null;
  }
}

/** 후보 URL을 순서대로 시도해 처음 성공한 favicon data URL을 돌려준다. */
export async function firstFaviconData(
  urls: readonly string[],
  fetch: Fetch,
  resize?: FaviconResize,
): Promise<string | null> {
  const seen = new Set<string>();
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    const data = await faviconData(url, fetch, resize);
    if (data !== null) return data;
  }
  return null;
}
