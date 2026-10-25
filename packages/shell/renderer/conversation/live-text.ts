// 아직 저장되지 않은 model 호출(attempt) 하나의 글. session snapshot의 `writing`에서 시작하고
// `ModelOutputStreamed` delta로 자라며, `MessageRecorded`나 `TurnEnded`가 오면 버린다. core의
// `run-loop/live-turns.ts`와 같은 규칙으로 접는다: 다른 model 호출의 조각이 오면 앞 글을 버리고(retry,
// 다음 호출), offset이 앞 글 길이를 넘는 조각은 붙이지 않고(gap) snapshot을 다시 읽게 한다. 화면에 무엇이
// 남는지는 이 접기가 정하므로 React 없이 둔다.
import type {
  AgentEvent,
  SessionSnapshot,
} from "../../../protocol/events/mod.ts";

export interface LiveText {
  /** 이 글이 사는 turn. */
  readonly turn: string;
  /** 지금 쓰는 중인 model 호출 하나. */
  readonly modelCall: string;
  readonly text: string;
  /** reasoning 글. 그리는 것은 reasoning-shell이 맡는다. */
  readonly reasoning: string;
  /** 이 글이 새 agent 묶음을 열 때 묶음 위의 시각(ISO). */
  readonly at: string;
  /** offset이 앞 글 길이보다 큰 delta를 받았다. snapshot을 다시 읽어야 한다. */
  readonly gap: boolean;
}

/** snapshot의 쓰는 중인 글. 칸이 없거나 null이면 아직 쓰는 글이 없다. */
export function liveFromWriting(
  writing: SessionSnapshot["writing"],
  at: string,
): LiveText | null {
  if (writing === undefined || writing === null) return null;
  return {
    turn: writing.turn,
    modelCall: writing.model_call,
    text: writing.text,
    reasoning: writing.reasoning,
    at,
    gap: false,
  };
}

type Delta = Extract<AgentEvent, { type: "ModelOutputStreamed" }>["payload"];

/**
 * delta 하나를 접는다. 겹친 조각(snapshot 뒤에 다시 접는 경우)은 두 번 붙지 않고, offset이 앞 글 길이를
 * 넘으면 붙이지 않고 gap을 세운다. 다른 model 호출의 조각이면 앞 글을 버리고 그 조각에서 시작한다.
 */
export function foldDelta(
  live: LiveText | null,
  delta: Delta,
  at: string,
): LiveText {
  const base: LiveText = live === null || live.modelCall !== delta.model_call
    ? {
      turn: delta.turn,
      modelCall: delta.model_call,
      text: "",
      reasoning: "",
      at,
      gap: false,
    }
    : live;
  const current = base[delta.kind];
  if (delta.offset > current.length) {
    return base.gap ? base : { ...base, gap: true };
  }
  const end = delta.offset + delta.text.length;
  if (end <= current.length) return base;
  return {
    ...base,
    [delta.kind]: current + delta.text.slice(current.length - delta.offset),
  };
}

// 0~3개 공백 뒤의 fence 시작이다. 연 fence는 끝까지 같은 문자로만 닫힌다.
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * 그릴 때만 쓰는 규칙: 닫히지 않은 code fence를 글 끝에서 닫는다. 쓰는 중인 글은 fence 가운데에서 끊기므로
 * 그대로 그리면 code block이 아니게 된다. 닫는 줄은 같은 문자를 연 길이 이상 쓰고 뒤에 공백만 둔다.
 */
export function closeOpenFence(text: string): string {
  let open: string | null = null;
  for (const line of text.split("\n")) {
    const fence = FENCE_LINE.exec(line)?.[1] ?? null;
    if (fence === null) continue;
    if (open === null) {
      open = fence;
      continue;
    }
    const closes = line.trim() === fence &&
      fence[0] === open[0] &&
      fence.length >= open.length;
    if (closes) open = null;
  }
  return open === null ? text : `${text}\n${open}`;
}
