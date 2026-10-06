// 등록된 지침 파일 하나의 관측 loop(file-tracking#R19). root loop와 달리 폴더를 순회하지도
// watch하지도 않는다: 등록된 exact 경로 하나를 시작할 때, 60초마다, 그리고 같은 파일에 사람이
// 쓴 직후(nudge) 안정 읽기한다. 파일 읽기는 주입한 port만 부른다.
import type { Result } from "../../base/mod.ts";
import { QUIET_MS } from "./model.ts";
import {
  type ObservationBasisCheck,
  type ObservationCandidate,
  SCAN_INTERVAL_MS,
} from "./observation.ts";
import type { ObservationSubmit, StableOutcome } from "./work.ts";

export type ObserveInstruction = {
  // 등록된 exact 절대 경로.
  path: string;
  // 문서 파일의 상대 경로(파일 이름)다.
  relative: string;
};

export type ObserveInstructionDeps = {
  // 지침 파일의 안정 읽기. 소유자·일반 파일·symlink 아님을 검사하고 없는 파일은 not_found로,
  // 검사를 통과하지 못한 파일은 그 밖의 오류로 돌려준다. 제품은 등록 폴더를 읽을 수 있는 준비 worker가
  // 하고(`instructionReadPort`+`readStably`), coordinator는 그 결과만 받는다.
  read(path: string): Promise<Result<StableOutcome>>;
  nowMs(): number;
  submit(submission: ObservationSubmit): Promise<Result<void>>;
  basisFor(candidate: ObservationCandidate): ObservationBasisCheck;
  // 등록은 있는데 파일이 없다. 지침 부재 성공으로 꾸미지 않고 상태만 남긴다.
  missing(candidate: ObservationCandidate): Promise<void> | void;
  stop?: { stopped: boolean };
  // 사람이 이 파일에 쓴 직후 세운다. 다음 tick이 바로 다시 읽는다.
  nudge?: { requested: boolean };
  // 테스트가 직접 미는 한 간격. 없으면 50ms다.
  waitTick?: () => Promise<void>;
};

const TICK_MS = 50;

function candidateOf(
  request: ObserveInstruction,
  nowMs: number,
): ObservationCandidate {
  return {
    root: request.path,
    canonical: request.path,
    relative: request.relative,
    fact: "modified",
    lastSignalMs: nowMs - QUIET_MS,
    retries: 0,
  };
}

export async function observeInstructionFile(
  deps: ObserveInstructionDeps,
  request: ObserveInstruction,
): Promise<void> {
  const once = async () => {
    const candidate = candidateOf(request, deps.nowMs());
    const outcome = await deps.read(request.path);
    if (!outcome.ok) {
      if (outcome.error.code === "not_found") {
        await deps.missing(candidate);
        return;
      }
      // 소유자·symlink·일반 파일 검사나 읽기 실패다. 읽지 못한 것을 없는 것으로 보지 않는다.
      await deps.submit({
        candidate,
        basis: deps.basisFor(candidate),
        outcome: { kind: "unverified", reason: outcome.error.message },
      });
      return;
    }
    await deps.submit({
      candidate,
      basis: deps.basisFor(candidate),
      outcome: outcome.value,
    });
  };
  await once();
  let nextAt = deps.nowMs() + SCAN_INTERVAL_MS;
  while (!deps.stop?.stopped) {
    await (deps.waitTick ?? sleep)();
    if (deps.stop?.stopped) break;
    if (deps.nudge?.requested || deps.nowMs() >= nextAt) {
      if (deps.nudge !== undefined) deps.nudge.requested = false;
      nextAt = deps.nowMs() + SCAN_INTERVAL_MS;
      await once();
    }
  }
}

function sleep(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, TICK_MS));
}
