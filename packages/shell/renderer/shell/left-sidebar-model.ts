// 왼쪽 sidebar가 그리는 값. 화면은 이 값과 callback만 안다(project 창, 뒤에 Home과 app workspace가 같이 쓴다).
import type { AgentFace } from "../parts/agent-session/agent-session.tsx";
import type { SessionDot } from "../parts/agent-session/activity.ts";
import type {
  Copy,
  ListedProject,
} from "../desktop/workspaces/projects/machine-workspaces.ts";
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
  /** 연필(Rename)을 두지 않는다. 다른 기계의 터미널 탭은 이름을 그 기계의 core에 쓸 수 없다. */
  readonly noRename?: true;
  /** 그 workspace 줄의 기계가 아닌 기계의 터미널(이 workspace에 연 다른 기계의 터미널 탭). 줄 끝에 그 기계의 꼬리표가 붙는다. */
  readonly machine?: string;
  /** 꺼진 기계의 줄(이 실행 동안 마지막으로 본 것). 흐리고 열리지 않는다. */
  readonly offline?: true;
  /**
   * 다른 기계의 터미널 coding agent. 줄이 자기 기계와 터미널을 들고 다니므로 열고 이름 바꾸는 쪽이 줄을 읽어 기계를 고른다
   * (줄이 여는 workspace의 기계로 짐작하지 않는다). `tab`은 이 창의 그 workspace layout에 이미 있는 탭의 key이고 없으면 null이다.
   */
  readonly remote?: {
    readonly machine: string;
    readonly terminal: string;
    readonly tab: string | null;
    readonly harness: string;
  };
  /** 팀(spawn tree)에서 이 줄의 자식. 같은 desk 묶음 안에 부모가 있는 session 줄이 그 부모 아래로 온다. */
  readonly children?: readonly SidebarSession[];
  /** lophn session이 주인인 탭(자기 대화 탭은 빼고). 줄을 펴면 보인다. 없으면 펼침 단추가 없다. */
  readonly tabs?: readonly SidebarTab[];
}

/** 탭의 자리. 탭 줄(group 칸 포함), 펴진 float, 접힌 float, detached. */
export type OwnedTabPlace = "tab" | "float" | "minimized" | "detached";

/** session이 주인인 탭 하나. layout 하나에서 모은 값이다. */
export interface OwnedTab {
  readonly key: string;
  readonly title: string;
  readonly kind: string;
  readonly desk: string;
  readonly place: OwnedTabPlace;
}

/** session 줄 아래의 탭 줄. 탭이 있는 workspace를 단다(session 줄과 다른 workspace일 수 있다). */
export interface SidebarTab extends OwnedTab {
  readonly workspace: WorkspaceRef;
}

/** 줄과 그 팀 자식 줄 전부(위에서 아래 순서). */
export const withChildren = (item: SidebarSession): SidebarSession[] => [
  item,
  ...(item.children ?? []).flatMap(withChildren),
];

export const sessionKey = (item: Pick<SidebarSession, "kind" | "ref">) =>
  `${item.kind}:${item.ref}`;

/** current 줄을 그 탭이 있는 desk로 나눈 묶음. */
export interface SidebarDeskGroup {
  /** 줄이 속한 desk. 탭 없는 줄도 Main desk에 든다. layout을 아직 못 읽은 workspace의 묶음 하나만 null이다. */
  readonly desk: { readonly key: string; readonly label: string } | null;
  /** 팀 tree의 맨 위 단계 줄. 자식 줄은 `children`에 든다. */
  readonly items: readonly SidebarSession[];
}

export interface SidebarWorkspace {
  readonly ref: WorkspaceRef;
  readonly name: string;
  /** 지금 열려 있거나 도는 session을 desk로 나눈 것. layout의 desk 순서다. 빈 묶음은 없다. */
  readonly current: readonly SidebarDeskGroup[];
  /** 끝났거나 닫은 session. 접힌 줄 하나로 시작한다. */
  readonly recent: readonly SidebarSession[];
  /** 같은 project인 다른 기계의 project. */
  readonly also?: readonly Copy[];
  /** project 줄의 목록 값. 다른 기계의 project를 이 컴퓨터로 가져오는 menu가 쓴다. */
  readonly listed?: ListedProject;
  /** 여는 기계가 꺼져 있다. 줄은 흐리고 열리지 않는다. */
  readonly offline?: true;
}
