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
  activationAppInputSchema,
  blockInputSchema,
  dataJobInputSchema,
  desiredAppSchema,
  logsInputSchema,
  type ObservationWire,
  observeInputSchema,
  previewLaunchSchema,
  previewObserveInputSchema,
  previewStopInputSchema,
  releasePreparationInputSchema,
  releasePrepareInputSchema,
  restartInputSchema,
  SUPERVISOR_OPS,
} from "../../packages/apps/runtime/control-protocol.ts";
import type { PreparationService } from "../../packages/apps/releases/preparation.ts";
import type { DataJobRunner } from "./data-runner.ts";
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
import {
  createPreviewLauncher,
  type PreviewLauncher,
  type PreviewScope,
} from "../../packages/apps/preview/mod.ts";
import { DIRECT_SOCKET_PATHS } from "../../packages/contracts/apps/mod.ts";
import { diagnosticSchema } from "../../packages/contracts/platform/mod.ts";
import { createKnownSecretRegistry } from "../../packages/platform/redaction/mod.ts";
import {
  type BrokerChild,
  type InvocationBroker,
  pairSocketFlags,
  type ProblemsReport,
  socketFlags,
} from "../../packages/apps/permissions/mod.ts";
import {
  type AutomationPermits,
  createAutomationPermits,
} from "../../packages/apps/automations/permits.ts";
import { reportAcceptanceSchema } from "../../packages/contracts/problems/mod.ts";
import { createCoreAppCallTargets, createCoreBrokerAccess } from "./access.ts";
import {
  previewScopeFromBundle,
  previewServicesFor,
} from "./preview-broker.ts";
import { createCorePairs, forgetAtCore, observeStartsAtCore } from "./pairs.ts";
import {
  type BrokerAdapters,
  createSupervisorBroker,
  type SupervisorBroker,
} from "./broker.ts";
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
  // 다른 앱의 고정 자리 direct socket이다. 자리를 정하기만 하고 파일을 지우지 않는다(그 앱이 지금 듣고
  // 있을 수 있다). 없으면 앱 자식에게 다른 앱 socket 허락을 더하지 않는다.
  directSocketOf?: (app: string) => string;
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
  // 자식 종료를 관측하면 알린다(결과를 못 받은 invocation을 미확인으로 확정하는 쪽이 쓴다).
  childExited?: (processNonce: string) => void;
  // preview 자식이 선언한 외부 범위(고정 bundle의 blueprint)다. 기본은 bundle 사본의 blueprint.json을 읽는다.
  previewScopeOf?: (info: {
    app: string;
    bundleHash: string;
    dataPath: string;
  }) => Promise<PreviewScope>;
  // release 준비 요청의 진행(메모리)이다. 없으면 준비 요청은 unavailable이다.
  preparation?: PreparationService;
  // 앱 전용 data worker다. 없으면 데이터 작업(activation의 backup·migration·restore)은 unavailable이다.
  data?: DataJobRunner;
  // 앱이 broker로 보낸 invocation 후행 기록을 core에 전달하는 쪽이다. 없으면 기록 통로는 unavailable이다.
  invocations?: Pick<InvocationBroker, "submit">;
  // broker 서비스에 더하는 어댑터와 시험 대역(외부 전송 등). 기본은 core read·route를 지나는 어댑터다.
  brokerAdapters?: Partial<
    Pick<
      BrokerAdapters,
      | "netTransport"
      | "netScheme"
      | "documents"
      | "secrets"
      | "pairs"
    >
  >;
};

export type Assembly = {
  supervisor: Supervisor;
  // 앱 자식마다 여는 broker socket과 서비스다. 시험과 grant 적용이 앱 단위로 막는다.
  broker: SupervisorBroker;
  // preview 자식의 broker다. 운영 자식의 broker와 hub를 나눠 서로의 정지·회수가 영향을 주지 않는다.
  previewBroker: SupervisorBroker;
  // automation 전체 동시 한도의 permit이다. 앱마다가 아니라 하나뿐이다(apps/automations#R6).
  permits: AutomationPermits;
  ops: OpHandlers;
  // 감독 pipe의 hello. core API 위치와 machine credential이 온다.
  onHello(
    hello: { credential: string; apiPort: number; verifyKey?: string },
  ): void;
  // core가 app_credential_request에 준 답.
  onCredential(response: { request_id: string; credential: string }): void;
  // preview 프로세스 수명. 운영 supervisor와 따로 한 앱에 하나만 쥔다(apps/preview).
  previews: PreviewLauncher;
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
  // automation 전체 동시 한도는 앱마다가 아니라 supervisor 하나가 쥔다(apps/automations#R6).
  const permits = createAutomationPermits();

  const closedInvocations: Pick<InvocationBroker, "submit"> = {
    submit: () =>
      err({
        code: "unavailable",
        message: "invocation delivery is not connected",
      }),
  };

  function problemsFor(child: BrokerChild): ProblemsReport {
    return {
      async report(request) {
        // 보고는 그 자식의 app credential로만 core에 간다. app·release·mode는 그 credential이 정한다.
        const bearer = credentials.get(child.processNonce);
        if (bearer === undefined) {
          return err({
            code: "unavailable",
            message: "the app has no reporting credential",
          });
        }
        let response: { status: number; body: unknown };
        try {
          response = await io.post("problems/report", bearer, {
            report_id: io.ids.newId("rpt"),
            code: request.code,
            observed_at: io.clock.now(),
            ...(request.trace === undefined ? {} : { text: request.trace }),
            ...(request.details === undefined
              ? {}
              : { details: request.details }),
          });
        } catch {
          return err({ code: "unavailable", message: "core is unreachable" });
        }
        const accepted = reportAcceptanceSchema.safeParse(response.body);
        if (response.status === 200 && accepted.success) {
          return ok({ report_id: accepted.data.report });
        }
        return err({
          code: errorCodeOf(response.status, response.body),
          message: "the report was refused",
        });
      },
    };
  }

  const toCore = { post: io.post, bearer: () => hello.credential };
  const callTargets = createCoreAppCallTargets(toCore);
  const brokerAdapters: BrokerAdapters = {
    access: createCoreBrokerAccess(toCore),
    // 호출의 start 사실은 core의 앱 쌍 경로 장부에도 알린다(apps/connections#R7).
    invocations: observeStartsAtCore(
      io.invocations ?? closedInvocations,
      toCore,
    ),
    permits,
    pairs: createCorePairs(toCore),
    platformPorts: () => hello.apiPort === 0 ? [] : [hello.apiPort],
    problems: problemsFor,
    ...(io.brokerAdapters ?? {}),
  };
  const broker = createSupervisorBroker({ adapters: brokerAdapters });
  const previewBroker = createSupervisorBroker({ adapters: brokerAdapters });

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

  // 제어 요청을 받는 자식. 운영 자식은 앱 하나, preview 자식은 그 nonce까지다.
  type ControlTarget = { app: string; previewNonce?: string };

  // core가 서명한 machine connection. 제어 요청(probe·open·close·shutdown)의 Authorization이다.
  async function authorization(
    target: ControlTarget,
  ): Promise<Result<string>> {
    try {
      const response = await io.post("apps/connect", hello.credential, {
        app: target.app,
        mode: target.previewNonce === undefined ? "live" : "preview",
        screens: [CONTROL_SCREEN],
        screen_sizes: {},
        commands: [],
        ...(target.previewNonce === undefined
          ? {}
          : { preview_nonce: target.previewNonce }),
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
    target: ControlTarget,
    direct: string,
    path: string,
    body: unknown,
  ): Promise<Result<{ status: number; body: unknown }>> {
    const signed = await authorization(target);
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

  // 준비 확인. 운영 자식과 preview 자식이 같은 probe 규칙을 쓴다.
  async function probeChild(
    child: { identity: { processNonce: string }; exited: Promise<unknown> },
    direct: string,
    target: ControlTarget,
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
      const answered = await control(
        target,
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
            ok: true as const,
            commands: attestation.commands ?? [],
            dataSchema: attestation.data_schema ?? 0,
            bundleHash: attestation.bundle_hash ?? "",
          };
        }
        // 서명·nonce·handler 불일치는 기다린다고 낫지 않는다. 준비 중(503)만 다시 본다.
        if (answered.value.status !== 503) {
          return {
            ok: false as const,
            reason: `probe was rejected (${answered.value.status})`,
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
    direct: string,
    target: ControlTarget,
  ): Promise<void> {
    const nonce = child.identity.processNonce;
    await control(target, direct, DIRECT_SOCKET_PATHS.close, {
      process_nonce: nonce,
      reason: "stop",
    });
    await control(target, direct, DIRECT_SOCKET_PATHS.shutdown, {
      process_nonce: nonce,
      grace_ms: 10_000,
    });
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
      // 사람이 허락한 app.call 대상의 direct socket에는 이 자식도 닿아야 한다. 조회가 막혔으면 더하지
      // 않는다: 그 앱 호출만 NotCapable로 닫히고 나머지 시작은 그대로다.
      let pairFlags: string[] = [];
      if (io.directSocketOf !== undefined) {
        const targets = await callTargets(request.app);
        if (targets.ok) {
          const made = pairSocketFlags(targets.value.map(io.directSocketOf));
          if (made.ok) pairFlags = made.value;
        }
      }
      // 자식이 연결하기 전에 broker socket이 이미 듣고 있어야 한다. credential은 시작 입력에 있다.
      const credential = brokerCredentialOf(request.startLine);
      if (credential === undefined) {
        throw new Error("the start input has no broker credential");
      }
      const nonce = request.identity.processNonce;
      const opened = broker.open({
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
          deno: request.deno,
          entry: request.entry,
          flags: {
            ...request.flags,
            args: [...request.flags.args, ...sockets.value, ...pairFlags],
          },
          importMap: request.importMap,
          environment: request.environment,
          startLine: request.startLine,
        });
      } catch (thrown) {
        // 자식이 뜨지 못했으면 열어 둔 socket과 점유를 바로 거둔다.
        await broker.closed(nonce);
        throw thrown;
      }
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
    probe: (child, direct, desired) =>
      probeChild(child, direct, { app: desired.app }),
    async open(child, direct, desired) {
      const answered = await control(
        { app: desired.app },
        direct,
        DIRECT_SOCKET_PATHS.open,
        {
          process_nonce: child.identity.processNonce,
          release: desired.release,
        },
      );
      return answered.ok && answered.value.status === 200;
    },
    requestStop: (child, direct, desired) => {
      // broker도 새 요청부터 막는다. 이미 한 전송을 취소하지는 않는다.
      broker.blockApp(desired.app);
      return stopChild(child, direct, { app: desired.app });
    },
    wait: io.wait,
    ...(io.readyTimeoutMs === undefined
      ? {}
      : { readyTimeoutMs: io.readyTimeoutMs }),
    ...(io.stopGraceMs === undefined ? {} : { stopGraceMs: io.stopGraceMs }),
    // 자식 종료를 확인하면 socket을 닫고 그 자식의 점유·열린 기록을 거둔다.
    childExited(processNonce) {
      void broker.closed(processNonce);
      forgetAtCore(toCore, processNonce);
      io.childExited?.(processNonce);
    },
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

  // preview 프로세스. 운영 자식과 따로 쥐고(별도 nonce·socket 자리·disposable DB) 운영 앱의 credential·
  // record_* 사실·재시작 정책을 쓰지 않는다. 자식의 broker 자격은 이 supervisor가 만든 일회용 값이고
  // core가 발급한 app credential이 아니다(같은 앱의 운영 자식 credential을 끝내지 않는다).
  const previews = createPreviewLauncher({
    clock: io.clock,
    deno: io.deno,
    environment: io.environment,
    socketPaths: (app) => io.socketPaths(`preview:${app}`),
    credential: () => {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-")
        .replaceAll("/", "_").replace(/=+$/, "");
    },
    verifyKey: () => verifyKey,
    async spawn(request) {
      const sockets = socketFlags(request.sockets);
      if (!sockets.ok) throw new Error(sockets.error.message);
      // preview 자식도 연결하기 전에 broker socket이 듣고 있어야 한다. 외부에 닿는 서비스는 모두 대역이고
      // 선언은 그 bundle의 고정 blueprint가 정한다(apps/preview#R4).
      const started = startFieldsOf(request.startLine);
      if (started === undefined) {
        throw new Error("the start input has no broker credential");
      }
      const scope = await (io.previewScopeOf ?? previewScopeFromBundle)({
        app: request.app,
        bundleHash: started.bundleHash,
        dataPath: started.dataPath,
      });
      const opened = previewBroker.open({
        child: {
          app: request.app,
          release: request.release,
          mode: "preview",
          processNonce: request.nonce,
        },
        credential: started.credential,
        socketPath: request.sockets.brokerSocket,
        services: previewServicesFor(
          scope,
          io.invocations ?? closedInvocations,
        ),
      });
      if (!opened.ok) throw new Error(opened.error.message);
      let spawned: Awaited<ReturnType<SupervisorIo["spawn"]>>;
      try {
        spawned = await io.spawn({
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
      } catch (thrown) {
        await previewBroker.closed(request.nonce);
        throw thrown;
      }
      void spawned.exited.then(() => previewBroker.closed(request.nonce));
      // 출력은 운영 앱 log와 섞이지 않는 preview 자리로 모은다. 읽지 않으면 자식이 막힌다.
      const log = bufferOf(`preview:${request.app}`);
      void log.attach(spawned.stdout);
      void log.attach(spawned.stderr);
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
    probe: (child, direct, launch) =>
      probeChild(child, direct, {
        app: launch.app,
        previewNonce: launch.nonce,
      }),
    async open(child, direct, launch) {
      const answered = await control(
        { app: launch.app, previewNonce: launch.nonce },
        direct,
        DIRECT_SOCKET_PATHS.open,
        { process_nonce: child.identity.processNonce, release: launch.release },
      );
      return answered.ok && answered.value.status === 200;
    },
    requestStop: (child, direct, launch) =>
      stopChild(child, direct, { app: launch.app, previewNonce: launch.nonce }),
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

  function preparationOf(): PreparationService {
    if (io.preparation === undefined) {
      throw new OpError("unavailable", "release preparation is not attached");
    }
    return io.preparation;
  }

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
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      };
      // 살아 있는 자식의 stream은 끝나지 않으므로 기다리지 않고 지금 모인 줄을 준다. 자식이 끝난
      // 직후의 조회만 마지막 flush를 최대 20ms 기다린다(R27).
      const alive = (supervisor.observation(input.app)?.processNonce ?? "") !==
        "";
      return alive ? buffer.read(query) : await buffer.collect(query);
    },
    [SUPERVISOR_OPS.block]: (payload) => {
      const input = parse(blockInputSchema, payload);
      return Promise.resolve({ blocked: broker.blockApp(input.app) });
    },
    [SUPERVISOR_OPS.restart]: async (payload) => {
      const input = parse(restartInputSchema, payload);
      return {
        restarted: await supervisor.restart(input.app, input.process_nonce),
      };
    },
    [SUPERVISOR_OPS.previewStart]: (payload) => {
      const launch = parse(previewLaunchSchema, payload);
      if (verifyKey === "" || hello.credential === "") {
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
      return Promise.resolve(
        preparationOf().get(input.app, input.request_key),
      );
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
      if (verifyKey === "" || hello.credential === "") {
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
            commands: started.attestation.commands,
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
    permits,
    ops,
    previews,
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
