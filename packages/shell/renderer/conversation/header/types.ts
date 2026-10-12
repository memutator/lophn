// Agent 머리와 session popover가 받는 화면 값. CSS를 부르는 component 없이 type만
// 가져올 수 있게 따로 둔다.

/** avatar가 그리는 얼굴. design의 AvatarProfile과 같은 모양이다. */
export type AgentProfile =
  | { readonly kind: "icon"; readonly icon: string }
  | { readonly kind: "image"; readonly src: string }
  | { readonly kind: "initial"; readonly text: string };

export type SessionStatus = "waiting" | "working" | "idle";
export type SessionGroup = "today" | "earlier";

/** popover의 session 한 줄. */
export interface SessionLine {
  /** `ses_…` */
  readonly id: string;
  /** 이 session이 속한 agent(assignment, `asg_…`). 머리의 agent와 다르면 목록에 보이지 않는다. */
  readonly assignment: string;
  /** 비어 있지 않은 제목. 제목 없는 새 session의 말은 부르는 쪽이 정한다. */
  readonly title: string;
  /** ● Waiting for you(waiting), ◐ Working(working), 점 없음(idle). */
  readonly status: SessionStatus;
  /** 마지막 활동 시각(ISO). 줄에는 `now` 기준 상대 시각으로 보인다. */
  readonly activeAt: string;
  /** Today·Earlier 묶음. 부르는 쪽이 사용자 달력으로 가른다(component는 시간대를 다루지 않는다). */
  readonly group: SessionGroup;
  /** archive한 session. 기본 목록이 아니라 Archived (n) 아래에 있다. */
  readonly archived: boolean;
}

export interface HeaderAgent {
  /** `asg_…` */
  readonly assignment: string;
  /** 머리에 보이는 agent 이름(고정 글자가 아니다). */
  readonly name: string;
  readonly profile: AgentProfile;
}
