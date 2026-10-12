// 활성 tracking root 집합의 변화를 보고 documents worker를 새 권한으로 다시 띄운다
// (file-tracking#R3). root 집합이 같으면 아무것도 하지 않는다. 다시 띄우지 못하면
// 옛 권한으로 성공했다고 하지 않고 곧 다시 시도한다.
// 확인(check)은 core 안 구독자(machine:documents-feed)가 ProjectTrackingChanged 등 event를
// 받을 때, 구독이 (다시) 열릴 때, 시작할 때 부른다(documents plan Q17). 주기로 읽지 않는다.
// event는 깨우는 신호일 뿐이고 root 집합은 매번 같은 read(project.tracking_roots)로 읽는다.
import type { Result } from "../../../../base/mod.ts";
import type { DocumentsRelaunch } from "../../register.ts";

export type RootsWatchDeps = {
  // 지금 활성 tracking root의 절대 경로. 읽지 못하면 err다.
  roots(): Promise<Result<readonly string[]>>;
  relaunch(
    previous: readonly string[],
    next: readonly string[],
  ): Promise<DocumentsRelaunch>;
  // worker가 지금 쓰는 root 집합(기동 때 정한 것).
  known: readonly string[];
  // 읽기·재시작이 실패했을 때 다시 확인하기까지의 대기. 성공이면 timer를 두지 않는다.
  retryMs: number;
};

export type RootsWatch = {
  // 한 번 확인한다. event 구독자와 시험이 같은 함수를 부른다.
  check(): Promise<void>;
  readonly known: readonly string[];
  stop(): void;
};

export function watchTrackingRoots(deps: RootsWatchDeps): RootsWatch {
  let known = [...deps.known].sort();
  let stopped = false;
  let running: Promise<void> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  function retryLater() {
    if (stopped || retry !== undefined) return;
    retry = setTimeout(() => {
      retry = undefined;
      void check();
    }, deps.retryMs);
  }
  // 한 번의 확인. 읽기·재시작이 실패하면 곧 다시 시도하도록 timer를 건다.
  async function pass(): Promise<void> {
    const read = await deps.roots();
    if (stopped) return;
    if (!read.ok) return retryLater();
    const next = [...new Set(read.value)].sort();
    const decision = await deps.relaunch(known, next);
    // 재시작이 실패했으면 known을 그대로 둬 다시 시도한다.
    if (decision.kind !== "unavailable") known = next;
    else retryLater();
  }
  // 겹친 확인은 하나로 합친다: 재시작 중에 또 재시작하지 않는다. 다만 도는 중에 온 신호는
  // 이미 읽은 값 뒤의 변화일 수 있어서, 끝난 뒤 한 번 더 확인한다.
  let again = false;
  async function check(): Promise<void> {
    if (running) {
      again = true;
      return await running;
    }
    running = (async () => {
      do {
        again = false;
        await pass();
      } while (again && !stopped);
    })().finally(() => {
      running = undefined;
    });
    await running;
  }
  return {
    check,
    get known() {
      return known;
    },
    stop() {
      stopped = true;
      clearTimeout(retry);
      retry = undefined;
    },
  };
}
