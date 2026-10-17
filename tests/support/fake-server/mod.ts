// core E2E와 `deno task dev`가 provider 자리에 쓰는 fake server. anthropic-messages
// 하나만 말한다(path `/messages`). 기대와 다른 요청과 queue가 빈 요청은 HTTP 400으로
// 답한다. 500 계열은 제품이 temporary로 보고 retry해서 test가 헷갈린다.

import { toResponse } from "./reply.ts";
import type { FakeServer, JournalEntry, Reply, Step } from "./types.ts";

export type {
  FakeServer,
  JournalEntry,
  Partial,
  Reply,
  Step,
} from "./types.ts";

const PATH = "/messages";

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => resolve = r);
  return { promise, resolve };
}

function mismatchResponse(message: string): Response {
  return new Response(
    JSON.stringify({
      type: "error",
      error: { type: "invalid_request_error", message },
    }),
    { status: 400, headers: { "content-type": "application/json" } },
  );
}

// socket 없이 request를 직접 넣을 수 있는 몸체. startFakeServer가 Deno.serve를 얹는다.
export function createFakeHandler(options: { fallback?: Reply } = {}) {
  let queue: readonly Step[] = [];
  let taken = 0;
  let entries: JournalEntry[] = [];
  let arrivals = new Map<number, Deferred<JournalEntry>>();
  let aborts = new Map<number, Deferred<void>>();
  const closing = new AbortController();

  const arrival = (n: number) => {
    const found = arrivals.get(n) ?? deferred<JournalEntry>();
    arrivals.set(n, found);
    return found;
  };
  const abort = (n: number) => {
    const found = aborts.get(n) ?? deferred<void>();
    aborts.set(n, found);
    return found;
  };

  async function handle(request: Request): Promise<Response> {
    const n = entries.length + 1;
    const url = new URL(request.url);
    const text = await request.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // JSON이 아니면 원문 글을 둔다.
    }
    const entry: JournalEntry = {
      n,
      method: request.method,
      path: url.pathname,
      headers: Object.fromEntries(request.headers),
      body: parsed,
      step: null,
      mismatch: null,
    };
    entries.push(entry);
    const until = AbortSignal.any([request.signal, closing.signal]);
    const gone = abort(n);
    if (request.signal.aborted) gone.resolve();
    else {
      request.signal.addEventListener("abort", () => gone.resolve(), {
        once: true,
      });
    }
    arrival(n).resolve(entry);

    const miss = (message: string) => {
      entry.mismatch = message;
      return mismatchResponse(message);
    };
    if (entry.method !== "POST" || entry.path !== PATH) {
      return miss(`expected POST ${PATH}, got ${entry.method} ${entry.path}`);
    }
    let reply: Reply;
    const step = queue[taken];
    if (step !== undefined) {
      entry.step = taken++;
      const difference = step.expect?.(entry) ?? null;
      if (difference !== null) return miss(difference);
      reply = step.reply;
    } else if (options.fallback !== undefined) {
      reply = options.fallback;
    } else {
      return miss(`no scripted reply left for request ${n}`);
    }
    if (reply.kind === "silent") {
      // header도 주지 않는다. client가 끊거나 server를 닫을 때까지 응답하지 않는다.
      if (!until.aborted) {
        await new Promise<void>((resolve) =>
          until.addEventListener("abort", () => resolve(), { once: true })
        );
      }
      return new Response(null, { status: 499 });
    }
    return toResponse(reply, until);
  }

  return {
    script(steps: readonly Step[]) {
      queue = [...steps];
      taken = 0;
    },
    reset() {
      queue = [];
      taken = 0;
      entries = [];
      arrivals = new Map();
      aborts = new Map();
    },
    journal: (): readonly JournalEntry[] => entries,
    arrived: (n: number) => arrival(n).promise,
    aborted: (n: number) => abort(n).promise,
    handle,
    // 붙들고 있는 연결(silent, stall, hold)을 놓는다.
    release: () => closing.abort(),
  };
}

export function startFakeServer(
  options: { fallback?: Reply } = {},
): Promise<FakeServer> {
  const { release, ...fake } = createFakeHandler(options);
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen() {} },
    fake.handle,
  );
  return Promise.resolve({
    ...fake,
    url: `http://127.0.0.1:${server.addr.port}`,
    async close() {
      release();
      await server.shutdown();
    },
  });
}
