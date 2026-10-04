import { err, ok, type Result } from "../../packages/base/mod.ts";
import {
  type ChildMessage,
  createRpcClient,
  eventsList,
} from "../../packages/contracts/platform/mod.ts";
import {
  type ChildSession,
  startChild,
} from "../../packages/platform/responsiveness/mod.ts";
import {
  type CoreRead,
  startRuntime,
  type Startup,
} from "../../packages/lophn-agent/harness/run-loop/mod.ts";
import { startCatalogRefresher } from "./catalog.ts";

// core가 감독하는 agent runtime. ledger writer는 core만 소유하고 이 프로세스는 read만 한다.
export type Runtime = {
  startup: Startup;
  // 새 model·tool 진입을 막는다. 진행 호출 취소는 나중 작업이 이 신호에 붙는다.
  readonly stopped: boolean;
  done: Promise<void>;
  shutdown(): Promise<void>;
};

type Streams = {
  stdin: ReadableStream<Uint8Array>;
  stdout: WritableStream<Uint8Array>;
  stderr: WritableStream<Uint8Array>;
};

export async function startAgentRuntime(input: {
  streams?: Streams;
  // 테스트가 core 대신 응답을 끼운다. 없으면 hello의 loopback port로 붙는다.
  read?: CoreRead;
  fetch?: typeof fetch;
  // derived 위치의 root. 없으면 LOPHN_HOME에서 결정한다(T3와 같은 근원).
  dataRoot?: string;
}): Promise<Result<Runtime>> {
  const streams = input.streams ?? {
    stdin: Deno.stdin.readable,
    stdout: Deno.stdout.writable,
    stderr: Deno.stderr.writable,
  };
  const diagnostics = createDiagnosticWriter(streams.stderr);
  // child session은 stderr에 제어 frame을 쓰지 않는다. 진단은 같은 통로를 잠그지 않게 따로 둔다.
  const childStderr = new TransformStream<Uint8Array>();
  let startup: Startup | undefined;
  let resolveReady: (result: Result<Startup>) => void = () => {};
  const ready = new Promise<Result<Startup>>((resolve) => {
    resolveReady = resolve;
  });
  let stopped = false;

  const child = startChild(
    {
      stdin: { read: streamReader(streams.stdin) },
      stdout: streamWriter(streams.stdout),
      stderr: streamWriter(childStderr.writable),
    },
    {
      async onHello(hello) {
        const read = input.read ??
          coreRead(
            hello.api_port,
            () => child.credentialUsable ? hello.credential : undefined,
            input.fetch,
          );
        const started = await startRuntime({ hello, read });
        if (started.ok) {
          startup = started.value;
          // ready는 감독이 읽기 전에 나간다. 전송 완료를 기다리면 역압이 기동을 막는다.
          void send(child, { type: "ready" });
          // catalog 자동 갱신은 기동을 막지 않는 single-flight다(R4). 끈 날에는
          // 내부에서 자동 요청이 나가지 않는다(R6).
          const root = runtimeDataRoot(input.dataRoot);
          if (root !== undefined) {
            const refresher = startCatalogRefresher({
              dataRoot: root,
              ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
            });
            refresher.kickAutoUpdate();
          }
        } else {
          // 진단 쓰기가 막혀도 기동 실패는 바로 돌려준다.
          void diagnostics.write(started.error.message);
        }
        resolveReady(started);
      },
      onStop() {
        // 종료 요청·pipe 닫힘·core 종료 모두 여기로 온다. 새 진입은 이 순간부터 막힌다.
        // stopped ack는 cleanup 안에서만 통과한다. 그 전에 보내면 거절된다.
        stopped = true;
        return send(child, { type: "stopped" });
      },
    },
  );

  const running = child.run().then(
    () => {},
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      void diagnostics.write(message);
    },
  );
  const started = await Promise.race([
    ready,
    running.then(() =>
      err({
        code: "unavailable" as const,
        message: "runtime이 기동 전에 끝났다",
      })
    ),
  ]);
  if (!started.ok) {
    return started;
  }
  const runtime: Runtime = {
    startup: startup!,
    get stopped() {
      return stopped;
    },
    done: running,
    async shutdown() {
      stopped = true;
      await running;
    },
  };
  return ok(runtime);
}

// core loopback의 events/list. credential은 호출 시점의 사용 허가로만 붙인다.
function coreRead(
  port: number,
  credential: () => string | undefined,
  fetchImpl: typeof fetch = fetch,
): CoreRead {
  return async (_path, body) => {
    const token = credential();
    if (!token) {
      return err({ code: "unauthorized", message: "credential이 없다" });
    }
    const client = createRpcClient({
      baseUrl: `http://127.0.0.1:${port}`,
      token,
      fetch: async (url, init) => {
        const response = await fetchImpl(url, init);
        return {
          status: response.status,
          headers: response.headers,
          bytes: new Uint8Array(await response.arrayBuffer()),
        };
      },
    });
    const listed = await client.call(eventsList, body as never);
    if (!listed.ok) return listed;
    return ok(listed.value);
  };
}

// derived 위치의 root. core의 resolveDataRoot와 같은 근원(env)에서 결정한다.
function runtimeDataRoot(injected?: string): string | undefined {
  if (injected !== undefined && injected.length > 0) return injected;
  const lophnHome = Deno.env.get("LOPHN_HOME");
  if (lophnHome !== undefined && lophnHome.length > 0) return lophnHome;
  return undefined;
}

// 감독 pipe로 제어 frame을 보낸다. 감독이 먼저 닫았으면 조용히 끝난다.
async function send(
  child: ChildSession,
  message: ChildMessage,
): Promise<void> {
  try {
    await child.send(message);
  } catch {
    // 감독이 먼저 닫았으면 frame은 전달되지 않는다. 종료는 그대로 진행한다.
  }
}

// stderr는 redaction된 진단만. credential 값과 secret 형태는 여기서 거른다.
function createDiagnosticWriter(stderr: WritableStream<Uint8Array>) {
  const encoder = new TextEncoder();
  return {
    // 호출자가 진단을 바로 읽을 수 있게 기다린다. 실패는 진단을 막지 않는다.
    async write(message: string) {
      const writer = stderr.getWriter();
      try {
        await writer.write(encoder.encode(`${redact(message)}\n`));
      } catch {
        // stderr가 이미 닫혔으면 진단은 버려진다.
      } finally {
        writer.releaseLock();
      }
    },
  };
}

const SECRET_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /sk-[A-Za-z0-9]{8,}/g,
  /gh[pousr]_[A-Za-z0-9]{8,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /xox[baprs]-[A-Za-z0-9-]{8,}/g,
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g,
  // 헤더 한 줄 전체를 가린다. 값 하나만 지우면 뒤 토큰이 남는다.
  /authorization\s*[:=][^\n]*/gi,
  /:\/\/[^/\s]+@/g,
];

export function redact(text: string): string {
  let next = text;
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    next = next.replace(pattern, "[redacted]");
  }
  return next;
}

function streamReader(
  stream: ReadableStream<Uint8Array>,
): (buffer: Uint8Array) => Promise<number | null> {
  const reader = stream.getReader();
  let pending: Uint8Array | undefined;
  return async (buffer) => {
    while (!pending || pending.length === 0) {
      const next = await reader.read();
      if (next.done) return null;
      // 빈 chunk는 스트림이 닫힌 것이다. 0을 돌려주면 읽기가 끝나지 않는다.
      if (next.value.length === 0) return null;
      pending = next.value;
    }
    const take = Math.min(buffer.length, pending.length);
    buffer.set(pending.subarray(0, take));
    pending = pending.subarray(take);
    return take;
  };
}

function streamWriter(stream: WritableStream<Uint8Array>) {
  const writer = stream.getWriter();
  return {
    write: async (bytes: Uint8Array) => {
      await writer.write(bytes);
      return bytes.length;
    },
  };
}

if (import.meta.main) {
  const started = await startAgentRuntime({});
  if (!started.ok) {
    console.error(`agent runtime: ${redact(started.error.message)}`);
    Deno.exit(1);
  }
  const runtime = started.value;
  const stop = () => void runtime.shutdown().then(() => Deno.exit(0));
  Deno.addSignalListener("SIGINT", stop);
  Deno.addSignalListener("SIGTERM", stop);
  await runtime.done;
  Deno.exit(0);
}
