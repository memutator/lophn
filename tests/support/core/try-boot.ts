// 세 질문
// - contract: boundary `server`·`supervision`(core가 시작하지 못할 때 stdout 첫 줄로 이유를 알리고 아무것도 안 쓰고 끝난다. 같은 data root에 둘째 instance는 안 뜬다).
// - 현실적 회귀: `start_failed` 알림 모양이 바뀌어 launcher가 시작 실패 이유를 못 보이는 것, 시작에 실패한 core가 child를 남기는 것.
// - 왜 지금 test가 못 잡나: 시작 실패 경로를 process로 보는 test가 없다. `bootCore`는 첫 줄이 안 오면 30초 뒤 실패하는 것이 전부다.
import { type BootOptions, type Core, type Run, startCore } from "./mod.ts";
import { processesOf, waitGone } from "./process.ts";

export type StartFailure =
  | "newer_schema"
  | "history_mismatch"
  | "damaged_original"
  | "other";

// start_failed를 받으면 core가 스스로 끝나기를 기다려 종료 코드를 돌려준다(끝나지 않으면 SIGKILL하고 exit null).
// 같은 data root에 이미 돌던 core(둘째 instance 시험)는 남아 있어도 되고, 이 시도가 띄운 process만 없어야 한다.
export async function tryBootCore(
  run: Run,
  options: BootOptions = {},
): Promise<
  | { ok: true; core: Core }
  | {
      ok: false;
      reason: StartFailure;
      exit: number | null;
    }
> {
  const before = await processesOf(run.home);
  const started = await startCore(run, options);
  if (started.ok) return started;
  const left = await waitGone(run.home, before);
  if (left.length > 0) {
    throw new Error(
      `시작에 실패한 core가 child를 남긴다: pid ${left.join(
        ", ",
      )} (SIGKILL로 정리함)`,
    );
  }
  return { ...started, reason: started.reason as StartFailure };
}
