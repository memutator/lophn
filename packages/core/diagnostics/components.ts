import type { Clock } from "../../base/mod.ts";
import type { ComponentStatus } from "../../protocol/diagnostics/mod.ts";
import type { ComponentCheck } from "./ports.ts";

// 점검 하나가 이 시간을 넘기면 불가로 본다. 다른 점검은 기다리지 않는다.
const CHECK_TIMEOUT_MS = 2000;

type Observed = { available: true } | { available: false; reason: string };

// core와 ledger만 여기서 짓는다. 나머지 구성 요소는 owner의 wiring이 `componentChecks`에 더한다.
export function createComponentChecks(input: {
  ready(): boolean;
  // writer(runtime)가 열렸고 reader가 모두 healthy인지 본다. 아직 열리지 않았으면 undefined다.
  runtime(): { readers: { health(): readonly string[] } } | undefined;
}): ComponentCheck[] {
  return [
    {
      component: "core",
      check: () =>
        Promise.resolve(
          input.ready()
            ? { available: true }
            : { available: false, reason: "API가 아직 요청을 받지 않는다" },
        ),
    },
    {
      component: "ledger",
      check: () => {
        const runtime = input.runtime();
        if (!runtime) {
          return Promise.resolve({
            available: false,
            reason: "writer가 아직 없다",
          });
        }
        return Promise.resolve(
          runtime.readers.health().every((health) => health === "healthy")
            ? { available: true }
            : { available: false, reason: "reader가 정상이 아니다" },
        );
      },
    },
  ];
}

// 점검을 모두 동시에 돌린다. 각 점검의 시각은 그 점검을 시작한 때다. 불가에는 이유를 반드시 붙인다.
export async function runComponentChecks(
  checks: readonly ComponentCheck[],
  clock: Clock,
): Promise<ComponentStatus[]> {
  return await Promise.all(checks.map(async (item) => {
    const checkedAt = clock.now();
    const observed = await observe(item);
    return {
      component: item.component,
      available: observed.available,
      ...(observed.available ? {} : { reason: observed.reason }),
      checked_at: checkedAt,
    };
  }));
}

async function observe(item: ComponentCheck): Promise<Observed> {
  try {
    const result = await withTimeout(item.check(), CHECK_TIMEOUT_MS);
    if (result === undefined) {
      return { available: false, reason: "check timed out" };
    }
    if (result.available) return { available: true };
    return { available: false, reason: result.reason || "check failed" };
  } catch {
    return { available: false, reason: "check failed" };
  }
}

// 시간이 지나면 undefined를 준다. 늦게 온 결과는 버린다.
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}
