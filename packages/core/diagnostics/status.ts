import type { Clock } from "../../base/mod.ts";
import { ok, type Result } from "../../base/mod.ts";
import type { ComponentStatus } from "../../protocol/diagnostics/mod.ts";
import type { HealthObservation } from "../../protocol/server/mod.ts";
import type { MemoryHandler, ReadHandler } from "../server/mod.ts";
import { runComponentChecks } from "./components.ts";
import type { ComponentCheck } from "./ports.ts";

export type StatusSource = {
  // 준비: 시작 순서가 끝나 API가 요청을 받는 상태.
  ready: boolean;
  // 적용된 schema step 수.
  schema: number;
  dataRoot: string;
  ledgerId: string;
  // 지금 돌릴 구성 요소 점검 목록. owner가 더한 것까지 포함한다.
  checks(): readonly ComponentCheck[];
};

// `diagnostics/status`: 부를 때마다 모든 점검을 지금 돌린다. 옛 시각을 다시 쓰지 않는다.
export function diagnosticsStatusHandler(
  checks: () => readonly ComponentCheck[],
  clock: Clock,
): MemoryHandler {
  return async () => {
    const components = await runComponentChecks(checks(), clock);
    return ok({ checked_at: clock.now(), components });
  };
}

// 인증은 API 입구가 이미 끝냈다. 여기서는 현재 상태만 읽는다.
export function platformStatusReads(
  source: StatusSource,
  clock: Clock,
): { status: ReadHandler; health: ReadHandler } {
  return {
    async status(): Promise<Result<unknown>> {
      const components = await runComponentChecks(source.checks(), clock);
      return ok({
        ready: source.ready,
        schema: source.schema,
        data_root: source.dataRoot,
        ledger_id: source.ledgerId,
        components: components.map(toObservation),
        as_of_seq: "0",
        next_cursor: null,
      });
    },
    async health(): Promise<Result<unknown>> {
      const components = await runComponentChecks(source.checks(), clock);
      return ok({
        observations: components.map(toObservation),
        observed_at: clock.now(),
        as_of_seq: "0",
        next_cursor: null,
      });
    },
  };
}

function toObservation(status: ComponentStatus): HealthObservation {
  return {
    component: status.component,
    available: status.available,
    ...(status.available ? {} : { reason: status.reason }),
    observed_at: status.checked_at,
  };
}
