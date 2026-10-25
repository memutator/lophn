// model 호출 공통 interface. runtime 내부 interface는
// `InvokeModelCall` 타입이다. 세 adapter(anthropic-messages·
// openai-responses·openai-chat-completions)가 같은 입력·출력을 갖는다. SDK의
// 숨은 retry는 0이다: retry 횟수·간격·총 시도 수의 주인은 run-loop다.

import type { Result } from "../../../base/mod.ts";
import type {
  CallModel,
  ModelOutcome,
  TokenUsage,
} from "../../../protocol/lophn-agent/mod.ts";
import type { FailureVerdict } from "./failures.ts";
import type { ToolCall } from "./adapters/messages.ts";

// 받은 글의 늘어난 조각 하나다. redaction 전 날 글이고 core가 화면에 내기 전에 가린다
// (`run-loop/live-turns.ts`).
export type ModelOutputDelta = { kind: "text" | "reasoning"; text: string };

// 호출 입력. resolve가 준 판과 turn 근거다.
export type ModelCallInput = {
  // 시도 id. 호출 시작 기록과 같은 id다.
  callId: string;
  // Compact의 요약 call은 turn이 없고 session만 있다.
  turn: string | null;
  session: string | null;
  purpose: "judgment" | "organizing";
  model: CallModel;
  // endpoint는 API base다. adapter가 표의 path를 붙인다.
  endpoint: string;
  // 보호한 prompt와 context_basis hash. 값은 여기 없다.
  inputHash: string;
  contextBasisHash: string;
  // 전송할 본문(adapter가 번역한 wire bytes).
  body: Record<string, unknown>;
  // prompt-assemble이 준 cache 경계는 buildRequest에서 이미 표시됐다.
  // token 사용량 정의 판. 보고 사용량에 붙는다.
  usageRevision: string;
  // 재전송 대상 opaque 추론이 있는 요청의 state-free 계속 검증 입력이다.
  continuation?: { pendingReasoning: boolean; reasoningRequired: boolean };
  // 받은 글이 늘 때마다 늘어난 조각을 넘긴다. compactor(`session/compactor.ts`)는 넘기지 않는다.
  onDelta?: (delta: ModelOutputDelta) => void;
};

// 호출 출력. 순서·대응을 보존한 text·tool requests다.
export type ModelCallOutput = {
  id: string;
  outcome: ModelOutcome;
  text: string;
  toolCalls: ToolCall[];
  // 완성 확인 뒤 tool만 실행 대상이다. partial·failed의 tool은 없다.
  usage?: TokenUsage;
  // failed 결과의 분류 근거다. credential 상태 변경이 읽고 보존하지 않는다.
  verdict?: FailureVerdict;
  durationMs: number | null;
  firstOutputMs: number | null;
};

export type InvokeModelCall = (
  input: ModelCallInput,
  signal: AbortSignal,
) => Promise<Result<ModelCallOutput>>;

// SDK 숨은 retry 0. 호출은 한 번이다. 재시도는 run-loop가 새 ModelCall로 한다.

// parser 상한 실패는 일시가 아니라 요청 크기 문제다. over 종류를 그대로 전달한다.
