import { stat } from "node:fs/promises";
import process from "node:process";
import { systemClock } from "../../../base/clock.ts";
import { cryptoRandom } from "../../../base/random.ts";
import type { Clock, RandomSource, Result } from "../../../base/mod.ts";
import { err, ok } from "../../../base/mod.ts";
import { ROUTES } from "../../../protocol/registry.ts";
import type { Route } from "../../../protocol/base/mod.ts";
import {
  type ApiServer,
  RouteRegistry,
  startApiServer,
  WORKSPACE_MEMORY_ROUTES,
} from "../../server/mod.ts";
import {
  applyDataSteps,
  applyMigrations,
  checkRestart,
  ensureLedgerId,
} from "../../storage/migration/mod.ts";
import {
  acquireInstanceLock,
  type DataRoot,
  type InstanceLock,
  removeRunMetadata,
  resolveDataRoot,
  writeRunMetadata,
} from "../../install-and-update/mod.ts";
import {
  removeUserToken,
  writeUserToken,
} from "../../install-and-update/run-metadata.ts";
import {
  CRASH_LOCATIONS,
  createHealth,
  createTelemetry,
  type Health,
  installSnapshotSignal,
  readTelemetryConfig,
  type Telemetry,
  tracedCall,
} from "../../diagnostics/mod.ts";
import { describeThrown } from "../../../base/telemetry/mod.ts";
import { assemble } from "./registration.ts";
import type { TeamModule } from "../../storage/ledger/team-module.ts";
import { openRuntime } from "./runtime.ts";
import {
  greet,
  type ParentPipe,
  shellViewLog,
  watchParent,
  writeParent,
} from "./parent.ts";
import {
  type Built,
  createWiringContext,
  type StoppedConditions,
  type WiringFactory,
} from "./wiring/context.ts";

// 시작 순서: lock → schema step → writer·reader → API → I/O worker 감독 → worker들. 단계마다 wiring의
// hook을 WIRINGS 순서로 부른다(hook 순서는 wiring/context.ts에 적혀 있다).
export type CoreOptions = {
  // 없으면 프로세스 환경의 LOPHN_HOME, 그것도 없으면 ~/.lophn.
  lophnHome?: string;
  home?: string;
  // 0이면 빈 port. 기본은 7431.
  port?: number;
  teams: readonly TeamModule[];
  // writer·reader가 다시 import할 등록 파일.
  teamModules: readonly string[];
  // module마다의 wiring. core 한 번의 기동마다 만든다(assembly.ts의 WIRINGS).
  wirings: readonly WiringFactory[];
  clock?: Clock;
  random?: RandomSource;
  // 없으면 process env(LOPHN_TELEMETRY 등)로 만들고 stderr에 쓴다.
  telemetry?: Telemetry;
  // Electron main이 물려 준 stdin/stdout.
  parent?: ParentPipe;
};

type Core = {
  port: number;
  epoch: string;
  dataRoot: string;
  // 부모 pipe의 종료 감시가 끝나면 resolve된다. 부모가 없으면 이미 끝난 상태다.
  done: Promise<void>;
  // 새 command 입장을 닫고 연 것을 정리한 뒤 lock을 푼다.
  shutdown(): Promise<void>;
};

export async function startCore(options: CoreOptions): Promise<Result<Core>> {
  const clock = options.clock ?? systemClock;
  const random = options.random ?? cryptoRandom;
  const telemetry = options.telemetry ?? telemetryFromEnv(clock, random);
  const root = await resolveDataRoot({
    lophnHome: options.lophnHome ?? process.env.LOPHN_HOME ?? undefined,
    home: options.home ?? process.env.HOME ?? undefined,
  });
  if (!root.ok) return root;
  const locked = await acquireInstanceLock(root.value.run);
  if (!locked.ok) return locked;
  // 앞 core의 token은 이미 무효다. 남은 file이 있으면 CLI가 lophn이 켜져 있다고 본다.
  // lock을 잡은 뒤에 지워야 이미 도는 core의 file을 지우지 않는다.
  await removeUserToken(root.value.run);

  const opened = await open(
    options,
    root.value,
    locked.value,
    clock,
    random,
    telemetry,
  );
  if (!opened.ok) {
    // 기동이 실패하면 위치 metadata와 user token을 남기지 않고 lock을 푼다.
    await removeRunMetadata(root.value.run);
    await removeUserToken(root.value.run);
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
  telemetry: Telemetry,
): Promise<Result<Core>> {
  const ledgerPath = `${root.path}/lophn.db`;
  const wirings = options.wirings.map((make) => make());
  const ctx = createWiringContext({
    options,
    clock,
    random,
    root,
    ledgerPath,
    telemetry,
  });

  // wiring이 넘긴 환경은 팀 조립과 platform 조립이 같이 읽는다. 각자 자기 key만 읽는다.
  const environment = Object.assign(
    {},
    ...wirings.map((wiring) => wiring.environment?.(ctx)),
  );
  const assembled = assemble(options.teams, environment);
  if (!assembled.ok) return assembled;
  ctx.provide("assembled", assembled.value);
  // HTTP route는 writer·reader가 받는 command·read와 같은 조립에서 온다.
  // platform 기본 route와 팀 route의 resource/method가 겹치면 기동을 거절한다.
  const allRoutes = [
    ...ROUTES,
    ...WORKSPACE_MEMORY_ROUTES,
    ...assembled.value.routes,
  ];
  ctx.provide("allRoutes", allRoutes);
  let routes: RouteRegistry;
  try {
    routes = new RouteRegistry(allRoutes);
  } catch {
    return err({ code: "internal", message: "route 등록이 겹친다" });
  }

  // ledger를 새로 만드는 기동인지는 migration이 파일을 만들기 전에 본다(ledger_id는
  // ledger를 만들거나 복원할 때마다 새 값이다).
  const ledgerExisted = await fileExists(ledgerPath);
  // schema step의 순서가 이력이다: wiring 앞 몫(ledger, credential) → 팀 → wiring 뒤 몫(settings, secret).
  const schemaSteps = [
    ...wirings.flatMap((wiring) => wiring.schemaSteps ?? []),
    ...assembled.value.schemaSteps,
    ...wirings.flatMap((wiring) => wiring.schemaStepsAfterTeams ?? []),
  ];
  ctx.provide("schemaSteps", schemaSteps);
  const migrated = await applyMigrations(ledgerPath, schemaSteps, {
    clock,
    recovery: { root: root.path },
  });
  if (!migrated.ok) return migrated;
  ctx.provide("migrationsApplied", migrated.value);
  // ledger 밖 파일은 ledger 뒤에 옮긴다. ledger가 거절한 판(더 새 판, 다른 내용)은 파일도 건드리지 않는다.
  const files = await applyDataSteps(
    root.path,
    wirings.flatMap((wiring) => wiring.dataSteps ?? []),
    !ledgerExisted,
  );
  if (!files.ok) return files;
  const ledgerId = await ensureLedgerId(root.path, ledgerExisted);
  if (!ledgerId.ok) return ledgerId;
  ctx.provide("ledgerId", ledgerId.value);
  // 중단 작업 점검 → cursor 복원 순서다. SQLite 복구·schema 점검 뒤
  // 정상 read를 열고 전체 scan·index·큰 hash를 기다리지 않는다. 소유
  // concern의 복구 command가 아직 없는 영역은 unknown 관측값과 근거를 남기고
  // 읽기 열기를 막지 않는다. 점검 관측은 status에 더하지 않는다: 상태는
  // 구성 요소 관측이고 소유 concern 관측은 복구 command로 남는다.
  const restart = await checkRestart(ledgerPath, {
    clock,
    owners: wirings.flatMap((wiring) => wiring.restartOwners ?? []),
  });
  if (!restart.ok) return restart;
  const epoch = hex(random, 16);
  ctx.provide("epoch", epoch);
  const operations = [];
  for (const wiring of wirings) {
    operations.push(...((await wiring.operations?.(ctx)) ?? []));
  }
  ctx.provide("operations", operations);
  for (const wiring of wirings) wiring.prepare?.(ctx);

  const openedRuntime = await openRuntime({
    ledgerPath,
    clock,
    seed: seedOf(random),
    modules: options.teamModules,
    assembled: assembled.value,
    source: ctx.statusSource,
    blob: ctx.blobRead.deps,
    logger: telemetry.logger,
  });
  if (!openedRuntime.ok) return openedRuntime;
  const runtime = openedRuntime.value;
  // writer command 하나, reader read 하나가 span이다. API의 server span 아래로 이어진다.
  const writerCommand = runtime.writer.command.bind(runtime.writer);
  runtime.writer.command = tracedCall(
    telemetry.tracer,
    "ledger.command",
    (_ctx, envelope) => ({
      "db.system.name": "sqlite",
      "db.operation.name": "command",
      "lophn.command": envelope.command,
    }),
    writerCommand,
  );
  const readerRead = runtime.readers.read.bind(runtime.readers);
  runtime.readers.read = tracedCall(
    telemetry.tracer,
    "ledger.read",
    (route) => ({
      "db.system.name": "sqlite",
      "db.operation.name": "read",
      "lophn.read": `${route.resource}/${route.method}`,
    }),
    readerRead,
  );
  ctx.provide("runtime", runtime);
  // API 직전에 만들고 ready 뒤에 신호를 건다. 그 앞에서 기동이 실패해도 남는 timer·listener가 없다.
  let health: Health | undefined;
  let uninstallSnapshot = () => {};

  // 종료 순서: 새 command·prepare 입장 닫기(ready = false) → 구독·감시·worker 통로
  // 정리(closeIntake) → server.stop() → closeChildren(앱 제어) → 앱 supervisor 정지 → io 정지 →
  // closeWork(timer·bootstrap) → runtime.close() → 유지보수(stopped) → run metadata와 user token file 지우기,
  // lock 풀기. 정지 유지보수는 세 조건이 실제로 끝난 뒤에만 돈다. 앞 단계가 예외를 던져도 metadata
  // 정리와 lock 해제는 그대로 실행한다.
  let shutdownRun: Promise<void> | undefined;
  const shutdown = () => {
    // 같은 시각의 두 종료 요청도 실제 종료가 끝날 때까지 같은 barrier를 기다린다.
    return (shutdownRun ??= (async () => {
      if (ctx.stopped) return;
      ctx.stopped = true;
      const stoppedAt: StoppedConditions = {
        preparationsBlocked: false,
        commandsBlocked: false,
        writerStopped: false,
      };
      try {
        // 새 입장을 먼저 닫는다. 이미 입장한 command는 writer가 확정 또는 실패로 마친다.
        ctx.ready = false;
        for (const wiring of wirings) await wiring.closeIntake?.();
        // main 연결이 끊기면 그 main의 relay 값을 모두 disconnected로 바꾼다.
        runtime.memory.disconnect();
        // server.stop은 받은 요청이 끝나기를 기다린 뒤 listen을 닫는다. 그 뒤에야
        // 새 command 입장이 실제로 닫힌 것이다.
        await ctx.server.stop();
        stoppedAt.commandsBlocked = ctx.ready === false;
        for (const wiring of wirings) await wiring.closeChildren?.();
        // 앱 supervisor가 먼저 앱 자식을 정지한다.
        const appsStopped = await ctx.appsSupervision.stopAll();
        // stop 요청과 실제 정지 확인은 다르다. unconfirmed이면 update barrier와
        // 정지 유지보수는 fail-closed로 남긴다.
        const ioStopped = await ctx.io.stopAll();
        stoppedAt.preparationsBlocked = appsStopped && ioStopped;
        for (const wiring of wirings) await wiring.closeWork?.();
        // writer Worker와 reader 연결을 닫는다. close가 돌아온 뒤에야 writer가 멈춘 것이다.
        await runtime.close();
        stoppedAt.writerStopped = true;
        for (const wiring of wirings) {
          if ((await wiring.stopped?.(ctx, stoppedAt)) === "handled") break;
        }
      } finally {
        uninstallSnapshot();
        health?.close();
        try {
          await removeRunMetadata(root.run);
        } finally {
          try {
            await removeUserToken(root.run);
          } finally {
            try {
              await lock.release();
            } finally {
              telemetry.logger.info({ component: "core", event: "stopped" });
              await telemetry.shutdown();
            }
          }
        }
      }
    })());
  };
  ctx.provide("shutdown", shutdown);

  // sweep나 recovery가 쓰는 core 내부 machine 자격을 ledger에 기록한다. 기록이 없으면 writer가 그 자격의
  // command를 거절하므로 기동을 여기서 멈춘다.
  for (const wiring of wirings) {
    for (const context of wiring.records?.(ctx) ?? []) {
      const recorded = await runtime.record(context);
      if (!recorded.ok) {
        await runtime.close();
        return recorded;
      }
    }
  }
  const builts: Built[] = [];
  for (const wiring of wirings) {
    if (wiring.build === undefined) continue;
    const built = await wiring.build(ctx);
    if (!built.ok) {
      await runtime.close();
      return built;
    }
    builts.push(built.value);
  }
  for (const built of builts) built.reads?.(runtime.reads);
  const merged = <T>(
    pick: (built: Built) => Iterable<readonly [string, T]> | undefined,
  ) => new Map(builts.flatMap((built) => [...(pick(built) ?? [])]));
  // 쓰기 앞 처리기는 안쪽에서 바깥으로 접는다(앞 wiring이 안쪽이다). API server와 core 안 호출이 같은 것을 쓴다.
  ctx.provide(
    "writer",
    builts.reduce(
      (inner, built) => (built.writer ? built.writer(inner) : inner),
      runtime.writer,
    ),
  );
  const memory = new Map([
    ...runtime.memory.handlers,
    ...merged((built) => built.memory),
  ]);
  // memory route는 등록(팀 registration)과 handler(wiring)가 따로 붙는다. 한쪽만 있으면 그 route가 늘
  // not_found나 unavailable로 끝나는데 check와 기동은 통과했다. 그렇게 여러 번 빠졌다.
  const unmatched = memoryRouteMismatch(allRoutes, memory);
  if (unmatched.length > 0) {
    await runtime.close();
    return err({
      code: "internal",
      message: `memory route와 handler가 맞지 않는다: ${unmatched.join(", ")}`,
    });
  }
  health = createHealth({
    service: SERVICE_NAME,
    clock,
    ready: () => ctx.ready,
    checks: () => ctx.componentChecks,
    readers: () => runtime.readers.health(),
  });
  let server: ApiServer;
  try {
    server = await startApiServer({
      port: options.port,
      credentials: ctx.registry,
      clock,
      writer: ctx.writer,
      reads: runtime.reads,
      memory,
      bus: ctx.bus,
      gateway: ctx.gateway,
      // command·read·file·worker route는 같은 조립에서 온다. platform 기본 route와
      // 팀 route의 resource/method가 겹치면 RouteRegistry가 거절한다.
      registry: routes,
      // 바이트 body route. 제출 파일은 blob 준비 중계로 바로 흐른다.
      uploads: merged((built) => built.uploads),
      // 큰 파일을 core 메모리에 모으지 않고 창 단위로 흘리는 file route.
      fileStreams: merged((built) => built.fileStreams),
      logger: telemetry.logger,
      telemetry,
      health,
    });
  } catch {
    health.close();
    await runtime.close();
    return err({ code: "unavailable", message: "API를 열 수 없다" });
  }
  ctx.provide("server", server);
  const recorded = await writeRunMetadata(root.run, {
    apiPort: server.port,
    coreEpoch: epoch,
    startedAt: clock.now(),
  });
  if (!recorded.ok) {
    health.close();
    await server.stop();
    await runtime.close();
    return recorded;
  }
  for (const wiring of wirings) {
    const started = await wiring.start?.(ctx);
    if (started !== undefined && !started.ok) {
      health.close();
      await server.stop();
      await runtime.close();
      return started;
    }
  }
  ctx.ready = true;
  // `kill -USR2 <pid>`가 <data root>/diagnostics/에 자원 요약과 CPU profile을 남긴다.
  uninstallSnapshot = installSnapshotSignal({
    dir: `${root.path}/diagnostics`,
    clock,
    heap: process.env.LOPHN_HEAP_SNAPSHOT === "1",
    done: (paths) =>
      telemetry.logger.info({
        component: "diagnostics",
        event: "snapshot_written",
        fields: {
          files: paths.map((path) => path.slice(root.path.length + 1)),
        },
      }),
    failed: (thrown) =>
      telemetry.logger.error({
        component: "diagnostics",
        event: "snapshot_failed",
        fields: describeThrown(thrown),
      }),
  });
  for (const wiring of wirings) await wiring.afterReady?.(ctx);

  // 부모 pipe는 호출자가 명시할 때만 연다. 터미널에서 직접 띄우면 종료는 신호가 담당한다.
  const parent = options.parent;
  const hello = parent
    ? greet(
        parent,
        ctx.registry,
        runtime,
        server.port,
        epoch,
        (scope) => ctx.registry.issue(scope),
        (token) => writeUserToken(root.run, token),
        allRoutes,
        ctx.eventNames,
      )
    : Promise.resolve(ok(undefined));
  const core: Core = {
    port: server.port,
    epoch,
    dataRoot: root.path,
    done: Promise.resolve(),
    shutdown,
  };
  const greeted = await hello;
  if (!greeted.ok) {
    await core.shutdown();
    return greeted;
  }
  core.done = parent
    ? watchParent(
        parent,
        () => core.shutdown(),
        {
          confirmation: (body) => runtime.confirmation(body),
          reply: (message) => writeParent(parent, message),
        },
        {
          ...shellViewLog(root.path),
          // 보내는 쪽 값을 믿지 않고 core가 component·location을 정한다.
          internal: (diagnostic) =>
            void ctx
              .diagnosticsWrite({
                ...diagnostic,
                payload: {
                  ...diagnostic.payload,
                  component: "platform/shell-main",
                  location: CRASH_LOCATIONS.shellMain,
                },
              })
              .catch(() => {}),
        },
      )
    : Promise.resolve();
  telemetry.logger.info({
    component: "core",
    event: "started",
    fields: {
      port: server.port,
      telemetry: telemetry.config.mode,
      pid: process.pid,
    },
  });
  return ok(core);
}

const SERVICE_NAME = "lophn-core";

function telemetryFromEnv(clock: Clock, random: RandomSource): Telemetry {
  const { config, problems } = readTelemetryConfig(process.env);
  const telemetry = createTelemetry({
    service: SERVICE_NAME,
    clock,
    random,
    config,
    write: (line) => void process.stderr.write(`${line}\n`),
  });
  for (const problem of problems) {
    telemetry.logger.warn({
      component: "telemetry",
      event: "config_ignored",
      message: problem,
    });
  }
  return telemetry;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
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

function memoryRouteMismatch(
  routes: readonly Route[],
  handlers: ReadonlyMap<string, unknown>,
): string[] {
  const registered = new Set(
    routes
      .filter((route) => route.kind === "memory")
      .map((route) => `${route.resource}/${route.method}`),
  );
  return [
    ...[...registered].filter((key) => !handlers.has(key)),
    ...[...handlers.keys()].filter((key) => !registered.has(key)),
  ];
}
