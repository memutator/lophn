// coordinator의 core HTTP client. 인증은 hello가 싣는 machine credential의 Bearer
// token이고, 대상은 같은 장치의 core API뿐이다(allow_net은 127.0.0.1). fetch는
// 주입받는다: core graph의 EXTERNAL_FETCH tripwire가 worker graph에서도 같은 모양을
// 요구하므로 제품 fetch는 property 접근으로만 부른다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import type { LophnError } from "../../../../base/mod.ts";
import { ERROR_CODES } from "../../../../base/mod.ts";

// loopback HTTP JSON call의 좁은 모양. status와 body bytes만 본다.
export type LoopbackFetch = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  },
) => Promise<{ status: number; bytes: Uint8Array }>;

export type CoreClientOptions = {
  baseUrl: string;
  credential: string;
  fetch: LoopbackFetch;
};

export type CoreClient = {
  // `/v1/<path>` POST. 200 이외는 core가 낸 공통 오류 code를 그대로 전한다.
  call(path: string, body: unknown): Promise<Result<unknown, LophnError>>;
};

const decoder = new TextDecoder();

function decode(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch {
    return undefined;
  }
}

function codeOf(value: unknown): LophnError["code"] {
  return (ERROR_CODES as readonly unknown[]).includes(value)
    ? value as LophnError["code"]
    : "internal";
}

export function createCoreClient(options: CoreClientOptions): CoreClient {
  const base = options.baseUrl.replace(/\/$/, "");
  return {
    async call(path, body) {
      let response: { status: number; bytes: Uint8Array };
      try {
        response = await options.fetch(`${base}/v1/${path}`, {
          method: "POST",
          headers: {
            "authorization": `Bearer ${options.credential}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        });
      } catch {
        // 전송 실패의 원문(주소·token)은 남기지 않는다.
        return err({ code: "unavailable", message: "core request failed" });
      }
      const parsed = decode(response.bytes);
      if (response.status !== 200) {
        const failure = (parsed as {
          error?: { code?: unknown; message?: unknown };
        } | undefined)?.error;
        return err({
          code: codeOf(failure?.code),
          message: typeof failure?.message === "string"
            ? failure.message
            : "core request failed",
        });
      }
      if (parsed === undefined) {
        return err({ code: "internal", message: "core answer is not JSON" });
      }
      return ok(parsed);
    },
  };
}

// 제품 fetch. property 접근으로만 부른다(bare fetch( 금지). Response를 status와
// body bytes로만 거둔다.
export function productFetch(): LoopbackFetch {
  const globalFetch = globalThis.fetch;
  return async (input, init) => {
    const response = await globalFetch(input, init);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { status: response.status, bytes };
  };
}
