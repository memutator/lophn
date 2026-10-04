// 세 protocol과 OAuth를 127.0.0.1에서 실제 HTTP로 내보낸다.
import { type Incoming, loggedHeaders } from "./match.ts";
import { parseRequestBody, safeBody } from "./normalize.ts";
import { OAuth, type OAuthOptions } from "./oauth.ts";
import { StepQueue } from "./queue.ts";
import { parseScript, ScriptError } from "./script.ts";
import { buildReply } from "./semantic.ts";
import { openStream } from "./stream.ts";
import type { LoggedRequest, Script, Step, StepResponse } from "./types.ts";

export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

export type ServerOptions = {
  script: Script;
  nowMs?: () => number;
  sleep?: Sleep;
  oauth?: Omit<OAuthOptions, "nowMs">;
  // 이름 없는 지연을 건너뛴다. gate는 항상 release를 기다린다.
  instant?: boolean;
};

const PATHS: Record<string, Step["protocol"]> = {
  "/messages": "messages",
  "/responses": "responses",
  "/chat/completions": "chat_completions",
};

export class FakeServer {
  #options: ServerOptions;
  #queue: StepQueue;
  #oauth: OAuth;
  #log: LoggedRequest[] = [];
  #seq = 0;
  #admission: Promise<void> = Promise.resolve();
  #lifetime = new AbortController();
  #released = new Set<string>();
  #waiters = new Map<string, Array<() => void>>();
  #failure: string | undefined;

  constructor(options: ServerOptions) {
    this.#options = options;
    // 프로그램이 넘긴 script도 JSON과 같은 검사를 거친다.
    this.#queue = new StepQueue(parseScript(options.script));
    this.#oauth = new OAuth({ ...options.oauth, nowMs: () => this.#now() });
  }

  requests(): LoggedRequest[] {
    return this.#log.map((entry) => ({
      ...entry,
      headers: [...entry.headers],
    }));
  }

  remaining(): string[] {
    return this.#queue.remaining();
  }

  // 받은 요청 수가 기대와 다르거나 step이 남거나 기대와 다른 요청이 있으면 실패한다.
  // 호출이 없음을 단언하려면 expected를 0이 아닌 수로 준다.
  assertDone(expected: number): void {
    if (this.#failure) throw new Error(this.#failure);
    const remaining = this.#queue.remaining();
    if (remaining.length) throw new Error(`남은 응답: ${remaining.join(",")}`);
    const count = this.#log.filter((entry) => PATHS[entry.path]).length;
    if (count !== expected) {
      throw new Error(`요청 수 ${count}, 기대 ${expected}`);
    }
  }

  close(): void {
    this.#lifetime.abort();
  }

  release(gate: string): void {
    this.#released.add(gate);
    for (const wake of [...(this.#waiters.get(gate) ?? [])]) wake();
    this.#waiters.delete(gate);
  }

  handle(request: Request): Promise<Response> {
    // body read·header hash 전에 접수 번호를 reserve한다. stream 소비는 tail 밖이다.
    const seq = ++this.#seq;
    const atMs = this.#now();
    const admitted = this.#admission.then(() =>
      this.#handle(request, seq, atMs)
    );
    this.#admission = admitted.then(() => {}, () => {});
    return admitted;
  }

  async #handle(
    request: Request,
    seq: number,
    atMs: number,
  ): Promise<Response> {
    const url = new URL(request.url);
    const text = await request.text();
    const headers = Object.fromEntries(
      [...request.headers].map(([name, value]) => [name.toLowerCase(), value]),
    );
    const incoming = incomingOf(request.method, url.pathname, headers, text);
    const entry = await this.#record(
      request.method,
      url.pathname,
      headers,
      incoming.body,
      seq,
      atMs,
    );

    if (url.pathname === "/__fake/log" && request.method === "GET") {
      return Response.json(this.requests());
    }
    if (url.pathname === "/__fake/script" && request.method === "POST") {
      return this.#replace(text);
    }

    const oauth = await this.#oauth.handle(
      request.method,
      url.pathname,
      incoming.body,
      url.searchParams,
    );
    if (oauth) return await this.#respond(oauth, request.signal, entry);

    const protocol = PATHS[url.pathname];
    if (!protocol || request.method !== "POST") {
      this.#fail(entry, "script에 없는 요청");
      return Response.json({ error: "unexpected" }, { status: 500 });
    }
    const found = this.#queue.next(incoming, protocol);
    if ("exhausted" in found) {
      this.#fail(entry, "응답 소진");
      return Response.json({ error: "exhausted" }, { status: 500 });
    }
    if (!found.result.ok) {
      this.#fail(
        entry,
        `script와 다른 요청(${found.result.detail}): step ${found.step.id}`,
      );
      return Response.json({ error: "mismatch" }, { status: 500 });
    }
    if (found.step.protocol !== protocol) {
      this.#fail(entry, `protocol이 다름: step ${found.step.id}`);
      return Response.json({ error: "mismatch" }, { status: 500 });
    }
    entry.matchedStep = found.step.id;
    const response = found.step.response ??
      buildReply(protocol, found.step.reply ?? {});
    return await this.#respond(response, request.signal, entry);
  }

  async #record(
    method: string,
    path: string,
    headers: Record<string, string>,
    body: unknown,
    seq: number,
    atMs: number,
  ): Promise<LoggedRequest> {
    const entry: LoggedRequest = {
      seq,
      atMs,
      method,
      path: PATHS[path] ||
          [
            "/__fake/log",
            "/__fake/script",
            "/oauth/token",
            "/oauth/register",
            "/oauth/authorize",
            "/oauth/device",
            "/.well-known/openid-configuration",
          ].includes(path)
        ? path
        : "[unexpected]",
      headers: await loggedHeaders(headers),
      body: path === "/__fake/script" ? { omitted: true } : safeBody(body),
      aborted: false,
    };
    this.#log.push(entry);
    return entry;
  }

  #replace(text: string): Response {
    let script: Script;
    try {
      script = parseScript(JSON.parse(text));
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof ScriptError) {
        return Response.json({ error: "invalid_script" }, { status: 400 });
      }
      throw error;
    }
    if (this.#log.some((entry) => entry.matchedStep)) {
      return Response.json({ error: "script_started" }, { status: 409 });
    }
    this.#queue = new StepQueue(script);
    this.#failure = undefined;
    return Response.json({ ok: true });
  }

  #respond(
    response: StepResponse,
    signal: AbortSignal,
    entry: LoggedRequest,
  ): Response {
    const headers = new Headers(response.headers);
    if (!response.chunks) {
      return new Response(
        [204, 205, 304].includes(response.status) ? null : response.body ?? "",
        {
          status: response.status,
          headers,
        },
      );
    }
    const body = openStream({
      chunks: response.chunks,
      end: response.end,
      signal: AbortSignal.any([signal, this.#lifetime.signal]),
      instant: this.#options.instant === true,
      sleep: this.#options.sleep ?? realSleep,
      waitGate: (name, signal) => this.#untilGate(name, signal, entry),
      onAbort: () => {
        entry.aborted = true;
      },
    });
    return new Response(body, { status: response.status, headers });
  }

  #untilGate(
    name: string,
    signal: AbortSignal,
    entry: LoggedRequest,
  ): Promise<void> {
    if (this.#released.has(name)) return Promise.resolve();
    return new Promise((resolve) => {
      const finish = () => {
        signal.removeEventListener("abort", abort);
        const waiters = this.#waiters.get(name);
        if (waiters) {
          const index = waiters.indexOf(finish);
          if (index >= 0) waiters.splice(index, 1);
          if (!waiters.length) this.#waiters.delete(name);
        }
        resolve();
      };
      const abort = () => {
        entry.aborted = true;
        finish();
      };
      if (signal.aborted) return abort();
      const waiters = this.#waiters.get(name) ?? [];
      waiters.push(finish);
      this.#waiters.set(name, waiters);
      signal.addEventListener("abort", abort, { once: true });
    });
  }

  #now(): number {
    return this.#options.nowMs?.() ?? Date.now();
  }

  #fail(entry: LoggedRequest, detail: string): void {
    this.#failure ??= `seq ${entry.seq}: ${detail}`;
  }
}

function incomingOf(
  method: string,
  path: string,
  headers: Record<string, string>,
  text: string,
): Incoming {
  const body = parseRequestBody(headers["content-type"] ?? "", text);
  return { method, path, headers, body };
}

function realSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener("abort", finish, { once: true });
    if (signal?.aborted) finish();
  });
}
