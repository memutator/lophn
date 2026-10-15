// core loopback HTTP client. collector의 보고 접수 통로가 쓴다.
// fetch는 주입받는다: core graph의 EXTERNAL_FETCH tripwire가 bare fetch(를
// 금지하므로 property 접근으로만 부른다. node:http는 graph 어디에도 없다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import type { LophnError } from "../../../../base/mod.ts";
import { recordProblemReport } from "../../../../protocol/problems/mod.ts";

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

const decoder = new TextDecoder();

function decode(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch {
    return undefined;
  }
}

// problem.record_report command call. JSON body는 envelope({input, idempotency_key,
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
    response = await options.fetch(
      `${base}/v1/${recordProblemReport.resource}/${recordProblemReport.method}`,
      {
        method: "POST",
        headers: {
          "authorization": `Bearer ${options.credential}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(envelope),
      },
    );
  } catch {
    return err({ code: "unavailable", message: "transport failed" });
  }
  if (response.status !== 200) {
    const body = decode(response.bytes) as {
      error?: { code?: string; message?: string };
    } | undefined;
    return err({
      code: (body?.error?.code ?? "internal") as LophnError["code"],
      message: body?.error?.message ?? "record_report failed",
    });
  }
  return ok(decode(response.bytes));
}
