import { systemClock } from "../../../base/clock.ts";
import { cryptoRandom } from "../../../base/random.ts";
import type { Clock, RandomSource, Result } from "../../../base/mod.ts";
import { err, ok } from "../../../base/mod.ts";
import { ROUTES } from "../../../protocol/registry.ts";
import {
  type ApiServer,
  RouteRegistry,
  startApiServer,
  WORKSPACE_MEMORY_ROUTES,
} from "../../server/mod.ts";
import {
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
import type { KeychainAdapter } from "../../secrets/mod.ts";
import { assemble } from "./registration.ts";
import type { TeamModule } from "../../storage/ledger/team-module.ts";
import { withPlatform } from "./platform-register.ts";
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
  // Electron main이 물려 준 stdin/stdout.
  parent?: ParentPipe;
  // secret store·MCP OAuth가 값을 읽는 keychain adapter.
  codingKeychain: KeychainAdapter;
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
  const ledgerPath = `${root.path}/lophn.db`;
  const wirings = options.wirings.map((make) => make());
  const ctx = createWiringContext({ options, clock, random, root, ledgerPath });

  // wiring이 넘긴 환경은 팀 조립과 platform 조립이 같이 읽는다. 각자 자기 key만 읽는다.
  const environment = Object.assign(
    {},
    ...wirings.map((wiring) => wiring.environment?.(ctx)),
  );
  const assembled = withPlatform(
    assemble(options.teams, environment),
    environment,
  );
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
    operations.push(...await wiring.operations?.(ctx) ?? []);
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
    // 참조가 있을 때만 부른다. secret store와 MCP OAuth가 같은 adapter로 값을 읽는다.
    keychain: () => options.codingKeychain,
  });
  if (!openedRuntime.ok) return openedRuntime;
  const runtime = openedRuntime.value;
  ctx.provide("runtime", runtime);
  ctx.provide("knownSecrets", runtime.knownSecrets);

  // 종료 순서: 새 command·prepare 입장 닫기(ready = false) → 구독·감시·worker 통로
  // 정리(closeIntake) → server.stop() → closeChildren(앱 제어) → 앱 supervisor 정지 → io 정지 →
  // closeWork(timer·bootstrap) → runtime.close() → 유지보수(stopped) → run metadata 지우기와
  // lock 풀기. 정지 유지보수는 세 조건이 실제로 끝난 뒤에만 돈다. 앞 단계가 예외를 던져도 metadata
  // 정리와 lock 해제는 그대로 실행한다.
  let shutdownRun: Promise<void> | undefined;
  const shutdown = () => {
    // 같은 시각의 두 종료 요청도 실제 종료가 끝날 때까지 같은 barrier를 기다린다.
    return shutdownRun ??= (async () => {
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
          if (await wiring.stopped?.(ctx, stoppedAt) === "handled") break;
        }
      } finally {
        try {
          await removeRunMetadata(root.run);
        } finally {
          await lock.release();
        }
      }
    })();
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
  ) => new Map(builts.flatMap((built) => [...pick(built) ?? []]));
  let server: ApiServer;
  try {
    server = await startApiServer({
      port: options.port,
      credentials: ctx.registry,
      clock,
      // 쓰기 앞 처리기는 안쪽에서 바깥으로 접는다(앞 wiring이 안쪽이다).
      writer: builts.reduce(
        (inner, built) => built.writer ? built.writer(inner) : inner,
        runtime.writer,
      ),
      reads: runtime.reads,
      memory: new Map([
        ...runtime.memory.handlers,
        ...merged((built) => built.memory),
      ]),
      bus: ctx.bus,
      gateway: ctx.gateway,
      // command·read·file·worker route는 같은 조립에서 온다. platform 기본 route와
      // 팀 route의 resource/method가 겹치면 RouteRegistry가 거절한다.
      registry: routes,
      // 바이트 body route. 제출 파일은 blob 준비 중계로 바로 흐른다.
      uploads: merged((built) => built.uploads),
      // 큰 파일을 core 메모리에 모으지 않고 창 단위로 흘리는 file route.
      fileStreams: merged((built) => built.fileStreams),
      workers: new Map(
        builts.flatMap((built) => [...built.workers ?? []]),
      ),
    });
  } catch {
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
    await server.stop();
    await runtime.close();
    return recorded;
  }
  for (const wiring of wirings) {
    const started = await wiring.start?.(ctx);
    if (started !== undefined && !started.ok) {
      await server.stop();
      await runtime.close();
      return started;
    }
  }
  ctx.ready = true;
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
    ? watchParent(parent, () => core.shutdown(), {
      confirmation: (body) => runtime.confirmation(body),
      reply: (message) => writeParent(parent, message),
    }, shellViewLog(root.path))
    : Promise.resolve();
  return ok(core);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile;
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
