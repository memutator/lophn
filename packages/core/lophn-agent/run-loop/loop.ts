import { TurnLimiter } from "./limits.ts";
import type {
  LoopDeps,
  LoopEnd,
  StopReason,
  TurnInput,
  TurnLoopHandle,
} from "./ports.ts";
import { keepStopped, type LoopState, runTurn } from "./turn.ts";

// 한 turn의 agent loop. provider에 독립적이고, model call·tool 동작·시간 대기는 모두 비동기 호출이라
// ledger writer나 다른 turn을 점유하지 않는다. loop는 turn을 끝낼 때까지 되풀이하고 한도·멈춤·완료에서
// 끝난다. 정상 완료·실패 확정은 FinishTurn이고 멈춤·session 끝남·꺼짐은 core가 이미 확정했다. 사람의
// 결정을 기다리는 동안은 tool 호출이 돌아오지 않을 뿐 loop는 그대로 running이다.

export function startTurnLoop(
  deps: LoopDeps,
  input: TurnInput,
): TurnLoopHandle {
  const limiter = new TurnLimiter({
    limits: input.limits,
    elapsed: input.elapsed,
    attempts: input.attempts,
    nowMs: () => deps.clock.nowMs(),
  });
  const state: LoopState = {
    deps,
    input,
    limiter,
    // 여러 호출이 동시에 기다릴 수 있어 센다. 하나라도 기다리면 시간은 서지 않는다.
    pause: (() => {
      let waiting = 0;
      return {
        begin() {
          if (waiting++ === 0) limiter.enterWait();
        },
        end() {
          if (waiting > 0 && --waiting === 0) limiter.leaveWait();
        },
      };
    })(),
    control: new AbortController(),
    flags: {
      stop: null,
      providerRevoked: false,
      revokedServers: new Set(),
    },
    modelCalls: new Set(),
    serverCalls: new Map(),
    history: [],
    dated: false,
    closing: null,
    partialRun: 0,
    emptyRun: 0,
    repeat: null,
    anchor: null,
    sessionTokens: null,
    opening: null,
    overflowRecoveries: 0,
    dropImages: false,
    midTurnCompactions: 0,
    compactNext: false,
    facts: { changes: [], unexecuted: [], unknown_effects: [] },
  };

  async function run(): Promise<LoopEnd> {
    for (;;) {
      const turn = await runTurn(state);
      if (turn.kind !== "end") continue;
      // restarted·session_ended는 loop가 없거나 session이 끝난 뒤라 남기지 않는다.
      if (turn.end.kind === "stopped" && turn.end.reason === "user_stopped") {
        await keepStopped(state);
      }
      return turn.end;
    }
  }

  return {
    done: run(),
    compactNext: () => state.compactNext,
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
