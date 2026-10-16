// preview 프로세스 수명. supervisor가 PreviewLaunch마다 운영 자식과 따로 띄우고 닫기 요청에 끝낸다.
// 같은 앱의 preview는 하나만 쥔다: 새 preview는 이전 preview의 종료를
// 확인한 뒤 뜬다. 운영 자식·record_* 사실·재시작 정책은 여기 없다. 운영 core에
// 아무것도 기록하지 않는다. 입출력은 모두 주입받는다.
import { type Clock, err, ok, type Result } from "../../../base/mod.ts";
import type { AppProcessStartInput } from "../../../protocol/apps/calls/mod.ts";
import {
  type AppChild,
  type AppEnvironment,
  type ChildIdentity,
  type ObservationWire as WireObservation,
  type PreviewLaunch as WireLaunch,
  previewLaunchSchema,
} from "../runtime/mod.ts";
import type { FlagSet } from "../permissions/mod.ts";
import { previewFlagsViolation } from "./flags.ts";
import {
  PREVIEW_STARTING,
  PREVIEW_UNAVAILABLE,
  type PreviewLaunch,
  type PreviewObservationWire as ObservationWire,
} from "./model.ts";

// core 쪽 모양(model.ts)과 supervisor 통로의 wire 모양(runtime/control-protocol)이 달라지면
// 컴파일이 실패한다.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const launchShape: Same<PreviewLaunch, WireLaunch> = true;
const observationShape: Same<ObservationWire, WireObservation> = true;
void launchShape;
void observationShape;

type PreviewProbe =
  | {
    ok: true;
    app_api: string[];
    dataSchema: number;
    bundleHash: string;
  }
  | { ok: false; reason: string };

type PreviewSpawnRequest = {
  app: string;
  release: string | null;
  nonce: string;
  sockets: { brokerSocket: string; controlSocket: string };
  deno: string;
  entry: string;
  flags: FlagSet;
  importMap: string;
  environment: AppEnvironment;
  startLine: string;
  identity: ChildIdentity;
};

type PreviewChildIdentity = {
  app: string;
  release: string | null;
  bundleHash: string;
  processNonce: string;
};

type PreviewLauncherDeps = {
  clock: Clock;
  deno: () => string;
  environment: AppEnvironment;
  // preview 자식의 두 socket. 같은 앱은 같은 자리를 쓴다(이전 자식 종료 확인 뒤에만 다시 쓴다).
  socketPaths: (app: string) => { broker: string; control: string };
  // 자식이 broker에 보이는 credential. 운영 앱 자식·supervisor의 credential이 아니다.
  credential: (request: {
    app: string;
    release: string | null;
    nonce: string;
    bundleHash: string;
  }) => Promise<string> | string;
  spawn: (request: PreviewSpawnRequest) => Promise<AppChild>;
  probe: (
    child: AppChild,
    control: string,
    launch: PreviewLaunch,
  ) => Promise<PreviewProbe> | PreviewProbe;
  open?: (
    child: AppChild,
    control: string,
    launch: PreviewLaunch,
  ) => Promise<boolean>;
  // 새 호출을 닫고 종료를 요청한다. 없으면 유예 없이 바로 강제 종료한다.
  requestStop?: (
    child: AppChild,
    control: string,
    launch: PreviewLaunch,
  ) => Promise<void>;
  // 자식의 broker 통로를 연다. 돌려준 함수가 그 통로를 닫는다. 이 자리에 올리는 서비스는
  // adapters의 대역이다.
  attachBroker?: (
    child: PreviewChildIdentity,
    launch: PreviewLaunch,
    credential: string,
  ) => (() => void) | undefined;
  wait: (ms: number) => Promise<void>;
  readyTimeoutMs?: number;
  stopGraceMs?: number;
};

export type PreviewLauncher = {
  // 시작을 접수한다. 시작은 비동기이고 상태는 observation으로 따라간다.
  start(launch: PreviewLaunch): Result<void>;
  // 그 nonce의 지금 관측. 다른 nonce·종료된 preview는 값 없음이다.
  observation(app: string, nonce: string): ObservationWire | null;
  // 정지 확인 뒤 true. 모르는 nonce면 false, 종료를 확인하지 못하면 unavailable이다.
  stop(app: string, nonce: string): Promise<Result<boolean>>;
  // 호출을 중계할 수 있는 그 nonce의 control socket. probe와 open을 마친 살아 있는 preview만이다.
  control(app: string, nonce: string): string | undefined;
  // supervisor가 멈추거나 core 연결이 끊겼다. 모든 preview를 끝낸다.
  stopAll(): Promise<void>;
};

const PREVIEW_STOP_GRACE_MS = 10_000;
const READY_TIMEOUT_MS = 30_000;

type Entry = {
  launch: PreviewLaunch;
  child: AppChild | undefined;
  control: string;
  // 종료를 요청했거나 만들기 전에 취소됐다.
  intended: boolean;
  probed: boolean;
  opened: boolean;
  reason: { code: string; summary: string } | undefined;
  detach: (() => void) | undefined;
};

type AppSlot = { entry: Entry | undefined; pending: Promise<void> };

function startLine(input: {
  launch: PreviewLaunch;
  broker: string;
  control: string;
  credential: string;
}): string {
  const line: AppProcessStartInput = {
    app: input.launch.app,
    // 준비 전 bundle이면 null이다. 가짜 release를 만들지 않는다.
    release: input.launch.release,
    bundle_hash: input.launch.bundleHash,
    mode: "preview",
    process_nonce: input.launch.nonce,
    broker_socket: input.broker,
    control_socket: input.control,
    data_path: input.launch.dataPath,
    broker_credential: input.credential,
  };
  return JSON.stringify(line);
}

export function createPreviewLauncher(
  deps: PreviewLauncherDeps,
): PreviewLauncher {
  const slots = new Map<string, AppSlot>();
  const timeout = deps.readyTimeoutMs ?? READY_TIMEOUT_MS;
  let closed = false;

  function slotOf(app: string): AppSlot {
    const found = slots.get(app);
    if (found) return found;
    const created: AppSlot = { entry: undefined, pending: Promise.resolve() };
    slots.set(app, created);
    return created;
  }

  function enqueue(slot: AppSlot, work: () => Promise<unknown>): Promise<void> {
    slot.pending = slot.pending.then(work, work).then(() => {});
    return slot.pending;
  }

  // 자식을 끝낸다. group 종료를 확인했을 때만 true다. 확인하지 못하면 자식을 놓지 않는다.
  async function terminate(entry: Entry, graceful = true): Promise<boolean> {
    entry.intended = true;
    const child = entry.child;
    if (child === undefined) {
      entry.detach?.();
      entry.detach = undefined;
      return true;
    }
    // supervisor가 멈추거나 core가 끊긴 때는 진행 호출이 끝나기를 기다리지 않고 바로 끝낸다.
    if (graceful && deps.requestStop && entry.probed) {
      try {
        await deps.requestStop(child, entry.control, entry.launch);
      } catch { /* 요청이 닿지 않아도 유예 뒤 강제 종료가 이어진다 */ }
      await Promise.race([
        child.exited,
        deps.wait(deps.stopGraceMs ?? PREVIEW_STOP_GRACE_MS),
      ]);
    }
    const confirmed = await child.terminate();
    if (!confirmed) return false;
    await child.exited;
    entry.child = undefined;
    entry.detach?.();
    entry.detach = undefined;
    return true;
  }

  async function failStart(
    entry: Entry,
    reason: { code: string; summary: string },
  ): Promise<void> {
    entry.reason = reason;
    await terminate(entry);
  }

  async function launchEntry(entry: Entry): Promise<void> {
    const launch = entry.launch;
    let credential: string;
    try {
      credential = await deps.credential({
        app: launch.app,
        release: launch.release,
        nonce: launch.nonce,
        bundleHash: launch.bundleHash,
      });
    } catch {
      entry.reason = {
        code: "start_failed",
        summary: "preview credential is unavailable",
      };
      return;
    }
    if (entry.intended || closed) return;
    const sockets = deps.socketPaths(launch.app);
    const identity: ChildIdentity = {
      pid: 0,
      startedAtMs: deps.clock.nowMs(),
      processNonce: launch.nonce,
    };
    entry.control = sockets.control;
    let child: AppChild;
    try {
      child = await deps.spawn({
        app: launch.app,
        release: launch.release,
        nonce: launch.nonce,
        sockets: {
          brokerSocket: sockets.broker,
          controlSocket: sockets.control,
        },
        deno: deps.deno(),
        entry: launch.entry,
        flags: launch.flags,
        importMap: launch.importMap,
        environment: deps.environment,
        startLine: startLine({
          launch,
          broker: sockets.broker,
          control: sockets.control,
          credential,
        }),
        identity,
      });
    } catch {
      entry.reason = {
        code: "start_failed",
        summary: "preview process could not be started",
      };
      return;
    }
    entry.child = child;
    entry.detach = deps.attachBroker?.(
      {
        app: launch.app,
        release: launch.release,
        bundleHash: launch.bundleHash,
        processNonce: launch.nonce,
      },
      launch,
      credential,
    );
    // 스스로 끝난 preview는 다시 띄우지 않는다. 종료를 확인하고 이유만 남긴다.
    void child.exited.then(() => onExit(entry, child));
    // 띄우는 동안 정지 요청이 왔으면 준비 확인을 기다리지 않고 바로 끝낸다.
    if (entry.intended) {
      await terminate(entry, false);
      return;
    }
    const probe = await Promise.race([
      deps.probe(child, sockets.control, launch),
      deps.wait(timeout).then(() => ({
        ok: false as const,
        reason: "ready timeout",
      })),
    ]);
    if (entry.intended) return;
    if (!probe.ok || probe.bundleHash !== launch.bundleHash) {
      await failStart(entry, {
        code: "start_failed",
        summary: probe.ok ? "bundle mismatch" : probe.reason,
      });
      return;
    }
    const declared = [...launch.app_api].sort();
    const reported = [...probe.app_api].sort();
    if (
      declared.length !== reported.length ||
      declared.some((key, index) => key !== reported[index]) ||
      probe.dataSchema !== launch.dataSchema
    ) {
      await failStart(entry, {
        code: "start_failed",
        summary: "handler or schema mismatch",
      });
      return;
    }
    // ready 관측은 open이 마친 뒤에만 낸다. probe 성공과 open 완료 사이의 창에 ready=true·
    // accepting=false를 내면 connect가 지금 연결되고 write가 거절된다.
    if (deps.open) {
      let opened = false;
      try {
        opened = await deps.open(child, sockets.control, launch);
      } catch {
        opened = false;
      }
      if (entry.intended) return;
      if (!opened) {
        await failStart(entry, {
          code: "start_failed",
          summary: "open failed",
        });
        return;
      }
    }
    entry.probed = true;
    entry.opened = true;
  }

  function onExit(entry: Entry, child: AppChild): void {
    if (entry.intended || entry.child !== child) return;
    entry.reason = {
      code: "unexpected_exit",
      summary: "the preview process exited",
    };
    entry.probed = false;
    entry.opened = false;
    // group 전체 종료를 확인한다. 확인하지 못하면 자식을 놓지 않는다.
    void child.terminate().then((confirmed) => {
      if (!confirmed || entry.child !== child) return;
      entry.child = undefined;
      entry.detach?.();
      entry.detach = undefined;
    });
  }

  function wireOf(entry: Entry): ObservationWire {
    const alive = entry.child !== undefined && !entry.intended;
    const ready = alive && entry.probed;
    // 시작·실행 중 실패한 이유가 있으면 그 이유를, 정지 요청만 있으면 사용 불가를 알린다.
    const reason = ready ? undefined : entry.reason ??
      (entry.intended ? PREVIEW_UNAVAILABLE : PREVIEW_STARTING);
    return {
      app: entry.launch.app,
      release: entry.launch.release,
      mode: "preview",
      bundle_hash: entry.launch.bundleHash,
      process_nonce: entry.launch.nonce,
      // 관측 wire 계약이 아직 요구하는 칸이다. 연결 주소는 더 이상 core에 알리지 않는다.
      endpoint: "",
      app_api: [...entry.launch.app_api],
      screens: { ...(entry.launch.screens ?? {}) },
      ready,
      accepting: ready && entry.opened,
      ...(reason ? { reason } : {}),
    };
  }

  return {
    start(input) {
      if (closed) {
        return err({ code: "unavailable", message: "supervisor is closing" });
      }
      const parsed = previewLaunchSchema.safeParse(input);
      if (!parsed.success) {
        return err({
          code: "invalid_input",
          message: "preview launch input is invalid",
        });
      }
      const launch = parsed.data;
      const violation = previewFlagsViolation(launch);
      if (violation !== undefined) {
        return err({ code: "invalid_input", message: violation });
      }
      const slot = slotOf(launch.app);
      if (slot.entry?.launch.nonce === launch.nonce) {
        return err({ code: "conflict", message: "preview nonce is in use" });
      }
      const previous = slot.entry;
      const entry: Entry = {
        launch,
        child: undefined,
        control: "",
        intended: false,
        probed: false,
        opened: false,
        reason: undefined,
        detach: undefined,
      };
      slot.entry = entry;
      void enqueue(slot, async () => {
        // 이전 preview의 종료를 확인하기 전에는 같은 자리의 socket으로 새 자식을 띄우지 않는다.
        if (previous !== undefined && !await terminate(previous)) {
          entry.reason = {
            code: "start_failed",
            summary: "previous preview did not stop",
          };
          return;
        }
        if (entry.intended || closed) return;
        await launchEntry(entry);
      });
      return ok(undefined);
    },
    observation(app, nonce) {
      const entry = slots.get(app)?.entry;
      if (entry === undefined || entry.launch.nonce !== nonce) return null;
      return wireOf(entry);
    },
    control(app, nonce) {
      const entry = slots.get(app)?.entry;
      if (
        entry === undefined || entry.launch.nonce !== nonce ||
        entry.child === undefined || entry.intended || !entry.probed ||
        !entry.opened
      ) return undefined;
      return entry.control;
    },
    async stop(app, nonce) {
      const slot = slots.get(app);
      const entry = slot?.entry;
      if (slot === undefined || entry === undefined) return ok(false);
      if (entry.launch.nonce !== nonce) return ok(false);
      // 아직 뜨는 중이면 다음 단계부터 멈추고, 이미 떴으면 새 호출을 받지 않는 상태로 본다.
      entry.intended = true;
      let confirmed = false;
      await enqueue(slot, async () => {
        confirmed = await terminate(entry);
        if (confirmed && slot.entry === entry) slot.entry = undefined;
      });
      return confirmed ? ok(true) : err({
        code: "unavailable",
        message: "preview process termination is not confirmed",
      });
    },
    async stopAll() {
      closed = true;
      await Promise.all([...slots.values()].map(async (slot) => {
        const entry = slot.entry;
        if (entry === undefined) return;
        // 시작 중인 자식도 대기열을 기다리지 않고 바로 끝낸다.
        let confirmed = await terminate(entry, false);
        // 진행 중이던 시작 작업이 늦게 만든 자식이 남지 않게 그 작업이 끝난 뒤 한 번 더 본다.
        await slot.pending;
        if (entry.child !== undefined) {
          confirmed = await terminate(entry, false);
        }
        if (confirmed && slot.entry === entry) slot.entry = undefined;
      }));
    },
  };
}
