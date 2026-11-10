// core E2E와 `npm run dev`가 provider 자리에 쓰는 fake server. anthropic-messages
// 하나만 말한다(path `/messages`). 기대와 다른 요청과 queue가 빈 요청은 HTTP 400으로
// 답한다. 500 계열은 제품이 temporary로 보고 retry해서 test가 헷갈린다.

import { serve } from "../../../packages/core/server/serve.ts";
import { type Held, toResponse } from "./reply.ts";
import type { FakeServer, JournalEntry, Lane, Reply, Step } from "./types.ts";

export type {
  FakeServer,
  JournalEntry,
  Lane,
  Partial,
  Reply,
  ReplyFn,
  Step,
} from "./types.ts";

const PATH = "/messages";

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
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

// socket 없이 request를 직접 넣을 수 있는 몸체. startFakeServer가 serve adapter를 얹는다.
// core의 제목 call(`prompt-assembly/title.ts`): tool이 없고 system이 제목 짓기 지침이다.
function isTitleRequest(body: unknown): boolean {
  const request = body as { tools?: unknown[]; system?: unknown } | null;
  return (
    typeof request === "object" &&
    request !== null &&
    (request.tools?.length ?? 0) === 0 &&
    JSON.stringify(request.system ?? "").includes("You name a chat session")
  );
}

export function createFakeHandler(options: { fallback?: Reply } = {}) {
  // 줄마다 따로 꺼낸다. 기본 줄은 match가 없고 어느 줄에도 안 맞은 요청이 간다.
  type Queue = { steps: readonly Step[]; taken: number };
  let fallbackQueue: Queue = { steps: [], taken: 0 };
  let lanes = new Map<string, Queue & { match: Lane["match"] }>();
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
    const url = new URL(request.url);
    const text = await request.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // JSON이 아니면 원문 글을 둔다.
    }
    // session 첫 요청마다 core가 제목을 짓는 call을 따로 보낸다. test의 대본과 journal은 turn의 call만 세므로 여기서
    // 받아 넘긴다. 제목으로 쓸 수 없는 답을 주어 자른 자동 제목이 그대로 남는다.
    if (isTitleRequest(parsed)) {
      return toResponse(
        { kind: "text", text: "-" },
        AbortSignal.any([request.signal, closing.signal]),
        { on: false, cancel() {} },
      );
    }
    const n = entries.length + 1;
    const entry: JournalEntry = {
      n,
      method: request.method,
      path: url.pathname,
      headers: Object.fromEntries(request.headers),
      body: parsed,
      step: null,
      mismatch: null,
      lane: null,
    };
    for (const [name, lane] of lanes) {
      if (lane.match(entry)) {
        entry.lane = name;
        break;
      }
    }
    entries.push(entry);
    const until = AbortSignal.any([request.signal, closing.signal]);
    // 붙들고 있는 동안 client가 끊은 것만 aborted로 센다. close()로 놓아 준 것도 client 끊김이 아니다.
    // 정상으로 다 보낸 응답 뒤에도 request.signal은 abort될 수 있다.
    const gone = abort(n);
    const held: Held = {
      on: false,
      // client가 끊기면 serve adapter가 붙들고 있던 응답 stream을 cancel한다. Node에서는 그때
      // request.signal abort가 오지 않을 수 있어(실측) 끊김을 이 경로로도 센다.
      cancel() {
        if (held.on && !closing.signal.aborted) gone.resolve();
      },
    };
    request.signal.addEventListener(
      "abort",
      () => {
        if (held.on && !closing.signal.aborted) gone.resolve();
      },
      { once: true },
    );
    arrival(n).resolve(entry);

    const miss = (message: string) => {
      entry.mismatch = message;
      return mismatchResponse(message);
    };
    if (entry.method !== "POST" || entry.path !== PATH) {
      return miss(`expected POST ${PATH}, got ${entry.method} ${entry.path}`);
    }
    let reply: Reply;
    const queue = entry.lane === null ? fallbackQueue : lanes.get(entry.lane)!;
    const step = queue.steps[queue.taken];
    if (step !== undefined) {
      entry.step = queue.taken++;
      const difference = step.expect?.(entry) ?? null;
      if (difference !== null) return miss(difference);
      if (typeof step.reply === "function") {
        try {
          reply = step.reply(entry, entries);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return miss(`reply function threw: ${message}`);
        }
      } else {
        reply = step.reply;
      }
    } else if (options.fallback !== undefined) {
      reply = options.fallback;
    } else {
      return miss(`no scripted reply left for request ${n}`);
    }
    if (reply.kind === "silent") {
      // header도 주지 않는다. client가 끊거나 server를 닫을 때까지 응답하지 않는다.
      if (!until.aborted) {
        held.on = true;
        await new Promise<void>((resolve) =>
          until.addEventListener("abort", () => resolve(), { once: true }),
        );
        held.on = false;
      }
      return new Response(null, { status: 499 });
    }
    return toResponse(reply, until, held);
  }

  return {
    script(steps: readonly Step[], lane?: Lane) {
      if (lane === undefined) {
        fallbackQueue = { steps: [...steps], taken: 0 };
      } else {
        lanes.set(lane.name, {
          match: lane.match,
          steps: [...steps],
          taken: 0,
        });
      }
    },
    reset() {
      fallbackQueue = { steps: [], taken: 0 };
      lanes = new Map();
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

export async function startFakeServer(
  options: { fallback?: Reply } = {},
): Promise<FakeServer> {
  const { release, ...fake } = createFakeHandler(options);
  const server = await serve({ hostname: "127.0.0.1", port: 0 }, fake.handle);
  const port = server.addr.transport === "tcp" ? server.addr.port : 0;
  return {
    ...fake,
    url: `http://127.0.0.1:${port}`,
    async close() {
      release();
      await server.shutdown();
    },
  };
}
