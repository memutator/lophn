import type {
  AgentRole,
  AssignmentScope,
  WorkPlace,
} from "../../../protocol/lophn-agent/mod.ts";
import type {
  InstructionLayerKind,
  InstructionStatus,
} from "../../instructions/mod.ts";
import type { SummaryRef } from "./summary.ts";

export type { SummaryRef } from "./summary.ts";

// prompt 조립의 값과 입력이다(lophn-agent/harness/prompt-assemble 요구 R1–R3, R7–R9, R24, R30).
// 순수 값만 두고 I/O와 hash는 work.ts가 한다. 자료·tool 결과의 포장(`~~~data`)은 safety가 하고
// 이 층은 이미 포장된 문자열을 순서대로 놓기만 한다.

export const PROMPT_RULE_VERSION = "prompt-assemble.1";

// token을 세는 방법의 이름과 판. 전체 wire UTF-8 byte를 token 상한으로 쓴다(chars/4 하한 추정 없음).
export const COUNT_METHOD = "wire-utf8-bytes.1";

export type PromptLayerKind =
  | "product"
  | "role_agent"
  | "user_instructions"
  | "work_material"
  | "turn_context";

// system 쪽 세 층. 각 층의 끝이 cache 경계 하나다.
export type SystemLayerKind = "product" | "role_agent" | "user_instructions";

export type PromptTool = {
  name: string;
  description: string;
  input_schema: unknown;
};

// 이력에 들어오는 조각. reasoning 본문은 조립에서 빠진다(R24).
export type HistoryPart =
  | { kind: "text"; text: string }
  | { kind: "tool_use"; id: string; name: string; input: unknown }
  | { kind: "tool_result"; id: string; text: string }
  | { kind: "reasoning"; text: string };

export type HistoryMessage = {
  role: "user" | "assistant";
  parts: readonly HistoryPart[];
};

export type PromptPart = Exclude<HistoryPart, { kind: "reasoning" }>;

export type PromptMessage = {
  role: "user" | "assistant";
  parts: PromptPart[];
};

// 한 층의 system 본문. 층마다 하나이고 끝이 cache 경계다.
export type SystemBlock = { layer: SystemLayerKind; text: string };

// provider 중립 요청. 번역은 adapter가 하고 tools는 이번 call의 목록만이다(R7).
export type PromptRequest = {
  system: SystemBlock[];
  tools: PromptTool[];
  messages: PromptMessage[];
};

export type WorkMaterial = {
  // 목적·대상, 현재 run 사실
  purpose: string | null;
  run_facts: string | null;
  // 사람이 부른 Compact가 만든 요약. 요약이 덮은 구간의 원문은 이력에 없다(R23).
  compact_summary: string | null;
  // 이미 포장된 자료 목록(목차·요약)
  materials: readonly string[];
  compaction_summary: string | null;
  history: readonly HistoryMessage[];
  // 현재 사람 요청 전문과 아직 반영하지 않은 steering. 절대 줄이지 않는다.
  request: string | null;
  steering: readonly string[];
};

export type ModelLimits = {
  context_limit: number;
  input_limit: number;
  output_limit: number;
};

// 실제로 넣은 자료 근거와 생략(R4, R18). 본문 없이 context id·판 hash·깊이만 남긴다.
export type MaterialReference = {
  address: string;
  version: string | null;
  // full은 overview와 용어집, overview_only는 용어집을 뺀 것, names_only는 type 이름만 남긴 것이다(R18).
  depth: "full" | "overview_only" | "names_only";
};

// 줄인 자료(`input_over_budget`)이거나 읽지 못해 자료 자리에 이유만 남긴 context(`level: material`,
// `load_failed`, `detail`이 그 context의 이유)다.
export type MaterialOmission = {
  source: string;
  level: "glossary" | "overview" | "material";
  reason: "input_over_budget" | "load_failed";
  detail?: string;
};

// 실제 포함한 화면 근거(R28). 본문은 입력 blob에 있고 여기엔 포함한 값과 수집 시각만 둔다.
export type TurnContextBasis = {
  collected_at: string;
  timezone: string | null;
  workspace_generation: number | null;
  observed_at: string | null;
  tabs: { key: string; kind: string; selected: boolean }[];
  focused_key: string | null;
  omitted_count: number;
  app_summary: { included: boolean; bytes: number };
  unavailable: string[];
  text_hash: string | null;
  bytes: number;
};

// 실제 포함한 원문 세션·구간 근거다(T28 압축). 명시 세션만 쓰고 원래
// 순서·구간을 보존한다.
export type MessageRange = {
  session: string;
  from_seq: bigint;
  through_seq: bigint;
};

export type PromptEvidence = {
  references: readonly MaterialReference[];
  omissions: readonly MaterialOmission[];
  turn_context: TurnContextBasis | null;
  // compaction이 더한 원문 구간과 summary 근거다. 없으면 비운다.
  message_ranges?: readonly MessageRange[];
  summaries?: readonly SummaryRef[];
};

export type PromptInput = {
  product: { instructions: string } | null;
  tools: readonly PromptTool[];
  // 제품 역할 지시와 켜진 skill 목록이다. agent 정의 본문은 여기 없고 사람 지침 층 끝에 온다.
  role: { instructions: string } | null;
  // 지침 층을 고르는 작업 자리 근거. 탭은 여기 없다(R30).
  work: { role: AgentRole; session: WorkPlace; scope: AssignmentScope };
  material: WorkMaterial;
  // 이번 judgment turn의 동적 context(포장 끝). 없으면 null.
  turn_context: string | null;
  // material.ts·turn-context.ts가 고른 근거. 없으면 비운다.
  evidence?: PromptEvidence;
  limits: ModelLimits;
  reserved_output: number;
};

export type PromptLayer = {
  kind: PromptLayerKind;
  content: unknown;
  hash: string;
};

export type CacheBoundary = {
  after: SystemLayerKind;
  // 이 경계까지 층 hash를 이어 만든 hash. 이 앞이 같으면 같다.
  prefix_hash: string;
};

// 본문 없는 지침 근거(R30).
export type InstructionBasis = {
  kind: InstructionLayerKind;
  place: string | null;
  source_hash: string | null;
  transmitted_hash: string | null;
  status: InstructionStatus;
  bytes: number;
};

export type ContextBasis = {
  rule_version: string;
  work_place: WorkPlace;
  instructions: { layers: InstructionBasis[]; total_bytes: number };
  layer_hashes: { kind: PromptLayerKind; hash: string }[];
  cache_boundaries: CacheBoundary[];
  references: MaterialReference[];
  omissions: MaterialOmission[];
  turn_context: TurnContextBasis | null;
  // T28 compaction이 더한 원문 구간과 summary 근거다. 기본 []다.
  message_ranges: MessageRange[];
  summaries: SummaryRef[];
  tool_names: string[];
  size: {
    input_budget: number;
    reserved_output: number;
    measured_tokens: number;
    count_method: string;
  };
};

export type PromptAssembly = {
  rule_version: string;
  layers: PromptLayer[];
  basis: ContextBasis;
  cache_boundaries: CacheBoundary[];
  input_budget: number;
  reserved_output: number;
  measured_tokens: number;
  count_method: string;
  request: PromptRequest;
  // 조립한 요청 전체와 basis의 hash
  input_hash: string;
  basis_hash: string;
};

export type BlockedReason =
  | "product_missing"
  | "role_missing"
  | "instructions_unavailable"
  | "instructions_blocked"
  | "invalid_budget"
  | "mandatory_input_overflow"
  | "input_over_budget";

export type AssembleResult =
  | { status: "ready"; assembly: PromptAssembly }
  | { status: "blocked"; reason: BlockedReason; message: string };

// provider 포장. 번역된 wire body와 전송 adapter가 따로 쥔 opaque 상태의 byte 수다.
export type WirePack = { body: unknown; opaque_bytes: number };
export type WirePacker = (request: PromptRequest) => WirePack;
