// 앱 프로세스 안의 automation 시계(apps/automations#R1-R9). release bundle의 플랫폼 진입 파일이라
// 의존성이 없다(Zod·npm 금지). 시각·타이머·permit·호출은 모두 주입받는다.
//
// 계기는 업무 통로가 열릴 때 한 번(on_start)과 열린 단조 tick 기준 간격(interval)뿐이다. 1초마다
// 도래를 보고, 놓친 회차는 다시 하지 않으며, 진행 중·한도 초과 회차는 대기열 없이 건너뛴다. 실패 뒤
// retry는 없고 다음 정해진 회차만 새 호출이다.

export const CHECK_INTERVAL_MS = 1000;
export const MIN_INTERVAL_MS = 60_000;
// 도래한 회차를 정상으로 보는 지연 한계. 검사가 이보다 늦게 돌면(절전·멈춤) 그 회차는 놓친 것이다.
export const LATE_TOLERANCE_MS = 2 * CHECK_INTERVAL_MS;
export const DEFAULT_TIMEOUT_MS = 600_000;

export type AutomationWhen =
  | { kind: "on_start" }
  | { kind: "interval"; interval_ms: number };

export type AutomationSpec = {
  key: string;
  when: AutomationWhen;
  command: string;
  input?: unknown;
};

// 회차를 시작하지 못한 이유. invocation이 아니라 시작하지 못했다는 사실이다.
export type SkipReason =
  | "channel_closed"
  | "schema_mismatch"
  | "in_progress"
  | "undeclared_command"
  | "confirm_required"
  | "invalid_input"
  | "handler_missing"
  | "permission_required"
  | "capacity"
  | "unavailable"
  | "missed";

export type Acquire =
  | { kind: "permit"; timeout_ms: number }
  // 전체 동시 한도나 같은 automation의 점유 때문에 지금 받을 수 없다. 기다리지 않는다.
  | { kind: "busy" }
  | { kind: "denied" }
  | { kind: "unavailable" };

export type Started = {
  invocation: string;
  // handler가 실제로 끝나거나 자식이 끝날 때까지 풀리지 않는다. reject하지 않는다.
  done: Promise<void>;
  // timeout을 알린다. 실제 종료로 취급하지 않고 permit도 풀지 않는다.
  timedOut(): void;
};

export type Prepared =
  | { ok: true; start(): Started }
  | { ok: false; reason: SkipReason };

export type AutomationPorts = {
  // 프로세스 단조 시계(ms). 벽시계가 아니다.
  tick(): number;
  every(ms: number, fn: () => void): () => void;
  after(ms: number, fn: () => void): () => void;
  // 업무 통로가 열려 있는지(준비·교체·preview·멈춤에서는 닫힘).
  open(): boolean;
  // 등록한 handler와 선언이 현재 release로 호출 가능한지.
  schemaOk(): boolean;
  // 직접 호출과 같은 검사(선언 command·confirm=false·고정 입력). 거절은 이유를 남긴다.
  prepare(spec: AutomationSpec): Prepared;
  acquire(key: string): Promise<Acquire>;
  release(key: string, invocation: string): Promise<void>;
};

export type AutomationStatus = {
  key: string;
  started_tick: number;
  next_tick: number | null;
  on_start_fired: boolean;
  running_invocation: string | null;
  last_skip: SkipReason | null;
  skipped: Partial<Record<SkipReason, number>>;
  started_turns: number;
};

type Entry = {
  spec: AutomationSpec;
  next_tick: number | null;
  on_start_fired: boolean;
  // 시작을 결정한 뒤 permit을 기다리는 동안은 "pending"이다. 이 사이에도 다음 회차는 겹치지 않는다.
  running: string | "pending" | null;
  last_skip: SkipReason | null;
  skipped: Partial<Record<SkipReason, number>>;
  started_turns: number;
};

export type AutomationClock = {
  // 업무 통로가 열렸다. 이 시각이 기준이 되고 on_start 회차를 한 번 시작한다. 두 번째부터는 무시한다.
  start(): void;
  // 통로가 닫혔다. 진행 중인 호출은 그대로 끝나기를 기다린다.
  stop(): void;
  status(): AutomationStatus[];
  // 시험이 검사를 직접 돌린다. 시계는 같은 함수를 1초마다 돈다.
  check(): void;
};

export function createAutomationClock(options: {
  automations: readonly AutomationSpec[];
  ports: AutomationPorts;
}): AutomationClock {
  const { ports } = options;
  const entries: Entry[] = options.automations.map((spec) => ({
    spec,
    next_tick: null,
    on_start_fired: false,
    running: null,
    last_skip: null,
    skipped: {},
    started_turns: 0,
  }));
  let startedTick: number | null = null;
  let cancel: (() => void) | null = null;

  function skip(entry: Entry, reason: SkipReason): void {
    entry.last_skip = reason;
    entry.skipped[reason] = (entry.skipped[reason] ?? 0) + 1;
  }

  async function fire(entry: Entry): Promise<void> {
    if (!ports.open()) return skip(entry, "channel_closed");
    if (!ports.schemaOk()) return skip(entry, "schema_mismatch");
    // 동기 구간에서 먼저 점유해 같은 key의 두 회차가 겹치지 않게 한다.
    if (entry.running !== null) return skip(entry, "in_progress");
    entry.running = "pending";
    try {
      const prepared = ports.prepare(entry.spec);
      if (!prepared.ok) {
        entry.running = null;
        return skip(entry, prepared.reason);
      }
      let acquired: Acquire;
      try {
        acquired = await ports.acquire(entry.spec.key);
      } catch {
        acquired = { kind: "unavailable" };
      }
      if (acquired.kind !== "permit") {
        entry.running = null;
        return skip(
          entry,
          acquired.kind === "busy"
            ? "capacity"
            : acquired.kind === "denied"
            ? "permission_required"
            : "unavailable",
        );
      }
      const started = prepared.start();
      entry.running = started.invocation;
      entry.started_turns += 1;
      const stopTimer = ports.after(acquired.timeout_ms, () => {
        started.timedOut();
      });
      // 실제 handler 종료 때만 점유를 푼다. timeout은 점유를 풀지 않는다.
      void started.done.catch(() => undefined).finally(() => {
        stopTimer();
        entry.running = null;
        void ports.release(entry.spec.key, started.invocation).catch(() =>
          undefined
        );
      });
    } catch (_error) {
      entry.running = null;
      skip(entry, "unavailable");
    }
  }

  function check(): void {
    if (startedTick === null) return;
    const now = ports.tick();
    for (const entry of entries) {
      const when = entry.spec.when;
      if (
        when.kind !== "interval" || entry.next_tick === null ||
        now < entry.next_tick
      ) continue;
      // 가장 가까운 지난 배수만 본다. 그 회차가 지연 한계를 넘었으면 복귀 전 놓친 것이다.
      const turns = Math.floor((now - startedTick) / when.interval_ms);
      const turnTick = startedTick + turns * when.interval_ms;
      entry.next_tick = turnTick + when.interval_ms;
      if (now - turnTick <= LATE_TOLERANCE_MS) void fire(entry);
      else skip(entry, "missed");
    }
  }

  return {
    start() {
      if (startedTick !== null) return;
      const now = ports.tick();
      startedTick = now;
      for (const entry of entries) {
        const when = entry.spec.when;
        if (when.kind === "interval") {
          entry.next_tick = now + when.interval_ms;
        }
      }
      cancel = ports.every(CHECK_INTERVAL_MS, check);
      for (const entry of entries) {
        if (entry.spec.when.kind !== "on_start" || entry.on_start_fired) {
          continue;
        }
        // 시작 회차는 접수 결과와 상관없이 한 번뿐이다. 재시작이 새 시작이다.
        entry.on_start_fired = true;
        void fire(entry);
      }
    },
    stop() {
      cancel?.();
      cancel = null;
    },
    check,
    status() {
      return entries.map((entry) => ({
        key: entry.spec.key,
        started_tick: startedTick ?? 0,
        next_tick: entry.next_tick,
        on_start_fired: entry.on_start_fired,
        running_invocation: entry.running === "pending" ? null : entry.running,
        last_skip: entry.last_skip,
        skipped: { ...entry.skipped },
        started_turns: entry.started_turns,
      }));
    },
  };
}
