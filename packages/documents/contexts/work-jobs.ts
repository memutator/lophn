import type { Result } from "../../base/mod.ts";
import type { CheckOutcome } from "./check/mod.ts";
import type { CheckJobDeps, CheckJobRequest } from "./work-check.ts";
import type {
  IndexJobDeps,
  IndexJobRequest,
  IndexJobResult,
} from "./work-index.ts";

export type ContextJobs = {
  index(request: IndexJobRequest): Promise<Result<IndexJobResult>>;
  check(request: CheckJobRequest): Promise<Result<CheckOutcome>>;
};

// 직렬화(docs/architecture/documents.md 2.4): 한 context에는 job이 하나씩, 도착한 순서로 돈다.
// 다른 context의 job은 서로 기다리지 않는다. 같은 context의 같은 job 요청은 하나로 합친다:
// 아직 끝나지 않은(대기 중이거나 도는) 요청과 같으면(index는 context·bundle_hash·recorded_count,
// check는 check id) 새 job을 만들지 않고 그 요청의 결과(같은 Result)를 돌려준다.
// 끝난 요청은 기억하지 않는다. 한 job이 오류를 내도 뒤 job은 돈다.
export function createContextJobs(
  _deps: IndexJobDeps & CheckJobDeps,
): ContextJobs {
  throw new Error("not implemented");
}
