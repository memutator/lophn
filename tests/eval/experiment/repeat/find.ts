import type { CollectedToolCall, TrialRecord } from "../../types.ts";

export type RepeatGroup = {
  session: string;
  tool: string;
  input_hash: string;
  calls: string[]; // 같은 tool·같은 인자의 tool call id, 시간 순
  timeline: CollectedToolCall[]; // 첫 되풀이부터 마지막 되풀이까지(양끝 포함)
};

const BLOCK_CODES = ["denied", "rejected"];

// 되풀이 규칙은 collect/metrics.ts의 tool 정확도와 같다: 재시도에 밀린 행과 model 탓이 아닌 미실행은 세지 않는다.
export function findRepeatGroups(
  trial: TrialRecord,
  minCount = 3,
): RepeatGroup[] {
  const groups: RepeatGroup[] = [];
  for (const session of trial.sessions) {
    const superseded = new Set(
      session.tool_calls
        .map((t) => t.call.retry_of)
        .filter((id) => id !== null),
    );
    const bySame = new Map<string, CollectedToolCall[]>();
    for (const t of session.tool_calls) {
      const { call } = t;
      const { outcome } = call;
      if (call.state !== "finished" || outcome === null) continue;
      if (superseded.has(call.id)) continue;
      if (
        outcome.kind === "not_executed" &&
        !BLOCK_CODES.includes(outcome.code)
      )
        continue;
      const key = `${call.tool}\n${call.input}`;
      bySame.set(key, [...(bySame.get(key) ?? []), t]);
    }
    for (const same of bySame.values()) {
      if (same.length < minCount) continue;
      const first = session.tool_calls.indexOf(same[0]);
      const last = session.tool_calls.indexOf(same[same.length - 1]);
      groups.push({
        session: session.session,
        tool: same[0].call.tool,
        input_hash: same[0].call.input,
        calls: same.map((t) => t.call.id),
        timeline: session.tool_calls.slice(first, last + 1),
      });
    }
  }
  // 큰 묶음이 먼저. 같은 크기는 찾은 순서(stable sort)
  return groups.sort((a, b) => b.calls.length - a.calls.length);
}
