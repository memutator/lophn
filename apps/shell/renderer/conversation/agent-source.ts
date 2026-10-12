// Agent 화면(agent-view.tsx)이 core에 묻고 쓰는 통로. 한 agent의 한 화면이 쓰는 읽기와 쓰기를 모두
// 담고, 값은 contract(lophn-agent/sessions·messages·questions·commands·models·traces)를 부품 props의 모양으로
// 옮긴 화면 값이다. renderer는 contracts를 type check하지 않으므로 id는 문자열이다. 이 interface를 구현하는 쪽
// (core source)이 contract 값 이름과 화면 값을 잇는다.
//
// source는 agent 하나에 묶여 있다. 화면이 열려 있는 동안 agent는 바뀌지 않는다(shell/desktop#R38).
import type { ConnectionState } from "../desktop/connection/connection.ts";
import type { EditView, TaskView, ToolLineView } from "./activity/model.ts";
import type {
  ApprovalCardRequest,
  ApprovalChoice,
} from "./approval-card/model.ts";
import type { ContextChipView } from "./composer/agent-composer.tsx";
import type { HeaderAgent, SessionLine } from "./header/agent-header.tsx";
import type {
  PickerAxisView,
  PickerLayoutView,
  PickerModelRef,
  PickerNoticeView,
} from "./model-picker/model-picker.tsx";
import type {
  AnswerSummaryStatus,
  GroupAnswer,
  QuestionGroupView,
} from "./question-card/model.ts";
import type {
  SlashEntryView,
  SlashGroupView,
} from "./slash-menu/slash-menu.tsx";

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
  /** paused와 withdrawn은 새 입력을 받지 않는다(lophn-agent/conversation#R8). */
  readonly state: "enabled" | "paused" | "withdrawn";
  readonly place: { readonly kind: "project" | "app"; readonly name: string };
  /** 그 session의 실제 권한을 한 줄로 요약한 글(shell/desktop#R43). */
  readonly permissionSummary: string;
}

/** session 목록의 한 줄. Today·Earlier 묶음은 부르는 쪽(화면)이 사용자 달력으로 가른다. */
export interface SessionEntry extends Omit<SessionLine, "group" | "title"> {
  /** 첫 말이 오기 전의 session은 제목이 없다. 그 자리의 말은 화면이 정한다. */
  readonly title: string | null;
  /** assignment 회수로 닫힌 session. 읽기만 한다. */
  readonly closed: boolean;
}

/** 답 아래에 두는 결과. 실제로 만들거나 바꾼 문서·context만이다(lophn-agent/conversation#R4). */
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
  /** model 판단에 처음 반영됐는지. 접수와 따로 보인다(conversation#R3). */
  readonly applied: boolean;
  readonly results: readonly ResultLink[];
}

/** run trace에서 그린 tool 줄(shell/desktop#R41). trace에 없는 줄은 없다. */
export interface ThreadTools extends EntryBase {
  readonly kind: "tools";
  readonly tool: ToolLineView;
}

export interface ThreadEdit extends EntryBase {
  readonly kind: "edit";
  readonly edit: EditView;
  /** [Undo]를 눌러 되돌린 뒤이다. */
  readonly undone: boolean;
  /** 다음 사람 메시지를 보내기 전까지만 true다(lophn-agent/revert#R16). */
  readonly canRedo: boolean;
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
  | ThreadQuestions;

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
  /** 결정을 기다리는 승인 요청 하나. 없으면 null이다(shell/desktop#R47). */
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

/** 대화 입력 위에 놓이는 안내 한 줄. 지금 일에 필요한 행동 하나만 말한다(desktop#R7). */
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
  /** 메시지 id와 idempotency key. 같은 id·key로 다시 보내면 core가 이전 결과를 돌려준다(conversation#R2). */
  readonly id: string;
  readonly key: string;
  readonly text: string;
  readonly mode: "request" | "correction";
  /** 수정이 가리키는 지금 일. 다음 요청은 null이다. */
  readonly run: string | null;
}

export interface AgentViewSource {
  /** main이 미는 연결 상태. 끊겨도 화면은 마지막 내용을 둔다(desktop#R7). */
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

  // model(session 범위, conversation#R23). session이 null이면 source가 고른 값을 쥐고 있다가
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
   * role 명령과 skill 명령. 정한 prompt나 skill 이름이 든 사람의 메시지로 접수한다(commands#R9).
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
  /** 되돌릴 수 없다. 진행 중이거나 기다리는 run이 있으면 conflict다(conversation#R20). */
  deleteSession(session: string): Promise<SourceResult<void>>;
  /** 같은 agent·자리의 새 session `id`로 복사한다. through가 null이면 마지막 확정 메시지까지다. */
  forkSession(
    input: { id: string; session: string; through: string | null },
  ): Promise<SourceResult<void>>;
  /** 사람이 부른 요약. 실패해도 session과 원문은 그대로다(conversation#R10). */
  compactSession(session: string): Promise<SourceResult<void>>;

  // 메시지와 run
  send(input: SendInput): Promise<SourceResult<void>>;
  stop(run: string, key: string): Promise<SourceResult<void>>;

  // 질문 묶음과 승인(shell/desktop#R46·R47)
  answerQuestions(
    input: { group: string; answers: readonly GroupAnswer[] },
  ): Promise<SourceResult<void>>;
  /** 묶음 전체를 답 없이 미룬다. */
  deferQuestions(group: string): Promise<SourceResult<void>>;
  /** 결정이 아니라 confirmation window를 `choice`를 미리 고른 채 연다. 결정은 그 창에서만 낸다. */
  openApproval(
    input: { approval: string; choice: ApprovalChoice },
  ): Promise<SourceResult<void>>;

  // 되돌리기 자리. 단추가 부르는 signal만 있고 동작은 revert 화면 task가 붙인다(lophn-agent/revert).
  /** "Rewind to here"(message)와 ⋯ 메뉴의 Rewind…(null). */
  rewind(session: string, message: string | null): Promise<SourceResult<void>>;
  undoEdit(edit: string): Promise<SourceResult<void>>;
  redoEdit(edit: string): Promise<SourceResult<void>>;
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
