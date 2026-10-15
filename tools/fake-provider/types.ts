// fake provider의 script 값. 제품 domain contract가 아니다.

export type Protocol = "messages" | "responses" | "chat_completions";

// 요청 기대값. 적은 것만 본다. body는 object key만 정렬해 비교하고 array 순서는 그대로 둔다.
export type Expectation = {
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: unknown;
};

export type ResponseChunk = {
  // UTF-8 문자열. 바이트 경계가 필요하면 encoding: "base64".
  bytes: string;
  encoding?: "utf8" | "base64";
  delayMs?: number;
  // 이름이 있으면 테스트가 release(name)할 때까지 이 chunk를 보내지 않는다.
  gate?: string;
};

export type StepResponse = {
  status: number;
  headers?: Record<string, string>;
  // 비stream 본문. chunks와 함께 쓸 수 없다.
  body?: string;
  chunks?: ResponseChunk[];
  // reset은 chunk를 보낸 뒤 소켓을 끊는다. hold는 마지막 다음 이름 없는 대기다.
  end?: "close" | "reset" | "hold";
};

// 정상 흐름 편의. 오류·partial·reset·여러 tool은 raw response로 쓴다.
export type SemanticReply = {
  text?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  // 생략한 필드는 응답에 넣지 않는다(0으로 채우지 않음).
  usage?: {
    input?: number;
    cacheRead?: number;
    cacheWrite?: number;
    output?: number;
    reasoning?: number;
  };
  stop?: "end" | "tool_calls" | "max_tokens" | "length" | "incomplete";
};

export type Step = {
  id: string;
  protocol: Protocol;
  match?: Expectation;
  response?: StepResponse;
  reply?: SemanticReply;
};

export type Script = {
  steps: Step[];
};

export type LoggedHeader = {
  name: string;
  // 인증 header는 값 대신 존재와 종류만 남긴다.
  present: true;
  kind?: "api_key" | "bearer" | "other";
  value?: string;
};

export type LoggedRequest = {
  seq: number;
  atMs: number;
  method: string;
  path: string;
  headers: LoggedHeader[];
  // 인증 값을 뺀 structured 본문. raw 본문은 omitted만 남긴다.
  body: unknown;
  matchedStep?: string;
  aborted: boolean;
};

export type ScriptFailure =
  | { kind: "unexpected"; seq: number; detail: string }
  | { kind: "exhausted" }
  | { kind: "remaining"; ids: string[] }
  | { kind: "none" };
