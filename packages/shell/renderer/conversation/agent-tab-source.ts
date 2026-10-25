// Agent 탭이 core에 묻고 쓰는 통로와 그 화면 값. 화면 부품(thread, cards, composer, sessions)은 모두 이 타입 위에 선다.
// 값은 contract(lophn-agent의 agent-sessions·received-messages·turns·calls·ask-tool·session-rewinds·commands·models,
// events의 agent event, approvals)를 부품 props의 모양으로 옮긴 화면 값이다. 구현하는 쪽(source)이 contract 값과
// 화면 값을 잇고, 화면은 event를 줄로 접는 규칙(agent-tab-data.ts)으로 snapshot 뒤를 이어 붙인다.
//
// source는 agent 하나에 묶여 있다. 화면이 열려 있는 동안 agent는 바뀌지 않는다.
import type {
  CallFailReason,
  CallReply,
  CallState,
} from "../../../protocol/lophn-agent/calls.ts";
import type { AgentValueLayer } from "../../../protocol/lophn-agent/agent-definitions.ts";
import type { Role } from "../../../protocol/lophn-agent/places.ts";
import type { RewindReason } from "../../../protocol/lophn-agent/session-rewinds.ts";
import type { TurnRequest } from "../../../protocol/approvals/turn-request.ts";
import type {
  PickerAxisView,
  PickerLayoutView,
  PickerModelRef,
} from "./model-picker/types.ts";
import type { LiveText } from "./live-text.ts";
import type { SlashEntryView, SlashGroupView } from "./slash-menu/types.ts";

export type SourceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string };

export type AgentRole = Role;

/** 보내는 방식. 기본은 다음 turn이고, steer는 도는 turn에 들어간다. contract의 `InputDelivery`와 같다. */
export type Delivery = "next_turn" | "steer";

export type { CallFailReason, CallReply, CallState, RewindReason };

/** avatar가 그리는 얼굴. */
export type AgentProfile =
  | { readonly kind: "icon"; readonly icon: string }
  | { readonly kind: "image"; readonly src: string }
  | { readonly kind: "initial"; readonly text: string };

/** 화면이 고정해 보이는 agent와 그 자리. 머리·composer의 자리 이름·권한 요약이 여기서 온다. */
export interface AgentFace {
  readonly role: AgentRole;
  readonly name: string;
  readonly profile: AgentProfile;
  /** lophn은 열린 자리, 나머지는 자기 자리다. */
  readonly place: { readonly kind: "project" | "app"; readonly name: string };
  /** 그 agent에 할당한 앱을 한 줄로 요약한 글. */
  readonly permissionSummary: string;
}

export type SessionStatus = "waiting" | "working" | "idle";

/** session 목록의 한 줄. Today·Earlier 묶음은 부르는 쪽(화면)이 사용자 달력으로 가른다. */
export interface SessionEntry {
  readonly id: string;
  /** 첫 말이 오기 전의 session은 제목이 없다. 그 자리의 말은 화면이 정한다. */
  readonly title: string | null;
  /** useSessions가 아는 session은 hook이 그 상태로 덮는다. */
  readonly status: SessionStatus;
  /** 마지막 활동 시각(ISO). */
  readonly activeAt: string;
  readonly archived: boolean;
  /** 묻지 않고 실행한다. deny 규칙은 skip에서도 막는다. */
  readonly skip: boolean;
}

/** 본문의 한 part. */
export type BodyPart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "app_card"; readonly app: string; readonly view: string }
  /** agent 답 앞의 reasoning 요약. 글은 redaction을 거쳤고 없으면 ""다. 복사 글과 model 이력에는 들지 않는다. */
  | {
    readonly kind: "reasoning";
    readonly text: string;
    readonly durationMs: number | null;
  };

// ---- 보낸 쪽 ----

/**
 * 받은 메시지를 보낸 쪽. 사람이 직접 쓴 메시지는 여기에 없다. 이름은 event만으로는 알 수 없어 null일 수 있고,
 * chip을 누르면 `envelope`가 읽어 온다.
 */
export type Sender =
  | {
    readonly kind: "agent";
    readonly role: AgentRole | null;
    readonly name: string | null;
  }
  | { readonly kind: "coding"; readonly product: string | null }
  | { readonly kind: "program"; readonly label: string | null };

/** 맡긴 글의 근거 링크. */
export interface EvidenceRef {
  readonly kind: "file" | "session" | "annotation";
  /** 사람이 읽는 이름. 링크의 id는 `target`이다. */
  readonly text: string;
  readonly target: string;
}

/** 보낸 쪽 chip을 누르면 panel에 읽어 보이는 것. */
export interface Envelope {
  readonly sender: Sender;
  /** 맡긴 글. */
  readonly task: string;
  readonly refs: readonly EvidenceRef[];
  /** 보낸 session. program이 보낸 것은 없다. */
  readonly session: { readonly id: string; readonly title: string } | null;
}

// ---- call ----

export interface CallStatus {
  readonly state: CallState;
  /** failed일 때만 있다. */
  readonly reason: CallFailReason | null;
}

/** 이 session이 보낸 call 블록. 상태는 thread를 읽은 때의 것이고 누르면 `callState`로 다시 읽는다. */
export interface CallView {
  /** call id(`cal_…`). */
  readonly call: string;
  /** 받는 곳. */
  readonly to: string;
  /** 맡긴 글 한 줄. */
  readonly task: string;
  readonly reply: CallReply;
  readonly status: CallStatus;
  /** 받은 session. 받는 곳을 풀지 못했으면 null이다. */
  readonly session: string | null;
}

// ---- 질문 ----

interface QuestionOption {
  readonly label: string;
  readonly description: string;
}

/** 기한·추천·Skip이 없다. 늘 붙는 Other는 화면이 더한다. */
export interface AskedQuestion {
  /** 묶음 안의 순서로 정한 key. */
  readonly id: string;
  /** 짧은 header. 답한 뒤 요약에도 쓴다. */
  readonly header: string;
  readonly question: string;
  /** 2~4개. */
  readonly options: readonly QuestionOption[];
  readonly multiSelect: boolean;
}

/** 답을 기다리는 질문 묶음. event는 내용을 싣지 않아 `questions`가 읽히기 전에는 null이다. */
export interface AskedGroup {
  readonly group: string;
  /** 이 묶음을 만든 `ask` tool call. 답할 때 session과 함께 낸다. */
  readonly toolCall: string;
  readonly questions: readonly AskedQuestion[] | null;
}

/** 질문 하나의 답. contract의 `AskAnswer`와 같다. `question`은 질문 글이다. */
export interface QuestionAnswer {
  readonly question: string;
  readonly status: "answered" | "unanswered";
  /** 고른 label과 Other로 쓴 글. */
  readonly answer: readonly string[];
}

export type QuestionOutcome = "submitted" | "cancelled" | "human_message";

/** 답한 뒤 접힌 요약의 한 줄. 답을 모르는 줄(다른 창에서 답함)은 null이다. */
export interface AnsweredLine {
  readonly header: string;
  readonly answer: string | null;
}

// ---- 승인 ----

/** 대화 화면에 오는 물음의 대상. harness 물음은 대기 목록의 coding 카드가 터미널로 보낸다. */
export type ApprovalSubject = Exclude<
  TurnRequest["subject"],
  { readonly kind: "harness" }
>;

/**
 * composer 위에 놓이는 승인 카드. 제목과 세부의 글은 subject에서 화면이 만든다(요청한 agent가 쓴 설명은
 * 없다). 선택지는 `always_patterns`로 정해지고 이름이 같아야 `turnChoicesOf`가 request 그대로 받는다.
 */
export interface ApprovalCardRequest {
  /** `apr_…` */
  readonly id: string;
  readonly subject: ApprovalSubject;
  /** Always allow가 더할 allow 규칙의 pattern. 비어 있으면 Always allow가 없다. */
  readonly always_patterns: string[];
}

/** 결정 뒤 대화에 남는 줄. cancelled(원래 일이 끝남)는 거절이 아니다. */
type ApprovalOutcome = "allowed" | "denied" | "cancelled";

export interface ApprovalResultView {
  readonly request: string;
  readonly subject: ApprovalSubject;
  readonly outcome: ApprovalOutcome;
  /** 사람이 고른 허락 범위. 다른 창에서 결정한 것은 모른다. */
  readonly choice: "once" | "always" | null;
  /** 거절 이유. */
  readonly reason: string | null;
}

// ---- thread ----

/** 한 줄 안에 있는 모든 항목의 공통. `at`은 ISO 시각이고 화면이 시계 글로 바꾼다. */
interface EntryBase {
  readonly id: string;
  readonly at: string;
}

export interface ThreadMessage extends EntryBase {
  readonly kind: "message";
  /** user: 사람이 쓴 말. agent: 이 agent의 답. received: 다른 쪽이 보낸 메시지(보낸 쪽 chip이 붙는다). */
  readonly actor: "user" | "agent" | "received";
  /** received일 때만 있다. */
  readonly sender: Sender | null;
  /** 받은 call. 이 메시지가 맡긴 일이면 있다. */
  readonly call: string | null;
  /** 이 메시지가 답하는 call. 어느 부탁의 답인지 한 줄로 잇는다. */
  readonly replyTo: string | null;
  readonly delivery: Delivery;
  /** 이 메시지를 가져간 turn. 아직이면 null이다. */
  readonly turn: string | null;
  /** event나 snapshot이 이미 가진 글. 본문을 읽기 전에 보인다. 모르면 null이고 `body`로 읽는다. */
  readonly text: string | null;
}

/** tool 줄. trace에 없는 줄은 없다. */
interface ToolLineView {
  /** tool call ID(`tcl_…`) 또는 묶음 key. */
  readonly id: string;
  /** 접힌 한 줄, 예: "Read 3 documents". */
  readonly label: string;
  /** 펼쳤을 때의 하위 줄. */
  readonly lines: readonly string[];
}

interface EditView {
  readonly id: string;
  /** 바뀐 문서 ID(`doc_…`). [Open]이 이 문서의 탭을 연다. */
  readonly document: string;
  readonly path: string;
  readonly added: number;
  readonly removed: number;
}

interface ThreadTools extends EntryBase {
  readonly kind: "tools";
  readonly tool: ToolLineView;
}

/** 되돌아가는 편집을 undo하는 기능은 없다. 되돌리려면 rewind다. */
interface ThreadEdit extends EntryBase {
  readonly kind: "edit";
  readonly edit: EditView;
}

interface ThreadCall extends EntryBase {
  readonly kind: "call";
  readonly call: CallView;
}

/** 답을 기다리는 묶음은 `pending.questions`이고, 이 줄은 풀린 묶음의 접힌 요약이다. */
interface ThreadQuestions extends EntryBase {
  readonly kind: "questions";
  readonly group: string;
  readonly outcome: QuestionOutcome;
  readonly lines: readonly AnsweredLine[];
}

interface ThreadApprovalResult extends EntryBase {
  readonly kind: "approval-result";
  readonly result: ApprovalResultView;
}

/** 끝난 turn의 꼬리. 정상 종료는 "Worked for", 멈춤과 실패는 사람에게 멈춤이다. */
interface ThreadTurnEnd extends EntryBase {
  readonly kind: "turn-end";
  readonly turn: string;
  readonly outcome: "completed" | "stopped" | "failed";
  /** agent가 일한 시간(사람 기다림 제외). core가 turn 끝에 마감한 값이다. */
  readonly activeMs: number;
  /** 사람을 기다린 시간(wall − active). */
  readonly waitedMs: number;
}

/**
 * 끝난 turn의 두 시간. wall은 시작부터 끝까지이고, active를 모르면(coding agent) wall을 active로 쓴다.
 * 시작도 모르면 둘 다 0이다.
 */
export function turnEndTimes(
  startedAt: string | null,
  finishedAt: string,
  activeMs: number | null,
): { activeMs: number; waitedMs: number } {
  const wall = startedAt === null
    ? null
    : Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));
  const active = activeMs ?? wall ?? 0;
  const waited = wall === null ? 0 : Math.max(0, wall - active);
  return { activeMs: active, waitedMs: waited };
}

/** 요청이 거절되는 등 server 요청이 실패했다. 오류와 [Retry]가 대화에 남는다. */
interface ThreadProviderError extends EntryBase {
  readonly kind: "provider-error";
  readonly turn: string;
  readonly code: string;
  readonly message: string;
}

/** 되돌린 구간에서 복원하지 못한 항목 하나. receipt 같은 안쪽 근거는 없다. */
export interface RewindResultView {
  readonly kind: "file" | "fact";
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
 * rewind가 숨긴 구간. 메시지는 지워지지 않고 한 줄로 접히며, 펼치면 숨긴 줄을 읽기만 한다. 숨긴 줄 안의
 * 메시지는 다시 시점으로 고를 수 없다.
 */
export interface ThreadHidden extends EntryBase {
  readonly kind: "hidden";
  /** 그 rewind가 고른 사람 메시지. 되돌린 뒤 입력창에 원문을 채우는 데 쓴다. */
  readonly checkpoint: string;
  readonly choice: "restore_all" | "messages_only";
  /** 숨긴 메시지 수. */
  readonly count: number;
  /** 실제로 복원한 문서 파일 수. */
  readonly restored: number;
  /** 복원하지 못했거나 남은 항목(이유와 함께). */
  readonly left: readonly RewindResultView[];
  readonly entries: readonly ThreadEntry[];
}

export type ThreadEntry =
  | ThreadMessage
  | ThreadTools
  | ThreadEdit
  | ThreadCall
  | ThreadQuestions
  | ThreadApprovalResult
  | ThreadTurnEnd
  | ThreadProviderError
  | ThreadHidden;

/** 가장 늦게 시작한 turn. 멈춤과 다시 시도의 대상이다. */
export interface TurnView {
  readonly id: string;
  readonly phase: "working" | "waiting" | "ended";
  /** 걸린 시간을 셀 때 쓴다. 모르면 null이다. */
  readonly startedAt: string | null;
  /**
   * 도는 turn이 `at`까지 일한 시간(사람 기다림 제외). 일하는 중 줄은 `activeMs + (now − at)`을 보인다.
   * 모르면 null이다.
   */
  readonly elapsed: { readonly activeMs: number; readonly at: string } | null;
}

/** 다음 turn을 기다리는 사람 메시지. 도는 중에 보냈다. */
export interface QueuedView {
  /** 메시지 id. */
  readonly id: string;
  readonly at: string;
  readonly text: string;
}

/** 사람이 답할 것. 둘 다 composer 위에 놓인다. */
interface PendingView {
  readonly approval: ApprovalCardRequest | null;
  readonly questions: AskedGroup | null;
}

/** 한 session 화면 전체: 시간순 줄, 지금 turn, 다음 turn 줄, 사람이 답할 것, 쓰는 중인 글. */
export interface ThreadView {
  readonly entries: readonly ThreadEntry[];
  readonly turn: TurnView | null;
  readonly queued: readonly QueuedView[];
  readonly pending: PendingView;
  /** 아직 저장되지 않은 model 호출 하나의 글. 저장되면 그 message 줄로 바뀐다. */
  readonly live: LiveText | null;
  /**
   * 마지막으로 글을 버린 model 호출(저장됐거나 tool call이 시작된)과 끝난 turn. 그 늦은 delta가 새 live
   * 글로 보이지 않게 한다(core의 live-turns와 같은 규칙).
   */
  readonly dropped: {
    readonly modelCall: string | null;
    readonly turn: string | null;
  };
}

export const EMPTY_THREAD: ThreadView = {
  entries: [],
  turn: null,
  queued: [],
  pending: { approval: null, questions: null },
  live: null,
  dropped: { modelCall: null, turn: null },
};

// ---- model, 명령, 권한 ----

/** model 단추와 picker가 그릴 값. 정렬·거르기·값 맞춤은 model catalog가 정하고, 바꾼 값 맞춤은 안내 없이 조용히 맞춘다. */
export interface ModelView {
  readonly current: PickerModelRef;
  readonly currentLabel: string;
  readonly axes: readonly PickerAxisView[];
  readonly optionValues: Readonly<Record<string, string>>;
  readonly layout: PickerLayoutView;
  /** 지금 model이 온 층. 알 수 없으면 null이다. */
  readonly layer: AgentValueLayer | null;
}

/** `/permissions`와 입력칸 아래 요약이 여는 보기. */
export interface PermissionsView {
  /** 할당한 앱과 그 앱에서 뺀 tool. MCP server는 설정한 층이 할당이라 줄이 없다. */
  readonly apps: readonly {
    readonly name: string;
    readonly removed: readonly string[];
  }[];
}

// ---- rewind ----

/** 이 session이 고른 시점 뒤에 앱에 한 write. 결과를 모르는 write는 되돌릴 수 없다. */
export interface RewindWrite {
  /** ISO 시각. */
  readonly at: string;
  readonly text: string;
  readonly unknown: boolean;
}

export interface RewindApp {
  /** `app_…` */
  readonly app: string;
  readonly name: string;
  readonly writes: readonly RewindWrite[];
  /** 앱을 함께 되돌리면 같이 되돌아가는 다른 변경(다른 session이나 사람이 한 것). */
  readonly others: readonly { readonly by: string; readonly text: string }[];
  /** 되돌아가지 않는 external 효과. */
  readonly outside: readonly string[];
}

export interface RewindFileView {
  readonly path: string;
  /** 복원하지 못하는 파일의 이유. 복원할 파일은 null이다. */
  readonly skipped: RewindReason | null;
}

/** 시점을 고르면 보이는 것. 아무것도 바꾸지 않는다. */
export interface RewindPreviewView {
  /** file tool로 바꾼 파일. `files`를 끄면 복원하지 않는다. */
  readonly files: readonly RewindFileView[];
  /** 그 시점 뒤 이 session이 write한 앱. 앱마다 함께 되돌릴지 고른다. */
  readonly apps: readonly RewindApp[];
}

/** 사람이 panel에서 고른 것. `files`가 참이면 contract의 `restore_all`, 거짓이면 `messages_only`다. */
export interface RewindChoice {
  readonly files: boolean;
  /** 함께 되돌릴 앱 id. */
  readonly apps: readonly string[];
}

// ---- source ----

export interface SendInput {
  readonly session: string;
  /** 메시지 id와 idempotency key. 같은 id·key로 다시 보내면 core가 이전 결과를 돌려준다. */
  readonly id: string;
  readonly key: string;
  readonly text: string;
  readonly delivery: Delivery;
}

export interface AgentTabSource {
  // 읽기
  agent(): Promise<SourceResult<AgentFace>>;
  /** 그 agent의 session 전부. archive한 것도 들어 있다. */
  sessions(): Promise<SourceResult<readonly SessionEntry[]>>;
  /** snapshot이다. 처음과 다시 붙을 때 읽고, 그 사이는 agent event가 줄을 이어 붙인다. 없는 session은 not_found다. */
  thread(session: string): Promise<SourceResult<ThreadView>>;
  /** 확정 메시지 하나의 본문. 범위 밖이나 없는 메시지는 not_found다. */
  body(message: string): Promise<SourceResult<readonly BodyPart[]>>;
  /** 보낸 쪽 chip을 누르면 읽는다: 맡긴 글, 근거 링크, 보낸 session. */
  envelope(message: string): Promise<SourceResult<Envelope>>;
  /** call 블록을 누르면 읽는다. 상태가 바뀌어도 따로 알리지 않는다. */
  callState(call: string): Promise<SourceResult<CallStatus>>;
  /** QuestionAsked는 내용을 싣지 않는다. 풀린 묶음은 not_found다. */
  questions(
    session: string,
    toolCall: string,
  ): Promise<SourceResult<readonly AskedQuestion[]>>;

  // model(session 범위). session이 null이면 source가 고른 값을 쥐고 있다가 openSession 때 그 session에 저장한다.
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

  // `/` 명령. session이 없으면 session이 있어야 하는 명령은 목록에 없다.
  commands(
    session: string | null,
    query: string,
  ): Promise<SourceResult<readonly SlashGroupView[]>>;
  /** skill 명령. skill을 쓰라는 한 줄과 `/이름` 뒤의 글을 사람의 메시지로 다음 turn에 접수한다. */
  runCommand(
    session: string,
    entry: SlashEntryView,
    argument: string,
    key: string,
  ): Promise<SourceResult<void>>;
  /** `/permissions`와 입력칸 아래 요약. */
  permissions(session: string | null): Promise<SourceResult<PermissionsView>>;

  // 쓰기
  send(input: SendInput): Promise<SourceResult<void>>;
  /**
   * 보낼 이미지 하나를 그 session에 올린다(png·jpeg·gif·webp, 5 MiB까지). 메시지 글에는 돌려받은 id로
   * `attachmentImageLine`을 적고, 그 session의 agent가 image.read로 연다.
   */
  uploadImage(
    session: string,
    image: Blob,
  ): Promise<SourceResult<{ id: string }>>;
  /** 올린 이미지를 화면에 그릴 주소. 읽지 못하면 null이다. */
  imageUrl(session: string, id: string): Promise<string | null>;
  /** 다음 turn 줄을 도는 turn에 steer로 올린다. */
  sendQueuedNow(queued: string): Promise<SourceResult<void>>;
  removeQueued(queued: string): Promise<SourceResult<void>>;
  stop(turn: string, key: string): Promise<SourceResult<void>>;
  /** 실패한 turn의 입력을 같은 session에 다시 보낸다. */
  retryTurn(turn: string): Promise<SourceResult<void>>;
  answerQuestions(
    input: {
      session: string;
      toolCall: string;
      answers: readonly QuestionAnswer[];
    },
  ): Promise<SourceResult<void>>;
  /** waiting 목록의 결정과 같은 route다. 거절은 이유를 한 줄 적을 수 있다. */
  decidePermission(
    session: string,
    request: string,
    choice: "once" | "always" | "reject",
    reason?: string,
  ): Promise<SourceResult<void>>;
  /** 끝나지 않은 call을 취소한다. */
  cancelCall(call: string): Promise<SourceResult<void>>;

  // session
  /** 첫 말을 보내기 전에 만든다. */
  openSession(
    input: { id: string },
  ): Promise<SourceResult<void>>;
  renameSession(session: string, title: string): Promise<SourceResult<void>>;
  archiveSession(session: string): Promise<SourceResult<void>>;
  /** 사람만 바꾼다. 바꾼 값은 다음 turn부터다(turn mode는 turn을 시작할 때 정한다). */
  changeSkip(session: string, skip: boolean): Promise<SourceResult<void>>;
  /** 되돌릴 수 없다. 도는 turn이 있으면 conflict다. 받는 곳이 이 session인 열린 call은 실패한다. */
  deleteSession(session: string): Promise<SourceResult<void>>;
  /** 같은 agent의 새 session `id`로 복사한다. through가 null이면 마지막 확정 메시지까지다. */
  forkSession(
    input: { id: string; session: string; through: string | null },
  ): Promise<SourceResult<void>>;
  /** 사람이 부른 요약. 실패해도 session과 원문은 그대로다. */
  compactSession(session: string): Promise<SourceResult<void>>;

  // rewind. 확인은 대화 화면 안의 panel이고 확인 창은 없다.
  /** 시점으로 고를 수 있는 사람 메시지(steer는 아니다), 오래된 순. 숨긴 구간 밖이다. */
  rewindPoints(session: string): Promise<SourceResult<readonly string[]>>;
  rewindPreview(
    session: string,
    message: string,
  ): Promise<SourceResult<RewindPreviewView>>;
  rewind(
    session: string,
    message: string,
    choice: RewindChoice,
  ): Promise<SourceResult<void>>;

  /**
   * event 밖에서 바뀐 것을 알린다. 실제 source는 두지 않는다(event가 알린다). 메모리 fake가 쓴다.
   */
  changed?(listener: () => void): () => void;
}

/**
 * Agent 탭·앱 공간의 Agent 칸이 agent 하나의 통로를 얻는 함수다. 호스트가 아직 부르는 인자 모양을 그대로
 * 받는다(`assignment`의 값은 agent id다).
 */
export type AgentTabSourceFactory = (agent: {
  readonly assignment: string;
  readonly place: {
    readonly kind: "global" | "project" | "app";
    readonly id: string;
  };
}) => AgentTabSource;
