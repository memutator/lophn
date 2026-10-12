import type { Clock } from "../../base/mod.ts";
import { ok, type Result } from "../../base/mod.ts";
import type {
  AuthenticatedContext,
  HealthObservation,
} from "../../protocol/server/mod.ts";
import { platformHealth, platformStatus } from "../../protocol/server/mod.ts";
import type { ReadHandler } from "../server/mod.ts";

// 구성 요소 하나의 현재 관측. 불가이면 안전한 이유를 함께 둔다(diagnostics R8).
export type ComponentStatus = {
  available: boolean;
  reason?: string;
};

export type StatusSource = {
  // 준비: 시작 순서가 끝나 API가 요청을 받는 상태.
  ready: boolean;
  // 적용된 schema step 수.
  schema: number;
  dataRoot: string;
  ledgerId: string;
  // 관측 시각은 응답을 만드는 시각이다. 구성 요소가 가진 옛 시각을 재사용하지 않는다.
  components(): readonly (readonly [string, ComponentStatus])[];
};

function observations(
  source: StatusSource,
  at: string,
): HealthObservation[] {
  return source.components().map(([component, status]) => ({
    component,
    available: status.available,
    ...(status.available || status.reason === undefined
      ? {}
      : { reason: status.reason }),
    observed_at: at,
  }));
}

// 인증은 API 입구가 이미 끝냈다. 여기서는 현재 상태만 읽는다.
export function platformStatusReads(
  source: StatusSource,
  clock: Clock,
): { status: ReadHandler; health: ReadHandler } {
  return {
    status(
      _ctx: AuthenticatedContext,
      _input: unknown,
    ): Result<unknown> {
      const observed = observations(source, clock.now());
      return ok({
        ready: source.ready,
        schema: source.schema,
        data_root: source.dataRoot,
        ledger_id: source.ledgerId,
        components: observed,
        as_of_seq: "0",
        next_cursor: null,
      });
    },
    health(): Result<unknown> {
      const at = clock.now();
      return ok({
        observations: observations(source, at),
        observed_at: at,
        as_of_seq: "0",
        next_cursor: null,
      });
    },
  };
}

export const PLATFORM_STATUS_ROUTES = {
  status: platformStatus,
  health: platformHealth,
};
