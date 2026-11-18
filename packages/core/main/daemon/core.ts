import { execFile } from "node:child_process";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import process from "node:process";
import { systemClock } from "../../../base/clock.ts";
import { cryptoRandom } from "../../../base/random.ts";
import type { Clock, RandomSource, Result } from "../../../base/mod.ts";
import {
  createIdSource,
  err,
  errorCode,
  homeOf,
  ok,
} from "../../../base/mod.ts";
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
import { ensureMachine, readOsMachineId } from "../../machine/mod.ts";
import {
  acquireInstanceLock,
  type DataRoot,
  type InstanceLock,
  resolveDataRoot,
} from "../../install-and-update/mod.ts";
import {
  createHealth,
  createLogFiles,
  createLogRecorder,
  createTelemetry,
  type Health,
  installSnapshotSignal,
  type LogRecorder,
  readTelemetryConfig,
  type Telemetry,
  tracedCall,
} from "../../diagnostics/mod.ts";
import { describeThrown } from "../../../base/telemetry/mod.ts";
import { createShellCapabilities } from "../../server/control/capability.ts";
import { assemble } from "./registration.ts";
import type { TeamModule } from "../../storage/ledger/team-module.ts";
import type { AlwaysOnHost } from "../../always-on/ports.ts";
import { openRuntime } from "./runtime.ts";
import { type CoreControl, createCoreControl } from "./control.ts";
import {
  type ControlDiagnostics,
  createControlDiagnostics,
  routeDiagnostic,
} from "./diagnostics.ts";
import {
  type Built,
  createWiringContext,
  type StoppedConditions,
  type WiringFactory,
} from "./wiring/context.ts";

// 시작 순서: lock → schema step → 기계 신분 → writer·reader → API → I/O worker 감독 → worker들. 단계마다 wiring의
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
  // shell(앱)을 data root로 띄운다. browser가 필요한데 shell이 없을 때만 부른다. 시작이 실패하면 onError로 알린다.
  // 없으면 core는 shell을 띄우지 않는다.
  launchShell?: (dataRoot: string, onError: (error: unknown) => void) => void;
  // 설치 layout으로 뜬 core만 core 입구가 준다. 없으면 OS 등록을 하지 않는다(개발·test core).
  alwaysOn?: AlwaysOnHost;
  // ready 뒤 writer가 죽었거나 shutdown이 기한을 넘기면 core를 끝낸다. graceful 종료가 아니다: shell이 다시 띄운다.
  exit(code: number): void;
};

type Core = {
  port: number;
  epoch: string;
  dataRoot: string;
  // shutdown barrier가 끝나면 resolve된다. control stop·idle-exit·신호가 같은 barrier를 쓴다.
  done: Promise<void>;
  // 새 command 입장을 닫고 연 것을 정리한 뒤 lock을 푼다.
  shutdown(): Promise<void>;
};

export async function startCore(options: CoreOptions): Promise<Result<Core>> {
  const clock = options.clock ?? systemClock;
  const random = options.random ?? cryptoRandom;
  const recorder = createLogRecorder();
  const telemetry =
    options.telemetry ?? telemetryFromEnv(clock, random, recorder);
  const root = await resolveDataRoot({
    lophnHome: options.lophnHome ?? process.env.LOPHN_HOME ?? undefined,
    home: options.home ?? homeOf(process.env, process.platform),
  });
  if (!root.ok) return root;
  const locked = await acquireInstanceLock(root.value.run);
  if (!locked.ok) return locked;
  // log file은 lock을 잡은 core만 쓴다. 열지 못해도 core는 stderr log만으로 돈다. 넣어 준 telemetry(시험)는 기록기가 없다.
  if (options.telemetry === undefined) {
    try {
      recorder.attach(
        await createLogFiles(root.value.path, process.platform, "core"),
      );
    } catch (thrown) {
      telemetry.logger.warn({
        component: "telemetry",
        event: "log_files_unavailable",
        fields: describeThrown(thrown),
      });
    }
  }
  // 앞 판의 runtime file은 lock을 잡은 뒤에만 지운다. 이미 도는 core의 file을 지우지 않기 위해서다.
  for (const name of ["user-token", "location.json"]) {
    try {
      await rm(`${root.value.run}/${name}`);
    } catch (thrown) {
      if (errorCode(thrown) !== "ENOENT") throw thrown;
    }
  }
  await markRunning(root.value, clock, telemetry);

  // epoch은 control이 먼저 알린다(migration 전에도 identify가 답한다). open은 같은 값을 쓴다.
  const epoch = hex(random, 16);
  // socket 잔여물을 치우고 듣는 것도 lock을 잡은 뒤다. 진 core는 살아 있는 core의 socket을 건드리지 않는다.
  const control = await createCoreControl({
    root: root.value,
    coreEpoch: epoch,
    clock,
    random,
    platform: process.platform,
  });
  if (!control.ok) {
    await clearMarker(root.value, telemetry);
    await locked.value.release();
    return control;
  }

  const opened = await open(
    options,
    root.value,
    locked.value,
    control.value,
    epoch,
    clock,
    random,
    telemetry,
  );
  if (!opened.ok) {
    // 기동이 실패하면 listener·socket을 닫고 lock을 푼다.
    await control.value.close();
    await clearMarker(root.value, telemetry);
    await locked.value.release();
    return opened;
  }
  return opened;
}

async function open(
  options: CoreOptions,
  root: DataRoot,
  lock: InstanceLock,
  control: CoreControl,
  epoch: string,
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
  const ids = createIdSource({ clock, random });
  // data step(`remote.host-key.machine`)이 machine.json을 읽으므로 그 앞이다.
  const machine = await ensureMachine({
    root: root.path,
    osMachineId: () =>
      readOsMachineId(process.platform, {
        readFile: (path) => readFile(path, "utf8"),
        exec: (file, args, timeoutMs) =>
          new Promise((resolve, reject) =>
            execFile(
              file,
              args,
              { timeout: timeoutMs, windowsHide: true },
              (error, stdout) => (error ? reject(error) : resolve(stdout)),
            ),
          ),
      }),
    hostname,
    ids,
    clock,
    logger: telemetry.logger,
  });
  if (!machine.ok) return machine;
  ctx.provide("machine", machine.value);
  // ledger 밖 파일은 ledger 뒤에 옮긴다. ledger가 거절한 판(더 새 판, 다른 내용)은 파일도 건드리지 않는다.
  const files = await applyDataSteps(
    root.path,
    wirings.flatMap((wiring) => wiring.dataSteps ?? []),
    !ledgerExisted,
    { ids },
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
  ctx.provide("epoch", epoch);
  const operations = [];
  for (const wiring of wirings) {
    operations.push(...((await wiring.operations?.(ctx)) ?? []));
  }
  ctx.provide("operations", operations);
  for (const wiring of wirings) wiring.prepare?.(ctx);

  // ready 전 writer 죽음은 끝내지 않고 표시만 남긴다. 기동이 실패로 돌려주어야 main이 start_failed 줄을 쓴다.
  let writerDead = false;
  let wasReady = false;
  const openedRuntime = await openRuntime({
    ledgerPath,
    clock,
    seed: seedOf(random),
    modules: options.teamModules,
    assembled: assembled.value,
    source: ctx.statusSource,
    blob: ctx.blobRead.deps,
    logger: telemetry.logger,
    onDead: (cause) => {
      telemetry.logger.error({
        component: "core",
        event: "writer_dead",
        fields: { cause },
      });
      if (!wasReady) writerDead = true;
      else if (!ctx.stopped) void exitAfterFlush(telemetry, options.exit);
    },
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
  // shell capability는 control `connect {client: shell}`이 발급하고, 검증한 Gateway 연결이 끝나면 버린다.
  // core는 남아도 그 shell의 view relay와 미소비 handle은 남기지 않는다.
  const capabilities = createShellCapabilities({
    random: (bytes) => random.fill(bytes),
  });
  capabilities.onEnd(() => {
    runtime.memory.disconnect();
    void runtime.confirmation({ action: "clear" });
  });
  ctx.provide("shellCapabilities", capabilities);
  // API 직전에 만들고 ready 뒤에 신호를 건다. 그 앞에서 기동이 실패해도 남는 timer·listener가 없다.
  let health: Health | undefined;
  let uninstallSnapshot = () => {};
  // shutdown barrier가 끝나면 resolve된다. main은 이것으로 core가 끝났음을 안다.
  const done = Promise.withResolvers<void>();

  // 종료 순서: 새 command·prepare 입장 닫기(ready = false) → 구독·감시·worker 통로
  // 정리(closeIntake) → server.stop() → closeChildren(앱 제어) → 앱 supervisor 정지 → io 정지 →
  // closeWork(timer·bootstrap) → runtime.close() → 유지보수(stopped) → control close, lock 풀기.
  // 정지 유지보수는 세 조건이 실제로 끝난 뒤에만 돈다. 앞 단계가 예외를 던져도 lock 해제는 그대로 실행한다.
  let shutdownRun: Promise<void> | undefined;
  const shutdown = () => {
    // 같은 시각의 두 종료 요청도 실제 종료가 끝날 때까지 같은 barrier를 기다린다.
    return (shutdownRun ??= (async () => {
      if (ctx.stopped) return;
      ctx.stopped = true;
      // 멈춘 단계 하나가 instance lock을 쥔 채 끝없이 기다리지 않게 한다. 자식은 stdin EOF로 끝나고 lock은 OS가 푼다.
      const deadline = setTimeout(() => {
        telemetry.logger.error({
          component: "core",
          event: "shutdown_deadline",
        });
        options.exit(1);
      }, SHUTDOWN_DEADLINE_MS);
      deadline.unref();
      // control의 identify가 stopping을 내고 붙을 API가 없다고 알린다.
      control.stopping();
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
          // listener와 socket file을 먼저 닫아야 identify가 사라진다. 그 뒤에 lock을 푼다.
          await control.close();
        } finally {
          try {
            await clearMarker(root, telemetry);
            await lock.release();
          } finally {
            telemetry.logger.info({ component: "core", event: "stopped" });
            await telemetry.shutdown();
            clearTimeout(deadline);
            done.resolve();
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
  // 같은 Map에 모은다. AcpSend가 부를 때 읽는 ctx.runtime.memory.handlers가 완성된 목록이다.
  const memory = runtime.memory.handlers;
  for (const [route, handler] of merged((built) => built.memory)) {
    memory.set(route, handler);
  }
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
  ctx.provide(
    "uploads",
    merged((built) => built.uploads),
  );
  ctx.provide(
    "fileStreams",
    merged((built) => built.fileStreams),
  );
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
      shellCapabilities: capabilities,
      hostLink: ctx.hostLink,
      // command·read·file·worker route는 같은 조립에서 온다. platform 기본 route와
      // 팀 route의 resource/method가 겹치면 RouteRegistry가 거절한다.
      registry: routes,
      // 바이트 body route. 제출 파일은 blob 준비 중계로 바로 흐른다.
      uploads: ctx.uploads,
      // 큰 파일을 core 메모리에 모으지 않고 창 단위로 흘리는 file route.
      fileStreams: ctx.fileStreams,
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
  for (const wiring of wirings) {
    const started = await wiring.start?.(ctx);
    if (started !== undefined && !started.ok) {
      health.close();
      await server.stop();
      await runtime.close();
      return started;
    }
  }
  if (writerDead) {
    health.close();
    await server.stop();
    await runtime.close();
    return err({ code: "unavailable", message: "writer가 끝났다" });
  }
  ctx.ready = true;
  wasReady = true;
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
  const diagnostics: ControlDiagnostics = createControlDiagnostics(
    root.path,
    ctx.diagnosticsWrite,
  );
  // ready 뒤에야 control의 identify가 ready를 내고 connect가 된다.
  control.ready({
    coreEpoch: epoch,
    apiUrl: `http://127.0.0.1:${server.port}`,
    registry: ctx.registry,
    routes: allRoutes,
    events: ctx.eventNames,
    runtime,
    capabilities,
    diagnostic: (diagnostic) => routeDiagnostic(diagnostics, diagnostic),
    shutdown: () => void shutdown(),
  });

  const core: Core = {
    port: server.port,
    epoch,
    dataRoot: root.path,
    done: done.promise,
    shutdown,
  };
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

// 단계별 기한의 합(server 10초 + 자식 정지 5초씩 + writer close 15초 + 정지 유지보수 30초 = 65초)보다 길어야
// 정상 종료를 자르지 않는다.
const SHUTDOWN_DEADLINE_MS = 90_000;

// log를 flush할 시간을 주되 멈춰도 core가 끝나게 한다.
async function exitAfterFlush(
  telemetry: Telemetry,
  exit: (code: number) => void,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    telemetry.shutdown(),
    new Promise((resolve) => (timer = setTimeout(resolve, 1_000))),
  ]).catch(() => undefined);
  clearTimeout(timer);
  exit(1);
}

// 실행 중 표지. 지우지 못하고 끝난 core(crash, SIGKILL, exit(1))가 있었는지 다음 기동이 log로 알린다.
// lock을 쥔 동안에만 쓰고 지운다. liveness에는 쓰지 않는다(identify 하나다).
async function markRunning(
  root: DataRoot,
  clock: Clock,
  telemetry: Telemetry,
): Promise<void> {
  const path = `${root.run}/running.marker`;
  try {
    let previous: unknown;
    try {
      previous = JSON.parse(await readFile(path, "utf8"));
    } catch (thrown) {
      if (errorCode(thrown) !== "ENOENT") throw thrown;
    }
    if (previous !== undefined) {
      telemetry.logger.warn({
        component: "core",
        event: "previous_unclean_exit",
        fields: typeof previous === "object" ? { ...previous } : { previous },
      });
    }
    await writeFile(
      path,
      JSON.stringify({ pid: process.pid, started_at: clock.now() }),
    );
  } catch (thrown) {
    telemetry.logger.warn({
      component: "core",
      event: "running_marker_failed",
      fields: describeThrown(thrown),
    });
  }
}

async function clearMarker(root: DataRoot, telemetry: Telemetry) {
  try {
    await rm(`${root.run}/running.marker`, { force: true });
  } catch (thrown) {
    telemetry.logger.warn({
      component: "core",
      event: "running_marker_failed",
      fields: describeThrown(thrown),
    });
  }
}

function telemetryFromEnv(
  clock: Clock,
  random: RandomSource,
  recorder: LogRecorder,
): Telemetry {
  const { config, problems } = readTelemetryConfig(process.env);
  const telemetry = createTelemetry({
    service: SERVICE_NAME,
    clock,
    random,
    config,
    write: (line) => void process.stderr.write(`${line}\n`),
    recorder,
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
