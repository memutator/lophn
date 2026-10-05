import { systemClock } from "../../packages/base/clock.ts";
import { cryptoRandom } from "../../packages/base/random.ts";
import type { Clock, RandomSource, Result } from "../../packages/base/mod.ts";
import { err, ok } from "../../packages/base/mod.ts";
import type {
  AuthenticatedContext,
  ChildMessage,
  Frame,
  KindLaunchSpec,
} from "../../packages/contracts/platform/mod.ts";
import { ROUTES } from "../../packages/contracts/platform/mod.ts";
import {
  type ApiServer,
  RouteRegistry,
  startApiServer,
} from "../../packages/platform/api/mod.ts";
import {
  applyMigrations,
  checkRestart,
} from "../../packages/platform/backup-and-migration/mod.ts";
import { type StatusSource } from "../../packages/platform/diagnostics/mod.ts";
import { CredentialRegistry } from "../../packages/platform/identity/mod.ts";
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
import {
  type BlobPrepareRelay,
  createBlobPrepareRelay,
  type PreparedRelayResult,
} from "./blob-prepare.ts";
import { createPreparationRegistry } from "../../packages/platform/blob-store/mod.ts";
import type { BlobFieldDefinition } from "../../packages/contracts/platform/mod.ts";
import { CREDENTIAL_SCHEMA } from "./credentials.ts";
import { documentPrepareRoute, relaySink } from "./documents-prepare.ts";
import type { WorkerRouteTarget } from "../../packages/platform/responsiveness/mod.ts";
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
  const assembled = assemble(options.teams);
  if (!assembled.ok) return assembled;
  // HTTP route는 writer·reader가 받는 command·read와 같은 조립에서 온다.
  // platform 기본 route와 팀 route의 resource/method가 겹치면 기동을 거절한다.
  let routes: RouteRegistry;
  try {
    routes = new RouteRegistry([...ROUTES, ...assembled.value.routes]);
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
    modules: options.teamModules ?? [],
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
      workers: documentPrepareWorkers(prepareRelay),
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
  const blobRelay = io
    ? blobRelayFor(
      io,
      clock,
      (prepared, nowMs) => runtime.notePrepared(prepared, nowMs),
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
    prepareBlob: (call) =>
      blobRelay ? blobRelay.prepare(call) : Promise.resolve(err({
        code: "unavailable",
        message: "blob 준비 통로가 없다",
      })),
    async shutdown() {
      if (stopped) return;
      stopped = true;
      // 새 입장을 먼저 닫는다. 이미 입장한 command는 writer가 확정 또는 실패로 마친다.
      ready = false;
      // main 연결이 끊기면 그 main의 relay 값을 모두 disconnected로 바꾼다(T57).
      runtime?.memory.disconnect();
      await server.stop();
      if (io) await io.stopAll();
      stopPrune.run?.();
      await runtime?.close();
      await removeRunMetadata(root.run);
      await lock.release();
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

// ledger 파일을 다시 열지 않고 경로와 크기로만 식별한다. 내용은 읽지 않는다.
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

// platform/io는 diagnostics 입구다. 데이터 root만 읽고 네트워크는 열지 않는다.
// sys의 statfs는 blob 준비 전의 실제 디스크 여유 관측(R12)에만 쓴다. node:fs statfs는
// Deno에서 sys 권한을 요구하고 가장 좁은 값은 --allow-sys=statfs다(실측). run은 열지 않는다.
function repoRoot(): string {
  return new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
}

function denoDir(): string {
  const home = Deno.env.get("HOME");
  return home ? `${home}/.cache/deno` : "/tmp";
}

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
  const responses: { queue: Map<string, unknown> } = { queue: new Map() };
  const relay = createBlobPrepareRelay({
    // 해석·hash 없이 I/O worker로 넘긴다(Q6). backpressure는 frame writer가 지킨다.
    send: async (payload) => {
      const sent = await io.send("platform/io", payload);
      if (!sent.ok) throw new Error("blob 준비를 넘기지 못했다");
    },
    sendBytes: async (channel, chunk) => {
      const sent = await io.sendBytes("platform/io", channel, chunk);
      if (!sent.ok) throw new Error("blob 바이트를 넘기지 못했다");
    },
    responses,
    registry,
    nowMs: () => clock.nowMs(),
    note,
  });
  return {
    callbacks: {
      onMessage(message) {
        if (message.type !== "worker_response") return;
        const response = message as unknown as {
          request_id: string;
          ok: boolean;
          payload?: PreparedRelayResult;
          error?: { code: string; message: string };
        };
        // 등록은 prepare()가 응답을 받은 뒤 한다. 여기서 다시 하면 같은 키가 conflict다.
        responses.queue.set(response.request_id, response);
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
function documentPrepareWorkers(
  relay: {
    current?: (call: BlobPrepareCall) => Promise<Result<PreparedRelayResult>>;
  },
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
    validateFiles: () =>
      Promise.resolve(err({
        code: "unavailable",
        message: "format 검사가 아직 연결되지 않았다",
      })),
    loadBaseVersion: () =>
      Promise.resolve(err({
        code: "unavailable",
        message: "기준 판 읽기가 아직 연결되지 않았다",
      })),
  });
  return new Map([[route.key, { handle: route.handle }]]);
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
