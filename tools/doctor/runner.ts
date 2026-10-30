// check를 동시에 돌리고, check 하나가 던지거나 늦으면 fail로 만든다.
// --fix는 apply가 있는 결과만 차례로 고치고 그 check를 다시 돈다(사람이 명령을 고르는 것과 같은 순서).
import type { Check, Ctx, Outcome } from "./types.ts";

export type CheckResult = {
  check: Check;
  outcome: Outcome;
  applied: boolean;
  fixed: boolean;
};

// check 하나가 이 시간을 넘기면 fail. network·spawn이 매달려도 전체가 멈추지 않는다.
const TIMEOUT_MS = 5000;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  const timer = setTimeout(
    () => reject(new Error(`${ms}ms 안에 끝나지 않았다`)),
    ms,
  );
  work.then(
    (value) => {
      clearTimeout(timer);
      resolve(value);
    },
    (error) => {
      clearTimeout(timer);
      reject(error);
    },
  );
  return promise;
}

async function runOne(check: Check, ctx: Ctx): Promise<CheckResult> {
  try {
    const outcome = await withTimeout(check.run(ctx), TIMEOUT_MS);
    return {
      check,
      outcome,
      applied: false,
      fixed: false,
    };
  } catch (error) {
    return {
      check,
      outcome: {
        status: "fail",
        detail: `check가 던졌다: ${error instanceof Error ? error.message : String(error)}`,
      },
      applied: false,
      fixed: false,
    };
  }
}

export async function runChecks(
  checks: Check[],
  ctx: Ctx,
): Promise<CheckResult[]> {
  return Promise.all(checks.map((check) => runOne(check, ctx)));
}

export async function applyFixes(
  results: CheckResult[],
  ctx: Ctx,
): Promise<void> {
  for (const result of results) {
    const apply = result.outcome.fix?.apply;
    if (apply === undefined) continue;
    try {
      await apply();
    } catch (error) {
      result.outcome = {
        ...result.outcome,
        detail: `${result.outcome.detail}; fix 실패: ${error instanceof Error ? error.message : String(error)}`,
      };
      continue;
    }
    const next = await runOne(result.check, ctx);
    result.applied = true;
    result.fixed = next.outcome.status === "pass";
    result.outcome = next.outcome;
  }
}
