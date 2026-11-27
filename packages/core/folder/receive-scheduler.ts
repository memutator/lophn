// 받기·내보내기 공용 lane scheduler(carry/folder, vault-sync).
// 키마다 한 번에 하나만 돌고, 도는 사이 다시 불리면 끝난 뒤 한 번 더 돈다.
// 실패하면 1분부터 두 배씩 1시간까지 물러나되, 물러나는 동안(또는 실패로 끝난 실행 도중) 온 계기는 버리지 않고
// notBefore가 지난 뒤 한 번 더 실행해 유실을 막는다.
import {
  BACKOFF_FIRST_MS,
  BACKOFF_MAX_MS,
} from "../../protocol/folder/limits.ts";

/** 한 번 돈 결과. ok가 false이고 backoff !== false이면 exponential backoff로 물러난다. */
export type ReceiveOutcome = {
  ok: boolean;
  more?: boolean;
  /** 실패 원인이 앱 process 미기동인지. `appReady`가 이 lane만 바로 깨운다. */
  appDown?: boolean;
  /** false이면 실패해도 물러나지 않고 조용히 멈춘다(예: forbidden/not_found). */
  backoff?: boolean;
};

export type ReceiveSchedulerDeps = {
  nowMs(): number;
  /** ms 뒤에 fn을 부른다(idle-exit를 막지 않게 unref). 취소 함수를 돌려준다. */
  wait(ms: number, fn: () => void): () => void;
  backoffFirstMs?: number;
  backoffMaxMs?: number;
  /** true(기본)이면 만들자마자 kick을 받는다. false이면 start() 전까지 무시한다. */
  started?: boolean;
  log?(event: string, thrown: unknown): void;
  /** 도는 일. 종료 대기(closeWork)에 쓴다. */
  track?(done: Promise<void>): void;
};

type Lane = {
  job: () => Promise<ReceiveOutcome>;
  running: boolean;
  again: boolean;
  attempts: number;
  notBefore: number;
  // 물러나는 동안 온 계기. notBefore가 지나면 한 번 실행한다(중복 예약하지 않는다).
  deferred: (() => void) | undefined;
  appDown: boolean;
  woken: boolean;
};

export type ReceiveScheduler = ReturnType<typeof createReceiveScheduler>;

export function createReceiveScheduler(deps: ReceiveSchedulerDeps) {
  const firstMs = deps.backoffFirstMs ?? BACKOFF_FIRST_MS;
  const maxMs = deps.backoffMaxMs ?? BACKOFF_MAX_MS;
  const lanes = new Map<string, Lane>();
  const debounces = new Map<string, { cancel: () => void; firstAt: number }>();
  let active = deps.started ?? true;

  function clearDeferred(lane: Lane) {
    lane.deferred?.();
    lane.deferred = undefined;
  }

  function resetLane(lane: Lane) {
    clearDeferred(lane);
    lane.attempts = 0;
    lane.notBefore = 0;
  }

  function defer(name: string, lane: Lane) {
    if (!active || lane.deferred !== undefined) return;
    const delay = Math.max(0, lane.notBefore - deps.nowMs());
    lane.deferred = deps.wait(delay, () => {
      lane.deferred = undefined;
      if (!active) return;
      kick(name, lane.job);
    });
  }

  function kick(name: string, job: () => Promise<ReceiveOutcome>): void {
    if (!active) return;
    let lane = lanes.get(name);
    if (lane === undefined) {
      lane = {
        job,
        running: false,
        again: false,
        attempts: 0,
        notBefore: 0,
        deferred: undefined,
        appDown: false,
        woken: false,
      };
      lanes.set(name, lane);
    }
    const one = lane;
    one.job = job;
    if (one.running) {
      one.again = true;
      return;
    }
    if (deps.nowMs() < one.notBefore) {
      defer(name, one);
      return;
    }
    clearDeferred(one);
    one.running = true;
    const done = (async () => {
      try {
        for (;;) {
          one.again = false;
          let outcome: ReceiveOutcome;
          try {
            outcome = await one.job();
          } catch (thrown) {
            deps.log?.("run_threw", thrown);
            outcome = { ok: false, more: false };
          }
          if (!outcome.ok) {
            if (outcome.backoff === false) {
              one.woken = false;
              return;
            }
            one.appDown = outcome.appDown === true;
            if (one.appDown && one.woken && active) {
              one.woken = false;
              continue;
            }
            one.woken = false;
            one.notBefore =
              deps.nowMs() +
              Math.min(firstMs * 2 ** Math.min(one.attempts, 20), maxMs);
            one.attempts += 1;
            // 실행 도중 들어온 새 계기도 물러나기가 끝난 뒤 한 번 실행해 유실하지 않는다.
            if (one.again) defer(name, one);
            return;
          }
          one.woken = false;
          one.appDown = false;
          one.attempts = 0;
          one.notBefore = 0;
          clearDeferred(one);
          if (!active || !(outcome.more || one.again)) return;
        }
      } finally {
        one.running = false;
      }
    })();
    deps.track?.(done);
  }

  function debounce(
    name: string,
    ms: number,
    fn: () => void,
    maxWaitMs?: number,
  ): void {
    if (!active) return;
    const now = deps.nowMs();
    const prev = debounces.get(name);
    prev?.cancel();
    const firstAt = prev?.firstAt ?? now;
    const delay =
      maxWaitMs === undefined
        ? ms
        : Math.max(0, Math.min(ms, firstAt + maxWaitMs - now));
    debounces.set(name, {
      firstAt,
      cancel: deps.wait(delay, () => {
        debounces.delete(name);
        if (!active) return;
        fn();
      }),
    });
  }

  return {
    active: () => active,
    start() {
      if (active) return;
      active = true;
      for (const lane of lanes.values()) resetLane(lane);
    },
    stop() {
      active = false;
      for (const entry of debounces.values()) entry.cancel();
      debounces.clear();
      for (const lane of lanes.values()) clearDeferred(lane);
    },
    kick,
    debounce,
    /** 단일 키의 물러남과 예약된 재시도를 지운다. 다시 돌리지는 않는다. */
    reset(name: string) {
      const lane = lanes.get(name);
      if (lane !== undefined) resetLane(lane);
    },
    /** 이름이 `prefix`로 시작하는 lane의 물러남을 지운다. 다시 돌리지는 않는다. */
    clear(prefix: string) {
      for (const [name, lane] of lanes) {
        if (name.startsWith(prefix)) resetLane(lane);
      }
    },
    /** 앱 process가 떴다. `prefixes`로 시작하고 앱 미기동으로 물러난 lane만 바로 깨운다. */
    appReady(prefixes: readonly string[]) {
      for (const [name, lane] of lanes) {
        if (!prefixes.some((prefix) => name.startsWith(prefix))) continue;
        if (lane.running) {
          lane.woken = true;
          continue;
        }
        if (!lane.appDown) continue;
        resetLane(lane);
        kick(name, lane.job);
      }
    },
  };
}
