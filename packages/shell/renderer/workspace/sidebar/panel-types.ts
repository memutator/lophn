// sidebar가 그리는 session 줄의 값. lophn session은 `useSessions()`에서, 터미널 coding agent session은
// `usePanelTerminals`가 만든다. 앱 공간의 run 목록(run-list)도 같은 session 줄을 쓴다.
import type { SessionDot } from "../../parts/agent-session/activity.ts";

/** sidebar가 쓰는 session 한 줄. `useSessions()`의 항목에서 부르는 쪽이 옮긴다. */
export interface PanelSession {
  readonly id: string;
  readonly title: string;
  /** 이 session을 가진 agent의 `asg_…`. */
  readonly agent: string;
  /** 탭 줄과 같은 상태 점. 없으면 null이다. */
  readonly dot: SessionDot | null;
  /** 이 창에 그 session의 탭이 열려 있다. 닫으면 Recent로 간다. */
  readonly open: boolean;
  /** 마지막으로 움직인 때(epoch ms). */
  readonly at: number;
}

/** 터미널 coding agent session 한 줄. 이 창의 탭에서 도는 것(live)이거나 main이 저장한 것(saved)이다. */
export interface PanelTerminal {
  /** live면 탭 key, saved면 harness와 session id. */
  readonly key: string;
  readonly harness: string;
  /** harness의 제품 이름. */
  readonly label: string;
  readonly title: string;
  readonly dot: SessionDot | null;
  /** 마지막으로 움직인 때(epoch ms). */
  readonly at: number;
  /** 이 창에서 도는 탭. 누르면 그 탭을 고른다. */
  readonly live: { readonly tabKey: string } | null;
  /** 탭이 그 workspace의 기계가 아닌 기계의 터미널이면 그 기계. 줄 끝에 꼬리표가 붙는다. */
  readonly machine?: string;
  /** 저장만 된 session. 누르면 그 폴더에서 새 터미널 탭을 연다. */
  readonly saved: {
    readonly folderRef: string;
    readonly externalSession: string;
    /** harness에 resume 규칙이 있어 이어 열 수 있다. */
    readonly resumable: boolean;
  } | null;
}
