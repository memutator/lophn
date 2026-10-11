// Agent 화면 맨 위 머리와 그 session popover(shell/desktop#R38·R39).
// 화면 값은 lophn-agent/sessions contract에서 만든 view 값이다. renderer는 contracts를 type check하지
// 않으므로 id는 문자열로 받는다.
import type { ReactElement, ReactNode } from "react";
import type { AvatarProfile } from "@lophn/design/components";

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
  readonly profile: AvatarProfile;
}

export interface AgentHeaderProps {
  agent: HeaderAgent;
  /** 지금 보는 session. 제목이 머리에 보이고 popover 줄에 ✓가 붙는다. */
  session: { readonly id: string; readonly title: string };
  /** 그 자리에서 읽은 session 목록(archived 포함). 정렬은 부르는 쪽이 한다. */
  sessions: readonly SessionLine[];
  /** 상대 시각의 기준. */
  now: Date;
  /** 줄을 눌렀다. popover는 닫힌다. */
  onSwitch: (session: string) => void;
  /** [+ New session]을 눌렀다. popover는 닫힌다. */
  onNew: () => void;
  /** 이름 입력칸에서 Enter(또는 Save). 앞뒤 공백을 뺀 비지 않은 제목만 부른다. */
  onRename: (session: string, title: string) => void;
  onArchive: (session: string) => void;
  /** Archived 줄의 Restore. */
  onUnarchive: (session: string) => void;
  /** 확인 dialog의 Delete를 누른 뒤에만 부른다. */
  onDelete: (session: string) => void;
  /** closed session이면 true. ⋯ 메뉴에서 Rename·Fork·Rewind…가 빠지고 Usage·Close tab만 남는다. */
  sessionClosed: boolean;
  /** ⋯ 메뉴 Fork. 마지막 확정 메시지까지 복사한다(R48). */
  onForkSession: () => void;
  /** ⋯ 메뉴 Rewind…. 되돌리기 menu를 여는 일은 부르는 쪽 몫이다(내 메시지의 Rewind to here와 같은 menu). */
  onRewindMenu: () => void;
  onUsage: () => void;
  /** 탭·칸만 닫는다. session은 그대로 남는다. */
  onCloseTab: () => void;
  /** ⋯ 메뉴 왼쪽의 진행 chip·보기 상세 select는 다른 task 몫이라 자리만 연다. */
  children?: ReactNode;
}

/**
 * 약속하는 DOM(test가 단언):
 * - 머리: `[data-agent-header]` 안에 avatar(`[data-avatar]`), agent 이름, `·`, session 제목이 이 순서로 있고
 *   trigger `button[data-session-trigger]`(aria-haspopup)가 이 글을 품는다. agent를 고르는 칸은 없다.
 * - ⋯ 메뉴: 머리 오른쪽 `button[aria-label="More"]`(children 자리 뒤)가 `role=menu`를 열고 항목
 *   `role=menuitem`이 Rename, Fork, Rewind…, Usage, Close tab 순서다. closed session이면 Usage, Close tab뿐.
 *   Rename은 머리의 session 제목을 `input[data-header-rename][aria-label="Rename <제목>"]`(현재 제목이 값)로
 *   바꾸고 Enter로 `onRename(session.id, 앞뒤 공백을 뺀 제목)`, Escape로 취소(공백뿐이면 부르지 않는다).
 *   Fork `onForkSession()`, Rewind… `onRewindMenu()`, Usage `onUsage()`, Close tab `onCloseTab()`.
 * - popover: `[data-session-popover]`(portal). 맨 위 검색 `input[aria-label="Search <agent 이름> sessions"]`,
 *   `[role=listbox]` 안에 `[data-session-group]`(`Today`·`Earlier`) 머리와 줄
 *   `[role=option][data-session=<id>]`. 줄 안에 `[data-check]`(현재 줄만 ✓, 아니면 빈 글),
 *   상태 점(`role=img`, aria-label "Waiting for you"·"Working", idle은 점 없음),
 *   `[data-session-title]`, `[data-session-when]`(상대 시각, 영어 Intl). 현재 줄은 `aria-selected=true`.
 *   맞는 줄이 없으면 `[data-no-match]` "No sessions match.".
 * - 줄 단추: 줄 안의 aria-label "Rename"·"Archive"·"Delete" 단추가 이 순서로 있다(hover 노출은 CSS 몫).
 *   단추를 눌러도 줄을 누른 것으로 치지 않는다.
 * - Rename: 줄이 `input[aria-label="Rename <제목>"]`로 바뀌고 Enter 저장, Escape 취소.
 * - Delete: 줄이 `role=alertdialog`가 되어 `Delete "<제목>"? This can't be undone.`와 Delete·Cancel.
 * - 아래: `Archived (n)` 단추(aria-expanded), 펼치면 줄 `[data-archived-session=<id>]`마다
 *   `[data-session-title]`과 Restore. `New session` 단추.
 */
export function AgentHeader(_props: AgentHeaderProps): ReactElement {
  throw new Error("not implemented: agent-I21");
}
