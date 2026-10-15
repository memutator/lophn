import type { Result } from "../../base/mod.ts";
import type { At } from "../../protocol/base/values.ts";

// problems가 밖과 주고받는 것이다. module끼리 직접 import하지 않으므로
// 구현은 core 조립(`main/daemon/wiring/problems.ts`)이 끼운다.

export type ReleaseFact = {
  id: string;
  app: string;
  number: number;
  code_commit: string;
  activated_at: At | null;
  // 그 release가 선언한 바깥 자원 이름이다(`activation`의 `added_resources`와 같은 이름 규칙).
  resources: string[];
};

// apps/releases가 구현한다. 재발 판정(`activated_at`), 문제 상세의 source commit,
// `problem.more`의 `release_changes`가 쓴다.
export interface ReleaseLookup {
  get(id: string): Result<ReleaseFact | null>;
  activeOf(app: string): Result<ReleaseFact | null>;
  // 같은 앱에서 `number`가 바로 앞인 release.
  previousOf(id: string): Result<ReleaseFact | null>;
}

// apps가 받는다. `app.get`의 열린 문제 수를 위해서다.
export interface ProblemCounts {
  open(app: string): Result<number>;
}
