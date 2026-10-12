// coding-agent/checker worker. 보고된 ticket의 acceptance check를 machine actor로 판정한다
// (coding-agent/tickets#R7, R8, R18, R19, R20). core 감독이 상시 하나를 띄운다. 시작할 때
// (재시작 뒤 이어하기)와 core가 `tickets.check`를 보낼 때(VerificationRecorded·ReleaseActivated·
// ReleaseSuperseded·TicketCompletionReported 뒤) 보고된 ticket을 정본 사실로 다시 비교한다.
// 이 worker는 ledger를 직접 열지 않는다: core API의 read와 record_checks command뿐이다.
// model 호출도 없다.
import {
  err,
  ERROR_CODES,
  ok,
  type Result,
  sha256Hex,
} from "../../../../base/mod.ts";
import type { LophnError } from "../../../../base/mod.ts";
import type {
  ParentMessage,
  WorkerRequest,
} from "../../../../protocol/supervision/mod.ts";
import {
  type ChildSession,
  type ChildStreams,
  startChild,
} from "../../../supervision/responsiveness/mod.ts";
import {
  type CheckerClient,
  checkReported,
  type CheckSweep,
  type RecordChecksCall,
} from "../checker/mod.ts";

export const TICKET_CHECKER_KIND = "coding-agent/checker";
// core가 감독 pipe로 보내는 깨움 요청의 op. 본문은 쓰지 않는다: 상태는 정본에서 다시 읽는다.
export const TICKET_CHECK_OP = "tickets.check";

// loopback HTTP JSON call의 좁은 모양. fetch는 주입받는다(EXTERNAL_FETCH tripwire).
export type LoopbackFetch = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ status: number; bytes: Uint8Array }>;

function codeOf(value: unknown): LophnError["code"] {
  return (ERROR_CODES as readonly unknown[]).includes(value)
    ? value as LophnError["code"]
    : "internal";
}

// core API client. 인증은 hello가 싣는 machine credential의 Bearer token이다.
export function createCheckerClient(options: {
  baseUrl: string;
  credential: string;
  fetch: LoopbackFetch;
}): CheckerClient {
  const base = options.baseUrl.replace(/\/$/, "");
  const decoder = new TextDecoder();
  async function call(
    path: string,
    body: unknown,
  ): Promise<Result<Record<string, unknown>>> {
    let response: { status: number; bytes: Uint8Array };
    try {
      response = await options.fetch(`${base}/v1/${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.credential}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch {
      return err({ code: "unavailable", message: "core request failed" });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(decoder.decode(response.bytes));
    } catch {
      parsed = undefined;
    }
    if (response.status !== 200) {
      const failure = (parsed as { error?: { code?: unknown } } | undefined)
        ?.error;
      return err({
        code: codeOf(failure?.code),
        message: "core request failed",
      });
    }
    if (typeof parsed !== "object" || parsed === null) {
      return err({ code: "internal", message: "core answer is not JSON" });
    }
    return ok(parsed as Record<string, unknown>);
  }
  return {
    async work(input) {
      const read = await call("tickets/check_work", input);
      if (!read.ok) return read;
      const works = read.value["works"];
      const next = read.value["next_cursor"];
      if (!Array.isArray(works)) {
        return err({ code: "internal", message: "check work is malformed" });
      }
      return ok({
        works,
        next_cursor: typeof next === "string" ? next : null,
      });
    },
    async record(input: RecordChecksCall) {
      // 같은 읽기·같은 판정의 재시도는 같은 key라 한 번만 적용된다.
      const digest = await sha256Hex(
        new TextEncoder().encode(JSON.stringify(input.checks)),
      );
      const written = await call("tickets/record_checks", {
        input,
        idempotency_key:
          `check:${input.completion_seq}:${input.base_revision}:${
            digest.slice(0, 32)
          }`,
        compare: { base_revision: input.base_revision },
        prepared: [],
      });
      if (!written.ok) return written;
      return ok({ state: String(written.value["state"]) });
    },
  };
}

export type CheckerWorkerOptions = {
  streams: ChildStreams;
  // hello가 준 machine credential과 core api port로 core API client를 만든다.
  client(position: { credential: string; api_port: number }): CheckerClient;
};

function requestOf(message: ParentMessage): WorkerRequest | undefined {
  const record = message as unknown as Record<string, unknown>;
  return record["type"] === "worker_request" &&
      typeof record["request_id"] === "string" &&
      typeof record["op"] === "string"
    ? message as unknown as WorkerRequest
    : undefined;
}

export function createCheckerWorker(
  options: CheckerWorkerOptions,
): ChildSession {
  let client: CheckerClient | undefined;
  let stopped = false;
  let running: Promise<Result<CheckSweep>> | undefined;
  let again = false;
  // 한 번에 하나만 돈다. 도는 중에 온 깨움은 끝난 뒤 한 번 더 비교한다(정본이 그 사이 바뀔 수 있다).
  function run(): Promise<Result<CheckSweep>> {
    if (client === undefined) {
      return Promise.resolve(
        err({ code: "unavailable", message: "checker has no credential" }),
      );
    }
    if (running !== undefined) {
      again = true;
      return running;
    }
    const mine = client;
    running = (async () => {
      let last: Result<CheckSweep>;
      do {
        again = false;
        last = await checkReported(mine);
      } while (again && !stopped);
      return last;
    })().finally(() => {
      running = undefined;
    });
    return running;
  }
  const session: ChildSession = startChild(options.streams, {
    onHello(hello) {
      if (hello.kind !== TICKET_CHECKER_KIND) {
        throw new Error("invalid worker kind");
      }
      client = options.client({
        credential: hello.credential,
        api_port: hello.api_port,
      });
      return session.send({ type: "ready" }).then(() => {
        // 재시작 뒤 이어하기: 보고된 ticket의 누락 검사를 지금 비교한다.
        if (!stopped) void run();
      });
    },
    onStop() {
      stopped = true;
      return session.send({ type: "stopped" });
    },
    async onParent(message) {
      const request = requestOf(message);
      if (request === undefined) return;
      if (request.op !== TICKET_CHECK_OP) {
        await session.send({
          type: "worker_response",
          request_id: request.request_id,
          ok: false,
          error: { code: "invalid_input", message: "unknown checker op" },
        });
        return;
      }
      const done = await run();
      await session.send(
        done.ok
          ? {
            type: "worker_response",
            request_id: request.request_id,
            ok: true,
            payload: done.value,
          }
          : {
            type: "worker_response",
            request_id: request.request_id,
            ok: false,
            error: { code: "unavailable", message: "ticket check failed" },
          },
      );
    },
  });
  return session;
}

export async function runCheckerWorker(_root: string): Promise<void> {
  // Only the entry owns console routing. Helper modules never change global console.
  console.log = console.info = console.debug = (...args: unknown[]) =>
    console.error(...args);
  const session = createCheckerWorker({
    streams: { stdin: Deno.stdin, stdout: Deno.stdout, stderr: Deno.stderr },
    client: (position) =>
      createCheckerClient({
        baseUrl: `http://127.0.0.1:${position.api_port}`,
        credential: position.credential,
        // EXTERNAL_FETCH tripwire: property access로만 부른다.
        fetch: (input, init) => {
          const globalFetch = globalThis.fetch;
          return globalFetch(input, init).then(async (response) => ({
            status: response.status,
            bytes: new Uint8Array(await response.arrayBuffer()),
          }));
        },
      }),
  });
  await session.run();
}

// launchArgv가 내는 argv의 entry는 이 모듈 자체다.
if (import.meta.main) {
  await runCheckerWorker(Deno.env.get("LOPHN_HOME") ?? "");
}
