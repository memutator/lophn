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
import {
  type ApiServer,
  startApiServer,
} from "../../packages/platform/api/mod.ts";
import { applyMigrations } from "../../packages/platform/backup-and-migration/mod.ts";
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
import { CREDENTIAL_SCHEMA } from "./credentials.ts";
import { greet, type ParentPipe, watchParent, writeParent } from "./parent.ts";
import { assemble, type TeamModule } from "./registration.ts";
import { type CoreRuntime, openRuntime } from "./runtime.ts";
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
  random?: RandomSource;
  // Electron main이 물려 준 stdin/stdout. 테스트가 파이프를 끼운다.
  parent?: ParentPipe;
  // I/O worker 감독. 없으면 core가 platform/io를 직접 감독한다.
  supervise?: (workers: readonly KindLaunchSpec[]) => Promise<void>;
  // 테스트가 child를 띄우지 않을 때만 끈다. 제품 기동은 항상 감독한다.
  superviseIo?: boolean;
  // 테스트 harness만 true로 둔다. main.ts는 이 입구를 열지 않는다.
  testCredentials?: boolean;
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
  // testCredentials일 때만 있다. 제품 발급이 막는 actor의 테스트 기록이다.
  acceptTestCredential?(
    context: AuthenticatedContext,
    token: string,
  ): Promise<Result<void>>;
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
  const ledgerPath = `${root.path}/lophn.db`;
  const migrated = await applyMigrations(
    ledgerPath,
    [
      ...LEDGER_SCHEMA_STEPS,
      CREDENTIAL_SCHEMA,
      ...assembled.value.schemaSteps,
    ],
    { clock },
  );
  if (!migrated.ok) return migrated;
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
    env: (kind) => ({ LOPHN_WORKER_KIND: kind, LOPHN_HOME: root.path }),
  });
  let ready = false;
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
  const openedRuntime = await openRuntime({
    ledgerPath,
    clock,
    nowMs: clock.nowMs(),
    seed: seedOf(random),
    modules: options.teamModules ?? [],
    assembled: assembled.value,
    source,
  });
  if (!openedRuntime.ok) return openedRuntime;
  runtime = openedRuntime.value;
  let server: ApiServer;
  try {
    server = await startApiServer({
      port: options.port,
      credentials: registry,
      clock,
      writer: runtime.writer,
      reads: runtime.reads,
      events: runtime.events,
      subscriptions: runtime.subscriptions,
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
  const startedIo = io
    ? await startPlatformIo(io, root.path, epoch, server.port)
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
    async shutdown() {
      if (stopped) return;
      stopped = true;
      // 새 입장을 먼저 닫는다. 이미 입장한 command는 writer가 확정 또는 실패로 마친다.
      ready = false;
      await server.stop();
      if (io) await io.stopAll();
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
function platformIoSpec(dataRoot: string): KindLaunchSpec {
  return {
    kind: "platform/io",
    entry: new URL("./io-entry.ts", import.meta.url).pathname,
    allow_read: [dataRoot],
    allow_write: [dataRoot],
    allow_net: [],
    allow_run: [],
    allow_env: ["LOPHN_HOME", "LOPHN_WORKER_KIND"],
    policy: "always",
    memory_limit_bytes: 256 * 1024 * 1024,
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

function ioComponent(
  io: ReturnType<typeof createSupervisor> | undefined,
): { available: boolean; reason?: string } {
  if (!io) return { available: false, reason: "I/O worker 감독이 없다" };
  const observed = io.observation("platform/io");
  return observed.available
    ? { available: true }
    : { available: false, reason: observed.reason ?? "platform/io가 없다" };
}
