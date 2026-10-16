import { err, ok, type Result } from "../../../base/mod.ts";
import type { ChildMessage } from "../../../protocol/supervision/mod.ts";
import { createRpcClient } from "../../../protocol/client/mod.ts";
import { type ReadRoute, routePath } from "../../../protocol/base/mod.ts";
import {
  type ChildSession,
  startChild,
} from "../../supervision/responsiveness/mod.ts";
import {
  type CoreRead,
  createTurnCredentials,
  startRuntime,
  type Startup,
  type TurnCredentials,
  type TurnSource,
} from "../../lophn-agent/run-loop/mod.ts";
import {
  type CatalogRefresherHandle,
  startCatalogRefresher,
} from "../../lophn-agent/models/catalog-refresh.ts";
import { providerList } from "../../../protocol/lophn-agent/mod.ts";
import { agentCall, machineCall } from "./core-http.ts";
import type { CoreCall } from "../../lophn-agent/run-loop/core-call.ts";
import type { AgentEventSink } from "../../lophn-agent/run-loop/ports.ts";
import type { BlobPort } from "../../lophn-agent/run-loop/blobs.ts";
import { createCredentialLink } from "./credential-link.ts";
import {
  createRedactLink,
  type Redactor,
} from "../../lophn-agent/run-loop/redact-link.ts";
import { createSecretLink } from "./secret-link.ts";
import { createTurnSourceLink } from "./turn-source-link.ts";
import { startMcpAuthPump } from "./mcp-auth-pump.ts";
import type { SecretAttachLike } from "../../lophn-agent/providers/mod.ts";
import { redact } from "./redact.ts";
import { roleOperations } from "../../lophn-agent/run-loop/mod.ts";
export { redact };
import type { Compactor } from "../../lophn-agent/session/compactor.ts";
import { productDriver, startTurnPump } from "./product-driver.ts";
import { createProviderWatch } from "../../lophn-agent/providers/watch.ts";
import {
  createTurnDriver,
  type TurnDriver,
} from "../../lophn-agent/run-loop/driver.ts";
import type { TurnPreparer } from "../../lophn-agent/run-loop/prepare.ts";

// core가 감독하는 agent runtime. ledger writer는 core만 소유하고 이 프로세스는 read만 한다.
export type CoreCalls = {
  // machine 자격의 loopback. 열린 route만 부른다.
  machine: CoreCall;
  // turn의 agent credential token으로 부르는 loopback.
  agentCall(token: string): CoreCall;
  // 기록이 hash로 가리키는 본문을 감독 pipe로 core에 준비한다.
  blobs: BlobPort;
  // model로 보낼 글의 안전화. core의 알려진 secret 값과 검출 규칙으로 지우고 끝내지 못하면 null이다.
  redact: Redactor["redact"];
  // provider 호출의 credential 전송 부착. core가 값을 한 번 건네고 인증 transport가 쓴 뒤 버린다.
  secrets?: SecretAttachLike;
  // 마지막 정상 catalog와 동봉 snapshot. data root가 없으면 없다.
  catalog: CatalogRefresherHandle | undefined;
  // loop가 낸 agent event를 감독 pipe로 core Bus까지 보낸다.
  events: AgentEventSink;
};

type Runtime = {
  startup: Startup;
  // 입력함에서 시작할 turn을 고르는 길. 입력함은 core 메모리에 있어 감독 pipe로 읽는다.
  source: TurnSource;
  // turn마다 받는 agent credential. 감독 pipe로 core에 청한다.
  credentials: TurnCredentials;
  // 고른 turn을 시작해 loop를 돌린다. 시작 재료(`driver` 입력)를 받았을 때만 있다.
  driver: TurnDriver | undefined;
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

async function startAgentRuntime(input: {
  streams?: Streams;
  // 테스트가 core 대신 응답을 끼운다. 없으면 hello의 loopback port로 붙는다.
  read?: CoreRead;
  fetch?: typeof fetch;
  // derived 위치의 root. 없으면 LOPHN_HOME에서 결정한다.
  dataRoot?: string;
  // 입력함의 turn을 계속 시작하는 pump를 돌릴지. 제품 기동만 켠다.
  pump?: boolean;
  // turn 시작 재료(basis 준비, StartTurn, loop의 port)를 만드는 쪽이다. core 연결(machine 자격과 turn의
  // agent 자격 호출)을 받아 `createTurnPreparer` 같은 것을 돌려준다.
  driver?: (
    calls: CoreCalls,
  ) =>
    & { preparer: TurnPreparer }
    // 사람이 요청한 Compact의 요약을 끝내는 일. 없으면 요약을 하지 않는다.
    & { compactor?: Compactor };
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
  let selectorRead: CoreRead | undefined;
  let calls: CoreCalls | undefined;
  let resolveReady: (result: Result<Startup>) => void = () => {};
  const ready = new Promise<Result<Startup>>((resolve) => {
    resolveReady = resolve;
  });
  let stopped = false;
  const link = createCredentialLink({ send: (message) => child.send(message) });
  const redactLink = createRedactLink({
    send: (message) => child.send(message),
  });
  const secretLink = createSecretLink({
    send: (message) => child.send(message),
  });
  const turnLink = createTurnSourceLink({
    send: (message) => child.send(message),
  });
  const credentials = createTurnCredentials({
    issuer: link.issuer,
    // session의 역할 상한 안에서만 청한다. core가 같은 상한으로 대조한다.
    operations: roleOperations,
    process: "agent-runtime",
  });
  let driver: TurnDriver | undefined;
  const pumpStop = new AbortController();
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
          selectorRead = read;
          // catalog 자동 갱신은 기동을 막지 않는 single-flight다. 끈 날에는 내부에서 자동 요청이
          // 나가지 않는다.
          const root = runtimeDataRoot(input.dataRoot);
          const refresher = root === undefined
            ? undefined
            : startCatalogRefresher({
              dataRoot: root,
              ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
            });
          calls = {
            catalog: refresher,
            redact: redactLink.redact,
            events: turnLink.events,
            secrets: secretLink.attach,
            machine: input.read ?? machineCall({
              port: hello.api_port,
              credential: () =>
                child.credentialUsable ? hello.credential : undefined,
              ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
            }),
            blobs: {
              async prepare(purpose, bytes) {
                const prepared = await child.prepareBlob({
                  purpose,
                  sizeBytes: bytes.length,
                  bytes,
                });
                return prepared.ok
                  ? ok({
                    hash: prepared.value.hash,
                    size_bytes: prepared.value.size_bytes,
                  })
                  : prepared;
              },
            },
            agentCall: (token) =>
              agentCall({
                port: hello.api_port,
                token,
                ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
              }),
          };
          // ready는 감독이 읽기 전에 나간다. 전송 완료를 기다리면 역압이 기동을 막는다.
          void send(child, { type: "ready" });
          refresher?.kickAutoUpdate();
        } else {
          // 진단 쓰기가 막혀도 기동 실패는 바로 돌려준다.
          void diagnostics.write(started.error.message);
        }
        resolveReady(started);
      },
      onParent(message) {
        if (redactLink.onParent(message)) return;
        if (secretLink.onParent(message)) return;
        if (turnLink.onParent(message)) return;
        link.onParent(message);
      },
      onStop() {
        // 종료 요청·pipe 닫힘·core 종료 모두 여기로 온다. 새 진입은 이 순간부터 막힌다.
        // stopped ack는 cleanup 안에서만 통과한다. 그 전에 보내면 거절된다.
        stopped = true;
        pumpStop.abort();
        // 감독 상실: 진행 loop의 새 진입을 막고 들고 있는 credential을 모두 끝낸다.
        if (driver !== undefined) driver.endAll();
        else credentials.endAll();
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
  // 켜질 때 돌던 turn은 core가 interrupted로 닫으므로 runtime이 이을 것은 없다.
  const source: TurnSource = turnLink.source;
  let pumping: Promise<void> = Promise.resolve();
  // MCP OAuth 발급자 호출은 core에 외부 fetch가 없어서 이 프로세스가 대신 보낸다.
  // 제품 기동만 돌린다. 허락한 발급자(`--allow-net`) 밖은 Deno 권한이 막는다.
  const authPumping = input.pump === true
    ? startMcpAuthPump({
      call: calls!.machine,
      fetch: input.fetch ?? fetch,
      signal: pumpStop.signal,
    })
    : Promise.resolve();
  if (input.driver !== undefined) {
    const { compactor, preparer } = input.driver(calls!);
    driver = createTurnDriver({ source, credentials, preparer });
    if (input.pump === true) {
      pumping = startTurnPump({
        driver,
        providerWatch: createProviderWatch({
          read: selectorRead!,
          revokeProvider: (provider) => driver!.revokeProvider(provider),
        }),
        ...(compactor === undefined ? {} : { compactor }),
        signal: pumpStop.signal,
      });
    }
  }
  const runtime: Runtime = {
    startup: startup!,
    source,
    credentials,
    driver,
    get stopped() {
      return stopped;
    },
    done: running,
    async shutdown() {
      stopped = true;
      pumpStop.abort();
      await running;
      await pumping;
      await authPumping;
    },
  };
  return ok(runtime);
}

// core loopback read. selector가 쓰는 read route만 연다(SELECTOR_READ_ROUTES). credential은
// 호출 시점의 사용 허가로만 붙인다. 목록에 없는 경로는 요청하지 않는다.
const ROUTES_BY_PATH = new Map<string, ReadRoute>(
  [providerList].map((route) => [routePath(route), route as ReadRoute]),
);

function coreRead(
  port: number,
  credential: () => string | undefined,
  fetchImpl: typeof fetch = fetch,
): CoreRead {
  return async (path, body) => {
    const route = ROUTES_BY_PATH.get(path);
    if (route === undefined) {
      return err({ code: "invalid_input", message: "read가 열려 있지 않다" });
    }
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
    const listed = await client.call(route, body as never);
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
  const started = await startAgentRuntime({
    driver: productDriver(),
    pump: true,
  });
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
