// Agent 화면(agent-view.tsx)이 core에 묻고 쓰는 통로. 한 agent의 한 화면이 쓰는 읽기와 쓰기를 모두
// 담고, 값은 contract(lophn-agent/sessions·messages·questions·commands·models·traces)를 부품 props의 모양으로
// 옮긴 화면 값이다. renderer는 contracts를 type check하지 않으므로 id는 문자열이다. 이 interface를 구현하는 쪽
// (core source)이 contract 값 이름과 화면 값을 잇는다.
//
// source는 agent 하나에 묶여 있다. 화면이 열려 있는 동안 agent는 바뀌지 않는다.
import type { ConnectionState } from "../desktop/connection/connection.ts";
import type { EditView, TaskView, ToolLineView } from "./activity/model.ts";
import type {
  ApprovalCardRequest,
  ApprovalChoice,
} from "./approval-card/model.ts";
import type { ContextChipView } from "./composer/types.ts";
import type { HeaderAgent, SessionLine } from "./header/types.ts";
import type {
  PickerAxisView,
  PickerLayoutView,
  PickerModelRef,
  PickerNoticeView,
} from "./model-picker/types.ts";
import type {
  AnswerSummaryStatus,
  GroupAnswer,
  QuestionGroupView,
} from "./question-card/model.ts";
import type { SlashEntryView, SlashGroupView } from "./slash-menu/types.ts";

export type SourceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string };

export type AgentRole =
  | "lophn"
  | "app_engineer"
  | "context_engineer"
  | "operator";

/** 화면이 고정해 보이는 agent와 그 자리. 머리·composer의 자리 이름·권한 요약이 여기서 온다. */
export interface AgentFace extends HeaderAgent {
  readonly role: AgentRole;
  /** paused와 withdrawn은 새 입력을 받지 않는다. */
  readonly state: "enabled" | "paused" | "withdrawn";
  readonly place: { readonly kind: "project" | "app"; readonly name: string };
  /** 그 session의 실제 권한을 한 줄로 요약한 글. */
  readonly permissionSummary: string;
}

/** session 목록의 한 줄. Today·Earlier 묶음은 부르는 쪽(화면)이 사용자 달력으로 가른다. */
export interface SessionEntry extends Omit<SessionLine, "group" | "title"> {
  /** 첫 말이 오기 전의 session은 제목이 없다. 그 자리의 말은 화면이 정한다. */
  readonly title: string | null;
  /** assignment 회수로 닫힌 session. 읽기만 한다. */
  readonly closed: boolean;
}

/** 답 아래에 두는 결과. 실제로 만들거나 바꾼 문서·context만이다. */
export type ResultLink =
  | { readonly kind: "document"; readonly document: string }
  | { readonly kind: "context"; readonly context: string }
  | {
    readonly kind: "version";
    readonly document: string;
    readonly version: string;
  };

/** 사람 말의 본문 값. 글 part만이고 hash·blob은 core가 만든다. */
export interface TextContent {
  readonly schema_version: 1;
  readonly parts: readonly [{ readonly kind: "text"; readonly text: string }];
}

/**
 * 확정 메시지 본문의 한 part. 시각 블록은 받은 값 그대로이며 블록 renderer
 * (workspace/visuals/registry.ts)가 그리기 전에 검사한다.
 */
export type BodyPart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "visual"; readonly block: unknown };

/** 한 줄 안에 있는 모든 항목의 공통. `at`은 ISO 시각이고 화면이 시계 글로 바꾼다. */
interface EntryBase {
  readonly id: string;
  readonly at: string;
}

export interface ThreadMessage extends EntryBase {
  readonly kind: "message";
  readonly actor: "user" | "agent" | "machine";
  /** 이 메시지를 맡은 run. 끝났는지를 같이 줘서 문서로 남기기의 진행을 셀 수 있다. */
  readonly run: { readonly id: string; readonly ended: boolean } | null;
  readonly mode: "request" | "correction" | null;
  /** model 판단에 처음 반영됐는지. 접수와 따로 보인다. */
  readonly applied: boolean;
  readonly results: readonly ResultLink[];
}

/** run trace에서 그린 tool 줄. trace에 없는 줄은 없다. */
export interface ThreadTools extends EntryBase {
  readonly kind: "tools";
  readonly tool: ToolLineView;
}

/**
 * 이 편집을 지금 Undo할 수 있는가. 지금 파일이 그 call이 쓴 내용과 같고 더 나중 편집이
 * 없을 때만 true다. 아니면 사전 검사가 낸 이유 코드를 준다. 어느 call의 편집인지 모르면 reason은 `unknown`이다.
 */
export type EditUndo =
  | { readonly can: true }
  | { readonly can: false; readonly reason: RewindReason | "unknown" };

export interface ThreadEdit extends EntryBase {
  readonly kind: "edit";
  readonly edit: EditView;
  /** [Undo]를 눌러 되돌린 뒤이다. Undo를 다시 되돌리는 기능은 없다. */
  readonly undone: boolean;
  readonly undo: EditUndo;
}

/** 되돌리기가 대상을 고르지 못하거나 항목을 설명하는 이유 코드(contracts revertReasonSchema). */
export type RewindReason =
  | "edited_outside"
  | "chain_broken"
  | "no_pre_image"
  | "link_path"
  | "rename_blocked"
  | "created_edited"
  | "no_receipt"
  | "no_revert_command"
  | "app_revision_changed"
  | "external_effect"
  | "already_reverted"
  | "answered_fact"
  | "app_failed"
  | "app_uncertain"
  | "app_not_started"
  | "app_not_settled"
  | "later_edit";

/** 되돌린 구간에서 복원하지 못한 항목 하나. receipt 같은 안쪽 근거는 없다. */
export interface RewindResultView {
  readonly kind: "file" | "app" | "fact";
  readonly target: string;
  readonly result:
    | "skipped"
    | "remained"
    | "failure"
    | "uncertain"
    | "unchanged";
  readonly reason: RewindReason | null;
}

/**
 * rewind가 숨긴 구간. 메시지는 지워지지 않고 한 줄로 접히며, 펼치면 숨긴 줄을 읽기만 한다.
 * 숨긴 줄 안의 메시지는 다시 시점으로 고를 수 없다.
 */
export interface ThreadHidden extends EntryBase {
  readonly kind: "hidden";
  /** 이 구간을 숨긴 rewind. 구간 안에서 Redo를 할 수 있는 가장 나중 것, 없으면 가장 나중 것이다. */
  readonly revert: string;
  /** 그 rewind가 고른 사람 메시지. 되돌린 뒤 입력창에 원문을 채우는 데 쓴다. */
  readonly checkpoint: string;
  readonly choice: "restore_all" | "messages_only";
  /** 숨긴 메시지 수. */
  readonly count: number;
  /** 실제로 복원한 문서 파일 수. */
  readonly restored: number;
  /** 복원하지 못했거나 남은 항목(이유와 함께). */
  readonly left: readonly RewindResultView[];
  /** 다음 사람 메시지를 보내기 전이라 Redo를 할 수 있다. */
  readonly redo: boolean;
  /** 숨긴 줄. */
  readonly entries: readonly ThreadEntry[];
}

/** 끝난 run의 꼬리. 정상 종료는 "Worked for", 멈춤·실패는 사람에게 멈춤이다. */
export interface ThreadRunEnd extends EntryBase {
  readonly kind: "run-end";
  readonly outcome: "completed" | "stopped";
  readonly durationMs: number;
}

/** 대화 안 질문 묶음. `answered`가 null이면 아직 답을 기다리는 카드다. */
export interface ThreadQuestions extends EntryBase {
  readonly kind: "questions";
  readonly group: QuestionGroupView;
  readonly answered: {
    readonly status: AnswerSummaryStatus;
    readonly answers: readonly GroupAnswer[];
  } | null;
}

export type ThreadEntry =
  | ThreadMessage
  | ThreadTools
  | ThreadEdit
  | ThreadRunEnd
  | ThreadQuestions
  | ThreadHidden;

/** 한 session 화면 전체: 시간순 줄, 지금 일, 진행, composer 위에 붙는 승인. */
export interface ThreadView {
  readonly entries: readonly ThreadEntry[];
  /** 가장 늦게 접수된 run. 수정과 멈춤의 대상이다. 없으면 null이다. */
  readonly run: {
    readonly id: string;
    readonly phase: "working" | "waiting" | "ended";
  } | null;
  /** 일하는 중의 할 일 목록. 일하지 않으면 비어 있다. */
  readonly tasks: readonly TaskView[];
  /** 결정을 기다리는 승인 요청 하나. 없으면 null이다. */
  readonly approval: ApprovalCardRequest | null;
}

/** model 단추와 picker가 그릴 값. 정렬·거르기·값 맞춤은 model catalog가 정한다(harness/model). */
export interface ModelView {
  readonly current: PickerModelRef;
  readonly currentLabel: string;
  readonly axes: readonly PickerAxisView[];
  readonly optionValues: Readonly<Record<string, string>>;
  readonly layout: PickerLayoutView;
  /** 방금 model을 바꾸며 맞춘 값. 읽기만 한 응답에서는 비어 있다. */
  readonly notices: readonly PickerNoticeView[];
}

/** 대화 입력 위에 놓이는 안내 한 줄. 지금 일에 필요한 행동 하나만 말한다. */
export type AgentNotice =
  | { readonly kind: "provider-lost" }
  | {
    readonly kind: "external";
    readonly state: "waiting" | "connection-failed" | "unknown";
    readonly connection: string;
    readonly action: "reconnect" | "check" | null;
    /** 확정된 다음 시도 시각(ISO). 없으면 시간을 세지 않는다. */
    readonly retryAt: string | null;
  };

export interface SendInput {
  readonly session: string;
  /** 메시지 id와 idempotency key. 같은 id·key로 다시 보내면 core가 이전 결과를 돌려준다. */
  readonly id: string;
  readonly key: string;
  readonly text: string;
  readonly mode: "request" | "correction";
  /** 수정이 가리키는 지금 일. 다음 요청은 null이다. */
  readonly run: string | null;
}

export type RewindChoice = "restore_all" | "messages_only" | "summarize";

/** 선택지를 고르지 못하는 이유. 문서 복원 한도(contracts checkpointFilesReasonSchema)와 checkpoint가 아닌 메시지다. */
export type RewindBlock =
  | "correction"
  | "copied"
  | "limit_total"
  | "limit_file"
  | "limit_count"
  | "record_failed";

/** 시점으로 고를 수 있는 사람 메시지 하나와 그 시점에서 고를 수 없는 범위. */
export interface RewindPoint {
  readonly message: string;
  readonly blocked: Partial<Record<RewindChoice, RewindBlock>>;
}

export interface RewindMenuView {
  /** 끝나지 않았거나 기다리는 work가 있다. 먼저 멈춰야 한다. */
  readonly running: boolean;
  /** 숨긴 구간 밖의 사람 메시지, 오래된 순이다. */
  readonly points: readonly RewindPoint[];
}

/** 사전 검사의 항목 하나. 앱 복원 근거(receipt 원문)는 화면에 오지 않는다. */
export interface RewindItemView {
  readonly kind: "file" | "app" | "fact";
  readonly target: string;
  readonly reason: RewindReason | null;
}

export interface RewindPreviewView {
  readonly restore: readonly RewindItemView[];
  readonly skip: readonly RewindItemView[];
  readonly remain: readonly RewindItemView[];
  /** redo 예고. 앱 복원이 있거나 요약이면 false다. */
  readonly redo: boolean;
}

export interface AgentViewSource {
  /** main이 미는 연결 상태. 끊겨도 화면은 마지막 내용을 둔다. */
  watch(listener: (state: ConnectionState) => void): () => void;

  // 읽기. session이 null이면 아직 만들지 않은 새 session이다(shell/desktop AgentViewState).
  agent(): Promise<SourceResult<AgentFace>>;
  /** 그 agent와 자리의 session 전부. archive한 것도 들어 있다. */
  sessions(): Promise<SourceResult<readonly SessionEntry[]>>;
  /** 없는 session은 not_found다. */
  thread(session: string): Promise<SourceResult<ThreadView>>;
  /** 확정 메시지 하나의 본문(ReadMessageBody). 범위 밖이나 없는 메시지는 not_found다. */
  body(message: string): Promise<SourceResult<readonly BodyPart[]>>;
  documentTitle(document: string): Promise<SourceResult<string>>;
  notices(
    session: string | null,
  ): Promise<SourceResult<readonly AgentNotice[]>>;

  // model(session 범위). session이 null이면 source가 고른 값을 쥐고 있다가
  // openSession 때 그 session에 저장한다. query는 검색칸의 글이고 layout이 그것을 따른다.
  model(
    session: string | null,
    query: string,
  ): Promise<SourceResult<ModelView>>;
  chooseModel(
    session: string | null,
    model: PickerModelRef,
    query: string,
  ): Promise<SourceResult<ModelView>>;
  setModelOption(
    session: string | null,
    axis: string,
    value: string,
    query: string,
  ): Promise<SourceResult<ModelView>>;
  /** 즐겨찾기는 session이 아니라 사람의 것이다. session은 돌려줄 ModelView를 위해 받는다. */
  toggleFavorite(
    session: string | null,
    model: PickerModelRef,
    query: string,
  ): Promise<SourceResult<ModelView>>;

  // `/` 명령(lophn-agent/commands). session이 없으면 session이 있어야 하는 명령은 목록에 없다.
  commands(
    session: string | null,
    query: string,
  ): Promise<SourceResult<readonly SlashGroupView[]>>;
  /**
   * role 명령과 skill 명령. 정한 prompt나 skill 이름이 든 사람의 메시지로 접수한다.
   * 일하는 중이면 이번 일이 끝난 뒤 실행하는 것(queue)은 source가 기다린다.
   */
  runCommand(
    session: string,
    entry: SlashEntryView,
    key: string,
  ): Promise<SourceResult<void>>;

  // session
  /** 첫 말을 보내기 전에 만든다. contexts가 이 session의 첫 context(opening_context)가 된다. */
  openSession(
    input: { id: string; contexts: readonly ContextChipView[] },
  ): Promise<SourceResult<void>>;
  renameSession(session: string, title: string): Promise<SourceResult<void>>;
  archiveSession(session: string): Promise<SourceResult<void>>;
  unarchiveSession(session: string): Promise<SourceResult<void>>;
  /** 되돌릴 수 없다. 진행 중이거나 기다리는 run이 있으면 conflict다. */
  deleteSession(session: string): Promise<SourceResult<void>>;
  /** 같은 agent·자리의 새 session `id`로 복사한다. through가 null이면 마지막 확정 메시지까지다. */
  forkSession(
    input: { id: string; session: string; through: string | null },
  ): Promise<SourceResult<void>>;
  /** 사람이 부른 요약. 실패해도 session과 원문은 그대로다. */
  compactSession(session: string): Promise<SourceResult<void>>;

  // 메시지와 run
  send(input: SendInput): Promise<SourceResult<void>>;
  stop(run: string, key: string): Promise<SourceResult<void>>;

  // 질문 묶음과 승인
  answerQuestions(
    input: { group: string; answers: readonly GroupAnswer[] },
  ): Promise<SourceResult<void>>;
  /** 묶음 전체를 답 없이 미룬다. */
  deferQuestions(group: string): Promise<SourceResult<void>>;
  /** 결정이 아니라 confirmation window를 `choice`를 미리 고른 채 연다. 결정은 그 창에서만 낸다. */
  openApproval(
    input: { approval: string; choice: ApprovalChoice },
  ): Promise<SourceResult<void>>;

  // 되돌리기(lophn-agent/revert)
  /** rewind menu의 재료: 시점으로 고를 수 있는 메시지와 막힌 범위, 먼저 멈춰야 하는지. */
  rewindMenu(session: string): Promise<SourceResult<RewindMenuView>>;
  /** 그 시점과 범위로 되돌리면 복원할 것·건너뛰는 것·남는 영향. 아무것도 바꾸지 않는다. */
  rewindPreview(
    session: string,
    message: string,
    choice: RewindChoice,
  ): Promise<SourceResult<RewindPreviewView>>;
  /**
   * 되돌리기를 시작한다: 확인 창을 연다. 결정은 그 창에서만 낸다. "Summarize from here"는 먼저 요약을 만들고 끝난
   * 뒤에 연다(오래 걸릴 수 있다). 요약이 실패하면 `summary_failed`다.
   */
  rewind(
    input: { session: string; message: string; choice: RewindChoice },
  ): Promise<SourceResult<void>>;
  /** 편집 카드 하나를 되돌린다(UndoEdit). 카드가 어느 call의 편집인지 모르면 not_found다. */
  undoEdit(session: string, edit: string): Promise<SourceResult<void>>;
  /** 숨긴 구간을 다시 보인다(Redo). 다음 사람 메시지를 보내기 전까지만 된다. */
  redoRewind(session: string, revert: string): Promise<SourceResult<void>>;
}

/**
 * Agent 탭·앱 공간의 Agent 칸이 agent 하나의 통로를 얻는 함수다. agent는 실행 정체(assignment)와 일하는
 * 자리로 정한다(전역 built-in은 열린 자리, Operator는 자기 자리). core 구현은 agent-core-source.ts다.
 */
export type AgentViewSourceFactory = (agent: {
  readonly assignment: string;
  readonly place: {
    readonly kind: "global" | "project" | "app";
    readonly id: string;
  };
}) => AgentViewSource;
