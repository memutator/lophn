// project sidebar가 그리는 agent 한 줄의 값. Agent 모양과 접힌 rail이 같이 쓴다.
// renderer는 protocol을 type check하지 않으므로 id는 문자열로 받는다.
import type { AvatarProfile } from "../../parts/avatar/avatar.tsx";

/**
 * project sidebar에 보이는 역할. 지금 값은 `"lophn"`과 `"operator"`만 온다.
 * type의 나머지 값은 이 file 밖 `workspace.tsx`가 견주어 남아 있다.
 */
export type SidebarAgentRole = "lophn" | "project_manager" | "operator";

/** Agent 모양의 agent 줄 하나. */
export interface SidebarAgent {
  /** agent id(`lophn` 또는 `agt_…`). */
  readonly assignment: string;
  readonly role: SidebarAgentRole;
  /** 줄에 보이는 이름(고정 글자가 아니라 사람이 지은 이름일 수 있다). */
  readonly name: string;
  readonly profile: AvatarProfile;
  /** 이 agent에 답을 기다리는 session이 하나라도 있다. 점은 저장하지 않는 표시 상태다. */
  readonly waiting: boolean;
}
