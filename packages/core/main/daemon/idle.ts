import type { Clock, Logger, Result } from "../../../base/mod.ts";

// idle-exit: 일도 붙은 client도 없이 이만큼이 이어지면 core가 스스로 끝난다.
export const IDLE_EXIT_MS = 600_000;

// 일이나 client가 있는 동안에도 이 간격으로 다시 본다. 유휴가 끊긴 때를 이 간격 안에서 본다.
const POLL_MS = 30_000;

export type IdleTimers = {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
};

// 일과 client를 보는 port. wiring이 module별 activity read와 server의 수를 합쳐 꽂는다.
export type IdleActivity = {
  // module별 일(enabled job·열린 job run·running run·running workflow instance). 읽기 실패는 err다.
  busy(): Promise<Result<boolean>>;
  // 지금 붙은 client 수. 진행 중 HTTP 요청과 Gateway 구독이다.
  clients(): number;
  // client가 들어온 횟수. 단조 증가해야 하고, 읽는 동안 새 client가 들어왔는지 이 값으로 본다.
  arrivals(): number;
};

export type IdleMonitorDeps = {
  clock: Clock;
  timers: IdleTimers;
  activity: IdleActivity;
  // idle-exit를 시작한다. shutdown barrier와 같으므로 겹쳐 불러도 된다.
  shutdown(): void;
  logger: Logger;
  // 테스트가 줄인다. 기본은 10분이다.
  idleMs?: number;
};

export type IdleMonitor = {
  // ready가 된 뒤 부른다. 여기부터 유휴 시간을 센다.
  start(): void;
  // 종료가 시작됐다. 도는 확인의 결과로 더는 끝내지 않는다.
  stop(): void;
};

// 확인은 언제나 하나씩이고, 유휴가 이어진 때만 끝낸다. timer가 울릴 때마다 일과 client 수를 새로 읽어
// 지난 결과로 끝내지 않는다. 읽기에 실패하면 일이 있는 것으로 본다.
export function createIdleMonitor(deps: IdleMonitorDeps): IdleMonitor {
  const idleMs = deps.idleMs ?? IDLE_EXIT_MS;
  // 유휴를 처음 본 때. 한 번이라도 일이나 client를 보면 비운다. 시작 시각을 쓰지 않는다:
  // 시작 뒤 첫 확인 전의 일을 못 보고 10분보다 일찍 끝내지 않으려는 것이다.
  let idleSince: number | undefined;
  let handle: { value: unknown } | undefined;
  let started = false;
  let stopped = false;

  const clearTimer = () => {
    if (handle === undefined) return;
    deps.timers.clear(handle.value);
    handle = undefined;
  };

  const schedule = () => {
    clearTimer();
    if (stopped) return;
    const now = deps.clock.nowMs();
    const untilDeadline =
      idleSince === undefined ? POLL_MS : idleSince + idleMs - now;
    const slot: { value: unknown } = { value: undefined };
    slot.value = deps.timers.set(
      () => {
        if (handle === slot) handle = undefined;
        void check();
      },
      Math.max(0, Math.min(POLL_MS, untilDeadline)),
    );
    handle = slot;
  };

  async function check(): Promise<void> {
    if (stopped || !started) return;
    const arrivalsBefore = deps.activity.arrivals();
    let busy = true;
    try {
      const work = await deps.activity.busy();
      if (work.ok) {
        busy = work.value;
      } else {
        deps.logger.warn({
          component: "core",
          event: "idle_activity_read_failed",
          message: "idle: activity read failed; staying alive",
          fields: { code: work.error.code, reason: work.error.message },
        });
      }
    } catch (thrown) {
      deps.logger.warn({
        component: "core",
        event: "idle_activity_read_failed",
        message: "idle: activity read failed; staying alive",
        fields: {
          reason: thrown instanceof Error ? thrown.message : String(thrown),
        },
      });
    }
    if (stopped) return;
    // 읽는 동안 새 client가 들어왔거나 지금 client가 있으면, 읽기 전 상태로 끝내지 않는다.
    const clientsChanged =
      deps.activity.arrivals() !== arrivalsBefore ||
      deps.activity.clients() > 0;
    if (busy || clientsChanged) {
      idleSince = undefined;
      schedule();
      return;
    }
    const now = deps.clock.nowMs();
    idleSince ??= now;
    if (now - idleSince < idleMs) {
      schedule();
      return;
    }
    // 마지막 확인 뒤 여기까지 await가 없다. shutdown이 새 입장을 닫을 때 경합하는 request는
    // 그 전에 받은 것뿐이고, server.stop이 그것을 끝까지 기다린다.
    stopped = true;
    clearTimer();
    deps.logger.info({
      component: "core",
      event: "idle_exit",
      fields: { idle_ms: now - idleSince },
    });
    deps.shutdown();
  }

  return {
    start() {
      if (started || stopped) return;
      started = true;
      schedule();
    },
    stop() {
      stopped = true;
      clearTimer();
    },
  };
}
