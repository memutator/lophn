// harness test 자식의 입력 모양이다. 자식 본문(child.ts)은 동기 file API를 쓰는 test 자식 전용 코드라 core module graph에
// 들어가지 않게 하고, 이 모양만 mod.ts로 내보낸다.
import type { HarnessPlan } from "./driver.ts";

// 앱이 낸 실패 경로 test 한 건. 선언 code를 실제 command 호출로 재현하는 입력이다. `direct`는 SDK만
// 직접 부르는 test라서 통과하지 못한다.
export type HarnessFailurePath = {
  code: string;
  command?: string;
  input?: unknown;
  fault?: "store" | "net" | "none";
  direct?: boolean;
};

export type HarnessChildInput = {
  plan: HarnessPlan;
  // 정적 code 사용을 읽을 고정 source 폴더(봉인 bundle 사본).
  source_dir: string;
  // runner가 화면 검사 host를 띄울 수 있는지.
  view: boolean;
  failure_paths: HarnessFailurePath[];
};
