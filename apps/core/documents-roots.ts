// 활성 tracking root 집합의 변화를 보고 documents worker를 새 권한으로 다시 띄운다
// (file-tracking#R3). root 집합이 같으면 아무것도 하지 않는다. 다시 띄우지 못하면
// 옛 권한으로 성공했다고 하지 않고 다음 확인에서 다시 시도한다.
// event 구독(ProjectTrackingChanged)으로 바꾸지 못한다. core 안의 구독자도 platform의
// event 읽기(reader의 events/list)를 지나는데, 제품의 reader 등록(reader-registration.ts)은
// 팀 event 정의와 공개 정책을 하나도 싣지 않아 어느 자격에도 문서 event가 보이지 않고,
// documents의 Project 공개 정책은 사람 전용이라 core의 machine 자격에는 닫혀 있다. 같은
// 이유로 연결(DocumentCreated·DocumentSaved) 변화도 구독할 수 없다. platform이 팀 event
// 등록을 reader에 싣고 documents가 core 내부 구독자의 공개 범위를 정하면 바꾼다.
// 그 전까지는 같은 read(project.tracking_roots)를 주기로 읽어 변화를 본다.
import type { Result } from "../../packages/base/mod.ts";
import type { DocumentsRelaunch } from "./documents.ts";

export type RootsWatchDeps = {
  // 지금 활성 tracking root의 절대 경로. 읽지 못하면 err다.
  roots(): Promise<Result<readonly string[]>>;
  relaunch(
    previous: readonly string[],
    next: readonly string[],
  ): Promise<DocumentsRelaunch>;
  // worker가 지금 쓰는 root 집합(기동 때 정한 것).
  known: readonly string[];
  intervalMs: number;
};

export type RootsWatch = {
  // 한 번 확인한다. 테스트와 timer가 같은 함수를 부른다.
  check(): Promise<void>;
  readonly known: readonly string[];
  stop(): void;
};

export function watchTrackingRoots(deps: RootsWatchDeps): RootsWatch {
  let known = [...deps.known].sort();
  let stopped = false;
  let running: Promise<void> | undefined;
  async function check(): Promise<void> {
    // 겹친 확인은 하나로 합친다: 재시작 중에 또 재시작하지 않는다.
    if (running) return await running;
    running = (async () => {
      const read = await deps.roots();
      if (stopped || !read.ok) return;
      const next = [...new Set(read.value)].sort();
      const decision = await deps.relaunch(known, next);
      // 재시작이 실패했으면 known을 그대로 둬 다음 확인이 다시 시도한다.
      if (decision.kind !== "unavailable") known = next;
    })().finally(() => {
      running = undefined;
    });
    await running;
  }
  const timer = setInterval(() => void check(), deps.intervalMs);
  return {
    check,
    get known() {
      return known;
    },
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
