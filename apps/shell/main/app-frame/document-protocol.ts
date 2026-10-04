// lophn-document:// 요청은 이 view의 고정 version 자원만 내준다.
// 다른 문서·다른 대상·외부 자원은 거절하고, 모든 응답에 문서 CSP를 붙인다.

export const DOCUMENT_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

export function documentHostLabelFor(versionId: string): string {
  return `ver-${versionId.slice("ver_".length)}`;
}

export interface DocumentResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array | null;
}

function blocked(mediaType: string): DocumentResponse {
  return {
    status: 404,
    headers: documentResponseHeaders(mediaType),
    body: null,
  };
}

export function documentResponseHeaders(
  mediaType: string,
): Record<string, string> {
  return {
    "content-type": mediaType,
    "content-security-policy": DOCUMENT_CSP,
    "x-content-type-options": "nosniff",
  };
}

/**
 * view의 URL 하나를 이 view의 고정 version으로 좁힌다. scheme이 다르거나
 * userinfo·port·query가 있거나 host label이 이 version이 아니면 null이다.
 * hostname은 소문자로 변환되므로 소문자 label과 비교한다.
 */
export function checkDocumentUrl(
  url: string,
  versionId: string,
): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "lophn-document:") return null;
  if (parsed.username || parsed.password || parsed.port || parsed.search) {
    return null;
  }
  if (parsed.hostname !== documentHostLabelFor(versionId)) return null;
  return parsed;
}

/**
 * 문서 protocol 요청을 이 view의 고정 version 자원으로 좁힌다. resolver가 주는
 * 자원만 돌려주고 나머지는 404다. worker(subframe·worker script) 요청도 같은
 * 경계를 거친다.
 */
export function createDocumentHandler(
  versionId: string,
  resolver: (path: string) => Promise<Uint8Array | null>,
  mediaTypeFor: (path: string) => string | undefined,
): (request: { method: string; url: string }) => Promise<DocumentResponse> {
  return async (request) => {
    const url = checkDocumentUrl(request.url, versionId);
    if (url === null) return blocked("text/plain; charset=utf-8");
    if (request.method !== "GET" && request.method !== "HEAD") {
      return {
        status: 405,
        headers: documentResponseHeaders("text/plain; charset=utf-8"),
        body: null,
      };
    }
    // webContents의 자기 자원 요청은 이 판의 ContentFile 상대 path다.
    const path = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const mediaType = mediaTypeFor(path);
    if (path === "" || mediaType === undefined) {
      return blocked("text/plain; charset=utf-8");
    }
    const bytes = await resolver(path);
    if (bytes === null) return blocked(mediaType);
    return {
      status: 200,
      headers: documentResponseHeaders(mediaType),
      body: request.method === "HEAD" ? null : bytes,
    };
  };
}
