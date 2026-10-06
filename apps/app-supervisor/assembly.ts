// 앱 supervisor 조립. packages의 supervisor·관측 모듈에 실제 I/O(core 호출, 앱 direct
// socket, OS spawn)를 끼운다. I/O는 주입받아서 같은 조립을 실제 자식 프로세스 시험에서도
// 쓴다. 업무 규칙은 packages에 있고 여기는 연결만 한다(AGENTS.md: apps/* entry).
import {
  type Clock,
  err,
  type IdSource,
  ok,
  type Result,
} from "../../packages/base/mod.ts";
import {
  type AppChild,
  createSupervisor,
  type DesiredApp,
  OpError,
  type OpHandlers,
  type Supervisor,
  type SupervisorDeps,
  type SupervisorEvent,
} from "../../packages/apps/runtime/supervisor/mod.ts";
import type { CoreLink } from "../../packages/apps/runtime/core-link.ts";
import {
  desiredAppSchema,
  logsInputSchema,
  type ObservationWire,
  observeInputSchema,
  restartInputSchema,
  SUPERVISOR_OPS,
} from "../../packages/apps/runtime/control-protocol.ts";
import {
  createLogBuffer,
  type LogBuffer,
} from "../../packages/apps/runtime/observations/log-buffer.ts";
import {
  createMemoryObserver,
  type MemoryObserver,
  type RssReader,
} from "../../packages/apps/runtime/observations/memory.ts";
import {
  type CrashEvent,
  createCrashObserver,
} from "../../packages/apps/runtime/observations/crash.ts";
import type { ByteSource } from "../../packages/apps/runtime/observations/stream-decoder.ts";
import type {
  AppEnvironment,
  AppLaunch,
} from "../../packages/apps/runtime/processes/mod.ts";
import { DIRECT_SOCKET_PATHS } from "../../packages/contracts/apps/mod.ts";
import { diagnosticSchema } from "../../packages/contracts/platform/mod.ts";
import { createKnownSecretRegistry } from "../../packages/platform/redaction/mod.ts";
import { socketFlags } from "../../packages/apps/permissions/mod.ts";
import { lineRedactor } from "./log-redact.ts";
import { readRecordState, recordInput } from "./record.ts";

// core connect 요청이 요구하는 화면 key 자리다. machine connection은 화면 범위가 없어서
// core가 이 값을 쓰지 않는다.
export const CONTROL_SCREEN = "control";
const STDERR_TAIL_CHARS = 4096;
const CREDENTIAL_WAIT_MS = 5_000;

type Spawned = {
  pid: number;
  stdout: ByteSource;
  stderr: ByteSource;
  exited: Promise<number | null>;
  terminate(): Promise<boolean>;
};

export type SupervisorIo = {
  clock: Clock;
  ids: IdSource;
  deno: () => string;
  environment: AppEnvironment;
  socketPaths: (app: string) => { broker: string; direct: string };
  nonce: () => string;
  wait: (ms: number) => Promise<void>;
  spawn: (launch: AppLaunch) => Promise<Spawned>;
  // core loopback API. 전송 실패는 던진다. path는 `apps/connect`처럼 resource/method다.
  post: (
    path: string,
    bearer: string,
    body: unknown,
  ) => Promise<{ status: number; body: unknown }>;
  // 앱 direct socket 호출. 연결하지 못하면 던진다.
  direct: (
    endpoint: string,
    request: {
      method: "GET" | "POST";
      path: string;
      authorization: string;
      body?: unknown;
    },
  ) => Promise<{ status: number; body: unknown }>;
  // 감독 pipe로 core에 frame 하나를 보낸다.
  send: (message: unknown) => Promise<void> | void;
  rss?: RssReader;
  readyTimeoutMs?: number;
  stopGraceMs?: number;
  credentialWaitMs?: number;
};

export type Assembly = {
  supervisor: Supervisor;
  ops: OpHandlers;
  // 감독 pipe의 hello. core API 위치와 machine credential이 온다.
  onHello(
    hello: { credential: string; apiPort: number; verifyKey?: string },
  ): void;
  // core가 app_credential_request에 준 답.
  onCredential(response: { request_id: string; credential: string }): void;
  logs(app: string): LogBuffer | undefined;
  // 앱 자식의 RSS 표본기. 자식을 띄운 적이 없으면 없다.
  memory(app: string): MemoryObserver | undefined;
  // 관측 timer를 거둔다. supervisor 정지는 따로다.
  shutdown(): void;
};

function wireOf(
  observation: NonNullable<ReturnType<Supervisor["observation"]>>,
): ObservationWire {
  return {
    app: observation.app,
    release: observation.release === "" ? null : observation.release,
    mode: observation.mode,
    bundle_hash: observation.bundleHash === "" ? null : observation.bundleHash,
    process_nonce: observation.processNonce,
    endpoint: observation.endpoint,
    commands: observation.commands,
    screens: observation.screens,
    ready: observation.ready,
    accepting: observation.accepting,
    ...(observation.reason ? { reason: observation.reason } : {}),
    ...(observation.recordFailed
      ? { record_failed: observation.recordFailed }
      : {}),
  };
}

function parse<T>(
  schema: {
    safeParse(
      value: unknown,
    ): { success: true; data: T } | { success: false };
  },
  payload: unknown,
): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new OpError("invalid_input", "invalid op input");
  return parsed.data;
}

export function assembleSupervisor(io: SupervisorIo): Assembly {
  const hello: { credential: string; apiPort: number } = {
    credential: "",
    apiPort: 0,
  };
  let verifyKey = "";
  const buffers = new Map<string, LogBuffer>();
  const memories = new Map<string, MemoryObserver>();
  // 자식 nonce별 app credential과 stderr 꼬리. 자식이 끝나면 지운다.
  const credentials = new Map<string, string>();
  const lastCredential = new Map<string, string>();
  const tails = new Map<string, string>();
  const waiting = new Map<string, (credential: string) => void>();
  // 알려진 secret 값은 supervisor가 모른다. credential 모양 pattern만 지운다.
  const redact = lineRedactor(createKnownSecretRegistry());

  function send(message: unknown): void {
    try {
      void Promise.resolve(io.send(message)).catch(() => undefined);
    } catch { /* pipe가 닫혔다. core 단절 처리가 이어서 자식을 끝낸다. */ }
  }

  function bufferOf(app: string): LogBuffer {
    const found = buffers.get(app);
    if (found) return found;
    const created = createLogBuffer({
      app,
      redact,
      now: () => io.clock.nowMs(),
      // 버린 줄은 core가 안전한 진단으로 받는다(supervisor pipe, contracts#T6).
      onLoss(loss) {
        const diagnostic = diagnosticSchema.safeParse({
          type: "diagnostic",
          kind: "app_log_line_loss",
          payload: {
            component: "apps/supervisor",
            observed_at: io.clock.now(),
            ...loss,
          },
        });
        if (diagnostic.success) send(diagnostic.data);
      },
    });
    buffers.set(app, created);
    return created;
  }

  function memoryOf(app: string): MemoryObserver {
    const found = memories.get(app);
    if (found) return found;
    const created = createMemoryObserver({
      app,
      nowMs: () => io.clock.nowMs(),
      ...(io.rss ? { read: io.rss } : {}),
      // 설정한 RSS 한도가 아직 없다. 한도 없이는 85% 초과를 주장하지 않는다(R29).
    });
    created.start();
    memories.set(app, created);
    return created;
  }

  // 자식의 stderr 꼬리를 남기며 읽는다. V8 OOM 근거를 찾는 데만 쓰고 보고에 싣지 않는다.
  function tee(source: ByteSource, nonce: string): ByteSource {
    const decoder = new TextDecoder();
    return {
      async read(buffer) {
        const count = await source.read(buffer);
        if (count !== null) {
          const text = (tails.get(nonce) ?? "") +
            decoder.decode(buffer.subarray(0, count), { stream: true });
          tails.set(nonce, text.slice(-STDERR_TAIL_CHARS));
        }
        return count;
      },
    };
  }

  const core: CoreLink = {
    async record(record) {
      let response: { status: number; body: unknown };
      try {
        response = await io.post(`apps/${record.method}`, hello.credential, {
          input: recordInput(record),
          idempotency_key: crypto.randomUUID(),
          // record_*는 관측 사실이라 비교 기준이 없다. envelope는 빈 compare를 요구한다.
          compare: {},
          prepared: [],
        });
      } catch {
        return err({ code: "unavailable", message: "core is unreachable" });
      }
      return readRecordState(response);
    },
  };

  async function requestCredential(
    request: { desired: DesiredApp; nonce: string },
  ): Promise<string> {
    const requestId = `app-credential-${crypto.randomUUID()}`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reply = new Promise<string | undefined>((resolve) => {
      waiting.set(requestId, resolve);
      timer = setTimeout(
        () => resolve(undefined),
        io.credentialWaitMs ?? CREDENTIAL_WAIT_MS,
      );
    });
    let credential: string | undefined;
    try {
      await io.send({
        type: "app_credential_request",
        request_id: requestId,
        app: request.desired.app,
        release: request.desired.release,
        process: request.nonce,
        mode: "live",
        bundle_hash: request.desired.bundleHash,
      });
      credential = await reply;
    } finally {
      clearTimeout(timer);
      waiting.delete(requestId);
    }
    if (credential === undefined) {
      throw new Error("app credential was not issued");
    }
    credentials.set(request.nonce, credential);
    lastCredential.set(request.desired.app, credential);
    return credential;
  }

  // core가 서명한 machine connection. 제어 요청(probe·open·close·shutdown)의 Authorization이다.
  async function authorization(
    desired: DesiredApp,
  ): Promise<Result<string>> {
    try {
      const response = await io.post("apps/connect", hello.credential, {
        app: desired.app,
        mode: "live",
        screens: [CONTROL_SCREEN],
        screen_sizes: {},
        commands: [],
      });
      const body = response.body as
        | { connection?: unknown; signature?: unknown }
        | null;
      if (
        response.status !== 200 || body === null ||
        typeof body.signature !== "string" ||
        typeof body.connection !== "object" || body.connection === null
      ) {
        return err({
          code: "unavailable",
          message: "core did not sign a control connection",
        });
      }
      return ok(
        JSON.stringify({ payload: body.connection, signature: body.signature }),
      );
    } catch {
      return err({ code: "unavailable", message: "core is unreachable" });
    }
  }

  async function control(
    desired: DesiredApp,
    direct: string,
    path: string,
    body: unknown,
  ): Promise<Result<{ status: number; body: unknown }>> {
    const signed = await authorization(desired);
    if (!signed.ok) return signed;
    try {
      return ok(
        await io.direct(direct, {
          method: "POST",
          path,
          authorization: signed.value,
          body,
        }),
      );
    } catch {
      return err({ code: "unavailable", message: "app is not listening" });
    }
  }

  const deps: SupervisorDeps = {
    clock: io.clock,
    core,
    deno: io.deno,
    environment: io.environment,
    socketPaths: io.socketPaths,
    nonce: io.nonce,
    credential: requestCredential,
    // hello가 채운다. 비어 있으면 reconcile이 닿지 못한다.
    verifyKey: () => verifyKey,
    async spawn(request) {
      // 두 socket의 허락은 시작마다 새로 정한 경로로 supervisor가 더한다.
      const sockets = socketFlags(request.sockets);
      if (!sockets.ok) throw new Error(sockets.error.message);
      const spawned = await io.spawn({
        deno: request.deno,
        entry: request.entry,
        flags: {
          ...request.flags,
          args: [...request.flags.args, ...sockets.value],
        },
        importMap: request.importMap,
        environment: request.environment,
        startLine: request.startLine,
      });
      const nonce = request.identity.processNonce;
      const log = bufferOf(request.app);
      void log.attach(spawned.stdout);
      void log.attach(tee(spawned.stderr, nonce));
      memoryOf(request.app).setChild({
        pid: spawned.pid,
        processNonce: nonce,
        release: request.release,
      });
      const child: AppChild = {
        identity: {
          pid: spawned.pid,
          startedAtMs: request.identity.startedAtMs,
          processNonce: nonce,
        },
        exited: spawned.exited,
        terminate: () => spawned.terminate(),
      };
      return child;
    },
    async probe(child, direct, desired) {
      const nonce = child.identity.processNonce;
      let exited = false;
      void child.exited.then(() => {
        exited = true;
      });
      const deadline = io.clock.nowMs() + (io.readyTimeoutMs ?? 30_000);
      let reason = "the app did not answer";
      while (io.clock.nowMs() < deadline) {
        if (exited) return { ok: false, reason: "exited before ready" };
        const answered = await control(
          desired,
          direct,
          DIRECT_SOCKET_PATHS.probe,
          { process_nonce: nonce },
        );
        if (answered.ok) {
          const attestation = answered.value.body as
            | {
              commands?: string[];
              data_schema?: number;
              bundle_hash?: string;
            }
            | null;
          if (answered.value.status === 200 && attestation !== null) {
            return {
              ok: true,
              commands: attestation.commands ?? [],
              dataSchema: attestation.data_schema ?? 0,
              bundleHash: attestation.bundle_hash ?? "",
            };
          }
          // 서명·nonce·handler 불일치는 기다린다고 낫지 않는다. 준비 중(503)만 다시 본다.
          if (answered.value.status !== 503) {
            return {
              ok: false,
              reason: `probe was rejected (${answered.value.status})`,
            };
          }
        } else {
          reason = answered.error.message;
        }
        await io.wait(100);
      }
      return { ok: false, reason };
    },
    async open(child, direct, desired) {
      const answered = await control(
        desired,
        direct,
        DIRECT_SOCKET_PATHS.open,
        {
          process_nonce: child.identity.processNonce,
          release: desired.release,
        },
      );
      return answered.ok && answered.value.status === 200;
    },
    async requestStop(child, direct, desired) {
      const nonce = child.identity.processNonce;
      // 새 호출·clock부터 닫고 종료를 요청한다. 닿지 않아도 유예 뒤 강제 종료가 이어진다.
      await control(desired, direct, DIRECT_SOCKET_PATHS.close, {
        process_nonce: nonce,
        reason: "stop",
      });
      await control(desired, direct, DIRECT_SOCKET_PATHS.shutdown, {
        process_nonce: nonce,
        grace_ms: 10_000,
      });
    },
    wait: io.wait,
    ...(io.readyTimeoutMs === undefined
      ? {}
      : { readyTimeoutMs: io.readyTimeoutMs }),
    ...(io.stopGraceMs === undefined ? {} : { stopGraceMs: io.stopGraceMs }),
    onEvent(event) {
      void observeEvent(event);
    },
  };

  // 실패의 근거를 구별해 problems로 보낸다. 어느 앱·release인지는 본문이 아니라 그 자식의
  // app credential이 정한다. 전송이 실패해도 supervisor는 계속 돈다.
  async function observeEvent(event: SupervisorEvent): Promise<void> {
    if (event.kind === "exit") {
      const memory = memories.get(event.app);
      memory?.setChild(null);
    }
    const crash: CrashEvent = event.kind === "exit"
      ? {
        kind: "exit",
        intended: event.intended,
        exitCode: event.exitCode,
        stderrTail: tails.get(event.processNonce) ?? "",
      }
      : event.kind === "start_failed"
      ? { kind: "start_failed", reason: event.reason }
      : { kind: "crash_loop", exits: event.exits };
    const nonce = "processNonce" in event ? event.processNonce : undefined;
    const bearer = (nonce === undefined ? undefined : credentials.get(nonce)) ??
      lastCredential.get(event.app);
    const observer = createCrashObserver({
      ids: io.ids,
      now: () => io.clock.nowMs(),
      report: async (input) => {
        if (bearer === undefined) throw new Error("no process observer");
        const response = await io.post(
          "problems/observe-exception",
          bearer,
          input,
        );
        if (response.status !== 200) throw new Error("report was refused");
      },
    });
    try {
      await observer.observe(crash);
    } catch { /* 관측 실패가 supervisor를 멈추지 않는다 */ }
    if (event.kind === "exit" && nonce !== undefined) {
      credentials.delete(nonce);
      tails.delete(nonce);
    }
  }

  const supervisor = createSupervisor(deps);

  const ops: OpHandlers = {
    [SUPERVISOR_OPS.reconcile]: (payload) => {
      const desired = parse(desiredAppSchema, payload) as DesiredApp;
      if (verifyKey === "" || hello.credential === "") {
        throw new OpError("unavailable", "supervisor is not configured");
      }
      // 시작은 비동기다. 접수만 답하고 상태는 관측과 record_*로 따라간다.
      void supervisor.reconcile(desired).catch(() => undefined);
      return Promise.resolve({ accepted: true });
    },
    [SUPERVISOR_OPS.observe]: (payload) => {
      const input = parse(observeInputSchema, payload);
      const observation = supervisor.observation(input.app);
      return Promise.resolve({
        observation: observation ? wireOf(observation) : null,
      });
    },
    [SUPERVISOR_OPS.logs]: async (payload) => {
      const input = parse(logsInputSchema, payload);
      const buffer = buffers.get(input.app);
      if (!buffer) {
        return {
          state: "none",
          lines: [],
          collected_at: null,
          truncated: false,
        };
      }
      const query = {
        ...(input.invocation === undefined
          ? {}
          : { invocation: input.invocation }),
        limit: input.limit,
        ...(input.max_bytes === undefined
          ? {}
          : { max_bytes: input.max_bytes }),
      };
      // 살아 있는 자식의 stream은 끝나지 않으므로 기다리지 않고 지금 모인 줄을 준다. 자식이 끝난
      // 직후의 조회만 마지막 flush를 최대 20ms 기다린다(R27).
      const alive = (supervisor.observation(input.app)?.processNonce ?? "") !==
        "";
      return alive ? buffer.read(query) : await buffer.collect(query);
    },
    [SUPERVISOR_OPS.restart]: async (payload) => {
      const input = parse(restartInputSchema, payload);
      return {
        restarted: await supervisor.restart(input.app, input.process_nonce),
      };
    },
  };

  return {
    supervisor,
    ops,
    onHello(received) {
      hello.credential = received.credential;
      hello.apiPort = received.apiPort;
      verifyKey = received.verifyKey ?? "";
    },
    onCredential(response) {
      waiting.get(response.request_id)?.(response.credential);
    },
    logs: (app) => buffers.get(app),
    memory: (app) => memories.get(app),
    shutdown() {
      for (const memory of memories.values()) memory.stop();
    },
  };
}
