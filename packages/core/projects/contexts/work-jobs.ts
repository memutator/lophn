import type { Result } from "../../../base/mod.ts";
import type { CheckOutcome } from "./check/mod.ts";
import {
  type CheckJobDeps,
  type CheckJobRequest,
  runCheckJob,
} from "./work-check.ts";
import {
  type IndexJobDeps,
  type IndexJobRequest,
  type IndexJobResult,
  runIndexJob,
} from "./work-index.ts";

type ContextJobs = {
  index(request: IndexJobRequest): Promise<Result<IndexJobResult>>;
  check(request: CheckJobRequest): Promise<Result<CheckOutcome>>;
};

// 직렬화: 한 context에는 job이 하나씩, 도착한 순서로 돈다.
// 다른 context의 job은 서로 기다리지 않는다. 같은 context의 같은 job 요청은 하나로 합친다:
// 아직 끝나지 않은(대기 중이거나 도는) 요청과 같으면(index는 context·bundle_hash·recorded_count,
// check는 check id) 새 job을 만들지 않고 그 요청의 결과(같은 Result)를 돌려준다.
// 끝난 요청은 기억하지 않는다. 한 job이 오류를 내도 뒤 job은 돈다.
export function createContextJobs(
  deps: IndexJobDeps & CheckJobDeps,
): ContextJobs {
  // context마다 마지막 job이 끝나면 풀리는 꼬리
  const tails = new Map<string, Promise<void>>();
  // 아직 끝나지 않은 요청의 결과
  const pending = new Map<string, Promise<unknown>>();

  function enqueue<T>(
    context: string,
    key: string,
    run: () => Promise<T>,
  ): Promise<T> {
    const joined = pending.get(key);
    if (joined !== undefined) return joined as Promise<T>;
    const turn = (tails.get(context) ?? Promise.resolve()).then(run);
    const tail = turn.then(() => {}, () => {});
    tails.set(context, tail);
    pending.set(key, turn);
    const done = () => {
      pending.delete(key);
      if (tails.get(context) === tail) tails.delete(context);
    };
    turn.then(done, done);
    return turn;
  }

  return {
    index: (request) =>
      enqueue(
        request.context,
        JSON.stringify([
          "index",
          request.context,
          request.bundle_hash,
          request.recorded_count,
        ]),
        () => runIndexJob(deps, request),
      ),
    check: (request) =>
      enqueue(
        request.context,
        JSON.stringify(["check", request.context, request.check]),
        () => runCheckJob(deps, request),
      ),
  };
}
