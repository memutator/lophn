// "Keep lophn running on this computer": 사람의 표시를 `always-on.json`에 두고, OS의 로그인 시작 등록과
// keep-awake를 그 표시에 맞춘다. OS는 port(`ports.ts`)이고 없으면 개발·test core라 OS를 부르지 않는다.
import {
  type Clock,
  err,
  type Logger,
  ok,
  type Result,
} from "../../base/mod.ts";
import type { Id } from "../../protocol/base/mod.ts";
import type {
  AlwaysOnSetInput,
  AlwaysOnStatus,
} from "../../protocol/always-on/mod.ts";
import type { AlwaysOnOs, Registration, ServiceEnv } from "./ports.ts";
import {
  type Marker,
  type MarkerRead,
  readMarker,
  writeMarker,
} from "./state.ts";

export type {
  AlwaysOnHost,
  AlwaysOnOs,
  KeepAwake,
  Registrar,
  Registration,
  ServiceEnv,
} from "./ports.ts";

export type AlwaysOn = {
  // 마지막으로 안 값이다.
  status(): AlwaysOnStatus;
  // OS에 다시 묻는다.
  refresh(): Promise<AlwaysOnStatus>;
  set(input: AlwaysOnSetInput): Promise<Result<AlwaysOnStatus>>;
};

export type AlwaysOnService = AlwaysOn & {
  // 기동 맞추기. ready 뒤 한 번 부른다.
  reconcile(): Promise<void>;
  // 종료 때 keep-awake를 놓는다. 그 뒤로는 쥐지 않는다.
  close(): Promise<void>;
};

const DEVELOPMENT_BUILD =
  "Keeping lophn running needs an installed lophn. This is a development build.";

type Awake =
  | { state: "held" }
  | { state: "released" }
  | { state: "unavailable"; reason: "no_inhibitor" | "os_failed" };

export async function createAlwaysOn(deps: {
  root: string;
  machine: Id<"mch">;
  os?: AlwaysOnOs;
  clock: Clock;
  logger: Logger;
}): Promise<AlwaysOnService> {
  const { os } = deps;
  let marker: MarkerRead = await readMarker(
    deps.root,
    deps.machine,
    deps.logger,
  );
  // OS에 아직 묻지 않았으면 undefined다. "registered"는 OS가 답한 것만이다.
  let registration: Registration | undefined;
  let awake: Awake = { state: "released" };
  let closed = false;
  // set·맞추기·refresh를 줄 세운다. 둘이 겹쳐 등록과 지우기가 엇갈리지 않게 한다.
  let tail: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = tail.then(work);
    tail = next.catch(() => undefined);
    return next;
  };

  os?.keepAwake.onLost((reason) => {
    awake = { state: "unavailable", reason };
    deps.logger.warn({
      component: "always-on",
      event: "keep_awake_lost",
      fields: { reason },
    });
  });

  const status = (): AlwaysOnStatus => {
    const own = marker.own;
    const keepRunning = own?.keep_running ?? false;
    const login = loginOf(os, registration);
    return {
      keep_running: keepRunning,
      keep_awake: keepRunning && (own?.keep_awake ?? false),
      start_at_login: login.state,
      login_reason: login.reason,
      awake: awake.state,
      awake_reason: awake.state === "unavailable" ? awake.reason : null,
      mechanism: os?.registrar.mechanism ?? null,
    };
  };

  // 표시와 keep-awake가 둘 다 켜져 있을 때만 쥔다.
  const syncAwake = async (os: AlwaysOnOs) => {
    const own = marker.own;
    const want = !closed && own !== null && own.keep_running && own.keep_awake;
    if (want && awake.state !== "held") {
      awake = await os.keepAwake.hold();
    } else if (!want && awake.state === "held") {
      os.keepAwake.release();
      awake = { state: "released" };
    }
  };

  // 지금 쓸 등록 내용의 env. 이 기계의 표시가 있으면 켤 때 잡은 값이다.
  const envOf = (os: AlwaysOnOs): ServiceEnv =>
    marker.own?.service_env ?? os.captureEnv();

  const set = async (
    input: AlwaysOnSetInput,
  ): Promise<Result<AlwaysOnStatus>> => {
    if (
      os === undefined &&
      (input.keep_running === true || input.keep_awake === true)
    ) {
      return err({ code: "unavailable", message: DEVELOPMENT_BUILD });
    }
    const current = status();
    const keepRunning = input.keep_running ?? current.keep_running;
    if (input.keep_awake === true && !keepRunning) {
      return err({
        code: "invalid_input",
        message: "keep_awake needs keep_running",
      });
    }
    // 켤 때마다 env를 다시 잡는다. 같은 값을 다시 보내는 것이 [Try again]이다.
    const turningOn = input.keep_running === true;
    const env = turningOn ? os!.captureEnv() : marker.own?.service_env;
    // env가 없으면 이 기계의 표시가 없는 것(없거나 깨졌거나 다른 기계 것)이라 이미 꺼짐이고 쓸 것이 없다.
    if (env !== undefined) {
      const next: Marker = {
        machine: deps.machine,
        keep_running: keepRunning,
        keep_awake: keepRunning && (input.keep_awake ?? current.keep_awake),
        service_env: env,
        updated_at: deps.clock.now(),
      };
      const written = await writeMarker(deps.root, next);
      if (!written.ok) return written;
      marker = { exists: true, foreign: false, own: next };
    }
    if (os === undefined) return ok(status());
    // 등록이 실패해도 표시는 남는다(사람의 선언이다). 결과는 status에 사실로 보인다.
    if (turningOn) {
      registration = await os.registrar.register(env!);
    } else if (input.keep_running === false) {
      registration = await os.registrar.unregister();
    }
    await syncAwake(os);
    return ok(status());
  };

  const reconcile = async () => {
    // 한 번도 켠 적 없는 root(설치 확인 도구의 빈 root도)는 OS를 부르지 않는다.
    if (os === undefined || !marker.exists) return;
    const own = marker.own;
    if (own !== null && own.keep_running) {
      registration = await os.registrar.read(own.service_env);
      // OS나 사람이 OS 설정에서 끈 것(off_in_system)은 다시 켜지 않는다.
      if (registration.state === "absent" || registration.state === "stale") {
        registration = await os.registrar.register(own.service_env);
        deps.logger.info({
          component: "always-on",
          event: "always_on_reregistered",
          fields: { result: registration.state },
        });
      }
      await syncAwake(os);
      return;
    }
    registration = await os.registrar.read(os.captureEnv());
    if (
      registration.state === "registered" ||
      registration.state === "stale" ||
      registration.state === "off_in_system"
    ) {
      registration = await os.registrar.unregister();
      deps.logger.info({
        component: "always-on",
        event: "always_on_unregistered",
        fields: { foreign: marker.foreign, result: registration.state },
      });
    }
  };

  return {
    status,
    refresh: () =>
      serial(async () => {
        if (os !== undefined) {
          registration = await os.registrar.read(envOf(os));
        }
        return status();
      }),
    set: (input) => serial(() => set(input)),
    reconcile: () => serial(reconcile),
    close: () =>
      serial(async () => {
        closed = true;
        if (os !== undefined) await syncAwake(os);
      }),
  };
}

function loginOf(
  os: AlwaysOnOs | undefined,
  registration: Registration | undefined,
): {
  state: AlwaysOnStatus["start_at_login"];
  reason: AlwaysOnStatus["login_reason"];
} {
  if (os === undefined) {
    return { state: "unavailable", reason: "development_build" };
  }
  switch (registration?.state) {
    case "registered":
      return { state: "registered", reason: null };
    case "off_in_system":
      return { state: "off_in_system", reason: null };
    case "unavailable":
      return { state: "unavailable", reason: registration.reason };
    default:
      return { state: "not_registered", reason: null };
  }
}
