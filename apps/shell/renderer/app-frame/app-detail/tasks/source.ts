// Tasks 탭이 읽고 쓰는 통로(shell#T50). 화면은 이 interface만 보고 core route 이름과 main IPC는 core-source.ts만
// 안다. 모양은 contracts의 `ListTicketScreen`·`ShowTicketScreen`(coding-agent#T27)에서 이 화면이 쓰는 field만
// 옮긴 것이다. 상태·다음 행동은 coding-agent가 정한 값 그대로이고 화면 문구는 shell이 wording key로 바꾼다.
// 기본 화면에는 claim·기한·connection ID·조건 원문·보고 원문이 없고 상세에만 펼친 자리가 있다.
import type {
  FolderChoiceView,
  HarnessName,
  PromptDelivery,
  TuiState,
} from "../../../../ipc/coding.ts";
import type { SourceResult } from "../source.ts";

export type { SourceResult };
export type { FolderChoiceView, HarnessName, PromptDelivery, TuiState };

/** 화면 상태 일곱 값(coding-agent/tickets#R27). 진행 상태와 준비 상태가 하나로 합쳐진 값이다. */
export type TaskState =
  | "needs_confirmation"
  | "ready"
  | "in_progress"
  | "reported"
  | "confirmed"
  | "check_failed"
  | "cancelled";

/** 사람이 할 다음 행동 하나. 할 일이 없으면 null이다. */
export type TaskNext =
  | "start"
  | "needs_confirmation"
  | "check_result"
  | "waiting_for_approval";

export interface TaskRow {
  readonly id: string;
  readonly kind: "implementation" | "repair";
  readonly title: string;
  /** 사람이 읽을 요청 문장. 복사할 문장의 본문이다. */
  readonly request: string;
  readonly problemCount: number;
  readonly state: TaskState;
  readonly next: TaskNext | null;
}

export type CheckResult = "pass" | "fail" | "inconclusive";

export type ConditionKind =
  | "test_command"
  | "app_test"
  | "reproduction_test"
  | "release_active"
  | "problems_closed"
  | "human_confirmation";

export interface TaskCondition {
  readonly position: number;
  readonly kind: ConditionKind;
}

export interface TaskCheck {
  readonly condition: number;
  readonly result: CheckResult;
}

export interface TaskDetail extends TaskRow {
  readonly why: string;
  /** 준비 중일 때 사람이 정해 줄 것. 준비되면 비어 있다. */
  readonly needs: readonly string[];
  /** 다음 취소·시작이 비교하는 판. 화면은 이 값을 그대로 보낸다. */
  readonly revision: string;
  /** 작업을 맡은 쪽이 쥐고 있는 기한(ISO). 펼친 자리에만 보인다. 없으면 null이다. */
  readonly heldUntil: string | null;
  readonly conditions: readonly TaskCondition[];
  /** 완료를 보고했는지. 보고는 주장이고 실제 검사와 다른 줄이다. */
  readonly reported: boolean;
  readonly checks: readonly TaskCheck[];
  /** 통과로 닫히지 않은 조건 번호. */
  readonly remaining: readonly number[];
}

/** [Start] 앞에서 사람이 고르는 것. 값이 하나뿐이면 화면이 미리 골라 둔다. */
export interface HarnessChoice {
  readonly id: HarnessName;
  readonly profile: string | null;
}

export interface ConnectionChoice {
  readonly id: string;
  readonly label: string;
}

export interface StartChoices {
  /** 지금 감지된 harness만. */
  readonly harnesses: readonly HarnessChoice[];
  /** 이 앱의 일에 쓸 수 있는 활성 연결(범위가 전체거나 이 앱). */
  readonly connections: readonly ConnectionChoice[];
  /** 등록된 project 폴더. 여럿이면 사람이 고른 뒤에 누른다. */
  readonly folders: readonly FolderChoiceView[];
}

/** 사람이 [Start]를 누른 값. main이 한 번 더 검사하고 다른 것으로 바꾸지 않는다. */
export interface StartPress {
  readonly ticket: string;
  readonly revision: string;
  readonly connection: string;
  readonly harness: HarnessName;
  readonly profile: string | null;
  readonly project: string;
  readonly folderRef: string;
}

export type StartOutcome =
  | { readonly ok: true }
  | {
    readonly ok: false;
    /** 시작하지 못한 이유 이름. 화면이 문장으로 바꾼다. */
    readonly reason: string;
    /** lophn이 열지 않고 자기 터미널 안내로 끝난 경우. */
    readonly ownTerminal: boolean;
  };

/** lophn이 연 coding TUI 하나. TUI 상태와 첫 prompt 전달은 Task 상태와 다른 사실이다. */
export interface TuiSession {
  readonly ticket: string;
  readonly tui: TuiState;
  readonly promptDelivery: PromptDelivery;
}

/** 사람이 Task를 새로 만들 때 쓰는 말. 나머지(근거·조건)는 접수가 정리한다. */
export interface TaskDraft {
  readonly title: string;
  readonly what: string;
  readonly why: string;
}

export interface TasksSource {
  list(app: string): Promise<SourceResult<readonly TaskRow[]>>;
  get(ticket: string): Promise<SourceResult<TaskDetail>>;
  /** [Start]에서 고를 harness·연결·폴더. */
  startChoices(app: string): Promise<SourceResult<StartChoices>>;
  /** lophn이 [Start]로 연 TUI와 지금 관측한 상태. */
  sessions(): Promise<SourceResult<readonly TuiSession[]>>;
  /** 누르는 것이 허락이라 확인 창이 없다. 결과를 모르면 code로 나온다. */
  start(press: StartPress): Promise<SourceResult<StartOutcome>>;
  /** 한 줄 사유로 취소한다. 확인 창이 없다. */
  cancel(
    ticket: string,
    revision: string,
    reason: string,
  ): Promise<SourceResult<null>>;
  /** 사람이 새 Task를 만든다. 확인 창이 없다. */
  create(app: string, draft: TaskDraft): Promise<SourceResult<{ ticket: string }>>;
}
