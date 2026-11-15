// 앱 supervisor 조립. packages의 supervisor·관측 모듈에 실제 I/O(core 호출, 앱 control
// socket, OS spawn)를 끼운다. I/O는 주입받아서 같은 조립을 실제 자식 프로세스 시험에서도
// 쓴다. 업무 규칙은 packages에 있고 여기는 연결만 한다(AGENTS.md: apps/* entry).
import {
  type Clock,
  err,
  type IdSource,
  ok,
  type Result,
} from "../../../base/mod.ts";
import { createKnownSecretRegistry } from "../../../base/redaction/mod.ts";
import {
  appCallTool,
  processApplyRequestSchema,
  processSyncApplyRequestSchema,
  toolCallOutputSchema,
} from "../../../protocol/apps/calls/mod.ts";
import {
  noticePost,
  appsSecretValue,
  CONTROL_PATHS,
} from "../../../protocol/apps/mod.ts";
import { appEventPublish } from "../../../protocol/apps/events.ts";
import { appTraySet } from "../../../protocol/apps/tray.ts";
import { CALL_RESPONSE_MAX_BYTES } from "../../../protocol/base/mod.ts";
import {
  type AppCallPort,
  type BrokerChild,
  type EventPublishPort,
  type NoticePostPort,
  type ReadyReceiver,
  type SessionsPort,
} from "../../apps/permissions/mod.ts";
import {
  createPreviewLauncher,
  type PreviewLauncher,
  type PreviewScope,
} from "../../apps/preview/mod.ts";
import type { PreparationService } from "../../apps/releases/preparation.ts";
import {
  activationAppInputSchema,
  appendLogInputSchema,
  applyInputSchema,
  snapshotInputSchema,
  syncApplyInputSchema,
  blockInputSchema,
  callInputSchema,
  dataJobInputSchema,
  desiredAppSchema,
  type ObservationWire,
  observeInputSchema,
  previewLaunchSchema,
  previewObserveInputSchema,
  previewStopInputSchema,
  releasePreparationInputSchema,
  releasePrepareInputSchema,
  restartInputSchema,
  SUPERVISOR_OPS,
} from "../../apps/runtime/control-protocol.ts";
import type { CoreLink } from "../../apps/runtime/core-link.ts";
import {
  type CrashEvent,
  crashLogText,
} from "../../apps/runtime/observations/crash.ts";
import {
  type AppLogFile,
  createAppLogFile,
} from "../../apps/runtime/observations/log-file.ts";
import {
  createMemoryObserver,
  type MemoryObserver,
  type RssReader,
} from "../../apps/runtime/observations/memory.ts";
import { resolveStackFrames } from "../../apps/runtime/observations/stack-frames.ts";
import {
  type ByteSource,
  createStreamDecoder,
  drain,
} from "../../apps/runtime/observations/stream-decoder.ts";
import type {
  AppEnvironment,
  AppLaunch,
} from "../../apps/runtime/processes/mod.ts";
import {
  type AppChild,
  type ControlTransport,
  createRelay,
  createSupervisor,
  type DesiredApp,
  OpError,
  type OpHandlers,
  StreamedPayload,
  type Supervisor,
  type SupervisorDeps,
  type SupervisorEvent,
} from "../../apps/runtime/supervisor/mod.ts";
import { createCoreBrokerAccess } from "./access.ts";
import {
  type BrokerAdapters,
  createSupervisorBroker,
  type SupervisorBroker,
} from "./broker.ts";
import type { DataJobRunner } from "./data-runner.ts";
import { lineRedactor } from "./log-redact.ts";
import {
  previewScopeFromBundle,
  previewServicesFor,
} from "./preview-broker.ts";
import { readRecordState, recordBody } from "./record.ts";
import { createSecretDelivery, registeredByCore } from "./secret-delivery.ts";

// control socket 요청(probe·open·close·shutdown)의 응답 한도와 기한이다. 호출·적용은 relay가 따로 쥔다.
const CONTROL_TIMEOUT_MS = 5_000;
const CONTROL_BODY_MAX_BYTES = 64 * 1024;
const STDERR_TAIL_CHARS = 4096;
const CREDENTIAL_WAIT_MS = 5_000;

type Spawned = {
  pid: number;
  stdout: ByteSource;
  stderr: ByteSource;
  exited: Promise<number | null>;
  terminate(): Promise<boolean>;
};

type SupervisorIo = {
  // 없으면 app log를 file로 쓰지 않는다(data root 없는 조립).
  dataRoot?: string;
  clock: Clock;
  ids: IdSource;
  environment: AppEnvironment;
  socketPaths: (app: string) => { broker: string; control: string };
  nonce: () => string;
  wait: (ms: number) => Promise<void>;
  spawn: (launch: AppLaunch) => Promise<Spawned>;
  // core loopback API. 전송 실패는 던진다. path는 `apps/connect`처럼 resource/method다.
  post: (
    path: string,
    bearer: string,
    body: unknown,
  ) => Promise<{ status: number; body: unknown }>;
  // 앱 process의 control socket 호출. 같은 host의 supervisor만 이 socket을 부른다.
  control: ControlTransport;
  // 감독 pipe로 core에 frame 하나를 보낸다.
  send: (message: unknown) => Promise<void> | void;
  rss?: RssReader;
  readyTimeoutMs?: number;
  stopGraceMs?: number;
  credentialWaitMs?: number;
  // 자식 종료를 관측하면 알린다(결과를 못 받은 invocation을 미확인으로 확정하는 쪽이 쓴다).
  childExited?: (processNonce: string) => void;
  // preview 자식이 선언한 외부 범위(고정 bundle의 선언)다. 기본은 bundle 사본의 declaration.json을 읽는다.
  previewScopeOf?: (info: {
    app: string;
    bundleHash: string;
    dataPath: string;
  }) => Promise<PreviewScope>;
  // release 준비 요청의 진행(메모리)이다. 없으면 준비 요청은 unavailable이다.
  preparation?: PreparationService;
  // 앱 전용 data worker다. 없으면 데이터 작업(activation의 backup·migration·restore)은 unavailable이다.
  data?: DataJobRunner;
  // broker 서비스에 더하는 어댑터와 시험 대역(외부 전송 등). 기본은 core read·route를 지나는 어댑터다.
  brokerAdapters?: Partial<
    Pick<BrokerAdapters, "netTransport" | "netScheme" | "secrets">
  >;
};

type Assembly = {
  supervisor: Supervisor;
  // 앱 자식마다 여는 broker socket과 서비스다. 시험과 grant 적용이 앱 단위로 막는다.
  broker: SupervisorBroker;
  // preview 자식의 broker다. 운영 자식의 broker와 hub를 나눠 서로의 정지·회수가 영향을 주지 않는다.
  previewBroker: SupervisorBroker;
  ops: OpHandlers;
  // 감독 pipe의 hello. core API 위치와 machine credential이 온다.
  onHello(hello: { credential: string; apiPort: number }): void;
  // core가 app_credential_request에 준 답.
  onCredential(response: { request_id: string; credential: string }): void;
  // preview 프로세스 수명. 운영 supervisor와 따로 한 앱에 하나만 쥔다(apps/preview).
  previews: PreviewLauncher;
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
    // 관측 wire 계약이 아직 요구하는 칸이다. 연결 주소는 core에 알리지 않는다.
    endpoint: "",
    tools: observation.tools,
    ready: observation.ready,
    accepting: observation.accepting,
    ...(observation.reason ? { reason: observation.reason } : {}),
    ...(observation.recordFailed
      ? { record_failed: observation.recordFailed }
      : {}),
  };
}

// core 응답을 오류 code로 읽는다. 본문의 code가 우선이고 없으면 상태로 정한다.
function errorCodeOf(
  status: number,
  body: unknown,
):
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "invalid_input"
  | "unavailable" {
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  const known = [
    "unauthorized",
    "forbidden",
    "not_found",
    "conflict",
    "invalid_input",
    "unavailable",
  ] as const;
  const found = known.find((entry) => entry === code);
  if (found !== undefined) return found;
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status >= 400 && status < 500) return "invalid_input";
  return "unavailable";
}

// preview 시작 입력의 broker credential·bundle hash·disposable 영역이다.
function startFieldsOf(
  startLine: string,
): { credential: string; bundleHash: string; dataPath: string } | undefined {
  try {
    const parsed = JSON.parse(startLine) as {
      broker_credential?: unknown;
      bundle_hash?: unknown;
      data_path?: unknown;
    };
    return typeof parsed.broker_credential === "string" &&
      parsed.broker_credential.length > 0 &&
      typeof parsed.bundle_hash === "string" &&
      typeof parsed.data_path === "string"
      ? {
          credential: parsed.broker_credential,
          bundleHash: parsed.bundle_hash,
          dataPath: parsed.data_path,
        }
      : undefined;
  } catch {
    return undefined;
  }
}

// 시작 입력(stdin JSON 한 줄)의 자식 broker credential이다.
function brokerCredentialOf(startLine: string): string | undefined {
  try {
    const parsed = JSON.parse(startLine) as { broker_credential?: unknown };
    return typeof parsed.broker_credential === "string" &&
      parsed.broker_credential.length > 0
      ? parsed.broker_credential
      : undefined;
  } catch {
    return undefined;
  }
}

function parse<T>(
  schema: {
    safeParse(value: unknown): { success: true; data: T } | { success: false };
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
  const memories = new Map<string, MemoryObserver>();
  // 자식 nonce별 app credential과 stderr 꼬리. 자식이 끝나면 지운다.
  const credentials = new Map<string, string>();
  // nonce별 bundle hash. 예외 stack을 그 release의 봉인된 bundle 사본으로 풀 때 쓴다.
  const bundleHashes = new Map<string, string>();
  const tails = new Map<string, string>();
  const waiting = new Map<string, (credential: string) => void>();
  const logFiles = new Map<string, AppLogFile>();
  // log file은 disk에 남으므로 credential pattern 말고 supervisor가 core에서 받은 secret 값도 지운다.
  const knownSecrets = createKnownSecretRegistry();
  const redact = lineRedactor(knownSecrets);

  // 앱 시작이 DB를 바꿨을 때 앱 process가 broker `ready`로 보낸 changeset이다. 시작 사실에 싣는다.
  const startChangesets = new Map<
    string,
    { changeset: string; hlc: string | null }
  >();
  const ready: ReadyReceiver = {
    ready(child, notice) {
      if (child.mode !== "live" || notice.startChangeset === null) return;
      startChangesets.set(child.processNonce, {
        changeset: notice.startChangeset,
        hlc: notice.startHlc,
      });
    },
  };

  // 그 자식의 app credential로 core 경로를 부른다. 호출한 앱과 release는 그 credential이 정하고
  // 본문이 정하지 않는다.
  async function asChild(
    child: BrokerChild,
    path: string,
    body: unknown,
  ): Promise<Result<unknown>> {
    const bearer = credentials.get(child.processNonce);
    if (bearer === undefined) {
      return err({
        code: "unavailable",
        message: "the app has no credential",
      });
    }
    let reply: { status: number; body: unknown };
    try {
      reply = await io.post(path, bearer, body);
    } catch {
      return err({ code: "unavailable", message: "core is unreachable" });
    }
    if (reply.status === 200) return ok(reply.body);
    const refused = (
      reply.body as {
        error?: { message?: unknown; details?: unknown };
      } | null
    )?.error;
    return err({
      code: errorCodeOf(reply.status, reply.body),
      message:
        typeof refused?.message === "string"
          ? refused.message
          : "core refused the request",
      ...(typeof refused?.details === "object" && refused.details !== null
        ? { details: refused.details as Record<string, unknown> }
        : {}),
    });
  }

  const appCall: AppCallPort = {
    async call(child, input) {
      const answered = await asChild(
        child,
        `${appCallTool.resource}/${appCallTool.method}`,
        input,
      );
      if (!answered.ok) return answered;
      const parsed = toolCallOutputSchema.safeParse(answered.value);
      return parsed.success
        ? ok(parsed.data)
        : err({
            code: "unavailable",
            message: "core answered the app call badly",
          });
    },
  };

  const notice: NoticePostPort = {
    post: (child, input) =>
      asChild(child, `${noticePost.resource}/${noticePost.method}`, input),
    setTray: (child, input) =>
      asChild(child, `${appTraySet.resource}/${appTraySet.method}`, input),
  };

  const events: EventPublishPort = {
    publish: (child, input) =>
      asChild(
        child,
        `${appEventPublish.resource}/${appEventPublish.method}`,
        input,
      ),
  };

  const sessions: SessionsPort = {
    call: (child, operation, input) =>
      asChild(child, `app_sessions/${operation}`, input),
  };

  const toCore = { post: io.post, bearer: () => hello.credential };
  // 앱 secret 값은 supervisor의 machine credential로 core에서 받는다. 앱 process는 이 route를 부르지 못한다.
  const secrets = {
    delivery: createSecretDelivery({
      nowMs: () => io.clock.nowMs(),
      async core(path, body) {
        if (hello.credential === "") {
          return err({ code: "unavailable", message: "core is not connected" });
        }
        let reply: { status: number; body: unknown };
        try {
          reply = await io.post(path, hello.credential, body);
        } catch {
          return err({ code: "unavailable", message: "core is unreachable" });
        }
        if (reply.status === 200) {
          if (
            path === `${appsSecretValue.resource}/${appsSecretValue.method}`
          ) {
            const value = appsSecretValue.output.safeParse(reply.body);
            if (value.success) knownSecrets.register([value.data.value]);
          }
          return ok(reply.body);
        }
        const refused = (reply.body as { error?: { message?: unknown } } | null)
          ?.error;
        return err({
          code: errorCodeOf(reply.status, reply.body),
          message:
            typeof refused?.message === "string"
              ? refused.message
              : "core refused the request",
        });
      },
    }),
    redaction: registeredByCore,
  };
  const brokerAdapters: BrokerAdapters = {
    access: createCoreBrokerAccess({
      ...toCore,
      candidate: (child) => guarded.candidate(child.app, child.processNonce),
    }),
    ready,
    appCall,
    events,
    sessions,
    notice,
    platformPorts: () => (hello.apiPort === 0 ? [] : [hello.apiPort]),
    exceptions: {
      frames: (child, stack) =>
        io.dataRoot === undefined
          ? Promise.resolve([])
          : resolveStackFrames({
              dataRoot: io.dataRoot,
              app: child.app,
              bundleHash: bundleHashes.get(child.processNonce) ?? null,
              stack,
            }),
      append: (app, entry) => logFileOf(app)?.append(entry),
    },
    secrets,
    ...(io.brokerAdapters ?? {}),
  };
  const broker = createSupervisorBroker({ adapters: brokerAdapters });
  const previewBroker = createSupervisorBroker({ adapters: brokerAdapters });

  // supervisor가 stdout·stderr, 예외, 비정상 종료를 같은 file에 쓴다. dataRoot가 없으면 undefined다.
  function logFileOf(app: string): AppLogFile | undefined {
    if (io.dataRoot === undefined) return undefined;
    const found = logFiles.get(app);
    if (found) return found;
    const created = createAppLogFile({
      dataRoot: io.dataRoot,
      app,
      redact,
      now: () => io.clock.now(),
    });
    logFiles.set(app, created);
    return created;
  }

  // 읽는 쪽이 없는 출력은 읽어서 버린다. 읽지 않으면 pipe가 차서 자식이 막힌다.
  function discard(source: ByteSource): void {
    void drain(source, createStreamDecoder({ onLine() {}, onDropped() {} }));
  }

  function memoryOf(app: string): MemoryObserver {
    const found = memories.get(app);
    if (found) return found;
    const created = createMemoryObserver({
      app,
      nowMs: () => io.clock.nowMs(),
      ...(io.rss ? { read: io.rss } : {}),
      // 설정한 RSS 한도가 아직 없다. 한도 없이는 85% 초과를 주장하지 않는다.
    });
    created.start();
    memories.set(app, created);
    return created;
  }

  // 자식의 stderr 꼬리를 남기며 읽는다. V8 OOM 근거를 찾는 데만 쓰고 log 줄에 싣지 않는다.
  function tee(source: ByteSource, nonce: string): ByteSource {
    const decoder = new TextDecoder();
    return {
      async read(buffer) {
        const count = await source.read(buffer);
        if (count !== null) {
          const text =
            (tails.get(nonce) ?? "") +
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
        response = await io.post(
          `apps/${record.method}`,
          hello.credential,
          recordBody(record),
        );
      } catch {
        return err({ code: "unavailable", message: "core is unreachable" });
      }
      return readRecordState(record, response);
    },
  };

  async function requestCredential(request: {
    desired: DesiredApp;
    nonce: string;
  }): Promise<string> {
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
    bundleHashes.set(request.nonce, request.desired.bundleHash);
    return credential;
  }

  // control socket 요청. 앱 process는 이 socket을 supervisor만 부른다고 믿으므로 서명이 없다.
  async function control(
    socket: string,
    path: string,
    body: unknown,
  ): Promise<Result<{ status: number; body: unknown }>> {
    const reply = await io.control({
      socket,
      path,
      body: JSON.stringify(body),
      timeoutMs: CONTROL_TIMEOUT_MS,
      maxBytes: CONTROL_BODY_MAX_BYTES,
    });
    if (reply.kind !== "reply") {
      return err({ code: "unavailable", message: "app is not listening" });
    }
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(reply.body);
    } catch {
      /* 본문이 JSON이 아니다 */
    }
    return ok({ status: reply.status, body: parsed });
  }

  // 준비 확인. 운영 자식과 preview 자식이 같은 probe 규칙을 쓴다.
  async function probeChild(
    child: { identity: { processNonce: string }; exited: Promise<unknown> },
    socket: string,
  ) {
    const nonce = child.identity.processNonce;
    let exited = false;
    void child.exited.then(() => {
      exited = true;
    });
    const deadline = io.clock.nowMs() + (io.readyTimeoutMs ?? 30_000);
    let reason = "the app did not answer";
    while (io.clock.nowMs() < deadline) {
      if (exited) return { ok: false as const, reason: "exited before ready" };
      const answered = await control(socket, CONTROL_PATHS.probe, {
        process_nonce: nonce,
      });
      if (answered.ok) {
        const attestation = answered.value.body as {
          tools?: string[];
          data_schema?: number;
          bundle_hash?: string;
        } | null;
        if (answered.value.status === 200 && attestation !== null) {
          return {
            ok: true as const,
            tools: attestation.tools ?? [],
            dataSchema: attestation.data_schema ?? 0,
            bundleHash: attestation.bundle_hash ?? "",
          };
        }
        // 서명·nonce·handler 불일치는 기다린다고 낫지 않는다. 준비 중(503)만 다시 본다.
        if (answered.value.status !== 503) {
          const message = (
            answered.value.body as { error?: { message?: unknown } } | null
          )?.error?.message;
          return {
            ok: false as const,
            // reason에 길이 상한이 없어 앱이 준 글은 자른다.
            reason:
              typeof message === "string"
                ? `probe was rejected (${answered.value.status}): ${message.slice(
                    0,
                    500,
                  )}`
                : `probe was rejected (${answered.value.status})`,
          };
        }
      } else {
        reason = answered.error.message;
      }
      await io.wait(100);
    }
    return { ok: false as const, reason };
  }

  // 새 호출·clock을 닫고 종료를 요청한다. 닿지 않아도 유예 뒤 강제 종료가 이어진다.
  async function stopChild(
    child: { identity: { processNonce: string } },
    socket: string,
  ): Promise<void> {
    const nonce = child.identity.processNonce;
    await control(socket, CONTROL_PATHS.close, {
      process_nonce: nonce,
      reason: "stop",
    });
    await control(socket, CONTROL_PATHS.shutdown, {
      process_nonce: nonce,
      grace_ms: 10_000,
    });
  }

  const deps: SupervisorDeps = {
    clock: io.clock,
    core,
    environment: io.environment,
    socketPaths: io.socketPaths,
    nonce: io.nonce,
    credential: requestCredential,
    startChangeset: (processNonce) => startChangesets.get(processNonce),
    async spawn(request) {
      // 자식이 연결하기 전에 broker socket이 이미 듣고 있어야 한다. credential은 시작 입력에 있다.
      const credential = brokerCredentialOf(request.startLine);
      if (credential === undefined) {
        throw new Error("the start input has no broker credential");
      }
      const nonce = request.identity.processNonce;
      const opened = await broker.open({
        child: {
          app: request.app,
          release: request.release,
          mode: "live",
          processNonce: nonce,
        },
        credential,
        socketPath: request.sockets.brokerSocket,
      });
      if (!opened.ok) throw new Error(opened.error.message);
      let spawned: Awaited<ReturnType<SupervisorIo["spawn"]>>;
      try {
        spawned = await io.spawn({
          entry: request.entry,
          environment: request.environment,
          startLine: request.startLine,
        });
      } catch (thrown) {
        // 자식이 뜨지 못했으면 열어 둔 socket과 점유를 바로 거둔다.
        await broker.closed(nonce);
        throw thrown;
      }
      const stderr = tee(spawned.stderr, nonce);
      const file = logFileOf(request.app);
      if (file) {
        void file.attach(spawned.stdout);
        void file.attach(stderr);
      } else {
        discard(spawned.stdout);
        discard(stderr);
      }
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
    probe: (child, socket) => probeChild(child, socket),
    async open(child, socket, desired) {
      const answered = await control(socket, CONTROL_PATHS.open, {
        process_nonce: child.identity.processNonce,
        release: desired.release,
      });
      return answered.ok && answered.value.status === 200;
    },
    requestStop: (child, socket, desired) => {
      // broker도 새 요청부터 막는다. 이미 한 전송을 취소하지는 않는다.
      broker.blockApp(desired.app);
      return stopChild(child, socket);
    },
    wait: io.wait,
    ...(io.readyTimeoutMs === undefined
      ? {}
      : { readyTimeoutMs: io.readyTimeoutMs }),
    ...(io.stopGraceMs === undefined ? {} : { stopGraceMs: io.stopGraceMs }),
    // 자식 종료를 확인하면 socket을 닫고 그 자식의 점유·열린 기록을 거둔다.
    childExited(processNonce) {
      void broker.closed(processNonce);
      startChangesets.delete(processNonce);
      io.childExited?.(processNonce);
    },
    onEvent(event) {
      observeEvent(event);
    },
  };

  // 실패의 근거를 구별해 그 앱 log에 한 줄 쓴다. 쓰기 실패는 writer가 삼키므로 supervisor는 계속 돈다.
  function observeEvent(event: SupervisorEvent): void {
    if (event.kind === "exit") {
      const memory = memories.get(event.app);
      memory?.setChild(null);
    }
    const crash: CrashEvent =
      event.kind === "exit"
        ? {
            kind: "exit",
            intended: event.intended,
            exitCode: event.exitCode,
            stderrTail: tails.get(event.processNonce) ?? "",
          }
        : event.kind === "start_failed"
          ? { kind: "start_failed", reason: event.reason }
          : { kind: "crash_loop", exits: event.exits };
    const text = crashLogText(crash);
    if (text !== undefined) {
      logFileOf(event.app)?.append({ invocation: null, text });
    }
    if (event.kind === "exit") {
      credentials.delete(event.processNonce);
      tails.delete(event.processNonce);
      bundleHashes.delete(event.processNonce);
    }
  }

  const supervisor = createSupervisor(deps);

  // preview 프로세스. 운영 자식과 따로 쥐고(별도 nonce·socket 자리·disposable DB) 운영 앱의 credential·
  // record_* 사실·재시작 정책을 쓰지 않는다. 자식의 broker 자격은 이 supervisor가 만든 일회용 값이고
  // core가 발급한 app credential이 아니다(같은 앱의 운영 자식 credential을 끝내지 않는다).
  const previews = createPreviewLauncher({
    clock: io.clock,
    environment: io.environment,
    socketPaths: (app) => io.socketPaths(`preview:${app}`),
    credential: () => {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      return btoa(String.fromCharCode(...bytes))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replace(/=+$/, "");
    },
    async spawn(request) {
      // preview 자식도 연결하기 전에 broker socket이 듣고 있어야 한다. 외부에 닿는 서비스는 모두 대역이고
      // 선언은 그 bundle의 고정 선언이 정한다.
      const started = startFieldsOf(request.startLine);
      if (started === undefined) {
        throw new Error("the start input has no broker credential");
      }
      const scope = await (io.previewScopeOf ?? previewScopeFromBundle)({
        app: request.app,
        bundleHash: started.bundleHash,
        dataPath: started.dataPath,
      });
      const opened = await previewBroker.open({
        child: {
          app: request.app,
          release: request.release,
          mode: "preview",
          processNonce: request.nonce,
        },
        credential: started.credential,
        socketPath: request.sockets.brokerSocket,
        services: previewServicesFor(scope),
      });
      if (!opened.ok) throw new Error(opened.error.message);
      let spawned: Awaited<ReturnType<SupervisorIo["spawn"]>>;
      try {
        spawned = await io.spawn({
          entry: request.entry,
          environment: request.environment,
          startLine: request.startLine,
        });
      } catch (thrown) {
        await previewBroker.closed(request.nonce);
        throw thrown;
      }
      void spawned.exited.then(() => previewBroker.closed(request.nonce));
      // preview 출력은 app log file에 남기지 않는다.
      discard(spawned.stdout);
      discard(spawned.stderr);
      return {
        identity: {
          pid: spawned.pid,
          startedAtMs: request.identity.startedAtMs,
          processNonce: request.nonce,
        },
        exited: spawned.exited,
        terminate: () => spawned.terminate(),
      };
    },
    probe: (child, socket) => probeChild(child, socket),
    async open(child, socket, launch) {
      const answered = await control(socket, CONTROL_PATHS.open, {
        process_nonce: child.identity.processNonce,
        release: launch.release,
      });
      return answered.ok && answered.value.status === 200;
    },
    requestStop: (child, socket) => stopChild(child, socket),
    // 보내기 실패는 버린다. 관측은 core가 previews.get 때 supervisor에서 읽으므로 화면이 다음에 다시 읽을 때 맞는다.
    changed: (app, nonce, state, reason) =>
      void core.record({
        method: "record_preview",
        app,
        process_nonce: nonce,
        state,
        ...(reason === undefined ? {} : { reason }),
      }),
    wait: io.wait,
    ...(io.readyTimeoutMs === undefined
      ? {}
      : { readyTimeoutMs: io.readyTimeoutMs }),
    ...(io.stopGraceMs === undefined ? {} : { stopGraceMs: io.stopGraceMs }),
  });

  // core 연결이 끊기거나 supervisor가 멈추면 preview 자식도 남기지 않는다.
  const guarded: Supervisor = {
    ...supervisor,
    async coreClosed() {
      await previews.stopAll();
      await supervisor.coreClosed();
    },
    async stop() {
      await previews.stopAll();
      await supervisor.stop();
    },
  };

  const relay = createRelay({
    transport: io.control,
    live: (app) => guarded.control(app),
    preview: (app, nonce) => previews.control(app, nonce),
  });

  function preparationOf(): PreparationService {
    if (io.preparation === undefined) {
      throw new OpError("unavailable", "release preparation is not attached");
    }
    return io.preparation;
  }

  const ops: OpHandlers = {
    [SUPERVISOR_OPS.reconcile]: (payload) => {
      const desired = parse(desiredAppSchema, payload) as DesiredApp;
      if (hello.credential === "") {
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
    [SUPERVISOR_OPS.block]: (payload) => {
      const input = parse(blockInputSchema, payload);
      return Promise.resolve({ blocked: broker.blockApp(input.app) });
    },
    [SUPERVISOR_OPS.appendLog]: (payload) => {
      const input = parse(appendLogInputSchema, payload);
      const file = logFileOf(input.app);
      file?.append({ invocation: null, text: input.text });
      return Promise.resolve({ written: file !== undefined });
    },
    [SUPERVISOR_OPS.restart]: async (payload) => {
      const input = parse(restartInputSchema, payload);
      return {
        restarted: await supervisor.restart(input.app, input.process_nonce),
      };
    },
    // core가 보낸 호출 하나와 뒤집은 changeset 적용을 그 앱 process의 control socket으로 중계한다.
    [SUPERVISOR_OPS.call]: async (payload) => {
      const input = parse(callInputSchema, payload);
      const output = await relay.call(input.target, input.request);
      // 화면 operation의 큰 응답은 control frame에 담기지 않아 bytes stream으로 보낸다.
      const bytes = new TextEncoder().encode(JSON.stringify(output));
      return bytes.length > CALL_RESPONSE_MAX_BYTES
        ? new StreamedPayload(bytes)
        : output;
    },
    [SUPERVISOR_OPS.apply]: async (payload, body) => {
      const input = parse(applyInputSchema, payload);
      // 본문(뒤집은 changeset 전부)은 control frame에 담기지 않아 bytes stream으로 온다.
      if (body === undefined) {
        throw new OpError("invalid_input", "apply body is missing");
      }
      let json: unknown;
      try {
        json = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(body),
        );
      } catch {
        throw new OpError("invalid_input", "apply body is not json");
      }
      const request = parse(processApplyRequestSchema, json);
      const applied = await relay.apply(input.app, request);
      if (!applied.ok) {
        throw new OpError(applied.error.code, applied.error.message);
      }
      return applied.value;
    },
    // 폰에서 온 변경 하나. 본문은 apply처럼 bytes stream으로 온다.
    [SUPERVISOR_OPS.syncApply]: async (payload, body) => {
      const input = parse(syncApplyInputSchema, payload);
      if (body === undefined) {
        throw new OpError("invalid_input", "sync apply body is missing");
      }
      let json: unknown;
      try {
        json = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(body),
        );
      } catch {
        throw new OpError("invalid_input", "sync apply body is not json");
      }
      const request = parse(processSyncApplyRequestSchema, json);
      const applied = await relay.syncApply(input.app, request);
      if (!applied.ok) {
        throw new OpError(applied.error.code, applied.error.message);
      }
      return applied.value;
    },
    [SUPERVISOR_OPS.snapshot]: async (payload) => {
      const input = parse(snapshotInputSchema, payload);
      const written = await relay.snapshot(input.app, { path: input.path });
      if (!written.ok) {
        throw new OpError(written.error.code, written.error.message);
      }
      return written.value;
    },
    [SUPERVISOR_OPS.previewStart]: (payload) => {
      const launch = parse(previewLaunchSchema, payload);
      if (hello.credential === "") {
        throw new OpError("unavailable", "supervisor is not configured");
      }
      // 시작은 비동기다. 접수만 답하고 상태는 preview 관측으로 따라간다.
      const started = previews.start(launch);
      if (!started.ok) {
        throw new OpError(started.error.code, started.error.message);
      }
      return Promise.resolve({ accepted: true });
    },
    [SUPERVISOR_OPS.previewObserve]: (payload) => {
      const input = parse(previewObserveInputSchema, payload);
      return Promise.resolve({
        observation: previews.observation(input.app, input.process_nonce),
      });
    },
    [SUPERVISOR_OPS.releasePrepare]: (payload) => {
      const input = parse(releasePrepareInputSchema, payload);
      const started = preparationOf().start(input);
      if (!started.ok) {
        throw new OpError(started.error.code, started.error.message);
      }
      return Promise.resolve(started.value);
    },
    [SUPERVISOR_OPS.releasePreparation]: (payload) => {
      const input = parse(releasePreparationInputSchema, payload);
      return Promise.resolve(preparationOf().get(input.app, input.request_key));
    },
    [SUPERVISOR_OPS.releaseCancel]: async (payload) => {
      const input = parse(releasePreparationInputSchema, payload);
      const cancelled = await preparationOf().cancel(
        input.app,
        input.request_key,
      );
      if (!cancelled.ok) {
        throw new OpError(cancelled.error.code, cancelled.error.message);
      }
      return { accepted: true };
    },
    // activation(apps/releases): 앱을 붙들고 이전 자식의 종료를 확인한다. 새 호출은 먼저 닫힌다.
    [SUPERVISOR_OPS.activationPause]: async (payload) => {
      const input = parse(activationAppInputSchema, payload);
      return { confirmed: await guarded.pause(input.app) };
    },
    // 후보를 준비 모드로 띄운다. 검사를 통과해도 업무 통로는 닫혀 있다.
    [SUPERVISOR_OPS.activationPrepare]: async (payload) => {
      const desired = parse(desiredAppSchema, payload) as DesiredApp;
      if (hello.credential === "") {
        throw new OpError("unavailable", "supervisor is not configured");
      }
      const started = await guarded.prepare(desired);
      return started.ok
        ? {
            ok: true,
            process_nonce: started.processNonce,
            attestation: {
              release: started.attestation.release,
              bundle_hash: started.attestation.bundleHash,
              tools: started.attestation.tools,
              data_schema: started.attestation.dataSchema,
            },
          }
        : { ok: false, reason: started.reason };
    },
    [SUPERVISOR_OPS.activationOpen]: async (payload) => {
      const input = parse(activationAppInputSchema, payload);
      return { opened: await guarded.open(input.app) };
    },
    [SUPERVISOR_OPS.activationResume]: async (payload) => {
      const input = parse(activationAppInputSchema, payload);
      await guarded.resume(input.app);
      return { accepted: true };
    },
    [SUPERVISOR_OPS.dataJob]: async (payload) => {
      const input = parse(
        dataJobInputSchema.extend({ app: activationAppInputSchema.shape.app }),
        payload,
      );
      if (io.data === undefined) {
        throw new OpError("unavailable", "data jobs are not attached");
      }
      const ran = await io.data.run(input.app, input.line);
      return { ok: ran.ok, line: ran.ok ? ran.value : null };
    },
    [SUPERVISOR_OPS.previewStop]: async (payload) => {
      const input = parse(previewStopInputSchema, payload);
      const stopped = await previews.stop(input.app, input.process_nonce);
      if (!stopped.ok) {
        throw new OpError(stopped.error.code, stopped.error.message);
      }
      return { stopped: stopped.value };
    },
  };

  return {
    supervisor: guarded,
    broker,
    previewBroker,
    ops,
    previews,
    onHello(received) {
      hello.credential = received.credential;
      hello.apiPort = received.apiPort;
    },
    onCredential(response) {
      waiting.get(response.request_id)?.(response.credential);
    },
    memory: (app) => memories.get(app),
    shutdown() {
      for (const memory of memories.values()) memory.stop();
    },
  };
}
