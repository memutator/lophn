import { ok } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
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

// queue가 고른 turn을 시작하고 loop를 돌리는 연결. source가 맨 앞 입력을 고르면 preparer가 재료를 모아
// StartTurn으로 확정하고, `agent:<ses>` credential을 받아 loop에 넘긴다. turn이 끝나거나 멈추거나 감독이
// 끊기면 credential을 끝낸다. 켜질 때 돌던 turn은 core가 interrupted로 닫으므로 이 쪽에 이어 하기는 없다.

type DriveDeps = {
  source: TurnSource;
  credentials: TurnCredentials;
  preparer: Pick<TurnPreparer, "prepare" | "forget">;
  // 이전 대화가 커졌다고 끝난 turn이 정한 session을 그 session의 다음 turn을 시작하기 전에 Compact한다. 기다리지
  // 않고 돈다: 그동안 queue가 그 session을 도는 중으로 잡아 새 turn은 시작되지 않고, 다른 session의 turn 시작은
  // 막지 않는다. 끝나거나 실패하면 session을 푼다.
  compact?(session: string): Promise<unknown>;
  // turn이 던진 예외와 session을 쉬는 상태로 돌리지 못한 일을 남긴다.
  report?(text: string): void;
  // 시험이 loop 대신 끼운다.
  startLoop?: typeof startTurnLoop;
};

type DriveResult =
  | { kind: "idle" }
  | { kind: "unavailable" }
  // session의 다음 turn 전에 Compact를 시작하고 그 session을 잡았다. 입력은 queue에 그대로 있고 풀리면 다시
  // 골라진다. 부른 쪽은 바로 다음 session을 본다.
  | { kind: "compacting" }
  // turn을 시작할 수 없어 core가 failed로 닫았다. consumed는 입력이 queue에서 빠졌는지다. 빠지지 않았으면 같은
  // 입력이 다시 골라지므로 부른 쪽이 바로 다시 돌지 않는다.
  | { kind: "not_started"; turn: string; consumed: boolean }
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
  // 끝난 turn이 다음 turn 전에 Compact하라고 정한 session. runtime이 다시 뜨면 잊는다.
  const compactBefore = new Set<string>();
  // turn 하나의 입력 길. 시작 입력은 StartTurn 뒤 queue에서 꺼낸 것이다.
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

  // session을 쉬는 상태로 돌린다. 실패하면 한 번 더 하고, 그래도 안 되면 남긴다: 안 풀린 session은 running으로
  // 남아 입력을 더 받지 못한다.
  async function release(session: Id<"ses">): Promise<void> {
    let ended = await deps.source.ended(session);
    if (!ended.ok) ended = await deps.source.ended(session);
    if (!ended.ok) {
      deps.report?.(
        `session ${session} could not be released: ${ended.error.message}`,
      );
    }
  }

  // 시작하지 못한 turn의 입력을 queue에서 뺀다. 같은 입력이 다시 골라지지 않게 한다.
  async function consume(
    session: Id<"ses">,
    message: Id<"msg">,
  ): Promise<boolean> {
    const taken = await deps.source.began(session, message);
    if (!taken.ok) return false;
    if (taken.value !== null) await release(session);
    return true;
  }

  return {
    async startNext() {
      const picked = await deps.source.next();
      if (!picked.ok) return { kind: "unavailable" };
      const start = picked.value;
      if (start === null) return { kind: "idle" };
      const compact = deps.compact;
      if (compact !== undefined && compactBefore.has(start.session)) {
        compactBefore.delete(start.session);
        const held = await deps.source.hold(start.session);
        if (!held.ok || !held.value) {
          compactBefore.add(start.session);
          return { kind: held.ok ? "idle" : "unavailable" };
        }
        // 기다리지 않는다: 요약은 model call이라 오래 걸리고 pump는 다른 session의 turn을 시작해야 한다.
        void compact(start.session)
          .catch((error) => {
            deps.report?.(
              `session ${start.session} compact failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          })
          .finally(() => release(start.session));
        return { kind: "compacting" };
      }
      // prepare가 session 기록이 없는 입력을 거절하므로 이 뒤에는 있다.
      const message = start.input.message as Id<"msg">;
      const prepared = await deps.preparer.prepare(start);
      if (!prepared.ok) return { kind: "unavailable" };
      if (prepared.value.kind === "closed") {
        // core가 turn을 failed로 닫았다. 입력을 소비해 같은 입력이 다시 고르지 않게 한다.
        return {
          kind: "not_started",
          turn: prepared.value.turn,
          consumed: await consume(start.session, message),
        };
      }
      const turn = prepared.value.turn;
      const begun = await beginTurn(
        { credentials: deps.credentials, startTurn: turn.startTurn },
        turn.begin,
      );
      if (!begun.ok) {
        // StartTurn이 확정되기 전에 실패했으면 입력은 그대로 queue에 있다.
        if (!begun.started) {
          return { kind: "not_started", turn: turn.turn, consumed: false };
        }
        // StartTurn은 확정됐지만 credential을 받지 못했다. failed로 닫고 입력을 소비한다.
        await turn.closeStarted("credential");
        return {
          kind: "not_started",
          turn: turn.turn,
          consumed: await consume(start.session, message),
        };
      }
      const first = await deps.source.began(start.session, message);
      if (first.ok && first.value === null) {
        // StartTurn을 기록한 입력이 그 사이 queue에서 없어졌다(사람이 지움). 남의 입력을 집지 않고 turn을 닫는다.
        deps.credentials.end(turn.turn);
        await turn.closeStarted("input_gone");
        return { kind: "not_started", turn: turn.turn, consumed: true };
      }
      const credential: AgentTurnCredential = begun.value.credential;
      const {
        provider,
        deps: loopDeps,
        input,
      } = turn.loop(credential, inputsOf(start.session, first));
      const handle = (deps.startLoop ?? startTurnLoop)(loopDeps, input);
      active.set(turn.turn, {
        session: start.session,
        provider,
        available: () => loopDeps.ports.model.available(),
        handle,
      });
      const done = handle.done
        .catch(async (error): Promise<LoopEnd> => {
          // loop가 던졌다. 이 turn을 failed로 닫아 session이 running으로 남지 않게 한다.
          const text = error instanceof Error ? error.message : String(error);
          deps.report?.(`turn ${turn.turn} threw: ${text}`);
          await turn.closeStarted("loop_threw").catch(() => {});
          return {
            kind: "finish_failed",
            outcome: { kind: "failed", reason: "configuration_unavailable" },
            error: { code: "internal", message: text },
          };
        })
        .finally(async () => {
          // turn 종료·멈춤에서 credential을 끝내고 session을 쉬는 상태로 돌린다.
          deps.credentials.end(turn.turn);
          active.delete(turn.turn);
          // session을 풀기 전에 올려야 풀린 session이 표 없이 골라지지 않는다.
          if (handle.compactNext() && deps.compact !== undefined) {
            compactBefore.add(start.session);
          }
          await release(start.session);
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
