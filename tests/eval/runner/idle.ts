import type { Clock } from "../../../packages/base/mod.ts";
import { approvalsPending } from "../../../packages/protocol/approvals/mod.ts";
import { sessionSnapshotsList } from "../../../packages/protocol/events/mod.ts";
import { receivedMessageList } from "../../../packages/protocol/lophn-agent/mod.ts";
import type { Core } from "../../support/core/mod.ts";

export type Waiting = {
  session: string;
  questions: number;
  permissions: number;
};

export type Snapshot = {
  running: string[]; // state가 running인 session. coding session은 running·unknown·waiting이 모두 든다
  waiting: Waiting[]; // ask 질문이나 허락을 사람이 답할 때까지 멈춘 role agent session
  unstarted: { session: string; message: string }[]; // turn이 아직 가져가지 않은 입력
  pendingApprovals?: number; // 보류 request 수(activation). session 상태에 안 드러난다. 없으면 0
};

export type IdleResult =
  | { kind: "idle"; waiting: Waiting[] }
  | { kind: "timeout"; unstarted: string[]; running: string[] };

export type IdleHooks = {
  // 사람 역할 tick. waiting이나 보류 approval이 있을 때 poll마다 부르고, 하나라도 처리했으면 참이다.
  // 있으면 waiting과 보류 approval은 조용함이 아니다.
  act?(): Promise<boolean>;
  // 문자열(이유)을 주면 바로 timeout으로 끝낸다. 비용 상한이 쓴다.
  over?(): Promise<string | null>;
  // act가 한 번이라도 참이면 조용함이 quietMs 대신 이만큼 이어져야 idle이다.
  graceMs?: number;
};

export type IdleOptions = {
  timeoutMs?: number;
  quietMs?: number;
  pollMs?: number;
  stuckMs?: number; // turn이 안 된 입력이 이만큼 지나면 timeoutMs와 상관없이 timeout
  hooks?: IdleHooks;
};

// 조용함(running과 unstarted가 모두 빔)이 quietMs 동안 이어져야 idle이다. turn pump(500ms)가 방금 온
// 입력을 turn으로 만들기 전의 틈을 넘기려는 것이다. act가 없으면 waiting은 조용함에 든다(ask 대기는 정상 끝이다).
export async function waitUntilIdle(
  read: () => Promise<Snapshot>,
  deps: {
    clock: Clock;
    sleep: (ms: number) => Promise<void>;
    log?: (line: string) => void;
  },
  options: IdleOptions = {},
): Promise<IdleResult> {
  const {
    timeoutMs = 300_000,
    quietMs = 1_000,
    pollMs = 250,
    stuckMs = 300_000,
    hooks = {},
  } = options;
  const start = deps.clock.nowMs();
  const firstSeen = new Map<string, number>(); // turn이 안 된 입력 → 처음 본 때
  let needMs = quietMs;
  let quietSince: number | null = null;
  for (;;) {
    const snapshot = await read();
    const now = deps.clock.nowMs();
    const timeout = (reason?: string): IdleResult => {
      if (reason !== undefined) deps.log?.(reason);
      return {
        kind: "timeout",
        unstarted: snapshot.unstarted.flatMap((u) => [u.message, u.session]),
        running: snapshot.running,
      };
    };

    const over = await hooks.over?.();
    if (over) return timeout(over);

    // turn 준비가 예외로 끝나면 입력이 영영 turn이 되지 않고 기록도 없다. 90분을 기다리지 않고 잡는다.
    const present = new Set(snapshot.unstarted.map((u) => u.message));
    for (const id of firstSeen.keys()) {
      if (!present.has(id)) firstSeen.delete(id);
    }
    for (const id of present) if (!firstSeen.has(id)) firstSeen.set(id, now);
    const stuck = [...firstSeen].find(([, seen]) => now - seen >= stuckMs);
    if (stuck !== undefined) {
      return timeout(`입력 ${stuck[0]}이 ${stuckMs}ms 동안 turn이 되지 않았다`);
    }

    const pending = snapshot.pendingApprovals ?? 0;
    const humanDue = snapshot.waiting.length > 0 || pending > 0;
    let acted = false;
    if (hooks.act !== undefined && humanDue) {
      acted = await hooks.act();
      if (acted) needMs = hooks.graceMs ?? quietMs;
    }
    const quiet = !acted && snapshot.running.length === 0 &&
      snapshot.unstarted.length === 0 &&
      (hooks.act === undefined || !humanDue);
    if (quiet) {
      quietSince ??= now;
      if (now - quietSince >= needMs) {
        return { kind: "idle", waiting: snapshot.waiting };
      }
    } else {
      quietSince = null;
    }
    if (now - start >= timeoutMs) return timeout();
    await deps.sleep(pollMs);
  }
}

// coding session은 role agent와 달리 입력(receivedMessageList)을 읽지 않고, 일하는 중(running)이거나 신호를 못 받았거나(unknown)
// 터미널에서 물음이 떠 사람의 attach를 기다리는 중(waiting)이면 모두 running에 넣는다. 안 넣으면 role agent가 쉬는 동안
// trial이 coding agent를 기다리지 않고 끝난다. 입력은 첫 page만 읽는다(판단 case는 입력이 적다).
export async function readSnapshot(
  core: Core,
  options: { approvals?: boolean } = {},
): Promise<Snapshot> {
  const { snapshots } = await core.call(sessionSnapshotsList, {});
  const snapshot: Snapshot = { running: [], waiting: [], unstarted: [] };
  for (const item of snapshots) {
    if (item.agent.role === "coding_agent") {
      if (item.state !== "idle") snapshot.running.push(item.session);
      continue;
    }
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
  if (options.approvals) {
    snapshot.pendingApprovals =
      (await core.call(approvalsPending, {})).requests.length;
  }
  return snapshot;
}
