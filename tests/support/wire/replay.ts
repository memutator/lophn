// 녹화 재생 fetch. provider 응답을 file이나 인라인 case로 돌려주고 받은 요청을 기록한다.
// 요청은 fixture에 저장하지 않는다(응답만 사람이 diff를 보고 commit한다).
import { readFileSync } from "node:fs";
import { errorCode } from "../../../packages/base/mod.ts";

// 저장 꼴: `<provider>/<case>.sse`(SSE 본문 그대로) 또는 `.json`(JSON 본문 그대로),
// 선택 `<case>.meta.json` = {status?, headers?, disconnect?}. live-suite가 같은 꼴로 저장한다.
export type Fixture = {
  status: number;
  headers?: Record<string, string>;
  body: string;
  // 본문을 다 준 뒤 stream이 오류로 끝난다.
  disconnect?: "error";
};

export type RecordedRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
};

type Meta = Partial<Pick<Fixture, "status" | "headers" | "disconnect">>;

const ROOT = new URL("../../fixtures/provider/", import.meta.url);

function readOptional(url: URL): string | null {
  try {
    return readFileSync(url, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

// name은 `anthropic/text-end_turn` 꼴이다. file이 없으면 던진다.
export function loadFixture(name: string): Fixture {
  const sse = readOptional(new URL(`${name}.sse`, ROOT));
  const body = sse ?? readOptional(new URL(`${name}.json`, ROOT));
  if (body === null) throw new Error(`no fixture: ${name}`);
  const metaText = readOptional(new URL(`${name}.meta.json`, ROOT));
  const meta: Meta = metaText === null ? {} : JSON.parse(metaText);
  return {
    status: meta.status ?? 200,
    headers: {
      "content-type": sse !== null ? "text/event-stream" : "application/json",
      ...meta.headers,
    },
    body,
    disconnect: meta.disconnect,
  };
}

function abortError(): DOMException {
  return new DOMException("aborted", "AbortError");
}

function responseOf(fixture: Fixture, signal: AbortSignal | null): Response {
  const bytes = new TextEncoder().encode(fixture.body);
  let stream: ReadableStream<Uint8Array> | null = null;
  if (bytes.length > 0) {
    let sent = false;
    stream = new ReadableStream<Uint8Array>({
      start(controller) {
        signal?.addEventListener(
          "abort",
          () => {
            try {
              controller.error(abortError());
            } catch {
              // 이미 끝난 stream이다.
            }
          },
          { once: true },
        );
      },
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(bytes);
        } else if (fixture.disconnect === "error") {
          controller.error(new TypeError("connection reset"));
        } else {
          controller.close();
        }
      },
    });
  }
  return new Response(stream, {
    status: fixture.status,
    headers: fixture.headers,
  });
}

// 호출 순서대로 case를 하나씩 돌려준다. case가 모자라면 던진다.
export function replayFetch(...cases: Fixture[]): {
  fetch: typeof fetch;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  let next = 0;
  const replay = (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const signal = init?.signal ?? null;
    if (signal?.aborted) return Promise.reject(abortError());
    const fixture = cases[next++];
    if (fixture === undefined) {
      return Promise.reject(new Error("replayFetch: no case left"));
    }
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, name) => {
      headers[name] = value;
    });
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    });
    return new Promise((resolve, reject) => {
      signal?.addEventListener("abort", () => reject(abortError()), {
        once: true,
      });
      queueMicrotask(() => resolve(responseOf(fixture, signal)));
    });
  };
  return { fetch: replay as typeof fetch, requests };
}
