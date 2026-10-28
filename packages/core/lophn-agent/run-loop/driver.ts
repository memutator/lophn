import { ok } from "../../../base/mod.ts";
import {
  type AgentTurnCredential,
  beginTurn,
  type TurnCredentials,
} from "./credentials.ts";
import { startTurnLoop } from "./loop.ts";
import type {
  LoopEnd,
  StopReason,
  TurnInputs,
  TurnLoopHandle,
  TurnSource,
} from "./ports.ts";
import type { TurnPreparer } from "./prepare.ts";

// 입력함이 고른 turn을 시작하고 loop를 돌리는 연결. source가 맨 앞 입력을 고르면 preparer가 재료를 모아
// StartTurn으로 확정하고, `agent:<ses>` credential을 받아 loop에 넘긴다. turn이 끝나거나 멈추거나 감독이
// 끊기면 credential을 끝낸다. 켜질 때 돌던 turn은 core가 interrupted로 닫으므로 이 쪽에 이어 하기는 없다.

type DriveDeps = {
  source: TurnSource;
  credentials: TurnCredentials;
  preparer: Pick<TurnPreparer, "prepare" | "forget">;
  // 이전 대화가 커진 session을 다음 turn을 시작하기 전에 Compact한다. 실패해도 turn은 시작한다.
  compact?(session: string): Promise<unknown>;
};

type DriveResult =
  | { kind: "idle" }
  | { kind: "unavailable" }
  // turn을 시작할 수 없어 core가 failed로 닫았다. 입력은 소비됐다.
  | { kind: "not_started"; turn: string }
  | { kind: "started"; turn: string; done: Promise<LoopEnd> };

export type TurnDriver = {
  // 시작할 turn 하나를 골라 시작한다. 없으면 idle이다.
  startNext(): Promise<DriveResult>;
  // 멈춤이 접수됐다. 새 진입을 막고 진행 호출에 중단을 요청한다.
  stop(turn: string, reason: StopReason): void;
  // session이 끝났다. 도는 turn이 있으면 멈추고 고정한 tool 목록을 버린다.
  endSession(session: string): void;
  // provider를 Disconnect했다는 알림이다. 그 provider로 진행 중인 turn 가운데 지금 연결을 더 쓸 수 없는 것의
  // 새 model 진입을 막고 진행 중인 호출에 취소를 요청한다. 알림이 늦게 처리돼 같은 ID로 다시 Connect한 뒤 시작한
  // turn은 지금 연결에 묶여 있어 그대로 둔다. 다른 provider의 turn은 건드리지 않는다.
  revokeProvider(provider: string): Promise<void>;
  revokeServer(server: string): void;
  // 감독이 끊겼다. 새 진입을 막고 진행 호출을 취소하며 들고 있는 credential을 모두 끝낸다.
  endAll(): void;
  readonly active: number;
};

export function createTurnDriver(deps: DriveDeps): TurnDriver {
  const active = new Map<
    string,
    {
      session: string;
      provider: string;
      available(): Promise<boolean>;
      handle: TurnLoopHandle;
    }
  >();
  // 끝난 turn이 다음 turn 전에 Compact하라고 정한 session. runtime이 다시 뜨면 잊는다: 그 뒤 넘치는 turn이
  // 다시 정한다.
  const compactBefore = new Set<string>();

  // turn 하나의 입력 길. 시작 입력은 StartTurn 뒤 입력함에서 꺼낸 것이다.
  function inputsOf(
    session: Parameters<TurnSource["began"]>[0],
    first: Awaited<ReturnType<TurnSource["began"]>>,
  ): TurnInputs {
    return {
      first: () => Promise.resolve(first.ok ? ok(first.value) : first),
      steering: () => deps.source.steering(session),
      settled: (count) => deps.source.settled(session, count),
    };
  }

  return {
    async startNext() {
      const picked = await deps.source.next();
      if (!picked.ok) return { kind: "unavailable" };
      const start = picked.value;
      if (start === null) return { kind: "idle" };
      if (compactBefore.delete(start.session)) {
        await deps.compact?.(start.session);
      }
      const prepared = await deps.preparer.prepare(start);
      if (!prepared.ok) return { kind: "unavailable" };
      if (prepared.value.kind === "closed") {
        // core가 turn을 failed로 닫았다. 입력을 소비해 같은 입력이 다시 고르지 않게 한다.
        await deps.source.began(start.session);
        await deps.source.ended(start.session);
        return { kind: "not_started", turn: prepared.value.turn };
      }
      const turn = prepared.value.turn;
      const begun = await beginTurn(
        { credentials: deps.credentials, startTurn: turn.startTurn },
        turn.begin,
      );
      if (!begun.ok) {
        if (begun.started) {
          // StartTurn은 확정됐지만 credential을 받지 못했다. failed로 닫고 입력을 소비한다.
          await turn.closeStarted();
          await deps.source.began(start.session);
          await deps.source.ended(start.session);
        }
        return { kind: "not_started", turn: turn.turn };
      }
      const first = await deps.source.began(start.session);
      const credential: AgentTurnCredential = begun.value.credential;
      const {
        provider,
        deps: loopDeps,
        input,
      } = turn.loop(credential, inputsOf(start.session, first));
      const handle = startTurnLoop(loopDeps, input);
      active.set(turn.turn, {
        session: start.session,
        provider,
        available: () => loopDeps.ports.model.available(),
        handle,
      });
      const done = handle.done.finally(async () => {
        // turn 종료·멈춤에서 credential을 끝내고 session을 쉬는 상태로 돌린다.
        deps.credentials.end(turn.turn);
        active.delete(turn.turn);
        if (handle.compactNext()) compactBefore.add(start.session);
        await deps.source.ended(start.session);
      });
      return { kind: "started", turn: turn.turn, done };
    },
    stop(turn, reason) {
      active.get(turn)?.handle.stop(reason);
    },
    endSession(session) {
      for (const entry of active.values()) {
        if (entry.session === session) entry.handle.stop("session_ended");
      }
      deps.credentials.endSession(session);
      deps.preparer.forget(session);
      compactBefore.delete(session);
    },
    async revokeProvider(provider) {
      for (const entry of [...active.values()]) {
        if (entry.provider !== provider) continue;
        if (await entry.available()) continue;
        entry.handle.revoke({ provider: true });
      }
    },
    revokeServer(server) {
      for (const entry of active.values()) entry.handle.revoke({ server });
    },
    endAll() {
      for (const entry of active.values()) {
        entry.handle.revoke({ provider: true });
      }
      deps.credentials.endAll();
    },
    get active() {
      return active.size;
    },
  };
}
