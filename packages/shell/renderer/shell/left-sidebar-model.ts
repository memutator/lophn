// 왼쪽 sidebar가 그리는 값. 화면은 이 값과 callback만 안다(project 창, 뒤에 Home과 app workspace가 같이 쓴다).
import type { AgentFace } from "../parts/agent-session/agent-session.tsx";
import type { SessionDot } from "../parts/agent-session/activity.ts";
import type { Away } from "../desktop/workspaces/projects/merged.ts";
import type { WorkspaceRef } from "./desk-model.ts";

/**
 * session 줄의 종류. lophn agent session, 첫 메시지 전이라 아직 session이 없는 lophn Agent 탭(draft),
 * 터미널 coding agent session, 사람 차례인 workflow desk.
 */
export type SidebarSessionKind = "session" | "draft" | "terminal" | "workflow";

export interface SidebarSession {
  readonly kind: SidebarSessionKind;
  /** session id, draft는 탭 key, 터미널 key, workflow 이름. */
  readonly ref: string;
  readonly title: string;
  /** 줄 앞의 agent 아이콘. workflow desk는 vendor도 profile도 없다. */
  readonly agent: AgentFace | { readonly kind: "workflow" };
  readonly dot: SessionDot | null;
  /** 줄에 hover하면 연필(Rename)과 x(Stop)가 뜬다. draft는 이름을 둘 session이 없어 x만 뜬다. */
  readonly actions: boolean;
  /** 마지막으로 움직인 때(epoch ms). Recent 줄의 상대 시각이다. 모르면 0. */
  readonly at: number;
  /** 그 workspace 줄의 기계가 아닌 기계의 줄. 줄 끝에 그 기계의 꼬리표가 붙고 탭은 이 기계를 달고 열린다. */
  readonly machine?: string;
  /** 꺼진 기계의 줄(이 실행 동안 마지막으로 본 것). 흐리고 열리지 않는다. */
  readonly offline?: true;
}

export const sessionKey = (item: Pick<SidebarSession, "kind" | "ref">) =>
  `${item.kind}:${item.ref}`;

/** current 줄을 그 탭이 있는 desk로 나눈 묶음. */
export interface SidebarDeskGroup {
  /** 줄이 속한 desk. 탭 없는 줄도 Main desk에 든다. layout을 아직 못 읽은 workspace의 묶음 하나만 null이다. */
  readonly desk: { readonly key: string; readonly label: string } | null;
  readonly items: readonly SidebarSession[];
}

export interface SidebarWorkspace {
  readonly ref: WorkspaceRef;
  readonly name: string;
  /** 지금 열려 있거나 도는 session을 desk로 나눈 것. layout의 desk 순서다. 빈 묶음은 없다. */
  readonly current: readonly SidebarDeskGroup[];
  /** 끝났거나 닫은 session. 접힌 줄 하나로 시작한다. */
  readonly recent: readonly SidebarSession[];
  /** 이 컴퓨터에 없는 project를 가져오는 길(clone, 잇기). */
  readonly away?: Away;
  /** 여는 기계가 꺼져 있다. 줄은 흐리고 열리지 않는다. */
  readonly offline?: true;
}
