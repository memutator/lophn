import type { RunRecord } from "../../../protocol/lophn-agent/mod.ts";

// 사람에게 보이는 run 상태(requirements lophn-agent/harness/run-loop R19). 모양과
// 위치는 shell이 정한다. 여기는 실제 사실만 낸다: 상태 넷, 현재 행동 한 줄, 경과
// 시간, 멈출 수 있는지. 진척을 모르면 퍼센트·예상 종료·추론 원문·장식 문구를 만들지 않는다.

export type RunPhase =
  | "accepted"
  | "running"
  | "waiting_for_you"
  | "finished";

// runtime이 지금 하는 일. 모르면 null이다.
export type RunActivity =
  | { kind: "model_call" }
  | { kind: "tool"; tool: string }
  | { kind: "saving" };

export type RunStatusView = {
  phase: RunPhase;
  // 현재 행동 한 줄. 상태와 실제 하는 일로만 만든다.
  action: string;
  // 사람 기다림을 뺀 경과 시간. 시작 전이면 null이다.
  elapsed_ms: number | null;
  can_stop: boolean;
};

const PHASE: Record<RunRecord["state"], RunPhase> = {
  accepted: "accepted",
  running: "running",
  waiting_user: "waiting_for_you",
  finished: "finished",
};

function line(run: RunRecord, activity: RunActivity | null): string {
  switch (run.state) {
    case "accepted":
      return "Waiting to start";
    case "waiting_user":
      return "Waiting for your answer";
    case "finished":
      return run.outcome === null
        ? "Finished"
        : `Finished: ${run.outcome.kind}`;
    case "running":
      if (activity === null) return "Working";
      if (activity.kind === "model_call") return "Thinking";
      if (activity.kind === "saving") return "Saving results";
      return `Using ${activity.tool}`;
  }
}

// run read의 경과(마지막 checkpoint)에 그 뒤 흐른 시간을 더한다. 사람을 기다리거나
// 끝난 run은 더하지 않는다.
export function runStatus(
  run: RunRecord,
  input: { activity?: RunActivity | null; nowMs: number },
): RunStatusView {
  let elapsed: number | null = null;
  if (run.started_at !== null) {
    elapsed = run.elapsed.active_ms;
    if (run.state === "running" && run.elapsed.checkpoint_at !== null) {
      elapsed += Math.max(
        0,
        input.nowMs - Date.parse(run.elapsed.checkpoint_at),
      );
    }
  }
  return {
    phase: PHASE[run.state],
    action: line(run, input.activity ?? null),
    elapsed_ms: elapsed,
    can_stop: run.state !== "finished",
  };
}
