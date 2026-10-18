import type { Clock } from "../../../packages/base/mod.ts";
import { sessionSnapshotsList } from "../../../packages/protocol/events/mod.ts";
import { receivedMessageList } from "../../../packages/protocol/lophn-agent/mod.ts";
import type { Core } from "../../support/core/mod.ts";

export type Waiting = {
  session: string;
  questions: number;
  permissions: number;
};

export type Snapshot = {
  running: string[]; // state가 running인 session
  waiting: Waiting[]; // ask 질문이나 허락을 사람이 답할 때까지 멈춘 session
  unstarted: { session: string; message: string }[]; // turn이 아직 가져가지 않은 입력
};

export type IdleResult =
  | { kind: "idle"; waiting: Waiting[] }
  | { kind: "timeout"; unstarted: string[]; running: string[] };

export type IdleOptions = {
  timeoutMs?: number;
  quietMs?: number;
  pollMs?: number;
};

// 조용함(running과 unstarted가 모두 빔)이 quietMs 동안 이어져야 idle이다. turn pump(500ms)가 방금 온
// 입력을 turn으로 만들기 전의 틈을 넘기려는 것이다. waiting은 조용함에 든다(ask 대기는 정상 끝이다).
export async function waitUntilIdle(
  read: () => Promise<Snapshot>,
  deps: { clock: Clock; sleep: (ms: number) => Promise<void> },
  options: IdleOptions = {},
): Promise<IdleResult> {
  const { timeoutMs = 300_000, quietMs = 1_000, pollMs = 250 } = options;
  const start = deps.clock.nowMs();
  let quietSince: number | null = null;
  for (;;) {
    const snapshot = await read();
    const now = deps.clock.nowMs();
    if (snapshot.running.length === 0 && snapshot.unstarted.length === 0) {
      quietSince ??= now;
      if (now - quietSince >= quietMs) {
        return { kind: "idle", waiting: snapshot.waiting };
      }
    } else {
      quietSince = null;
    }
    // turn 준비가 예외로 끝나면 입력이 영영 turn이 되지 않고 기록도 없다. 멈춘 이유를 이 값으로만 안다.
    if (now - start >= timeoutMs) {
      return {
        kind: "timeout",
        unstarted: snapshot.unstarted.flatMap((u) => [u.message, u.session]),
        running: snapshot.running,
      };
    }
    await deps.sleep(pollMs);
  }
}

// coding agent session은 기다림에서 뺀다. 입력은 첫 page만 읽는다(판단 case는 입력이 적다).
export async function readSnapshot(core: Core): Promise<Snapshot> {
  const { snapshots } = await core.call(sessionSnapshotsList, {});
  const snapshot: Snapshot = { running: [], waiting: [], unstarted: [] };
  for (const item of snapshots) {
    if (item.agent.role === "coding_agent") continue;
    if (item.state === "running") snapshot.running.push(item.session);
    if (item.state === "waiting") {
      snapshot.waiting.push({
        session: item.session,
        questions: item.questions.length,
        permissions: item.permission_requests.length,
      });
    }
    const { messages } = await core.call(receivedMessageList, {
      session: item.session,
    });
    for (const message of messages) {
      if (message.turn === null) {
        snapshot.unstarted.push({ session: item.session, message: message.id });
      }
    }
  }
  return snapshot;
}
