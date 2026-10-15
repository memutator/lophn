import type { TurnRecord } from "../../../protocol/lophn-agent/mod.ts";

// 사람에게 보이는 turn 상태. 모양과 위치는 shell이 정한다. 여기는 실제 사실만 낸다: 상태 셋, 현재 행동 한 줄,
// 경과 시간, 멈출 수 있는지. 진척을 모르면 퍼센트·예상 종료·추론 원문·장식 문구를 만들지 않는다.
// 사람 기다림은 turn 행이 아니라 session snapshot이 가지므로 호출자가 `waiting`으로 알린다.

export type TurnPhase = "running" | "waiting_for_you" | "finished";

// runtime이 지금 하는 일. 모르면 null이다.
export type TurnActivity =
  | { kind: "model_call" }
  | { kind: "tool"; tool: string }
  | { kind: "saving" };

export type TurnStatusView = {
  phase: TurnPhase;
  // 현재 행동 한 줄. 상태와 실제 하는 일로만 만든다.
  action: string;
  // 사람 기다림을 뺀 경과 시간.
  elapsed_ms: number;
  can_stop: boolean;
};

function line(
  turn: TurnRecord,
  waiting: boolean,
  activity: TurnActivity | null,
): string {
  if (turn.state === "finished") {
    return turn.outcome === null
      ? "Finished"
      : `Finished: ${turn.outcome.kind}`;
  }
  if (waiting) return "Waiting for your answer";
  if (activity === null) return "Working";
  if (activity.kind === "model_call") return "Thinking";
  if (activity.kind === "saving") return "Saving results";
  return `Using ${activity.tool}`;
}

// turn read의 경과(마지막 checkpoint)에 그 뒤 흐른 시간을 더한다. 사람을 기다리거나 끝난 turn은 더하지
// 않는다.
export function turnStatus(
  turn: TurnRecord,
  input: {
    activity?: TurnActivity | null;
    waiting?: boolean;
    nowMs: number;
  },
): TurnStatusView {
  const waiting = input.waiting === true;
  let elapsed = turn.elapsed.active_ms;
  if (
    turn.state === "running" && !waiting && turn.elapsed.checkpoint_at !== null
  ) {
    elapsed += Math.max(
      0,
      input.nowMs - Date.parse(turn.elapsed.checkpoint_at),
    );
  }
  return {
    phase: turn.state === "finished"
      ? "finished"
      : waiting
      ? "waiting_for_you"
      : "running",
    action: line(turn, waiting, input.activity ?? null),
    elapsed_ms: elapsed,
    can_stop: turn.state !== "finished",
  };
}
