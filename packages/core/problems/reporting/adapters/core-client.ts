// core loopback HTTP client와 진단 전송. collector의 보고 접수 통로가 쓴다.
// fetch는 주입받는다: core graph의 EXTERNAL_FETCH tripwire가 bare fetch(를
// 금지하므로 property 접근으로만 부른다. node:http는 graph 어디에도 없다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import type { WorkerRequest } from "../../../../protocol/supervision/mod.ts";
import type { LophnError } from "../../../../base/mod.ts";

// loopback HTTP/1.1 JSON call의 좁은 모양. fetch는 주입받는다.
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

export type LoopbackResponse<T> = {
  status: number;
  body: T | { error: { code: string; message: string } };
};

const decoder = new TextDecoder();

function decode(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch {
    return undefined;
  }
}

// record-report command call. JSON body는 envelope({input, idempotency_key,
// compare, prepared})다. 인증은 Bearer credential이다.
export async function postRecordReport(
  options: CoreClientOptions,
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
    response = await options.fetch(`${base}/v1/problems/record-report`, {
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
      message: body?.error?.message ?? "record-report failed",
    });
  }
  return ok(decode(response.bytes));
}

// 진단 전송. 잘못된 보고 진단은 platform/diagnostics로 가고 재귀 보고하지
// 않는다. transport 실패는 손실이다: 다시 보고하지 않는다.
export type DiagnosticsTransport = (request: WorkerRequest) => Promise<void>;

export async function postDiagnostics(
  send: DiagnosticsTransport,
  request: WorkerRequest,
): Promise<void> {
  try {
    await send(request);
  } catch {
    // 진단 실패는 손실이다. collector가 다시 보고하지 않는다.
  }
}
