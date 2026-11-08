// prompt 조립의 값이다. 순수 값만 두고 I/O와 hash는 `assembleTurnPrompt`가 한다.
// 자료·tool 결과의 포장(`~~~data`)은 safety가 하고 이 층은 이미 포장된 문자열을 순서대로 놓기만 한다.

// `assembleTurnPrompt`의 system 층. 순서대로 workspace_kind, instructions, memory, skills, workspace이고 자주 안 바뀌는 것이 앞이다.
// memory는 session 첫 turn에 읽어 고정한 값이라 session 안에서는 바뀌지 않는다.
type TurnLayerKind =
  | "workspace_kind"
  | "instructions"
  | "memory"
  | "skills"
  | "workspace";

// system 쪽 층. 경계 표시가 달린 층의 끝이 cache 경계 하나다.
export type SystemLayerKind = TurnLayerKind;

export type PromptTool = {
  name: string;
  description: string;
  input_schema: unknown;
};

// 이력에 들어오는 조각. reasoning 본문은 조립에서 빠진다.
export type HistoryPart =
  | { kind: "text"; text: string }
  // signature는 Gemini가 낸 thoughtSignature다. turn 이력(checkpoint)에 함께 남아 뒤 turn에도 그대로 간다.
  | {
      kind: "tool_use";
      id: string;
      name: string;
      input: unknown;
      signature?: string;
    }
  | { kind: "tool_result"; id: string; text: string }
  // tool 결과 안의 이미지다. id는 tool_result와 같은 tool_use id이고 provider adapter가 image block으로 바꾼다.
  | {
      kind: "tool_result_image";
      id: string;
      media_type: string;
      data_base64: string;
    }
  // 사람이나 다른 agent가 보낸 이미지다. user role에 놓이고 provider adapter가 image block으로 바꾼다.
  | { kind: "image"; media_type: string; data_base64: string }
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
// `cache`가 false면 경계 표시를 달지 않는다. 없으면 단다(Anthropic marker는 넷까지다).
export type SystemBlock = {
  layer: SystemLayerKind;
  text: string;
  cache?: boolean;
};

// provider 중립 요청. 번역은 adapter가 하고 tools는 이번 call의 목록만이다.
export type PromptRequest = {
  system: SystemBlock[];
  tools: PromptTool[];
  messages: PromptMessage[];
};

export type ModelLimits = {
  context_limit: number;
  input_limit: number;
  output_limit: number;
};

export type CacheBoundary = {
  after: SystemLayerKind;
  // 이 경계까지 층 hash를 이어 만든 hash. 이 앞이 같으면 같다.
  prefix_hash: string;
};

export type BlockedReason =
  | "workspace_kind_missing"
  | "invalid_budget"
  | "input_over_budget";

// provider 포장. 번역된 wire body와 전송 adapter가 따로 쥔 opaque 상태의 byte 수다.
export type WirePack = { body: unknown; opaque_bytes: number };
export type WirePacker = (request: PromptRequest) => WirePack;

// handle은 call의 `to.agent`로 쓰는 주소이고 name은 보이는 이름이다. scoped는 이 workspace에서만 있는 agent다.
export type WorkspaceAgent = {
  handle: string;
  name: string;
  description?: string;
  scoped?: boolean;
};
