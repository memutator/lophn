import type { AcpApprovalSubject } from "../../../protocol/approvals/gate-call.ts";
import type { TurnRequest } from "../../../protocol/approvals/turn-request.ts";
import type { CharacterProfile } from "../../../protocol/lophn-agent/agent-values.ts";
// Agent 탭이 core에 묻고 쓰는 통로와 그 화면 값. 화면 부품(thread, cards, composer, sessions)은 모두 이 타입 위에 선다.
// 대화는 ACP다: source가 snapshot(`AcpState`)을 주고 화면이 갱신을 `reduceAcp`로 접은 뒤 줄 모양으로 늘어놓는다
// (`thread-layout.ts`). 그 밖의 값은 contract(lophn-agent의 agent-sessions·received-messages·calls·session-rewinds·
// commands·models, approvals)를 부품 props의 모양으로 옮긴 화면 값이고 source가 contract 값과 화면 값을 잇는다.
//
// source는 agent 하나에 묶여 있다. 화면이 열려 있는 동안 agent는 바뀌지 않는다.
import type {
  CallFailReason,
  CallReply,
  CallState,
} from "../../../protocol/lophn-agent/calls.ts";
import {
  type ContentBlock,
  IMAGE_NOTE,
} from "../../../protocol/lophn-agent/content-block.ts";
import type {
  InputRequestView,
  SignInRequestView,
} from "../../../protocol/lophn-agent/input-request.ts";
import type { SignInProgress } from "../desktop/settings/sign-in.ts";
import type { EventClient } from "../desktop/connection/events/client.ts";
import type { AgentId } from "../../../protocol/lophn-agent/workspaces.ts";
import type { RewindReason } from "../../../protocol/lophn-agent/session-rewinds.ts";
import type {
  AcpCard,
  AcpChildState,
  AcpInput,
  AcpPlan,
  AcpSessionMeta,
  AcpState,
  AcpTask,
  AcpWriting,
} from "../../../protocol/acp/mod.ts";
import type { Vendor } from "../parts/vendor-icon/vendors.ts";
import type { ToolCallState, ToolCallView } from "./activity/model.ts";

export type SourceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string };

/** 보내는 방식. 기본은 다음 turn이고, steer는 도는 turn에 들어간다. contract의 `InputDelivery`와 같다. */
export type Delivery = "next_turn" | "steer";

export type { CallFailReason, CallReply, CallState, RewindReason };

/** avatar가 그리는 얼굴. */
export type AgentProfile =
  | CharacterProfile
  | { readonly kind: "image"; readonly src: string }
  | { readonly kind: "initial"; readonly text: string }
  | { readonly kind: "vendor"; readonly vendor: Vendor };

/** 화면이 고정해 보이는 agent와 그 자리. 머리·composer의 자리 이름·권한 요약이 여기서 온다. */
export interface AgentFace {
  readonly agent: AgentId;
  readonly name: string;
  readonly profile: AgentProfile;
  /** 이 source의 session이 열리는 자리. home은 null이다. */
  readonly workspace: {
    readonly kind: "project" | "app";
    readonly name: string;
  } | null;
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
}

/** session popover의 메시지 글 찾기가 찾은 한 줄. 묶음은 화면이 session으로 만들고 snippet만 보인다. */
export interface SessionSearchMatch {
  readonly session: string;
  readonly message: string;
  /** 메시지가 접수된 시각(ISO). 묶음 안 순서를 이 값으로 정한다. */
  readonly at: string;
  /** 처음 맞은 곳 앞뒤를 한 줄로 줄인 글. 앞뒤가 잘리면 `…`가 붙는다. */
  readonly snippet: string;
}

/** 본문의 한 part. */
export type BodyPart =
  | { readonly kind: "text"; readonly text: string }
  /** `blob`은 이미지 hash이거나 옛 첨부 id다. `imageUrl`이 읽는다. */
  | { readonly kind: "image"; readonly blob: string }
  | {
      readonly kind: "resource_link";
      readonly uri: string;
      readonly name: string;
    }
  | {
      readonly kind: "resource";
      readonly uri: string;
      readonly text: string;
    }
  | {
      readonly kind: "app_card";
      readonly app: string;
      readonly view: string;
      readonly params?: AcpCard["params"];
    }
  /** agent 답 앞의 reasoning 요약. 글은 redaction을 거쳤고 없으면 ""다. 복사 글과 model 이력에는 들지 않는다. */
  | {
      readonly kind: "reasoning";
      readonly text: string;
      readonly durationMs: number | null;
    };

/** 글 part, 이미지 자리의 고정 글, 링크 이름을 이은 한 줄감. 글이 없는 메시지를 목록에서 알아보게 한다(`blocksSummary`와 같다). */
export function summaryOfParts(parts: readonly BodyPart[]): string {
  return parts
    .flatMap((part) =>
      part.kind === "text"
        ? [part.text]
        : part.kind === "image"
          ? [IMAGE_NOTE]
          : part.kind === "resource_link"
            ? [part.name]
            : [],
    )
    .join("\n");
}

// ---- 보낸 쪽 ----

/**
 * 받은 메시지를 보낸 쪽. 사람이 직접 쓴 메시지는 여기에 없다. 이름은 ACP가 모를 수 있어 null일 수 있고,
 * chip을 누르면 `envelope`가 읽어 온다.
 */
export type Sender =
  | {
      readonly kind: "agent";
      readonly agent: AgentId | null;
      readonly name: string | null;
    }
  | { readonly kind: "program"; readonly label: string | null }
  // 앱이 보낸 call. name은 그 앱의 slug다.
  | {
      readonly kind: "app";
      readonly app: string | null;
      readonly name: string;
    };

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

/** 이 session이 보낸 call 블록. 상태는 thread를 읽은 때의 것이고 취소한 뒤 `callState`로 다시 읽는다. */
export interface CallView {
  /** call id(`cal_…`). 아직 보내지 못했거나 보내다 실패했으면 null이다. */
  readonly call: string | null;
  /** 받는 곳. */
  readonly to: string;
  /** 맡긴 글 한 줄. */
  readonly task: string;
  readonly reply: CallReply;
  /** call의 상태. call이 생기기 전(보내는 중, 보내다 실패)에는 null이다. */
  readonly status: CallStatus | null;
  /** call을 보낸 tool call의 상태. 도는 중이거나 실패한 때도 이 블록으로 그린다. */
  readonly toolState: ToolCallState;
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

/** 답을 기다리는 질문 묶음. 질문 내용을 모르면 `questions`가 null이다. */
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

export type QuestionOutcome =
  | "submitted"
  | "cancelled"
  | "human_message"
  | "parent_reply";

/** 답한 뒤 접힌 요약의 한 줄. 답을 모르는 줄(다른 창에서 답함)은 null이다. */
export interface AnsweredLine {
  readonly header: string;
  readonly answer: string | null;
}

// ---- 승인 ----

/** 대화 화면에 오는 물음의 대상. harness 물음은 대기 목록의 coding 카드가 터미널로 보낸다. */
export type ApprovalSubject =
  | Exclude<TurnRequest["subject"], { readonly kind: "harness" }>
  | AcpApprovalSubject;

/**
 * composer 위에 놓이는 승인 카드. 제목과 세부의 글은 subject에서 화면이 만든다(요청한 agent가 쓴 설명은
 * 없다). 단추는 source가 내는 `choices` 순서대로다.
 */
export interface ApprovalCardRequest {
  /** `apr_…` */
  readonly id: string;
  readonly subject: ApprovalSubject;
  /** 이 카드가 낼 수 있는 범위. `session`은 그 CLI session 안에서만이고 `always`는 영구 규칙이다. */
  readonly choices: readonly ("once" | "session" | "always" | "reject")[];
  /** Always allow가 영구로 더할 pattern. */
  readonly always_patterns: string[];
}

/** 결정 뒤 대화에 남는 줄. cancelled(원래 일이 끝남)는 거절이 아니다. */
type ApprovalOutcome = "allowed" | "denied" | "cancelled";

export interface ApprovalResultView {
  readonly request: string;
  readonly subject: ApprovalSubject;
  readonly outcome: ApprovalOutcome;
  /** 사람이 고른 허락 범위. 다른 창에서 결정한 것은 모른다. */
  readonly choice: "once" | "session" | "always" | null;
  /** 거절 이유. */
  readonly reason: string | null;
  /** plan 승인에서 고른 `modes` id. 그 밖은 null이다. */
  readonly mode: string | null;
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
  /** 앱 화면이 보낸 사람 메시지면 그 앱 이름(slug). 사람의 메시지는 그대로고 이름표만 붙는다. */
  readonly via?: string;
  /** 받은 call. 이 메시지가 맡긴 일이면 있다. */
  readonly call: string | null;
  /** 이 메시지가 답하는 call. 어느 부탁의 답인지 한 줄로 잇는다. */
  readonly replyTo: string | null;
  readonly delivery: Delivery;
  /** 이 메시지를 가져간 turn. 아직이면 null이다. */
  readonly turn: string | null;
  /** 그 CLI 자신의 message id(thread index bookmark의 key). 사람 메시지만 쓰고 lophn은 null이다. 화면은 읽지 않는다. */
  readonly origin: string | null;
  /** 본문: reasoning, 글·이미지·링크 block, 앱 카드 차례다. */
  readonly parts: readonly BodyPart[];
}

interface EditView {
  readonly id: string;
  /** 바뀐 문서 ID(`doc_…`). [Open]이 이 문서의 탭을 연다. */
  readonly document: string;
  readonly path: string;
  readonly added: number;
  readonly removed: number;
  /** 편집 tool call의 상태. 도는 중이거나 실패한 편집도 이 줄로 그린다. */
  readonly toolState: ToolCallState;
}

/** 이어진 call 묶음 하나. call이 하나면 그 call 줄이다. */
interface ThreadTools extends EntryBase {
  readonly kind: "tools";
  readonly calls: readonly ToolCallView[];
}

/** 일을 맡긴 subagent 한 줄. `child`가 있으면 줄이 단추이고 누르면 자식 대화를 연다. */
export interface ThreadSubagent extends EntryBase {
  readonly kind: "subagent";
  readonly tool: string;
  readonly agent: string;
  readonly description: string;
  readonly child: string | null;
  readonly state: "running" | "done" | "failed" | "cancelled";
  readonly model: string | null;
  /** 마지막 말이나 요약. */
  readonly last: string | null;
  readonly startedAt: string;
  readonly durationMs: number | null;
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

/** `release.activate`가 사람의 동의를 기다린다고 답한 호출. 동의 대기는 대기 목록의 같은 release 줄이다. */
interface ThreadReleaseConsent extends EntryBase {
  readonly kind: "release-consent";
  readonly release: string;
}

/** 답을 기다리는 묶음은 `pending.questions`이고, 이 줄은 풀린 묶음의 접힌 요약이다. */
interface ThreadQuestions extends EntryBase {
  readonly kind: "questions";
  readonly group: string;
  readonly outcome: QuestionOutcome;
  readonly lines: readonly AnsweredLine[];
  /** `parent_reply`일 때 부모의 답 글. */
  readonly reply?: string;
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

/** 요청이 거절되는 등 server 요청이 실패했다. 오류와 [Retry]가 대화에 남는다. */
interface ThreadProviderError extends EntryBase {
  readonly kind: "provider-error";
  readonly turn: string;
  readonly code: string;
  readonly message: string;
  /** provider 호출이 실패했을 때 판정 길과 request id. */
  readonly evidence?: {
    readonly verdict_path: string | null;
    readonly request_id: string | null;
    readonly http_status?: number | null;
  };
}

/** 한 줄 알림(compaction, 재시도, rate limit). `turn`이 null이면 turn 밖이다. */
interface ThreadInfo extends EntryBase {
  readonly kind: "info";
  readonly text: string;
  readonly level: "info" | "warning";
  readonly turn: string | null;
}

/**
 * 사람이 `!`로 돌린 명령(tool item `by: "user"`). agent 덩어리에 넣지 않고 사람 쪽에 출력을 펼쳐 그린다. `turn`이
 * 있어도 없어도 "Worked for"가 붙지 않는다. `id`가 본문을 읽을 tool id다.
 */
export interface ThreadShell extends EntryBase {
  readonly kind: "shell";
  readonly command: string;
  readonly state: ToolCallState;
  /** harness가 item에 실은 출력. lophn은 null이라 `toolCallBody(id, "output")`으로 읽는다. */
  readonly output: string | null;
}

/** 슬래시 명령이 낸 글. `turn`이 null이면 turn 밖이라 "Worked for"가 붙지 않는다. */
interface ThreadCommandOutput extends EntryBase {
  readonly kind: "command-output";
  /** 앞 `/` 없는 이름. */
  readonly command: string;
  readonly text: string;
  readonly format: "markdown" | "preformatted";
  readonly turn: string | null;
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
  | ThreadSubagent
  | ThreadEdit
  | ThreadCall
  | ThreadReleaseConsent
  | ThreadQuestions
  | ThreadApprovalResult
  | ThreadTurnEnd
  | ThreadProviderError
  | ThreadInfo
  | ThreadShell
  | ThreadCommandOutput
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
  /** 고칠 때 입력칸에 채우는 글. */
  readonly text: string;
  /** 줄에 보이는 글. 이미지나 파일만 든 메시지는 그 표시다. */
  readonly summary: string;
  /** 앱 화면이 보낸 메시지면 그 앱 이름(slug). 이름표일 뿐이다. */
  readonly via?: string;
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
  readonly live: AcpWriting | null;
  /** source의 session 기능(model, mode, 명령, 사용량)과 capability. 아직 모르면 null이다. */
  readonly session: AcpSessionMeta | null;
  /** agent의 계획. 없으면 null이다. */
  readonly plan: AcpPlan | null;
  /** background task. */
  readonly tasks: readonly AcpTask[];
  /** subagent의 대화(key는 subagent 줄의 `child`). 읽을 때 같은 `layoutOf`로 늘어놓는다. */
  readonly children: Readonly<Record<string, AcpChildState>>;
  /** composer에 한 번 채울 글(`key`가 새 값일 때). */
  readonly draft: AcpState["draft"];
}

// ---- model, 명령, 권한 ----

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

/** tool 호출의 입력이나 결과 본문. 사람 화면용으로 지금의 redaction을 거친 값이고, 64 KiB를 넘으면 앞부분만이다. */
export interface ToolCallBodyView {
  readonly value: unknown;
  readonly truncated: boolean;
}

export interface SendInput {
  readonly session: string;
  /** 메시지 id와 idempotency key. 같은 id·key로 다시 보내면 core가 이전 결과를 돌려준다. */
  readonly id: string;
  readonly key: string;
  readonly content: readonly ContentBlock[];
  readonly delivery: Delivery;
  /**
   * 이 화면이 아는 마지막 사람 메시지(`seenOf`). 그 뒤에 다른 기기의 사람 메시지가 있으면 core가 거절하고
   * 실패 code는 `changed_elsewhere`다. null은 하나도 못 봤다는 뜻이다(새 session의 첫 말).
   */
  readonly seen: string | null;
}

export interface AgentTabSource {
  // 읽기
  agent(): Promise<SourceResult<AgentFace>>;
  /** 그 agent의 session 전부. archive한 것도 들어 있다. */
  sessions(): Promise<SourceResult<readonly SessionEntry[]>>;
  /**
   * 그 agent의 session 메시지 글(사람이 쓴 말과 agent의 답)에서 찾는다. 최근 것부터 보고 상한이 있다.
   * 제목만 거르는 화면 검색과 달리 본문을 본다.
   */
  searchMessages(
    query: string,
  ): Promise<SourceResult<readonly SessionSearchMatch[]>>;
  /** ACP snapshot이다. 처음과 다시 붙을 때 읽고, 그 사이는 `AcpUpdated` 갱신이 상태를 접는다. 없는 session은 not_found다. */
  acp(session: string): Promise<SourceResult<AcpState>>;
  /**
   * 첫 메시지 전 새 session 화면의 session 기능(model 묶음, 기본 model, 명령, capability). 이 source가 묶인 agent와
   * workspace로 지금 session을 열면 받을 값이다. harness source는 session이 늘 있어 두지 않는다.
   */
  draft?(): Promise<SourceResult<AcpSessionMeta>>;
  /** 보낸 쪽 chip을 누르면 읽는다: 맡긴 글, 근거 링크, 보낸 session. 없으면(harness GUI) chip은 열리지 않는다. */
  envelope?(message: string): Promise<SourceResult<Envelope>>;
  /** call 블록이 취소한 뒤 읽는다. 상태가 바뀌어도 따로 알리지 않는다. */
  callState(call: string): Promise<SourceResult<CallStatus>>;
  /** call 줄을 펼칠 때 읽는다. 아직 출력이 없으면 output은 not_found다. */
  toolCallBody(
    toolCall: string,
    part: "input" | "output",
  ): Promise<SourceResult<ToolCallBodyView>>;

  /** `/permissions`와 입력칸 아래 요약. ACP가 다루지 않는 lophn의 할당 보기다. */
  permissions(session: string | null): Promise<SourceResult<PermissionsView>>;

  // 쓰기
  send(input: SendInput): Promise<SourceResult<void>>;
  /**
   * 새 ACP 입력(model·mode·명령·rewind·fork·compact·이름)을 보내는 길 하나다. 무엇을 할 수 있는지는 source가 아니라
   * ACP 상태의 `session.capabilities`가 알린다. fork가 새 lophn session을 열면 그 id를 돌려준다.
   */
  act(
    session: string,
    input: AcpInput,
  ): Promise<SourceResult<{ session?: string }>>;
  /**
   * 보낼 이미지 하나를 올려 메시지에 실을 block을 받는다. core source는 blob hash의 `image` block(png·jpeg·gif·webp,
   * 5 MiB까지, 올린 것을 참조하지 않으면 10분 뒤 사라진다)이고 harness source는 탭의 임시 폴더에 쓴 file의
   * `resource_link`다. capability `images`가 붙이기를 켠다.
   */
  uploadImage(image: Blob): Promise<SourceResult<{ block: ContentBlock }>>;
  /**
   * 그림 주소. id는 image block의 blob hash(옛 첨부 id)이거나, 그림 file을 가리킨 `file://` resource_link의 uri다(harness
   * source가 붙인 이미지). 읽지 못하면 null이다.
   */
  imageUrl(session: string, id: string): Promise<string | null>;
  /** 다음 turn 줄을 도는 turn에 steer로 올린다. */
  sendQueuedNow(queued: string): Promise<SourceResult<void>>;
  removeQueued(queued: string): Promise<SourceResult<void>>;
  /** 다음 turn 줄의 글을 고친다. 붙인 이미지와 링크는 그대로 남는다. turn이 이미 가져갔으면 conflict다. */
  editQueued(queued: string, text: string): Promise<SourceResult<void>>;
  /** 다음 turn 줄의 순서를 이웃과 바꾼다. 끝이면 그대로 둔다. */
  moveQueued(
    queued: string,
    direction: "up" | "down",
  ): Promise<SourceResult<void>>;
  stop(turn: string, key: string): Promise<SourceResult<void>>;
  /** 실패한 turn의 입력을 같은 session에 다시 보낸다. */
  retryTurn(turn: string): Promise<SourceResult<void>>;
  /**
   * 연결된 provider가 어떤 인증인지(`api_key`·`oauth`·`none`). provider 오류 줄의 [Enter key]가 API key provider에만 뜨게 한다
   * (구독 provider의 `provider.<id>`는 OAuth token이라 key를 덮어쓰면 안 된다). core source만 갖는다.
   */
  providerAuthKind?(provider: string): Promise<SourceResult<string>>;
  answerQuestions(input: {
    session: string;
    toolCall: string;
    answers: readonly QuestionAnswer[];
  }): Promise<SourceResult<void>>;
  /**
   * agent의 입력 요청 card가 읽는 내용(shell main이 잰 origin 포함)과 Cancel. 질문 content 없는 대기 항목이 입력 요청인지는
   * 읽어 보아야 안다(아니면 not_found). core source만 갖는다: fake·GUI source는 card를 그리지 않는다.
   */
  readInputRequest?(input: {
    session: string;
    toolCall: string;
  }): Promise<SourceResult<InputRequestView>>;
  cancelInputRequest?(input: {
    session: string;
    toolCall: string;
  }): Promise<SourceResult<void>>;
  /**
   * sign_in 요청의 [Sign in]. view의 target 로그인 흐름을 끝까지 돌리고 결과를 core에 알린다. 사람이 그만두면(progress.signal)
   * 알리지 않고 `cancelled`다.
   */
  signInInputRequest?(input: {
    session: string;
    toolCall: string;
    view: SignInRequestView;
    /** 앱 로그인이 끝남을 듣는 창의 event 연결. EventsProvider 밖(gallery)이면 null이고 앱 로그인은 unavailable이다. */
    events: EventClient | null;
    progress: SignInProgress;
  }): Promise<SourceResult<void>>;
  /** 끝나지 않은 call을 취소한다. */
  cancelCall(call: string): Promise<SourceResult<void>>;

  // session
  /** 첫 말을 보내기 전에 만든다. */
  openSession(input: { id: string }): Promise<SourceResult<void>>;
  /** 그 session에서 도는 turn을 멈춘다. 도는 turn이 없으면 할 일이 없어 ok다. */
  stopSession(session: string): Promise<SourceResult<void>>;
  archiveSession(session: string): Promise<SourceResult<void>>;
  /** 되돌릴 수 없다. 도는 turn이 있으면 conflict다. 받는 곳이 이 session인 열린 call은 실패한다. */
  deleteSession(session: string): Promise<SourceResult<void>>;
  // rewind. 확인은 대화 화면 안의 panel이고 확인 창은 없다.
  /** 시점으로 고를 수 있는 사람 메시지(steer는 아니다), 오래된 순. 숨긴 구간 밖이다. */
  rewindPoints(session: string): Promise<SourceResult<readonly string[]>>;
  rewindPreview(
    session: string,
    message: string,
  ): Promise<SourceResult<RewindPreviewView>>;
  /**
   * 갱신 event 밖에서 바뀐 것을 알린다. core source는 두지 않는다(`AcpUpdated`가 알린다). harness GUI source는
   * snapshot이 상태를 갈아 끼울 때 알리고, 메모리 fake도 쓴다.
   */
  changed?(listener: () => void): () => void;
}

/**
 * Agent 탭·앱 공간의 Agent 칸이 agent 하나의 통로를 얻는 함수다. 호스트가 아직 부르는 인자 모양을 그대로
 * 받는다. `assignment`는 agent id(lophn 또는 `agt_…`)이고 workspace의 `global`은 home이다.
 */
export type AgentTabSourceFactory = (agent: {
  readonly assignment: string;
  readonly workspace: {
    readonly kind: "global" | "project" | "app";
    readonly id: string;
  };
}) => AgentTabSource;
