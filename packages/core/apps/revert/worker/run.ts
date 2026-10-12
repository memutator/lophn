// 앱 revert 호출 worker(lophn-agent/revert R10). core 감독이 상시 하나를 띄우고, 사람의
// `RunAppRevert` 뒤 core가 단계마다 `revert.call`을 보낸다. worker는 요청이 싣는 사람
// credential으로 core loopback의 `apps/connect`를 부르고, 그 연결이 고정한 앱 direct socket으로
// 단계의 revert command를 request_key=step_key로 한 번 보낸다. worker는 ledger를 열지 않고
// 앱 단계의 판정(복원·미시작·불명확)도 하지 않는다: 결과를 그대로 돌려 core가 판정한다.
// 사람 credential은 요청 payload로만 오고 응답·log에 남지 않는다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import type {
  ParentMessage,
  WorkerRequest,
} from "../../../../protocol/server/mod.ts";
import {
  type ChildSession,
  type ChildStreams,
  startChild,
} from "../../../supervision/responsiveness/mod.ts";
import { type AppRevertBinding } from "../../../../protocol/lophn-agent/mod.ts";
import {
  type CoreCall,
  createRuntimeClient,
  type DirectTransport,
} from "../../runtime/client/mod.ts";

export const REVERT_WORKER_KIND = "apps/revert";
// core가 감독 pipe로 보내는 호출 요청의 op. apps/core/revert-caller.ts와 같은 값이다.
export const REVERT_CALL_OP = "revert.call";

const PLACEHOLDER_SCREEN = "main";

// worker가 core loopback에 낼 호출 결과다(lophn-agent/revert app-steps의 AppStepResult와 같은 모양).
export type RevertCallResult = {
  result: "restored" | "failure" | "uncertain";
  invocation: string | null;
};

class RevertRejection extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

// 요청 payload. credential은 RunAppRevert를 부른 사람의 Bearer token이고 core가 요청마다 싣는다.
export type RevertCallPayload = {
  credential: string;
  binding: AppRevertBinding;
};

function payloadOf(request: WorkerRequest): RevertCallPayload {
  const payload = request.payload;
  if (
    typeof payload !== "object" || payload === null ||
    typeof (payload as Record<string, unknown>)["credential"] !== "string"
  ) {
    throw new RevertRejection("invalid_input", "invalid request body");
  }
  return payload as RevertCallPayload;
}

// 저장한 revert 단계의 근거로 앱의 revert command를 한 번 보낸다. 사람의 apps/connect 연결을
// 열어 release가 같을 때만 request_key=step_key로 보낸다(앱이 같은 key의 재전송에 같은 결과를
// 돌려주므로 중복 실행되지 않는다). 앱에 닿지 못했거나 앱이 거절했으면(새 충돌, 확인 proof가 필요한
// command 포함) failure, 보낸 뒤 응답을 잃었으면 uncertain이다(되돌렸는지 결과 query로 묻지 않는다).
export async function acceptRevertCall(
  request: WorkerRequest,
  deps: {
    // core 주입(core)이 없을 때의 loopback 주소다.
    baseUrl?: string;
    // 시험이 transport를 바꿔 끼우는 입구다. 없으면 core loopback HTTP와 앱 direct socket이다.
    core?: CoreCall;
    direct?: DirectTransport;
  },
): Promise<RevertCallResult> {
  const payload = payloadOf(request);
  const binding = payload.binding;
  const client = createRuntimeClient({
    core: deps.core === undefined
      ? {
        baseUrl: deps.baseUrl ?? `http://127.0.0.1:0`,
        token: payload.credential,
      }
      : { call: deps.core },
    ...(deps.direct === undefined ? {} : { direct: deps.direct }),
  });
  const notSent: RevertCallResult = { result: "failure", invocation: null };
  const session = await client.connect({
    app: binding.app,
    mode: "live",
    screens: [PLACEHOLDER_SCREEN],
    screen_sizes: {},
    commands: [binding.revert_command],
  });
  if (!session.ok) return notSent;
  // 원래 write의 release와 다른 release에는 되돌림 근거가 통하지 않는다.
  if (session.value.connection.release !== binding.release) return notSent;
  const sent = await session.value.invoke({
    command: binding.revert_command,
    input: {
      invocation: binding.invocation,
      receipt: binding.receipt,
      expected_revision: binding.expected_revision,
    },
    request_key: binding.step_key,
  });
  if (!sent.ok) return notSent;
  if (sent.value.kind === "unknown") {
    return { result: "uncertain", invocation: null };
  }
  const invocation = sent.value.output.invocation;
  // 실제 Invocation 없이 복원했다고 답하지 않는다.
  return invocation === undefined
    ? { result: "uncertain", invocation: null }
    : { result: "restored", invocation };
}

export type RevertWorkerOptions = {
  streams: ChildStreams;
  // hello가 알려 준 core loopback port.
  onHello?(hello: { api_port: number }): void;
  accept(request: WorkerRequest): Promise<unknown>;
};

function requestOf(message: ParentMessage): WorkerRequest | undefined {
  const record = message as unknown as Record<string, unknown>;
  return record["type"] === "worker_request" &&
      typeof record["request_id"] === "string" &&
      typeof record["op"] === "string"
    ? message as unknown as WorkerRequest
    : undefined;
}

export function createRevertWorker(
  options: RevertWorkerOptions,
): ChildSession {
  const session: ChildSession = startChild(options.streams, {
    onHello(hello) {
      if (hello.kind !== REVERT_WORKER_KIND) {
        throw new Error("invalid worker kind");
      }
      options.onHello?.({ api_port: hello.api_port });
      return session.send({ type: "ready" });
    },
    onStop() {
      return session.send({ type: "stopped" });
    },
    async onParent(message) {
      const request = requestOf(message);
      if (request === undefined) return;
      if (request.op !== REVERT_CALL_OP) {
        await session.send({
          type: "worker_response",
          request_id: request.request_id,
          ok: false,
          error: { code: "invalid_input", message: "unknown revert op" },
        });
        return;
      }
      try {
        const payload = await options.accept(request);
        await session.send({
          type: "worker_response",
          request_id: request.request_id,
          ok: true,
          payload,
        });
      } catch {
        // worker 내부 실패와 credential 오류는 구별해 답하지 않는다. core가 판정한다.
        await session.send({
          type: "worker_response",
          request_id: request.request_id,
          ok: false,
          error: { code: "unavailable", message: "app revert call failed" },
        });
      }
    },
  });
  return session;
}

export function revertReady(kind: string): Result<true> {
  if (kind !== REVERT_WORKER_KIND) {
    return err({ code: "invalid_input", message: "unknown worker kind" });
  }
  return ok(true);
}

export async function runRevertWorker(_root: string): Promise<void> {
  // Only the entry owns console routing. Helper modules never change global console.
  console.log = console.info = console.debug = (...args: unknown[]) =>
    console.error(...args);
  let apiPort = 0;
  const session = createRevertWorker({
    streams: { stdin: Deno.stdin, stdout: Deno.stdout, stderr: Deno.stderr },
    onHello: (hello) => {
      apiPort = hello.api_port;
    },
    accept: (request) =>
      acceptRevertCall(request, {
        baseUrl: `http://127.0.0.1:${apiPort}`,
      }),
  });
  await session.run();
}

// launchArgv가 내는 argv의 entry는 이 모듈 자체다.
if (import.meta.main) {
  await runRevertWorker(Deno.env.get("LOPHN_HOME") ?? "");
}
