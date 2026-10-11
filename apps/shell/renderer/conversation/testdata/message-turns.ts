// 메시지 배치 test의 fake. 시각은 화면 글로 고정해 둔다.
import type {
  TurnAgent,
  TurnBlock,
  TurnItem,
  TurnMessage,
} from "../message-list/turns.tsx";

export function turnMessageId(n: number): string {
  return `msg_01h455vb4pex5v6nkc6gd5f${String(n).padStart(3, "0")}`;
}

/** 이름이 "lophn"이 아닌 agent. 화면에 보이는 이름이 props에서 오는지 본다. */
export const CONTEXT_ENGINEER: TurnAgent = {
  name: "Context Engineer",
  profile: { kind: "icon", icon: "contexts" },
};

export function turnMessage(
  n: number,
  actor: TurnMessage["actor"],
  body: string,
  time: string,
): TurnMessage {
  return { kind: "message", id: turnMessageId(n), actor, body, time };
}

/** tool 줄·편집 카드처럼 부르는 쪽이 그려서 주는 block. 여기서는 글 한 줄로 갈음한다. */
export function turnBlock(id: string, node: string, time?: string): TurnBlock {
  return time === undefined
    ? { kind: "block", id, node }
    : { kind: "block", id, node, time };
}

export const TOOL_BLOCK = "tool-read-3";
export const EDIT_BLOCK = "edit-c049";
export const LEADING_BLOCK = "tool-read-1";

/**
 * 나 → agent 묶음(메시지, tool 줄, 메시지, 편집 카드, 메시지) → 나 → agent 묶음(tool 줄로 시작, 메시지).
 * 묶음은 둘이다.
 */
export const TURN_ITEMS: readonly TurnItem[] = [
  turnMessage(1, "user", "Link the release notes to the findings.", "9:00 AM"),
  turnMessage(2, "agent", "I found three findings.", "9:01 AM"),
  turnBlock(TOOL_BLOCK, "Read 3 documents ›"),
  turnMessage(3, "agent", "Two of them mention release notes.", "9:02 AM"),
  turnBlock(EDIT_BLOCK, "Edited findings/c-049.md +4 −1"),
  turnMessage(4, "agent", "I linked both.", "9:03 AM"),
  turnMessage(5, "user", "Thanks. Check the third one too.", "9:05 AM"),
  turnBlock(LEADING_BLOCK, "Read 1 document ›", "9:06 AM"),
  turnMessage(6, "agent", "The third one has no release notes.", "9:06 AM"),
];
