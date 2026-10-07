// coding-agent worker kind의 수리 자료 조립(coding-agent#T42; repair-context#R1, R18-R20). 요청마다
// 요청자 connection credential로 현재 정본을 core RPC read로 읽어 summary·bundle을 만든다. ledger·앱 DB·
// 원본 파일은 열지 않고 완성 묶음을 저장하지 않는다. 글은 core 알려진 값 pipe(`redact_request`)를
// 지난 것만 쓴다. 이 worker를 요청에 연결하는 core route 등록(budget·more·cursor·이미지 포함)은 T43이다.
import {
  err,
  type ErrorCode,
  ok,
  type Result,
} from "../../../packages/base/mod.ts";
import {
  createRpcClient,
  type ParentMessage,
  type Route,
  type RpcFetch,
  type WorkerRequest,
} from "../../../packages/contracts/platform/mod.ts";
import {
  RepairContextBundleInputSchema,
  RepairContextSummaryInputSchema,
} from "../../../packages/contracts/coding-agent/mod.ts";
import {
  assembleRepairContext,
  createRepairReadPort,
  type RepairReadClient,
  type RepairTarget,
} from "../../../packages/coding-agent/repair-context/mod.ts";
import {
  type ChildSession,
  type ChildStreams,
  startChild,
} from "../../../packages/platform/responsiveness/mod.ts";
import { createRedactLink } from "../../agent-runtime/redact-link.ts";

export const CODING_AGENT_WORKER_KIND = "coding-agent/worker";
export const REPAIR_CONTEXT_OPS = {
  summary: "repair_context.summary",
  bundle: "repair_context.bundle",
} as const;

// worker 요청 payload. credential은 요청자 connection의 것이고 core가 요청마다 싣는다.
// worker는 machine credential로 범위 밖 근거를 대신 읽지 않는다.
export type RepairContextPayload = { credential: string; input: unknown };

export class RepairContextRejection extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export type RepairContextDeps = {
  baseUrl: string;
  redact(text: string): Promise<string | null>;
  now?(): string;
  fetch?: RpcFetch;
};

function rpcFetch(): RpcFetch {
  return (input, init) => {
    // EXTERNAL_FETCH tripwire: property access로만 부른다.
    const globalFetch = globalThis.fetch;
    return globalFetch(input, init).then(async (response) => ({
      status: response.status,
      headers: response.headers,
      bytes: new Uint8Array(await response.arrayBuffer()),
    }));
  };
}

function readClient(deps: RepairContextDeps, token: string): RepairReadClient {
  const client = createRpcClient({
    baseUrl: deps.baseUrl,
    token,
    fetch: deps.fetch ?? rpcFetch(),
  });
  return {
    read: (route: Route, input: unknown) =>
      client.call(route, input as never) as Promise<Result<unknown>>,
  };
}

function payloadOf(request: WorkerRequest): RepairContextPayload {
  const payload = request.payload;
  if (
    typeof payload !== "object" || payload === null ||
    typeof (payload as Record<string, unknown>)["credential"] !== "string"
  ) {
    throw new RepairContextRejection("invalid_input", "invalid request body");
  }
  return payload as RepairContextPayload;
}

function targetOf(input: unknown, summary: boolean): RepairTarget {
  const schema = summary
    ? RepairContextSummaryInputSchema
    : RepairContextBundleInputSchema;
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new RepairContextRejection("invalid_input", "invalid input");
  }
  const selector = parsed.data.selector;
  return selector.ticket !== undefined
    ? { ticket: selector.ticket }
    : { problem: selector.problem! };
}

// op 하나를 조립한다. 없는 대상과 범위 밖 대상은 같은 not_found다.
export async function acceptRepairContext(
  request: WorkerRequest,
  deps: RepairContextDeps,
): Promise<unknown> {
  const summary = request.op === REPAIR_CONTEXT_OPS.summary;
  if (!summary && request.op !== REPAIR_CONTEXT_OPS.bundle) {
    throw new RepairContextRejection("invalid_input", "unknown op");
  }
  const payload = payloadOf(request);
  const target = targetOf(payload.input, summary);
  const port = createRepairReadPort({
    client: readClient(deps, payload.credential),
    now: deps.now ?? (() => new Date().toISOString()),
    redact: deps.redact,
  });
  const assembled = await assembleRepairContext(port, target);
  if (!assembled.ok) {
    throw new RepairContextRejection(
      assembled.error.code,
      assembled.error.message,
    );
  }
  if (summary) return { summary: assembled.value.summary };
  if (assembled.value.context === null) {
    // 전체 상한 안에 줄이는 일은 T43이 맡는다. 줄이지 못한 묶음은 만들지 않는다.
    throw new RepairContextRejection(
      "unavailable",
      "repair context exceeds the total budget",
    );
  }
  return { context: assembled.value.context };
}

export type CodingAgentWorkerOptions = {
  streams: ChildStreams;
  accept(request: WorkerRequest): Promise<unknown>;
  // hello가 알려 준 core loopback port.
  onHello?(hello: { api_port: number }): void;
  // 감독 pipe의 parent message를 먼저 받는다. 처리했으면 true.
  onMessage?(message: ParentMessage): boolean;
  cancelled?: () => boolean;
};

export function createCodingAgentWorker(
  options: CodingAgentWorkerOptions,
): ChildSession {
  const session: ChildSession = startChild(options.streams, {
    onHello(hello) {
      if (hello.kind !== CODING_AGENT_WORKER_KIND) {
        throw new Error("invalid worker kind");
      }
      options.onHello?.(hello);
      return session.send({ type: "ready" });
    },
    onStop() {
      options.cancelled?.();
      return session.send({ type: "stopped" });
    },
    async onParent(message) {
      if (options.onMessage?.(message) === true) return;
      if (message.type !== "worker_request") return;
      try {
        const payload = await options.accept(message as WorkerRequest);
        await session.send({
          type: "worker_response",
          request_id: message.request_id,
          ok: true,
          payload,
        });
      } catch (thrown) {
        // 내부 실패는 unavailable이다. 본문·경로·credential을 응답에 넣지 않는다.
        const rejected = thrown instanceof RepairContextRejection;
        await session.send({
          type: "worker_response",
          request_id: message.request_id,
          ok: false,
          error: rejected
            ? { code: thrown.code, message: thrown.message }
            : { code: "unavailable", message: "repair context failed" },
        });
      }
    },
  });
  return session;
}

export function codingAgentReady(kind: string): Result<true> {
  if (kind !== CODING_AGENT_WORKER_KIND) {
    return err({ code: "invalid_input", message: "unknown worker kind" });
  }
  return ok(true);
}

export async function runCodingAgentWorker(_root: string): Promise<void> {
  // Only the entry owns console routing. Helper modules never change global console.
  console.log = console.info = console.debug = (...args: unknown[]) =>
    console.error(...args);
  let apiPort = 0;
  let session: ChildSession | undefined;
  const link = createRedactLink({
    send: (message) => session!.send(message),
  });
  session = createCodingAgentWorker({
    streams: { stdin: Deno.stdin, stdout: Deno.stdout, stderr: Deno.stderr },
    onHello: (hello) => {
      apiPort = hello.api_port;
    },
    onMessage: (message) => link.onParent(message),
    accept: (request) =>
      acceptRepairContext(request, {
        baseUrl: `http://127.0.0.1:${apiPort}`,
        redact: (text) => link.redact(text),
      }),
  });
  await session.run();
}
