import { err, ok, type Result } from "../../../base/mod.ts";

// 구독 OAuth 발급자와 계정 control plane에 보내는 HTTP 한 번이다. core에는 외부 fetch가 없어 발급자 요청
// 대기열(issuer-requests.ts)의 fetch가 들어온다. 요청과 응답 본문에는 code·verifier·token이 있어 오류와 log에 싣지 않는다.

export type IssuerFetch = (url: string, init: RequestInit) => Promise<Response>;

export type IssuerAnswer = { status: number; body: Record<string, unknown> };

// 발급자에 닿지 못하면 unavailable이다. 5xx도 그렇다. 본문이 JSON object가 아니면 빈 object로 본다.
export async function send(
  http: IssuerFetch,
  url: string,
  init: RequestInit,
): Promise<Result<IssuerAnswer>> {
  let response: Response;
  let raw: string;
  try {
    response = await http(url, init);
    raw = await response.text();
  } catch {
    return err({ code: "unavailable", message: "발급자에 닿지 못했다" });
  }
  if (response.status >= 500) {
    return err({ code: "unavailable", message: "발급자가 답하지 못했다" });
  }
  return ok({ status: response.status, body: objectOf(raw) });
}

export async function postForm(
  http: IssuerFetch,
  url: string,
  fields: Record<string, string>,
  headers: Record<string, string> = {},
): Promise<Result<IssuerAnswer>> {
  return await send(http, url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
      ...headers,
    },
    body: new URLSearchParams(fields).toString(),
  });
}

export async function postJson(
  http: IssuerFetch,
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Result<IssuerAnswer>> {
  return await send(http, url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

export function objectOf(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}
