import { type Result } from "../../packages/base/mod.ts";
import {
  findUninstalled,
  type PlanDeps,
  type UninstalledCandidate,
  uninstalledCandidates,
} from "../../packages/core/lophn-agent/session/rewind/mod.ts";
import type { RewindFilesDeps } from "./rewind-files.ts";

// 시작 때 맞추기(lophn-agent/revert "복원 쓰기"). Rewind·Undo가 ledger에 확정된 뒤 설치 전에 process가 죽으면
// 항목은 restored인데 파일은 그대로다. 파일이 아직 agent가 마지막으로 쓴 상태인 경로를 찾아 machine
// `AmendRevertInstall`로 skipped(edited_outside)로 고친다. 설치를 이어서 하지는 않는다: 시간이 지난 뒤
// 이어 쓰면 사람이 고친 내용을 덮을 수 있다.
export type RewindReconcileDeps = {
  snapshot: RewindFilesDeps["snapshot"];
  rootOf: PlanDeps["rootOf"];
  amend(revert: string, paths: readonly string[]): Promise<Result<unknown>>;
};

// 고친 경로 수를 돌려준다. 한 revert의 실패가 다른 것을 막지 않는다.
export async function reconcileRewindInstalls(
  deps: RewindReconcileDeps,
): Promise<number> {
  const seen = deps.snapshot((lookup) => {
    const bySession = new Map<string, UninstalledCandidate[]>();
    for (const candidate of uninstalledCandidates(lookup)) {
      bySession.set(candidate.session, [
        ...bySession.get(candidate.session) ?? [],
        candidate,
      ]);
    }
    return [...bySession].map(([session, candidates]) => {
      try {
        return { candidates, root: deps.rootOf(lookup, session) };
      } catch {
        return { candidates: [], root: "" };
      }
    });
  });
  if (!seen.ok) return 0;
  let amended = 0;
  for (const { candidates, root } of seen.value) {
    try {
      const missing = await findUninstalled(root, candidates);
      const byRevert = new Map<string, string[]>();
      for (const candidate of missing) {
        byRevert.set(candidate.revert, [
          ...byRevert.get(candidate.revert) ?? [],
          candidate.path,
        ]);
      }
      for (const [revert, paths] of byRevert) {
        const done = await deps.amend(revert, paths);
        if (done.ok) amended += paths.length;
      }
    } catch {
      // 다음 시작이 다시 본다.
    }
  }
  return amended;
}
