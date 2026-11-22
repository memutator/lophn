// folder wiring의 한 번 돌기(lane). 이름마다 한 번에 하나만 돌고, 도는 사이 다시 불리면 끝난 뒤 한 번 더 돈다. 실패하면 그
// lane만 1분부터 두 배씩 1시간까지 물러난다. 앱 process가 아직 뜨지 않아 실패한 lane은 그 앱이 뜬 신호(`appReady`)에 바로
// 다시 돈다: 그대로 두면 core를 다시 켠 뒤 앱이 뜨기 전의 첫 시도가 물러나, 사람의 data가 몇 분 늦게 나가고 들어온다.
import {
  BACKOFF_FIRST_MS,
  BACKOFF_MAX_MS,
} from "../../../../protocol/folder/mod.ts";

/** 한 번 돈 결과. ok가 아니면 물러난다. `appDown`이면 그 실패는 앱 process가 아직 없어서다. */
export type RunOutcome = { ok: boolean; more: boolean; appDown?: boolean };

type Lane = {
  job: () => Promise<RunOutcome>;
  running: boolean;
  again: boolean;
  attempts: number;
  notBefore: number;
  // 마지막 실패가 앱 process가 없어서였다.
  appDown: boolean;
  // 도는 사이 앱이 떴다. 이번 시도가 appDown으로 실패해도 물러나지 않고 한 번 더 돈다.
  woken: boolean;
};

export type FolderLanes = ReturnType<typeof createFolderLanes>;

export function createFolderLanes(deps: {
  nowMs(): number;
  stopped(): boolean;
  log(name: string, thrown: unknown): void;
  /** 도는 일. 끝내기가 기다린다. */
  track(done: Promise<void>): void;
}) {
  const lanes = new Map<string, Lane>();

  function kick(name: string, job: () => Promise<RunOutcome>): void {
    if (deps.stopped()) return;
    let lane = lanes.get(name);
    if (lane === undefined) {
      lane = {
        job,
        running: false,
        again: false,
        attempts: 0,
        notBefore: 0,
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
    if (deps.nowMs() < one.notBefore) return;
    one.running = true;
    const done = (async () => {
      try {
        for (;;) {
          one.again = false;
          let outcome: RunOutcome;
          try {
            outcome = await one.job();
          } catch (thrown) {
            deps.log("run_threw", thrown);
            outcome = { ok: false, more: false };
          }
          if (!outcome.ok) {
            one.appDown = outcome.appDown === true;
            if (one.appDown && one.woken && !deps.stopped()) {
              one.woken = false;
              continue;
            }
            one.woken = false;
            one.notBefore =
              deps.nowMs() +
              Math.min(
                BACKOFF_FIRST_MS * 2 ** Math.min(one.attempts, 20),
                BACKOFF_MAX_MS,
              );
            one.attempts += 1;
            return;
          }
          one.woken = false;
          one.appDown = false;
          one.attempts = 0;
          one.notBefore = 0;
          if (deps.stopped() || !(outcome.more || one.again)) return;
        }
      } finally {
        one.running = false;
      }
    })();
    deps.track(done);
  }

  /** 이름이 `prefix`로 시작하는 lane의 물러남을 지운다(사람이 막힘을 풀었다). 다시 돌리지는 않는다. */
  function clear(prefix: string): void {
    for (const [name, lane] of lanes) {
      if (name.startsWith(prefix)) {
        lane.attempts = 0;
        lane.notBefore = 0;
      }
    }
  }

  /**
   * 앱 process가 떴다. 이름이 `prefixes` 가운데 하나로 시작하고 앱이 없어서 물러난 lane만 물러남을 지우고 바로 다시 돌린다.
   * 다른 까닭으로 물러난 lane은 그대로 둔다.
   */
  function appReady(prefixes: readonly string[]): void {
    for (const [name, lane] of lanes) {
      if (!prefixes.some((prefix) => name.startsWith(prefix))) continue;
      if (lane.running) {
        lane.woken = true;
        continue;
      }
      if (!lane.appDown) continue;
      lane.attempts = 0;
      lane.notBefore = 0;
      kick(name, lane.job);
    }
  }

  return { kick, clear, appReady };
}
