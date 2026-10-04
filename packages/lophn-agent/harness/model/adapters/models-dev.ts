import { err, ok, type Result } from "../../../../base/mod.ts";

// 공개 catalog 목적지. 응답 해석만이 목적이며 개인 자료를 싣지 않는다(R6).
export const MODELS_DEV_URL = "https://models.dev/api.json";

// catalog 갱신은 세션·key·token·model 선택·계정 정보를 싣지 않는 공개 GET이다(R6).
// ETag는 현재 catalog 판 확인용이며 조건부 GET의 If-None-Match로만 쓴다(R4).
export type FetchResult =
  | { kind: "received"; body: string; etag: string | null }
  | { kind: "unchanged" }
  | { kind: "failed"; code: "invalid_input" | "unavailable" };

// fetchImpl은 테스트가 끼운다. 실제 network은 여기서만 만난다.
export type HttpFetch = (
  url: string,
  init: RequestInit,
) => Promise<{ status: number; etag: string | null; bytes: Uint8Array }>;

const MAX_BODY_BYTES = 4 * 1024 * 1024;

// 요청은 method·URL·Accept·선택적 If-None-Match뿐이다. credential·선택·세션은 없다(R6).
export function buildRequest(etag: string | null): RequestInit {
  return {
    method: "GET",
    headers: etag === null
      ? { accept: "application/json" }
      : { accept: "application/json", "if-none-match": etag },
  };
}

export async function fetchCatalog(
  etag: string | null,
  fetchImpl: HttpFetch,
): Promise<FetchResult> {
  let response: { status: number; etag: string | null; bytes: Uint8Array };
  try {
    response = await fetchImpl(MODELS_DEV_URL, buildRequest(etag));
  } catch {
    return { kind: "failed", code: "unavailable" };
  }
  if (response.status === 304) return { kind: "unchanged" };
  if (response.status !== 200) {
    return { kind: "failed", code: "unavailable" };
  }
  if (response.bytes.byteLength > MAX_BODY_BYTES) {
    return { kind: "failed", code: "invalid_input" };
  }
  const body = new TextDecoder().decode(response.bytes);
  // UTF-8 복호화 실패·분할된 응답은 여기서 잡지 않는다. 해석 판정은 해석 단계에서 한다.
  return { kind: "received", body, etag: response.etag };
}

// 응답 body를 해석한다. 잘못된 JSON은 갱신 전체 거절 사유다(R5).
export function parseCatalogBody(body: string): Result<unknown[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return err({
      code: "invalid_input",
      message: "catalog 응답을 해석하지 못했다",
    });
  }
  if (!Array.isArray(parsed)) {
    return err({
      code: "invalid_input",
      message: "catalog 응답은 항목 배열이어야 한다",
    });
  }
  return ok(parsed);
}
