import type { AgentSessionRow } from "../session/model.ts";

// 새 입력(사람 메시지, call, 답, reaction)을 받는지. 열린 session이고 그 workspace가 보관되지 않았을 때만이다.
// 보관한 workspace의 session은 열린 채 남고 다시 꺼내면 이어서 받는다.
export function acceptsInput(
  session: Pick<AgentSessionRow, "lifecycle">,
  workspaceArchived: boolean,
): boolean {
  return session.lifecycle === "open" && !workspaceArchived;
}
