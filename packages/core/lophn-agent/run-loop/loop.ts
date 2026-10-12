import { RunLimiter } from "./limits.ts";
import type {
  LoopDeps,
  LoopEnd,
  RunInput,
  RunLoopHandle,
  StopReason,
} from "./ports.ts";
import { type LoopState, runTurn } from "./turn.ts";

// 한 run의 agent loop(requirements lophn-agent/harness/run-loop R8). provider에 독립적이고, model
// call·tool 동작·시간 대기는 모두 비동기 호출이라 ledger writer나 다른 run을 점유하지 않는다.
// loop는 turn을 끝낼 때까지 되풀이하고 한도·멈춤·완료·사람 기다림에서 끝난다. 정상 완료·실패 확정은
// FinishRun이고 사람 멈춤은 core가 이미 확정했다.

export function startRunLoop(
  deps: LoopDeps,
  input: RunInput,
): RunLoopHandle {
  const state: LoopState = {
    deps,
    input,
    limiter: new RunLimiter({
      limits: input.limits,
      elapsed: input.elapsed,
      attempts: input.attempts,
      nowMs: () => deps.clock.nowMs(),
    }),
    control: new AbortController(),
    flags: {
      stop: null,
      providerRevoked: false,
      revokedServers: new Set(),
    },
    modelCalls: new Set(),
    serverCalls: new Map(),
    history: input.resume?.history ?? [],
    facts: input.resume?.facts ?? {
      changes: [],
      unexecuted: [],
      unknown_effects: [],
    },
    resume: {
      pending: input.resume?.pending ?? null,
      retry: input.resume?.retry ?? null,
    },
  };

  async function run(): Promise<LoopEnd> {
    for (;;) {
      const turn = await runTurn(state);
      if (turn.kind === "end") return turn.end;
    }
  }

  return {
    done: run(),
    stop(reason: StopReason) {
      // 새 진입은 이 순간부터 막히고 진행 중인 호출에는 중단을 요청한다.
      state.flags.stop ??= reason;
      state.control.abort();
    },
    revoke(change) {
      if ("provider" in change) {
        state.flags.providerRevoked = true;
        for (const call of state.modelCalls) call.abort();
        return;
      }
      state.flags.revokedServers.add(change.server);
      for (const call of state.serverCalls.get(change.server) ?? []) {
        call.abort();
      }
    },
  };
}
