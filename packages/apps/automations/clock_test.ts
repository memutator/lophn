import { assert, assertEquals } from "@std/assert";
import { manualClock } from "../../base/mod.ts";
import {
  type Acquire,
  type AutomationPorts,
  type AutomationSpec,
  CHECK_INTERVAL_MS,
  createAutomationClock,
  type Prepared,
  type SkipReason,
} from "./clock.ts";
import { createAutomationPermits } from "./permits.ts";
import { automationBlueprint, validationVerdict } from "./testing/mod.ts";

const MINUTE = 60_000;

type Turn = {
  key: string;
  invocation: string;
  finish(): void;
  fail(): void;
  timedOut: number;
};

// 가짜 단조 tick과 가짜 타이머. 시험이 시간을 직접 움직인다. 벽시계는 따로 있고 clock은 보지 않는다.
function world(
  automations: AutomationSpec[],
  over: {
    open?: () => boolean;
    schemaOk?: () => boolean;
    prepare?: (spec: AutomationSpec) => SkipReason | undefined;
    acquire?: (key: string) => Acquire;
    start?: number;
  } = {},
) {
  let tick = over.start ?? 5_000;
  const wall = manualClock(Date.parse("2026-10-06T00:00:00.000Z"));
  const intervals: { ms: number; fn: () => void; live: boolean }[] = [];
  const timeouts: { at: number; fn: () => void; live: boolean }[] = [];
  const turns: Turn[] = [];
  const released: { key: string; invocation: string }[] = [];
  const prepared: string[] = [];
  const permits = createAutomationPermits();
  let sequence = 0;
  const holder = (key: string) => ({ nonce: "n1", release: "rel_1", key });
  const ports: AutomationPorts = {
    tick: () => tick,
    every(ms, fn) {
      const entry = { ms, fn, live: true };
      intervals.push(entry);
      return () => {
        entry.live = false;
      };
    },
    after(ms, fn) {
      const entry = { at: tick + ms, fn, live: true };
      timeouts.push(entry);
      return () => {
        entry.live = false;
      };
    },
    open: over.open ?? (() => true),
    schemaOk: over.schemaOk ?? (() => true),
    prepare(spec): Prepared {
      prepared.push(spec.key);
      const refusal = over.prepare?.(spec);
      if (refusal !== undefined) return { ok: false, reason: refusal };
      return {
        ok: true,
        start() {
          sequence += 1;
          let settle!: () => void;
          const done = new Promise<void>((resolve) => {
            settle = resolve;
          });
          const turn: Turn = {
            key: spec.key,
            invocation: `inv_${sequence}`,
            finish: settle,
            fail: settle,
            timedOut: 0,
          };
          turns.push(turn);
          return {
            invocation: turn.invocation,
            done,
            timedOut: () => {
              turn.timedOut += 1;
            },
          };
        },
      };
    },
    acquire(key) {
      if (over.acquire) return Promise.resolve(over.acquire(key));
      const outcome = permits.tryAcquire(holder(key));
      return Promise.resolve(
        outcome === "granted"
          ? { kind: "permit", timeout_ms: 600_000 }
          : { kind: "busy" },
      );
    },
    release(key, invocation) {
      released.push({ key, invocation });
      permits.release(holder(key));
      return Promise.resolve();
    },
  };
  const clock = createAutomationClock({ automations, ports });
  async function flush() {
    // 가짜 port는 모두 microtask로만 끝난다. 실제 timer를 기다리지 않는다.
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  }
  return {
    clock,
    wall,
    turns,
    released,
    prepared,
    permits,
    flush,
    get tick() {
      return tick;
    },
    // 1초 timer를 따라 시간을 앞으로 보낸다.
    async advance(ms: number) {
      const target = tick + ms;
      while (tick < target) {
        tick = Math.min(tick + CHECK_INTERVAL_MS, target);
        for (const timeout of timeouts) {
          if (timeout.live && timeout.at <= tick) {
            timeout.live = false;
            timeout.fn();
          }
        }
        for (const interval of intervals) if (interval.live) interval.fn();
        await flush();
      }
    },
    // 절전·멈춤 뒤 한 번에 복귀한다. 그 사이 timer는 돌지 않았다.
    async resume(ms: number) {
      tick += ms;
      for (const interval of intervals) if (interval.live) interval.fn();
      await flush();
    },
    status: () => clock.status(),
    intervals,
  };
}

const every = (key: string, interval_ms = MINUTE): AutomationSpec => ({
  key,
  when: { kind: "interval", interval_ms },
  command: "lookup",
});
const atStart = (key: string): AutomationSpec => ({
  key,
  when: { kind: "on_start" },
  command: "lookup",
});

Deno.test("apps/automations#R2: 계기는 시작 한 번과 60000ms 이상 간격뿐이고 59999ms·cron·파일·event는 거절한다", async () => {
  // 선언 검사는 blueprint 정본 검증기가 한다(apps/blueprint#R14). clock은 받은 두 계기만 돈다.
  assertEquals(
    validationVerdict(automationBlueprint([every("a", MINUTE)])),
    true,
  );
  assertEquals(
    validationVerdict(automationBlueprint([atStart("a")])),
    true,
  );
  assertEquals(
    validationVerdict(automationBlueprint([every("a", MINUTE - 1)])),
    false,
  );
  for (
    const when of [
      { kind: "cron", expression: "* * * * *" },
      { kind: "file", path: "/tmp/x" },
      { kind: "event", name: "changed" },
    ]
  ) {
    assertEquals(
      validationVerdict(automationBlueprint([{
        key: "a",
        when,
        command: "lookup",
      } as unknown as AutomationSpec])),
      false,
      JSON.stringify(when),
    );
  }

  const w = world([atStart("boot"), every("tick")]);
  w.clock.start();
  await w.flush();
  assertEquals(w.turns.map((turn) => turn.key), ["boot"]);
  w.turns[0].finish();
  await w.advance(MINUTE - CHECK_INTERVAL_MS);
  // 59000ms째에는 아직 간격 회차가 없다.
  assertEquals(w.turns.length, 1);
  await w.advance(CHECK_INTERVAL_MS);
  assertEquals(w.turns.map((turn) => turn.key), ["boot", "tick"]);
  // 시작 회차는 두 번 돌지 않는다.
  w.turns[1].finish();
  await w.advance(MINUTE);
  assertEquals(w.turns.map((turn) => turn.key), ["boot", "tick", "tick"]);
});

Deno.test("apps/automations#R3: 간격은 시작 tick의 배수이고 벽시계 변경과 무관하며 재시작은 새 기준이다", async () => {
  const w = world([every("tick")]);
  w.clock.start();
  const started = w.tick;
  assertEquals(w.status()[0].next_tick, started + MINUTE);
  // 벽시계를 하루 뒤로·앞으로 돌려도 간격 기준은 그대로다.
  w.wall.set(Date.parse("2026-10-05T00:00:00.000Z"));
  await w.advance(MINUTE);
  w.turns[0].finish();
  w.wall.set(Date.parse("2027-01-01T00:00:00.000Z"));
  await w.advance(MINUTE);
  w.turns[1].finish();
  assertEquals(w.turns.length, 2);
  assertEquals(w.status()[0].next_tick, started + 3 * MINUTE);

  // 느린 회차가 끝난 시각이 다음 회차를 밀지 않는다. 배수는 시작 기준으로 고정이다.
  await w.advance(MINUTE + 30_000);
  assertEquals(w.turns.length, 3);
  w.turns[2].finish();
  await w.advance(MINUTE - 30_000);
  assertEquals(w.turns.length, 4);

  // 재시작은 새 프로세스의 새 시작이다. 시작 회차가 한 번 다시 돌고 간격은 새로 잡힌다.
  const next = world([atStart("boot"), every("tick")], { start: 90_000 });
  next.clock.start();
  await next.flush();
  assertEquals(next.turns.map((turn) => turn.key), ["boot"]);
  assertEquals(next.status()[1].next_tick, 90_000 + MINUTE);
});

Deno.test("apps/automations#R4: 통로가 닫혔거나 handler 목록이 선언과 맞지 않으면 handler 없이 이유를 남긴다", async () => {
  let open = false;
  let schema = true;
  const w = world([atStart("boot"), every("tick")], {
    open: () => open,
    schemaOk: () => schema,
  });
  w.clock.start();
  await w.flush();
  assertEquals(w.turns.length, 0);
  assertEquals(w.prepared.length, 0);
  assertEquals(w.status()[0].last_skip, "channel_closed");

  open = true;
  schema = false;
  await w.advance(MINUTE);
  assertEquals(w.turns.length, 0);
  assertEquals(w.status()[1].last_skip, "schema_mismatch");
  assertEquals(w.prepared.length, 0);

  schema = true;
  await w.advance(MINUTE);
  assertEquals(w.turns.length, 1);
  assertEquals(w.status()[1].started_turns, 1);

  // 통로를 닫으면 timer가 서고 새 회차가 없다.
  w.turns[0].finish();
  w.clock.stop();
  await w.advance(MINUTE * 3);
  assertEquals(w.turns.length, 1);
});

Deno.test("apps/automations#R5: 같은 automation은 진행 중이면 다음 회차를 건너뛰고 끝난 뒤 몰아서 실행하지 않는다", async () => {
  const w = world([every("slow")]);
  w.clock.start();
  await w.advance(MINUTE);
  assertEquals(w.turns.length, 1);
  // 1분 간격에 3분 넘게 걸린다. 그동안 도래한 회차는 쌓이지 않는다.
  await w.advance(3 * MINUTE);
  assertEquals(w.turns.length, 1);
  assertEquals(w.status()[0].skipped.in_progress, 3);
  w.turns[0].finish();
  await w.flush();
  // 끝난 직후에도 지난 회차를 보충하지 않는다.
  assertEquals(w.turns.length, 1);
  assertEquals(w.status()[0].running_invocation, null);
  await w.advance(MINUTE);
  assertEquals(w.turns.length, 2);
  // 동시에는 하나뿐이었다.
  assertEquals(w.permits.inUse, 1);
});

Deno.test("apps/automations#R6: 독립 automation 5개가 동시에 도래하면 4개만 시작하고 대기열에 쌓지 않는다", async () => {
  const w = world(["a", "b", "c", "d", "e"].map((key) => atStart(key)));
  w.clock.start();
  await w.flush();
  assertEquals(w.turns.length, 4);
  assertEquals(w.permits.inUse, 4);
  const skipped = w.status().find((s) => s.skipped.capacity === 1);
  assertEquals(skipped?.key, "e");
  // 하나가 끝나 permit이 돌아와도 한도 때문에 건너뛴 회차는 기다리고 있지 않다.
  w.turns[0].finish();
  await w.advance(10 * CHECK_INTERVAL_MS);
  assertEquals(w.turns.length, 4);
  assertEquals(w.released.length, 1);
  assertEquals(w.permits.inUse, 3);
});

Deno.test("apps/automations#R7: 1시간 멈췄다 켜면 지난 60회와 보충 1회 모두 실행하지 않고 다음 미래 간격부터 이어 간다", async () => {
  const w = world([every("tick")]);
  w.clock.start();
  const started = w.tick;
  await w.resume(60 * MINUTE + 30_000);
  assertEquals(w.turns.length, 0);
  assertEquals(w.status()[0].skipped.missed, 1);
  assertEquals(w.status()[0].next_tick, started + 61 * MINUTE);
  // 다음 정해진 배수에서 이어 간다.
  await w.advance(30_000);
  assertEquals(w.turns.length, 1);
  assertEquals(w.tick, started + 61 * MINUTE);
});

Deno.test("apps/automations#R8: 실패 직후 retry는 없고 다음 정해진 회차만 새 호출이다", async () => {
  const w = world([every("tick")]);
  w.clock.start();
  await w.advance(MINUTE);
  assertEquals(w.turns.length, 1);
  w.turns[0].fail();
  await w.flush();
  // 즉시 재실행도 retry timer도 없다. 다음 간격 직전까지 호출은 하나다.
  await w.advance(MINUTE - CHECK_INTERVAL_MS);
  assertEquals(w.turns.length, 1);
  await w.advance(CHECK_INTERVAL_MS);
  assertEquals(w.turns.length, 2);
  // 취소·retry용 timer가 따로 늘지 않았다: interval은 1초 검사 하나뿐이다.
  assertEquals(w.intervals.filter((entry) => entry.live).length, 1);
});

Deno.test("apps/automations#R9: timeout이면 종료 요청만 하고 handler가 실제로 끝나기 전에는 점유를 풀지 않는다", async () => {
  const w = world([every("slow")]);
  w.clock.start();
  await w.advance(MINUTE);
  const turn = w.turns[0];
  await w.advance(600_000 - CHECK_INTERVAL_MS);
  assertEquals(turn.timedOut, 0);
  await w.advance(CHECK_INTERVAL_MS);
  assertEquals(turn.timedOut, 1);
  // timeout 뒤에도 handler가 남았으니 같은 automation과 permit을 점유한다.
  assertEquals(w.status()[0].running_invocation, turn.invocation);
  assertEquals(w.released.length, 0);
  assertEquals(w.permits.inUse, 1);
  await w.advance(2 * MINUTE);
  assertEquals(w.turns.length, 1);
  turn.finish();
  await w.flush();
  assertEquals(w.released, [{ key: "slow", invocation: turn.invocation }]);
  assertEquals(w.permits.inUse, 0);
  assert(w.status()[0].running_invocation === null);
});

Deno.test("apps/automations#R13: 승인이 없으면 회차가 돌지 않고 이유만 남으며 승인 뒤 다음 회차부터 돈다", async () => {
  let approved = false;
  const w = world([every("sync")], {
    acquire: () =>
      approved ? { kind: "permit", timeout_ms: 600_000 } : { kind: "denied" },
  });
  w.clock.start();
  await w.advance(2 * MINUTE);
  assertEquals(w.turns.length, 0);
  assertEquals(w.status()[0].last_skip, "permission_required");
  assertEquals(w.status()[0].skipped.permission_required, 2);
  // 승인은 프로세스를 다시 띄우지 않고 다음 회차부터 적용된다.
  approved = true;
  await w.advance(MINUTE);
  assertEquals(w.turns.length, 1);
});
