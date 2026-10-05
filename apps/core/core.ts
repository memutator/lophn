import { systemClock } from "../../packages/base/clock.ts";
import { cryptoRandom } from "../../packages/base/random.ts";
import type { Clock, RandomSource, Result } from "../../packages/base/mod.ts";
import { err, ok } from "../../packages/base/mod.ts";
import type {
  AuthenticatedContext,
  ChildMessage,
  Frame,
  KindLaunchSpec,
  ParentMessage,
  RequestContext,
} from "../../packages/contracts/platform/mod.ts";
import { ROUTES } from "../../packages/contracts/platform/mod.ts";
import {
  type ApiServer,
  RouteRegistry,
  startApiServer,
} from "../../packages/platform/api/mod.ts";
import type { WorkerRouteTarget } from "../../packages/platform/responsiveness/mod.ts";
import {
  applyMigrations,
  checkRestart,
} from "../../packages/platform/backup-and-migration/mod.ts";
import { type StatusSource } from "../../packages/platform/diagnostics/mod.ts";
import {
  CredentialRegistry,
  type OperationPolicy,
} from "../../packages/platform/identity/mod.ts";
import {
  acquireInstanceLock,
  type DataRoot,
  type InstanceLock,
  removeRunMetadata,
  resolveDataRoot,
  writeRunMetadata,
} from "../../packages/platform/install-and-update/mod.ts";
import { LEDGER_SCHEMA_STEPS } from "../../packages/platform/ledger/mod.ts";
import { createSupervisor } from "../../packages/platform/responsiveness/mod.ts";
import { SETTINGS_SCHEMA_STEPS } from "../../packages/platform/settings/mod.ts";
import {
  type BlobPrepareRelay,
  type BufferGauge,
  createBlobPrepareRelay,
  createBufferGauge,
  type PreparedRelayResult,
} from "./blob-prepare.ts";
import {
  createPreparationRegistry,
  retentionRules,
} from "../../packages/platform/blob-store/mod.ts";
import type { BlobFieldDefinition } from "../../packages/contracts/platform/mod.ts";
import {
  type ChildBlobPrepare,
  createChildBlobPrepare,
} from "./child-blob-prepare.ts";
import { CREDENTIAL_SCHEMA } from "./credentials.ts";
import {
  type BaseVersionFor,
  documentPrepareRoute,
  relaySink,
} from "./documents-prepare.ts";
import type { VersionRow } from "../../packages/documents/versions/store.ts";
import { connectDocumentsRelaunch, workerSpecs } from "./documents.ts";
import {
  createDocumentsChannel,
  servedWorkers,
  statusMemoryVia,
} from "./documents-serving.ts";
import { PREPARE_BASE_ROUTE } from "./documents-served.ts";
import { type RootsWatch, watchTrackingRoots } from "./documents-roots.ts";
import { projectTrackingRoots } from "../../packages/contracts/documents/mod.ts";
import { greet, type ParentPipe, watchParent, writeParent } from "./parent.ts";
import { assemble, type TeamModule } from "./registration.ts";
import { type CoreRuntime, openRuntime } from "./runtime.ts";
import { ticketClaimSweepIntervalMs } from "./tickets.ts";
import { testCredentialFront } from "./test-credentials.ts";

// 시작 순서: lock → ledger schema step → writer·reader → event 배포 → API → I/O worker 감독.
export type CoreOptions = {
  // 없으면 프로세스 환경의 LOPHN_HOME, 그것도 없으면 ~/.lophn.
  lophnHome?: string;
  home?: string;
  // 0이면 빈 port. 기본은 7431.
  port?: number;
  teams: readonly TeamModule[];
  // writer·reader가 다시 import할 팀 등록 파일. 없으면 teams 객체만 쓴다.
  teamModules?: readonly string[];
  clock?: Clock;
  // writer 시각. "fixed"(기본)면 clock의 기동 시각에 고정한다. 테스트의 결정적인
  // 시각과 blob 준비 만기 판정이 여기 있다. "system"이면 writer가 자기 system
  // clock을 쓴다. 제품 기동(main.ts)만 "system"이다.
  writerClock?: "system" | "fixed";
  random?: RandomSource;
  // Electron main이 물려 준 stdin/stdout. 테스트가 파이프를 끼운다.
  parent?: ParentPipe;
  // I/O worker 감독. 없으면 core가 platform/io를 직접 감독한다.
  supervise?: (workers: readonly KindLaunchSpec[]) => Promise<void>;
  // 테스트가 child를 띄우지 않을 때만 끈다. 제품 기동은 항상 감독한다.
  superviseIo?: boolean;
  // 테스트 harness만 true로 둔다. main.ts는 이 입구를 열지 않는다.
  testCredentials?: boolean;
  // 테스트가 준비 참조를 writer 메모리에 심는 입구. 제품 기동에는 없다.
  notePrepared?: (prepared: PreparedRelayResult, nowMs: number) => void;
  // 테스트가 정지 유지보수를 대신 실행한다. 제품 기동에는 없다. 세 정지
  // 조건이 모두 관측된 뒤에만 불리고, 실패·시간 초과는 종료를 막지 않는다.
  maintenance?: () => Promise<void>;
  // 테스트가 종료의 앞 단계(API 정지)를 실패시킨다. 제품 기동에는 없다.
  failShutdown?: () => Promise<void>;
  // 정지 유지보수 시간 제한. 없으면 30초. 테스트가 짧게 줄인다.
  maintenanceTimeoutMs?: number;
  // 테스트가 worker route serving을 붙이는 입구(T8·T13 통합). 제품 기동에는 없다.
  workers?: ReadonlyMap<string, WorkerRouteTarget>;
  // 테스트가 documents worker에 준 hello(machine credential과 api port)를 본다. 시작과
  // 재시작마다 불린다. 제품
  // 기동에는 없다. credential은 log에 남기지 않는다.
  onDocumentsHello?: (hello: { credential: string; api_port: number }) => void;
};
export type BlobPrepareCall = {
  principal: string;
  purpose: string;
  expectedHash?: string;
  bytes: ReadableStream<Uint8Array>;
};

export type Core = {
  port: number;
  epoch: string;
  dataRoot: string;
  // 부모 pipe의 종료 감시가 끝나면 resolve된다. 부모가 없으면 이미 끝난 상태다.
  done: Promise<void>;
  // 새 command 입장을 닫고 연 것을 정리한 뒤 lock을 푼다(ledger R21).
  shutdown(): Promise<void>;
  record(context: AuthenticatedContext): Promise<Result<void>>;
  // 신뢰 프로세스의 blob.prepare 호출. HTTP route가 아니다(Q6).
  // I/O worker가 설치하고 writer 메모리에 준비 참조를 남긴 뒤에 끝난다.
  prepareBlob(call: BlobPrepareCall): Promise<Result<PreparedRelayResult>>;
  // blob 준비에서 core가 바이트를 쥐고 있는 양의 관측(자식 쪽 대기열과 중계의 chunk).
  // 한도는 BLOB_RELAY_BUFFER_MAX_BYTES다. core는 큰 blob을 통째로 모으지 않는다.
  readonly blobBuffer: BufferGauge;
  // 신뢰 자식(문서 worker, report collector)의 blob 준비 요청 처리(Q6). 자식 kind의
  // supervisor callback이 onMessage·onFrame을 이 값에 넘기고, 자식이 멈추면 close한다.
  // 허용 kind는 child-blob-prepare.ts의 목록뿐이다.
  childBlobPrepare(
    kind: string,
    send: (message: ParentMessage) => Promise<boolean>,
  ): ChildBlobPrepare;
  // testCredentials일 때만 있다. 제품 발급이 막는 actor의 테스트 기록이다.
  acceptTestCredential?(
    context: AuthenticatedContext,
    token: string,
  ): Promise<Result<void>>;
  // testCredentials일 때만 있다. 준비 참조를 writer 메모리에 알린다.
  notePrepared?(
    prepared: PreparedRelayResult,
    nowMs: number,
  ): Promise<Result<void>>;
  // 만료 claim 정리. 60초 timer와 재시작이 같은 함수를 부른다(tickets#R13).
  sweepTicketClaims(): Promise<void>;
  // testCredentials일 때만 있다. 확인 창 handle을 writer registry에 발급한다.
  confirmation?(body: {
    action: "issue" | "close-window" | "clear";
    request?: unknown;
    windowId?: string;
  }): Promise<Result<unknown>>;
};

export async function startCore(options: CoreOptions): Promise<Result<Core>> {
  const clock = options.clock ?? systemClock;
  const random = options.random ?? cryptoRandom;
  const root = await resolveDataRoot({
    lophnHome: options.lophnHome ?? Deno.env.get("LOPHN_HOME") ?? undefined,
    home: options.home ?? Deno.env.get("HOME") ?? undefined,
  });
  if (!root.ok) return root;
  const locked = await acquireInstanceLock(root.value.run);
  if (!locked.ok) return locked;

  const opened = await open(options, root.value, locked.value, clock, random);
  if (!opened.ok) {
    // 기동이 실패하면 위치 metadata를 남기지 않고 lock을 푼다.
    await removeRunMetadata(root.value.run);
    await locked.value.release();
    return opened;
  }
  return opened;
}

async function open(
  options: CoreOptions,
  root: DataRoot,
  lock: InstanceLock,
  clock: Clock,
  random: RandomSource,
): Promise<Result<Core>> {
  // documents coordinator 요청 통로. FileStatus 조회가 이 통로로 묻는다.
  const documentsChannel = createDocumentsChannel();
  const assembled = assemble(options.teams, {
    status: statusMemoryVia(documentsChannel),
  });
  if (!assembled.ok) return assembled;
  // HTTP route는 writer·reader가 받는 command·read와 같은 조립에서 온다.
  // platform 기본 route와 팀 route의 resource/method가 겹치면 기동을 거절한다.
  const allRoutes = [...ROUTES, ...assembled.value.routes];
  let routes: RouteRegistry;
  try {
    routes = new RouteRegistry(allRoutes);
  } catch {
    return err({ code: "internal", message: "route 등록이 겹친다" });
  }
  const ledgerPath = `${root.path}/lophn.db`;
  const migrated = await applyMigrations(
    ledgerPath,
    [
      ...LEDGER_SCHEMA_STEPS,
      CREDENTIAL_SCHEMA,
      ...assembled.value.schemaSteps,
      ...SETTINGS_SCHEMA_STEPS,
    ],
    { clock, recovery: { root: root.path } },
  );
  if (!migrated.ok) return migrated;
  // 중단 작업 점검 → cursor 복원 치는 R11 순서다. SQLite 복구·schema 점검 뒤
  // 정상 read를 열고 전체 scan·index·큰 hash를 기다리지 않는다(R15). 소유
  // concern의 복구 command가 아직 없는 영역은 unknown 관측값과 근거를 남기고
  // 읽기 열기를 막지 않는다(R16). 점검 관측은 status에 더하지 않는다: 상태는
  // 구성 요소 관측이고 소유 concern 관측은 복구 command로 남는다.
  const restart = await checkRestart(ledgerPath, { clock });
  if (!restart.ok) return restart;
  const epoch = hex(random, 16);
  // machine은 command kind 정책에만 닿는다(identity model operationCeiling).
  // 문서 관측 제출은 machine document.prepare(준비 route)와 document.save command다
  // (documents#T11). 준비 route도 machine이 닿도록 command kind로 올린다.
  const productRegistry = new CredentialRegistry({
    epoch,
    clock,
    random,
    operations: [
      {
        name: "platform/status",
        actors: ["user", "machine", "app", "agent", "coding_agent"],
        kind: "read",
      },
      {
        name: "platform/health",
        actors: ["user", "machine", "app", "agent", "coding_agent"],
        kind: "read",
      },
      { name: "document.save", actors: ["machine"], kind: "command" },
      { name: "document.prepare", actors: ["machine"], kind: "command" },
      // 사람 token 상한. user를 허용하는 route만 올라가고 다른 actor의 상한은 그대로다.
      ...allRoutes.filter((route) => route.actors.includes("user")).map((
        route,
      ): OperationPolicy => ({
        name: route.name,
        actors: ["user"],
        kind: route.kind === "command" ? "command" : "read",
      })),
    ],
  });
  const registry = options.testCredentials
    ? testCredentialFront(productRegistry, ledgerPath)
    : productRegistry;
  const io = options.superviseIo === false ? undefined : createSupervisor({
    clock,
    denoCommand: Deno.execPath(),
    env: (kind) => ({
      LOPHN_WORKER_KIND: kind,
      LOPHN_HOME: root.path,
      // deno는 이 둘 없이 캐시와 실행 파일을 못 찾는다. 그 밖 환경은 복사하지 않는다.
      ...(Deno.env.get("HOME") ? { HOME: Deno.env.get("HOME")! } : {}),
      ...(Deno.env.get("PATH") ? { PATH: Deno.env.get("PATH")! } : {}),
    }),
  });
  let ready = false;
  const stopPrune: { run?: () => void } = {};
  // 활성 tracking root 변화를 보는 확인. documents worker를 띄운 뒤에만 있다.
  let rootsWatch: RootsWatch | undefined;
  // 종료 때 documents worker의 열린 blob 준비를 닫는다.
  let closeChildBlob: (() => void) | undefined;
  // deno-lint-ignore prefer-const
  let runtime: CoreRuntime | undefined;
  const source: StatusSource = {
    get ready() {
      return ready;
    },
    schema: LEDGER_SCHEMA_STEPS.length + assembled.value.schemaSteps.length,
    dataRoot: root.path,
    // ledger 파일 하나의 식별. 내용은 노출하지 않는다.
    ledgerId: await ledgerIdentity(ledgerPath),
    components() {
      return [
        ["ledger", { available: true }],
        // unavailable 관측은 안전한 이유가 있어야 한다(healthObservationSchema).
        ["api", {
          available: ready,
          ...(ready ? {} : { reason: "API가 아직 요청을 받지 않는다" }),
        }],
        ["writer", {
          available: runtime !== undefined,
          ...(runtime ? {} : { reason: "writer가 아직 없다" }),
        }],
        ["reader", {
          available: runtime?.readers.health().every((health) =>
            health === "healthy"
          ) ?? false,
          ...(runtime ? {} : { reason: "reader가 아직 없다" }),
        }],
        ["io", ioComponent(io)],
      ];
    },
  };
  // 읽기 의존은 runtime보다 먼저 만들어 둔다. relay는 I/O worker가 뜬 뒤에 채운다.
  const blobRead = blobReadDeps(assembled.value);
  const openedRuntime = await openRuntime({
    ledgerPath,
    clock,
    nowMs: clock.nowMs(),
    writerClock: options.writerClock ?? "fixed",
    seed: seedOf(random),
    // 문서 worker route를 서빙하는 reader 등록은 항상 붙는다(documents-reader.ts).
    modules: withDocumentsReader(options.teamModules ?? []),
    assembled: assembled.value,
    source,
    blob: blobRead.deps,
  });
  if (!openedRuntime.ok) return openedRuntime;
  runtime = openedRuntime.value;
  // sweep가 expire_claim을 제출할 machine credential. 기록이 없으면 writer가
  // 만료 정리를 거절하므로 기동을 여기서 멈춘다(coding-agent/tickets#R13).
  const sweepCredential = await runtime.record({
    principal: "machine:ticket-claims",
    actor: "machine",
    scope: {
      operations: ["ExpireTicketClaim", "TicketClaimSweep"],
      targets: {},
    },
    conditions: {},
    credential_ref: "machine:ticket-claims",
  });
  if (!sweepCredential.ok) {
    await runtime.close();
    return sweepCredential;
  }
  // 문서 관측 제출 machine credential. 발급(greet과 같은 issue → revalidate →
  // record 규칙) 뒤 token이 documents/worker hello에 싣는다. 지우지 못한 token은
  // logs에 남기지 않는다(child.ts 계약). 발급이 실패하면 기동을 여기서 멈춘다.
  let documentsToken: string | undefined;
  if (options.superviseIo !== false) {
    const issued = await productRegistry.issue({
      actor: "machine",
      principal: "machine:documents",
      scope: {
        operations: ["document.prepare", "document.save"],
        targets: { task: "documents" },
      },
      conditions: { task: "documents", process: "documents/worker" },
    });
    if (!issued.ok) {
      await runtime.close();
      return issued;
    }
    const current = productRegistry.revalidate({
      credential_ref: issued.value.credential_ref,
    });
    if (!current.ok) {
      await runtime.close();
      return current;
    }
    const recorded = await runtime.record(current.value);
    if (!recorded.ok) {
      await runtime.close();
      return recorded;
    }
    documentsToken = issued.value.token;
  }
  // blob 준비 중계는 I/O worker가 뜬 뒤에 채워진다. 그 전에는 prepare route가
  // unavailable이다. route는 떠 있고, 바이트는 중계가 읽는 stream으로 바로 간다.
  const prepareRelay: {
    current?: (call: BlobPrepareCall) => Promise<Result<PreparedRelayResult>>;
  } = {};
  let server: ApiServer;
  try {
    server = await startApiServer({
      port: options.port,
      credentials: registry,
      clock,
      writer: runtime.writer,
      reads: runtime.reads,
      memory: runtime.memory.handlers,
      events: runtime.events,
      subscriptions: runtime.subscriptions,
      // command·read·file·worker route는 같은 조립에서 온다. platform 기본 route와
      // 팀 route의 resource/method가 겹치면 RouteRegistry가 거절한다.
      registry: routes,
      // worker route serving map. document.prepare는 제품 기동이 항상 넣고,
      // 테스트 seam(T8·T13)이 준 route를 같은 map에 더한다. resource/method가
      // 겹치면 테스트 seam이 이긴다. 둘 다 없으면 worker route는 503이다.
      workers: mergedWorkers(
        documentPrepareWorkers(prepareRelay, baseVersionRead(runtime)),
        mergedWorkers(
          servedWorkers({
            readers: runtime.readers,
            current: (ref) => runtime!.current(ref),
            observedAt: () => new Date().toISOString(),
          }),
          options.workers,
        ),
      ),
    });
  } catch {
    await runtime.close();
    return err({ code: "unavailable", message: "API를 열 수 없다" });
  }
  const recorded = await writeRunMetadata(root.run, {
    apiPort: server.port,
    coreEpoch: epoch,
    startedAt: clock.now(),
  });
  if (!recorded.ok) {
    await server.stop();
    await runtime.close();
    return recorded;
  }
  if (options.supervise) {
    try {
      await options.supervise(assembled.value.workers);
    } catch {
      await server.stop();
      await runtime.close();
      return err({
        code: "unavailable",
        message: "I/O worker 감독을 시작하지 못했다",
      });
    }
  }
  const blobBuffer = createBufferGauge();
  const blobRelay = io
    ? blobRelayFor(
      io,
      clock,
      (prepared, nowMs) => runtime.notePrepared(prepared, nowMs),
      blobBuffer,
    )
    : undefined;
  if (blobRelay) {
    blobRead.use(blobRelay.readBytes);
    prepareRelay.current = (call) => blobRelay.prepare(call);
  }
  // 준비 참조 수명 만기 prune. writer 메모리의 만기 판정 시각도 함께 전진한다.
  // 파일 GC는 하지 않고 메모리 참조만 떨어뜨린다.
  const timer = setInterval(() => {
    blobRelay?.prune(clock.nowMs());
    runtime?.prunePrepared(clock.nowMs());
  }, 60_000);
  // ticket claim 만료·회수 정리. 60초마다와 재시작 때 후보를 읽고 expire_claim을
  // 제출한다. timer는 표를 쓰지 않는다(coding-agent/tickets#R13).
  const claimSweep = setInterval(
    () => runtime?.sweepTicketClaims(),
    ticketClaimSweepIntervalMs,
  );
  await runtime?.sweepTicketClaims();
  stopPrune.run = () => {
    clearInterval(timer);
    clearInterval(claimSweep);
    rootsWatch?.stop();
  };
  const startedIo = io
    ? await startPlatformIo(
      io,
      root.path,
      epoch,
      server.port,
      blobRelay?.callbacks,
    )
    : undefined;
  if (startedIo && !startedIo.ok) {
    await server.stop();
    await runtime.close();
    return startedIo;
  }
  // documents/worker. 관측 제출 credential이 hello에 싣는다. credential이 없으면(감독이
  // 없는 harness) 띄우지 않는다: 제출 없이 관측만 반복하는 worker는 겉보기 가용이 거짓이다.
  // 띄우지 못해도 core는 계속 선다. 통로가 묶이지 않아 documents 요청은 unavailable이다.
  if (io && documentsToken) {
    const documentsHello = {
      type: "hello" as const,
      core_epoch: epoch,
      process_identity: epoch,
      kind: "documents/worker" as const,
      task: "documents",
      scope: { operations: [], targets: {} },
      credential: documentsToken,
      api_port: server.port,
    };
    // worker가 hello를 받을 때마다(처음 시작과 root 변경 뒤 재시작) 알린다.
    const announceHello = () =>
      options.onDocumentsHello?.({
        credential: documentsToken,
        api_port: server.port,
      });
    announceHello();
    // 자식의 blob 준비 요청(원문 → document_file blob)은 시작마다 새 handler가 받는다.
    // 자식이 멈추면(재시작·종료) 열린 준비는 unavailable로 닫는다(platform Q6).
    // 나머지 메시지의 worker_response는 통로가 요청 id로 맞춘다.
    let childBlob: ChildBlobPrepare | undefined;
    const freshCallbacks = () => {
      childBlob?.close();
      const handler = createChildBlobPrepare({
        kind: "documents/worker",
        gauge: blobBuffer,
        send: (message) =>
          io.send("documents/worker", message).then((sent) => sent.ok),
        prepareBlob: (call) =>
          blobRelay ? blobRelay.prepare(call) : Promise.resolve(err({
            code: "unavailable",
            message: "blob 준비 통로가 없다",
          })),
      });
      childBlob = handler;
      return {
        onMessage: (message: ChildMessage) => {
          if (!handler.onMessage(message)) documentsChannel.onMessage(message);
        },
        onFrame: (frame: Frame) => handler.onFrame(frame),
      };
    };
    closeChildBlob = () => childBlob?.close();
    const trackingRoots = async (): Promise<Result<readonly string[]>> => {
      const read = await runtime!.readers.read(
        projectTrackingRoots,
        trackingReader,
        {},
      );
      if (!read.ok) return read;
      return ok(
        (read.value as { roots: { path: string }[] }).roots.map((entry) =>
          entry.path
        ),
      );
    };
    const initial = await trackingRoots();
    const active = initial.ok ? [...new Set(initial.value)].sort() : [];
    const spec = workerSpecs(root.path, active).find((entry) =>
      entry.kind === "documents/worker"
    );
    const started = spec
      ? await io.start(spec, documentsHello, freshCallbacks())
      : undefined;
    if (started?.ok) {
      documentsChannel.bind((payload) =>
        io.send("documents/worker", payload).then((sent) => sent.ok)
      );
    }
    // root가 바뀌면 documents worker만 새 권한으로 다시 띄운다(file-tracking#R3).
    // 시작 읽기가 실패했으면 known은 비어 있고 다음 확인이 맞춘다.
    rootsWatch = watchTrackingRoots({
      roots: trackingRoots,
      relaunch: (previous, next) =>
        connectDocumentsRelaunch(
          {
            updateSpec: async (updated) => {
              announceHello();
              const restarted = await io.updateSpec(
                updated,
                documentsHello,
                freshCallbacks(),
              );
              return { ok: restarted.ok };
            },
          },
          root.path,
          previous,
          next,
        ),
      known: active,
      intervalMs: DOCUMENTS_ROOTS_INTERVAL_MS,
    });
  }
  ready = true;
  // 부모 pipe는 호출자가 명시할 때만 연다. 터미널에서 직접 띄우면 종료는 신호가 담당한다.
  const parent = options.parent;
  const hello = parent
    ? greet(
      parent,
      registry,
      runtime,
      server.port,
      epoch,
      (scope) => productRegistry.issue(scope),
      allRoutes,
    )
    : Promise.resolve(ok(undefined));
  let stopped = false;
  const core: Core = {
    port: server.port,
    epoch,
    dataRoot: root.path,
    done: Promise.resolve(),
    record: (context) => runtime!.record(context),
    sweepTicketClaims: () => runtime!.sweepTicketClaims(),
    blobBuffer,
    childBlobPrepare: (kind, send) =>
      createChildBlobPrepare({
        kind,
        send,
        gauge: blobBuffer,
        prepareBlob: (call) => core.prepareBlob(call),
      }),
    prepareBlob: (call) =>
      blobRelay ? blobRelay.prepare(call) : Promise.resolve(err({
        code: "unavailable",
        message: "blob 준비 통로가 없다",
      })),
    async shutdown() {
      if (stopped) return;
      stopped = true;
      // 종료 순서(architecture 7.5): 새 command·prepare 입장 닫기 → 입장한
      // 짧은 command 확정 또는 실패 → child 정상 정지 → writer 닫기.
      // 정지 유지보수(T44)는 이 세 조건이 실제로 끝난 뒤에만 돈다. 앞 단계가
      // 예외를 던져도 metadata 정리와 lock 해제는 그대로 실행한다.
      const stoppedAt: {
        preparationsBlocked: boolean;
        commandsBlocked: boolean;
        writerStopped: boolean;
      } = {
        preparationsBlocked: false,
        commandsBlocked: false,
        writerStopped: false,
      };
      try {
        // 새 입장을 먼저 닫는다. 이미 입장한 command는 writer가 확정 또는 실패로 마친다.
        ready = false;
        rootsWatch?.stop();
        closeChildBlob?.();
        // main 연결이 끊기면 그 main의 relay 값을 모두 disconnected로 바꾼다(T57).
        runtime?.memory.disconnect();
        // server.stop은 받은 요청이 끝나기를 기다린 뒤 listen을 닫는다. 그 뒤에야
        // 새 command 입장이 실제로 닫힌 것이다.
        await server.stop();
        if (options.failShutdown) await options.failShutdown();
        stoppedAt.commandsBlocked = ready === false;
        // child 정상 정지. stopAll이 돌아온 뒤에야 새 blob 준비 접수가 없다.
        if (io) await io.stopAll();
        stoppedAt.preparationsBlocked = true;
        stopPrune.run?.();
        // writer Worker와 reader 연결을 닫는다. close가 돌아온 뒤에야 writer가 멈춘 것이다.
        await runtime?.close();
        stoppedAt.writerStopped = true;
        // 세 조건이 모두 관측될 때만 유지보수를 부른다. 파일 작업과 blob_refs
        // 읽기는 core graph 밖 프로세스의 몫이다(responsiveness#R1). 관측을
        // 못 하면 건너뛰고(fail-closed), 시간 제한을 넘기면 그 프로세스만
        // 끝내고 종료를 계속한다. 실패는 diagnostics 로그만 남긴다.
        if (
          stoppedAt.preparationsBlocked && stoppedAt.commandsBlocked &&
          stoppedAt.writerStopped
        ) {
          await runStoppedMaintenance({
            dataRoot: root.path,
            ledgerPath,
            conditions: stoppedAt,
            fields: retentionRules(assembled.value.blobFields),
            nowMs: clock.nowMs(),
            timeoutMs: options.maintenanceTimeoutMs,
            run: options.maintenance,
          });
        }
      } finally {
        try {
          await removeRunMetadata(root.run);
        } finally {
          await lock.release();
        }
      }
    },
  };
  const greeted = await hello;
  if (!greeted.ok) {
    await core.shutdown();
    return greeted;
  }
  core.done = parent
    ? watchParent(parent, () => core.shutdown(), {
      confirmation: (body) => runtime!.confirmation(body),
      reply: (message) => writeParent(parent, message),
    })
    : Promise.resolve();
  const accepting = registry as CredentialRegistry & {
    acceptTestCredential?(
      context: AuthenticatedContext,
      token: string,
    ): Promise<Result<void>>;
  };
  if (options.testCredentials && runtime) {
    const noting = runtime;
    core.notePrepared = (prepared, nowMs) =>
      noting.notePrepared(prepared, nowMs);
    core.confirmation = (body) => noting.confirmation(body);
  }
  if (accepting.acceptTestCredential) {
    core.acceptTestCredential = (context, token) =>
      accepting.acceptTestCredential!(context, token);
  }
  return ok(core);
}

async function ledgerIdentity(path: string): Promise<string> {
  const stat = await Deno.stat(path);
  return `${path}:${stat.size}`;
}

function hex(random: RandomSource, bytes: number): string {
  const buffer = new Uint8Array(bytes);
  random.fill(buffer);
  return [...buffer].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function seedOf(random: RandomSource): number {
  const bytes = new Uint8Array(4);
  random.fill(bytes);
  return bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24);
}

// 정지 유지보수 프로세스(platform/blob-store#R8, R9, R10, T44). 파일 작업과
// ledger 읽기는 core graph 밖이다(responsiveness#R1). 세 정지 조건은 종료
// 순서가 실제로 끝난 뒤의 관측값이라 상수 true를 넘기지 않는다. 프로세스가
// 실패하거나 blob_refs를 읽지 못하면 아무것도 지우지 않고(fail-closed), 종료는
// 그대로 끝난다. 실패는 diagnostics 로그만 남긴다.
// 문서에 종료 전체의 시간 예산은 없다. 신뢰 child 정상 정지는 5초지만 유지보수는
// 파일 삭제를 포함하므로 그보다 길게, 디스크가 멈춰도 종료가 끝나도록 30초로 둔다.
const MAINTENANCE_TIMEOUT_MS = 30_000;

async function runStoppedMaintenance(input: {
  dataRoot: string;
  ledgerPath: string;
  conditions: {
    preparationsBlocked: boolean;
    commandsBlocked: boolean;
    writerStopped: boolean;
  };
  fields: ReturnType<typeof retentionRules>;
  nowMs: number;
  timeoutMs?: number;
  // 테스트가 프로세스를 대신한다. 제품 기동은 항상 프로세스를 띄운다.
  run?: () => Promise<void>;
}): Promise<void> {
  const signal = AbortSignal.timeout(input.timeoutMs ?? MAINTENANCE_TIMEOUT_MS);
  if (input.run) {
    try {
      // 제품 경로는 Deno.Command의 signal이 프로세스를 죽인다. 테스트가 주입한
      // 러너는 signal을 모르므로 여기서 같은 시간 제한과 경주한다.
      await Promise.race([
        input.run(),
        new Promise<never>((_resolve, reject) => {
          const fail = () => reject(new Error("maintenance_gc timeout"));
          if (signal.aborted) fail();
          else signal.addEventListener("abort", fail, { once: true });
        }),
      ]);
    } catch {
      await noteMaintenanceFailure(input.dataRoot, signal.aborted);
    }
    return;
  }
  const entry =
    new URL("../worker/platform/maintenance-entry.ts", import.meta.url)
      .pathname;
  let outcome: Deno.CommandOutput;
  try {
    outcome = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        `--allow-read=${input.dataRoot},${repoRoot()},${denoDir()}`,
        `--allow-write=${input.dataRoot}`,
        "--allow-env=LOPHN_HOME,LOPHN_MAINTENANCE,HOME,PATH",
        "--no-prompt",
        entry,
      ],
      stdin: "null",
      stdout: "null",
      stderr: "piped",
      clearEnv: true,
      signal,
      env: {
        ...(Deno.env.get("HOME") ? { HOME: Deno.env.get("HOME")! } : {}),
        ...(Deno.env.get("PATH") ? { PATH: Deno.env.get("PATH")! } : {}),
        LOPHN_HOME: input.dataRoot,
        LOPHN_MAINTENANCE: JSON.stringify({
          ledger: input.ledgerPath,
          conditions: input.conditions,
          fields: input.fields,
          nowMs: input.nowMs,
        }),
      },
    }).output();
  } catch {
    // signal이 시간을 넘기면 Deno가 그 프로세스만 죽이고 output()이 거절된다.
    await noteMaintenanceFailure(input.dataRoot, signal.aborted);
    return;
  }
  if (!outcome.success) await noteMaintenanceFailure(input.dataRoot, false);
}

// 유지보수 실패의 diagnostics 기록. 종료를 막지 않으므로 기록 실패도 삼킨다.
// 원문·경로·hash는 넣지 않고 분류만 남긴다(diagnostics#R5).
async function noteMaintenanceFailure(
  dataRoot: string,
  timedOut = false,
): Promise<void> {
  try {
    const directory = `${dataRoot}/logs`;
    try {
      await Deno.mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    }
    const record = {
      at: new Date().toISOString(),
      component: "platform/core",
      kind: "log",
      code: "lophn_internal",
      error_type: "maintenance_gc",
      location: "apps/core/core.ts",
      message: timedOut
        ? "maintenance_gc timeout"
        : "Stopped maintenance did not run.",
    };
    await Deno.writeTextFile(
      `${directory}/maintenance.jsonl`,
      JSON.stringify(record) + "\n",
      { append: true },
    );
  } catch {
    // 기록하지 못해도 종료는 그대로 끝난다.
  }
}

// 문서 worker route를 서빙하는 reader 등록은 팀 module 목록과 무관하게 붙는다.
function withDocumentsReader(modules: readonly string[]): string[] {
  const reader = new URL("./documents-reader.ts", import.meta.url).href;
  return modules.includes(reader) ? [...modules] : [...modules, reader];
}

// 활성 tracking root 변화 확인 주기. root 변경은 드물어서 짧은 read 하나면 된다.
const DOCUMENTS_ROOTS_INTERVAL_MS = 2_000;

// tracking root 읽기의 자격. machine만 읽는 project.tracking_roots를 core가 직접 읽는다.
// ledger credential 기록이 아니라 reader에 넘기는 context라, 발급 자격이 아니다.
const trackingReader: RequestContext = {
  principal: "machine:documents-roots",
  actor: "machine",
  scope: { operations: [projectTrackingRoots.name], targets: {} },
  conditions: {},
  credential_ref: "machine:documents-roots",
};

function repoRoot(): string {
  return new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
}

function denoDir(): string {
  const home = Deno.env.get("HOME");
  return home ? `${home}/.cache/deno` : "/tmp";
}

// platform/io는 diagnostics 입구다. 데이터 root만 읽고 네트워크는 열지 않는다.
// sys의 statfs는 blob 준비 전의 실제 디스크 여유 관측(R12)에만 쓴다. node:fs statfs는
// Deno에서 sys 권한을 요구하고 가장 좁은 값은 --allow-sys=statfs다(실측). run은 열지 않는다.
function platformIoSpec(dataRoot: string): KindLaunchSpec {
  return {
    kind: "platform/io",
    entry: new URL("./io-entry.ts", import.meta.url).pathname,
    // 데이터 root 밖은 코드와 deno 캐시만 읽는다. 쓰기는 데이터 root뿐이다.
    allow_read: [dataRoot, repoRoot(), denoDir()],
    allow_write: [dataRoot],
    allow_net: [],
    allow_run: [],
    allow_sys: ["statfs"],
    allow_env: ["LOPHN_HOME", "LOPHN_WORKER_KIND", "HOME", "PATH"],
    policy: "always",
    memory_limit_bytes: 256 * 1024 * 1024,
  };
}

// Q6 바이트 흐름. core가 relay를 만들어 I/O worker의 callback으로 넣는다.
// 준비 성공은 writer 메모리에도 알려 등록 판정이 같은 참조를 보게 한다.
// 바이트는 core가 열지 않는다. I/O worker의 blob.read가 읽고 core는 결과만 받는다.
function blobReadDeps(
  assembled: { blobFields?: readonly BlobFieldDefinition[] },
): {
  deps: {
    fields: readonly BlobFieldDefinition[];
    read(
      hash: string,
      offset: number,
      length: number,
    ): Promise<Result<{ hash: string; sizeBytes: number; bytes: Uint8Array }>>;
  };
  use(
    read: (
      hash: string,
      offset: number,
      length: number,
    ) => Promise<
      Result<{ hash: string; sizeBytes: number; bytes: Uint8Array }>
    >,
  ): void;
} {
  const reader: {
    current?: (
      hash: string,
      offset: number,
      length: number,
    ) => Promise<
      Result<{ hash: string; sizeBytes: number; bytes: Uint8Array }>
    >;
  } = {};
  return {
    deps: {
      fields: assembled.blobFields ?? [],
      read(hash, offset, length) {
        const current = reader.current;
        if (!current) {
          return Promise.resolve(err({
            code: "unavailable",
            message: "blob 읽기 통로가 없다",
          }));
        }
        return current(hash, offset, length).catch(() =>
          err({ code: "unavailable", message: "blob을 읽지 못했다" })
        );
      },
    },
    use(read) {
      reader.current = read;
    },
  };
}

function blobRelayFor(
  io: ReturnType<typeof createSupervisor>,
  clock: Clock,
  note: (
    prepared: PreparedRelayResult,
    nowMs: number,
  ) => Promise<Result<void>>,
  gauge: BufferGauge,
): {
  callbacks: {
    onMessage(message: ChildMessage): void;
    onFrame(frame: Frame): void;
  };
  prune(nowMs: number): void;
  prepare(call: BlobPrepareCall): Promise<Result<PreparedRelayResult>>;
  readBytes: BlobPrepareRelay["readBytes"];
} {
  const registry = createPreparationRegistry();
  const relay = createBlobPrepareRelay({
    // 해석·hash 없이 I/O worker로 넘긴다(Q6). worker가 준 credit 안에서만 보내고,
    // frame writer가 pipe backpressure를 지킨다.
    send: async (payload) => {
      const sent = await io.send("platform/io", payload);
      if (!sent.ok) throw new Error("blob 준비를 넘기지 못했다");
    },
    sendBytes: async (channel, chunk) => {
      const sent = await io.sendBytes("platform/io", channel, chunk);
      if (!sent.ok) throw new Error("blob 바이트를 넘기지 못했다");
    },
    sendEnd: async (channel) => {
      const sent = await io.sendEnd("platform/io", channel);
      if (!sent.ok) throw new Error("blob 끝을 넘기지 못했다");
    },
    sendAbort: async (channel) => {
      const sent = await io.sendAbort("platform/io", channel);
      if (!sent.ok) throw new Error("blob 중단을 넘기지 못했다");
    },
    registry,
    nowMs: () => clock.nowMs(),
    note,
    gauge,
  });
  return {
    callbacks: {
      // worker_response와 credit은 중계가 요청 id·channel로 맞춘다.
      onMessage(message) {
        relay.accept(message);
      },
      // worker가 돌려준 읽기 바이트는 JSON이 아니라 byte chunk frame이다.
      onFrame(frame) {
        relay.take(frame);
      },
    },
    prune: (nowMs) => relay.prune(nowMs),
    prepare: (call) =>
      relay.prepare(
        {
          principal: call.principal,
          purpose: call.purpose,
          expectedHash: call.expectedHash,
        },
        call.bytes,
      ).catch(() =>
        err({ code: "unavailable", message: "blob 준비를 넘기지 못했다" })
      ),
    readBytes: (hash, offset, length) => relay.readBytes(hash, offset, length),
  };
}

function startPlatformIo(
  io: ReturnType<typeof createSupervisor>,
  dataRoot: string,
  epoch: string,
  port: number,
  // blob 준비 중계. worker_response와 byte chunk 소비를 묶는다(Q6).
  blob?: {
    onMessage(message: ChildMessage): void;
    onFrame(frame: Frame): void;
  },
): Promise<Result<void>> {
  return io.start(
    platformIoSpec(dataRoot),
    {
      type: "hello",
      core_epoch: epoch,
      process_identity: epoch,
      kind: "platform/io",
      task: "diagnostics",
      scope: { operations: [], targets: {} },
      credential: "platform-io",
      api_port: port,
    },
    blob ?? {
      // platform/io 응답은 core가 아직 소비하지 않는다. 감독과 상태만 본다.
      onMessage() {},
    },
  ).then((started) =>
    started.ok ? ok(undefined) : err({
      code: started.code,
      message: "platform/io worker를 시작하지 못했다",
    })
  );
}

// document.prepare worker route. blob 중계가 뜨면 준비된다. format 검사와 기준 판
// 읽기는 그 소유 연결이 아직 없어 unavailable로 답한다. 목록 hash와 blob은 같은
// stream에서 만든다.
// 제품 route와 테스트 seam route를 한 map으로 모은다. 같은 key는 나중 것이 이긴다.
function mergedWorkers(
  base: ReadonlyMap<string, WorkerRouteTarget>,
  extra: ReadonlyMap<string, WorkerRouteTarget> | undefined,
): ReadonlyMap<string, WorkerRouteTarget> {
  return new Map([...base, ...(extra ?? [])]);
}

function documentPrepareWorkers(
  relay: {
    current?: (call: BlobPrepareCall) => Promise<Result<PreparedRelayResult>>;
  },
  loadBaseVersion: BaseVersionFor,
): ReadonlyMap<string, WorkerRouteTarget> {
  const route = documentPrepareRoute({
    sink: () =>
      relaySink((bytes) => {
        const prepare = relay.current;
        if (!prepare) {
          return Promise.resolve(err({
            code: "unavailable",
            message: "blob 준비 중계가 아직 없다",
          }));
        }
        return prepare({
          principal: "machine",
          purpose: "document_files",
          bytes,
        });
      }),
    available: () => relay.current !== undefined,
    observedAt: () => new Date().toISOString(),
    // format 검사는 coordinator의 format runner가 한다. 원문 바이트를 core에서
    // coordinator로 보내는 길(blob 읽기를 child에 여는 platform 통로)이 아직 없다.
    validateFiles: () =>
      Promise.resolve(err({
        code: "unavailable",
        message: "format 검사 통로가 아직 연결되지 않았다",
      })),
    loadBaseVersion,
  });
  return new Map([[route.key, { handle: route.handle }]]);
}

// 기준 판 읽기. 요청 credential의 현재 context로 reader Worker의 snapshot을 읽는다.
function baseVersionRead(runtime: CoreRuntime): BaseVersionFor {
  return async (version, from) => {
    const slash = from.request_id.lastIndexOf("/");
    const ref = slash > 0 ? from.request_id.slice(0, slash) : undefined;
    const ctx = ref === undefined ? undefined : runtime.current(ref);
    if (!ctx?.ok) {
      return err({ code: "unauthorized", message: "credential이 없다" });
    }
    const read = await runtime.readers.read(PREPARE_BASE_ROUTE, ctx.value, {
      document: from.document,
      version,
    });
    if (!read.ok) return read;
    return ok(
      (read.value as { version: VersionRow | null }).version,
    );
  };
}

function ioComponent(
  io: ReturnType<typeof createSupervisor> | undefined,
): { available: boolean; reason?: string } {
  if (!io) return { available: false, reason: "I/O worker 감독이 없다" };
  const observed = io.observation("platform/io");
  return observed.available
    ? { available: true }
    : { available: false, reason: observed.reason ?? "platform/io가 없다" };
}
