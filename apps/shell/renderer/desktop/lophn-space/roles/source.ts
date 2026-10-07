// roles 화면이 읽고 쓰는 통로. 화면은 이 interface만 보고 core route 이름은 core-source.ts만 안다.
// 모양은 contracts(assignments·presets·runs·sessions·messages·tool-calls·model-calls·agent-traces·
// agent-usage·reverts)에서 이 화면이 쓰는 field만 옮긴 것이다(contracts를 들이면 zod가 renderer
// bundle에 들어간다). 안쪽 말(assignment·run·session)은 이 파일 안에서만 쓰고 화면 말은 wording이 정한다.
import type {
  ConversationSource,
  SourceResult,
} from "../../../conversation/source.ts";

export type { ConversationSource, SourceResult };

export type RoleKind =
  | "lophn"
  | "app_engineer"
  | "context_engineer"
  | "operator";

export type RoleState = "enabled" | "paused" | "withdrawn";

export interface RoleScope {
  readonly kind: "all" | "project" | "app";
  readonly id: string | null;
}

/** 역할 하나(역할을 어떤 범위에 붙인 것). 목록의 한 행이다. */
export interface RoleRow {
  readonly id: string;
  readonly role: RoleKind;
  readonly state: RoleState;
  /** 바꿀 때의 비교 기준. */
  readonly revision: number;
  readonly scope: RoleScope;
  readonly preset: { readonly id: string; readonly revision: number };
  readonly presetName: string | null;
  /** Operator가 보고를 남기는 문서. */
  readonly outputs: readonly string[];
}

export type WorkState = "accepted" | "running" | "waiting_user" | "finished";

export type OutcomeKind = "completed" | "failed" | "stopped";

export interface Outcome {
  readonly kind: OutcomeKind;
  readonly reason: string;
}

/** 하는 일 한 줄(일 하나의 현재 상태). */
export interface WorkRow {
  readonly id: string;
  readonly session: string | null;
  readonly state: WorkState;
  readonly outcome: Outcome | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly stateSeq: string;
  readonly acceptedSeq: string;
  readonly origin: "message" | "schedule" | "handoff";
  /** 사람이 보낸 요청 메시지. 다시 시키기가 그 글을 다시 보낸다. */
  readonly requestMessage: string | null;
  /** 앞선 일. 앞선 일이 실패·멈춤으로 끝나 사람의 확인을 기다리는 일만 다시 시작할 수 있다. */
  readonly after: {
    readonly id: string;
    readonly stateSeq: string;
    /** 앞선 일이 실패하거나 멈추고 끝났다. */
    readonly stopped: boolean;
  } | null;
  readonly startConfirmed: boolean;
}

/** 만든 것. 실제로 만들거나 바꾼 문서만이다. */
export interface MadeLink {
  readonly document: string;
  readonly version: string | null;
  readonly work: string | null;
}

export type ToolSource = "tool" | "app" | "outside";

export type StepOutcome =
  | "success"
  | "failure"
  | "not_executed"
  | "uncertain"
  | "unfinished";

/** 도구 활동의 단계 하나. 도구 이름·입력·원문 결과는 펼친 자리에서만 읽는다. */
export interface ToolStep {
  readonly id: string;
  /** 도구 이름(예: document.create). 기본 화면에는 말로 바꾼 대상·한 일만 보인다. */
  readonly tool: string;
  readonly effect: "read" | "write" | "external";
  readonly source: ToolSource;
  /** 외부 MCP 호출의 원래 server와 tool. */
  readonly server: string | null;
  readonly originalTool: string | null;
  readonly app: string | null;
  readonly outcome: StepOutcome;
  readonly code: string | null;
  /** 이 호출을 막거나 허락한 판정. */
  readonly decision: {
    readonly kind: "allow" | "ask" | "deny";
    readonly reason: string;
    /** 사람이 결정한 approval이 있는지. */
    readonly byPerson: boolean;
  } | null;
  readonly startedAt: string | null;
  readonly durationMs: number | null;
  readonly hasInput: boolean;
  readonly hasOutput: boolean;
}

export interface TokenUsage {
  readonly input: number | null;
  readonly output: number | null;
  readonly cacheRead: number | null;
  readonly cacheWrite: number | null;
}

export type CostKind =
  | "reported"
  | "estimated"
  | "subscription"
  | "free"
  | "unknown";

export interface Cost {
  readonly kind: CostKind;
  /** reported·estimated·free일 때만 있다. 모르는 금액은 null이고 0으로 채우지 않는다. */
  readonly amount: string | null;
  readonly currency: string | null;
}

export type CallOutcome =
  | "complete"
  | "partial"
  | "failed"
  | "cancelled"
  | "uncertain"
  | "unfinished";

/** model 호출 한 번(시도). 호출별 사용량과 비용이다. */
export interface ModelAttempt {
  readonly id: string;
  readonly order: number;
  readonly model: string;
  readonly outcome: CallOutcome;
  readonly startedAt: string;
  readonly durationMs: number | null;
  readonly usage: TokenUsage;
  readonly cost: Cost;
  readonly billing: "api" | "subscription" | "extra_usage" | "unknown";
}

export interface CostTotal {
  readonly kind: CostKind;
  readonly amount: string | null;
  readonly currency: string | null;
  readonly calls: number;
}

export interface UsageTotals {
  readonly calls: number;
  readonly costs: readonly CostTotal[];
  /** 기록이 빠진 호출이 있다. */
  readonly complete: boolean;
}

export interface TraceMissing {
  readonly kind: "body" | "record" | "source";
  readonly reference: string;
  readonly reason: string;
}

export interface ToolActivity {
  readonly steps: number;
  readonly succeeded: number;
  readonly failed: readonly string[];
  readonly denied: readonly string[];
  readonly notExecuted: readonly string[];
  readonly uncertain: readonly string[];
  readonly unfinished: readonly string[];
  readonly external: readonly string[];
}

export interface ModelActivity {
  readonly attempts: number;
  readonly failed: readonly string[];
  readonly partial: readonly string[];
  readonly cancelled: readonly string[];
  readonly uncertain: readonly string[];
  readonly unfinished: readonly string[];
}

/** 일 하나의 trace. 본문 없이 참조와 사실만이다. */
export interface ReviewTrace {
  readonly work: string;
  readonly session: string | null;
  readonly state: WorkState | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly outcome: Outcome | null;
  readonly basis: string | null;
  readonly messages: readonly string[];
  readonly toolCalls: readonly string[];
  readonly modelCalls: readonly string[];
  readonly handoffs: readonly {
    readonly sender: string;
    readonly receiver: string;
  }[];
  readonly tools: ToolActivity;
  readonly models: ModelActivity;
  readonly activeMs: number;
  readonly waitingMs: number;
  readonly missing: readonly TraceMissing[];
}

/** 저장된 본문(근거·도구 입력·도구 결과). 지금의 redaction을 거친 값이다. */
export interface StoredBody {
  readonly value: unknown;
  readonly truncated: boolean;
}

export type BodyKind = "run_basis" | "tool_call_input" | "tool_call_output";

/** 근거 본문에서 이 화면이 읽는 것. 모르는 모양이면 null이다. */
export interface BasisSummary {
  readonly presetRevision: number | null;
  readonly judgmentModel: string | null;
  readonly organizingModel: string | null;
}

export type ContentKind =
  | "message"
  | "model_input"
  | "model_output"
  | "tool_input"
  | "tool_output";

export interface ExportResult {
  readonly sent: number;
  readonly notSent: number;
}

export type UndoOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: string };

/** 사람이 고르는 Preset 판 하나. */
export interface PresetVersion {
  readonly id: string;
  readonly revision: number;
  readonly definition: PresetDefinition;
}

export type ContextKind =
  | "all"
  | "work_place"
  | "assignment_scope"
  | "project"
  | "app"
  | "context"
  | "document"
  | "sdk";

export interface ContextChoice {
  readonly kind: ContextKind;
  readonly target: string | null;
  readonly section: string | null;
}

export interface McpTool {
  readonly server: string;
  readonly tool: string;
}

/** model 선택. 계정은 쓸 순서대로 담긴다. 나머지 값은 고치지 않고 그대로 돌려보낸다. */
export interface ModelPick {
  readonly provider: string;
  readonly accounts: readonly string[];
  readonly model: string;
  /** 바꾸지 않는 값(추론 단계·옵션)을 그대로 돌려보내는 원본. 화면은 읽지 않는다. */
  readonly raw: unknown;
}

/**
 * Preset 정의에서 화면이 고치는 자리. `raw`는 고치지 않는 자리(prompt·capability·지침·safe tool)를
 * 그대로 돌려보내려고 쥐는 원본이고 화면은 읽지 않는다.
 */
export interface PresetDefinition {
  readonly name: string;
  readonly origin: "product" | "user";
  readonly role: RoleKind;
  readonly decisions: ModelPick | null;
  readonly summaries: ModelPick | null;
  readonly context: readonly ContextChoice[];
  readonly skills: readonly string[];
  readonly servers: readonly string[];
  readonly tools: readonly McpTool[];
  readonly internals: {
    readonly prompt: string;
    readonly bundles: readonly {
      readonly name: string;
      readonly revision: number;
    }[];
    readonly capabilityTools: readonly string[];
    readonly instructions: number;
  };
  readonly raw: unknown;
}

export interface PresetEntry {
  readonly id: string;
  readonly revision: number;
  readonly definition: PresetDefinition;
}

/** Preset을 고를 때 보이는 선택지. */
export interface PresetChoices {
  readonly connections: readonly {
    readonly id: string;
    readonly name: string;
    readonly definition: string;
    readonly accounts: readonly {
      readonly key: string;
      readonly label: string;
      readonly order: number;
    }[];
  }[];
  readonly servers: readonly {
    readonly name: string;
    readonly enabled: boolean;
    /** 사람이 분류한 tool만 알 수 있다. 연결 중인 server의 모든 tool은 읽는 길이 없다. */
    readonly tools: readonly string[];
  }[];
}

export interface RolesSource {
  /** core 연결 상태를 듣는다. 준비되면 화면이 다시 읽는다. 해제는 반환 함수다. */
  watch(listener: (state: { readonly state: string }) => void): () => void;
  roles(): Promise<SourceResult<readonly RoleRow[]>>;
  /** 역할의 하는 일. */
  works(role: RoleRow): Promise<SourceResult<readonly WorkRow[]>>;
  /** 역할이 만든 것. */
  made(role: RoleRow): Promise<SourceResult<readonly MadeLink[]>>;
  documentTitle(document: string): Promise<SourceResult<string>>;
  /** 역할 하나에 묶은 대화 통로. 회수된 담당은 지난 대화만 읽는다. */
  conversation(role: RoleRow): ConversationSource;
  /** 멈춘 역할을 다시 시작한다. */
  resume(role: RoleRow): Promise<SourceResult<null>>;
  /** 하는 일 멈추기. */
  stop(work: WorkRow, key: string): Promise<SourceResult<null>>;
  /** 앞선 일이 멈춘 뒤 이어서 시작하는 것을 사람이 확인한다(다시 시작). */
  restart(work: WorkRow): Promise<SourceResult<null>>;
  /** 처음 요청의 글(다시 시키기가 입력칸에 채운다). 읽지 못하면 실패다. */
  requestText(work: WorkRow): Promise<SourceResult<string>>;

  /** 작업 검토. */
  trace(work: string): Promise<SourceResult<ReviewTrace>>;
  steps(work: string): Promise<SourceResult<readonly ToolStep[]>>;
  attempts(work: string): Promise<SourceResult<readonly ModelAttempt[]>>;
  usage(work: string): Promise<SourceResult<UsageTotals>>;
  /** 근거·도구 입력·도구 결과. 본문이 없으면 not_found·unavailable이다. */
  body(kind: BodyKind, id: string): Promise<SourceResult<StoredBody>>;
  /** 요청 글과 만든 문서. 사용자 요청과 결과 링크다. */
  workMessages(
    role: RoleRow,
    work: WorkRow,
  ): Promise<
    SourceResult<
      {
        readonly request: string | null;
        readonly results: readonly MadeLink[];
      }
    >
  >;
  /** 파일 export. 대상 폴더를 사람이 고른 뒤 보낸다. 그만두면 null이다. */
  exportTrace(
    work: string,
    kinds: readonly ContentKind[],
  ): Promise<SourceResult<ExportResult | null>>;
  /** 되돌리기. 확인 창이 미리 보기를 읽고 결정을 받는다. */
  undo(work: string): Promise<UndoOutcome>;

  /** Preset. */
  presets(role: RoleRow): Promise<SourceResult<readonly PresetEntry[]>>;
  choices(): Promise<SourceResult<PresetChoices>>;
  /** 그 연결 정의가 알려진 model 이름들. 확인하지 못했으면 실패다. */
  models(definition: string): Promise<SourceResult<readonly string[]>>;
  /** 새 판 저장. 사람이 만든 Preset은 같은 Preset의 새 판이고 기본 Preset은 사본으로 만든다. */
  savePreset(
    role: RoleRow,
    entry: PresetEntry | null,
    edited: PresetDefinition,
    reason: string,
  ): Promise<SourceResult<PresetEntry>>;
  /** 명시 적용. 다음 일부터 이 판을 쓴다. */
  applyPreset(
    role: RoleRow,
    preset: string,
    revision: number,
  ): Promise<SourceResult<null>>;
}
