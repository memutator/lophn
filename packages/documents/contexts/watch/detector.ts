import type { ChangeDetector, ChangeDetectorDeps } from "./types.ts";

// 변화 감지의 순수 core. 시각과 timer는 deps로 받는다.
//
// signal(paths): paths 중 하나라도 어떤 활성 context의 감시 폴더에 들면 그 context를 대기 집합에
// 더하고, 창이 열려 있지 않으면 window_ms 짜리 창을 연다. 창은 첫 신호로 열리고 뒤 신호가 늘이지
// 않는다(계속 바뀌어도 window_ms마다 rescan한다). 창이 닫히면 rescan을 한 번 부르고 집합을 비운다.
// 변화 목록·이력·event를 남기지 않는다. 힌트일 뿐이라 놓쳐도 다음 검색·열기의 훑기가 따라잡는다.
export function createChangeDetector(
  _deps: ChangeDetectorDeps,
): ChangeDetector {
  throw new Error("not implemented");
}
