import { type Clock, type ErrorCode, ok, type Result } from "../../base/mod.ts";
import type {
  processAssignmentOccurrence,
  ScheduleOccurrence,
} from "../../contracts/lophn-agent/mod.ts";
import type {
  CommandRequest,
  CommandResponse,
} from "../../contracts/platform/mod.ts";
import type { CoreRead } from "../harness/run-loop/mod.ts";

// 회차 시계. 승인된 Operator 주기마다 지금 처리할 회차를 ledger 밖에서 계산해
// ProcessAssignmentOccurrence로 낸다(domain-model lophn-agent/scheduling "계산
// 주체"). 시각은 주입한 clock에서만 얻고 model은 부르지 않는다. 같은 회차는
// 판단까지 같은 idempotency key라 재시작·재전송에 두 번 접수되지 않는다(R4).
// 기동·절전 복귀·사람 재개는 모두 tick() 한 번이고, 그때 가장 최근 회차 하나만
// 처리되며 앞 회차는 놓친 구간으로만 남는다(R6).

export type ProcessOccurrence = (
  body: CommandRequest<typeof processAssignmentOccurrence>,
) => Promise<Result<CommandResponse<typeof processAssignmentOccurrence>>>;

export type OccurrenceClockDeps = {
  clock: Clock;
  // core loopback read. assignment list만 부른다.
  read: CoreRead;
  process: ProcessOccurrence;
};

export type TickReport = {
  advanced: { assignment: string; occurrence: ScheduleOccurrence }[];
  // 이번에 처리하지 못한 assignment. 다음 tick이 현재 판과 시각으로 다시 계산한다.
  retry: { assignment: string; code: ErrorCode }[];
  // 켜진 주기 중 가장 빠른 다음 예정 시점. 주기가 하나도 없으면 null이다.
  next_due_at: string | null;
};

export type OccurrenceClock = {
  tick(): Promise<Result<TickReport>>;
  // wait이 끝날 때마다 tick한다. 절전 중에는 timer가 늦게 깨므로 대기를 MAX_IDLE_MS로
  // 끊어 복귀 뒤 한 번 안에 따라잡는다.
  run(control: {
    wait(ms: number): Promise<void>;
    stopped(): boolean;
  }): Promise<void>;
};

// 새 승인·재개·시계 점프를 이 안에 알아챈다.
export const MAX_IDLE_MS = 60_000;

export function createOccurrenceClock(
  deps: OccurrenceClockDeps,
): OccurrenceClock {
  // Operator 주기 선언이 assignment에서 없어졌다. 처리할 회차가 없어 시계는 비어 돈다.
  // 이 시계는 scheduling을 지우는 정리(agent-R3)가 함께 지운다.
  function tick(): Promise<Result<TickReport>> {
    return Promise.resolve(
      ok({ advanced: [], retry: [], next_due_at: null }),
    );
  }

  return {
    tick,
    async run(control) {
      while (!control.stopped()) {
        const ticked = await tick();
        const nextMs = ticked.ok && ticked.value.next_due_at !== null
          ? Date.parse(ticked.value.next_due_at) - deps.clock.nowMs()
          : MAX_IDLE_MS;
        await control.wait(Math.min(Math.max(nextMs, 1), MAX_IDLE_MS));
      }
    },
  };
}
