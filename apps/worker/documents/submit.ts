// coordinator의 machine document.save 제출 client. 인증은 hello가 싣는
// credential token(Bearer)이다. fetch는 주입받는다: core graph의 EXTERNAL_FETCH
// tripwire가 documents worker graph에서도 같은 모양을 요구하므로 property 접근으로만
// 부른다(worker entry의 graph 검사는 packages/platform/responsiveness/core_imports_test).
import { err, ok, type Result } from "../../../packages/base/mod.ts";
import type { LophnError } from "../../../packages/base/mod.ts";

// loopback HTTP/1.1 JSON call의 좁은 모양. fetch는 주입받는다.
export type LoopbackSaveFetch = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  },
) => Promise<{ status: number; bytes: Uint8Array }>;

export type SaveClientOptions = {
  baseUrl: string;
  credential: string;
  fetch: LoopbackSaveFetch;
};

const decoder = new TextDecoder();

function decode(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch {
    return undefined;
  }
}

// document.save command call. JSON body는 envelope({input, idempotency_key,
// compare, prepared})다. 인증은 hello credential의 Bearer token이다.
export async function postDocumentSave(
  options: SaveClientOptions,
  envelope: {
    input: unknown;
    idempotency_key: string;
    compare: unknown;
    prepared: readonly string[];
  },
): Promise<Result<unknown, LophnError>> {
  const base = options.baseUrl.replace(/\/$/, "");
  let response: { status: number; bytes: Uint8Array };
  try {
    response = await options.fetch(`${base}/v1/documents/save`, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${options.credential}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(envelope),
    });
  } catch {
    return err({ code: "unavailable", message: "transport failed" });
  }
  if (response.status !== 200) {
    const body = decode(response.bytes) as {
      error?: { code?: string; message?: string };
    } | undefined;
    return err({
      code: (body?.error?.code ?? "internal") as LophnError["code"],
      message: body?.error?.message ?? "document.save failed",
    });
  }
  return ok(decode(response.bytes));
}

// 제품 fetch. property 접근으로만 부른다(bare fetch( 금지). Response를 좁은
// 모양으로 거둔다: status와 body bytes만 본다.
export function productSaveFetch(): LoopbackSaveFetch {
  const globalFetch = globalThis.fetch;
  return async (input, init) => {
    const response = await globalFetch(input, init);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { status: response.status, bytes };
  };
}
