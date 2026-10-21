// OpenAI 호환 공통 레이어. endpoint path 결합(/v1 중복 없음),
// redirect 목적지 검사(다른 목적지에 credential 없음), provider 정의가 명시하는
// 호환 quirk(DeepSeek·OpenRouter 등), protocol별 state-free 계속 검증, 시그니처
// 비교를 여기 둔다. 형식은 model 이름이 아니라 provider 정의가
// 명시한다. Gemini는 Chat Completions 호환 연결이고 네이티브 Google 형식은
// 받지 않는다.

// endpoint는 API base이고 adapter가 표의 path를 붙인다. base가
// 이미 /v1으로 끝나면 path의 /v1을 붙이지 않는다.
export function joinEndpoint(base: string, path: string): string {
  const trimmed = base.replace(/\/+$/, "");
  const inner = path.startsWith("/") ? path : `/${path}`;
  if (/\/v1$/.test(trimmed) && (inner === "/v1" || inner.startsWith("/v1/"))) {
    return trimmed + inner.slice(3);
  }
  return trimmed + inner;
}

// 인증 없음은 127.0.0.1·::1·localhost에만 허용된다. Ollama·LM Studio·
// llama.cpp의 loopback endpoint가 여기 해당한다. 파싱 실패는 fail closed다.

// provider redirect로 다른 목적지에 credential을 보내지 않는다. 같은
// origin 안의 redirect만 안전하다. 목적지를 못 읽으면 안전하지 않은 것으로 세운다.

type CompatQuirks = {
  // assistant 메시지마다 reasoning_content 필수(DeepSeek, 조사 문서 1378–1384·
  // 1685–1693). 없는 턴은 공백 하나로 채운다(빈 문자열은 거절이다).
  reasoning_content_required: boolean;
  // OpenRouter reasoning_details는 구조 배열이지 사람이 읽을 본문이 아니다.
  // 무시한다.
  reasoning_details_ignored: boolean;
};

// provider 정의 key만 본다. model 이름 substring으로 quirk를 추론하지 않는다.
const QUIRKS: Record<string, CompatQuirks> = {
  deepseek: {
    reasoning_content_required: true,
    reasoning_details_ignored: false,
  },
  openrouter: {
    reasoning_content_required: false,
    reasoning_details_ignored: true,
  },
};

const PLAIN: CompatQuirks = {
  reasoning_content_required: false,
  reasoning_details_ignored: false,
};

export function quirksFor(provider: string): CompatQuirks {
  return QUIRKS[provider] ?? PLAIN;
}

type StateFreeVerdict = {
  // continuable이 false면 run-loop가 configuration_unavailable로 끝낸다.
  continuable: boolean;
  adjustment: "none" | "reasoning_item_dropped" | "reasoning_content_padded";
};

// opaque 상태가 메모리에 없을 때(재시작·compaction) protocol별 state-free 계속을
// 검증한다. Responses는 reasoning item을 빼도 function_call·
// call_id 대응이 남으므로 계속 가능하다. Chat는 reasoning_content 없는 assistant
// 턴을 공백 하나로 채우므로 DeepSeek 필수라도 계속 가능하다. 두 protocol 모두
// 검증을 통과한다. 검증을 통과하지 못하는 protocol(서명 필수 Anthropic)은
// messages.ts의 reasoningFor가 실패를 내고 run-loop가 configuration_unavailable로
// 끝낸다.
export function verifyStateFree(input: {
  protocol: "openai-responses" | "openai-chat-completions";
  // 이번 요청에 재전송 대상 opaque 상태가 있었는가.
  pendingReasoning: boolean;
  reasoningRequired: boolean;
}): StateFreeVerdict {
  if (!input.pendingReasoning) return { continuable: true, adjustment: "none" };
  if (input.protocol === "openai-responses") {
    return { continuable: true, adjustment: "reasoning_item_dropped" };
  }
  return {
    continuable: true,
    adjustment: input.reasoningRequired ? "reasoning_content_padded" : "none",
  };
}

// 시그니처 비교. 블록의 signature와 메모리의 signature가
// 같을 때만 재전송 대상이다. 다르거나 한쪽이 없으면 깨진 턴으로 보고 그 시그니처를
// 재전송하지 않는다(Hermes 487–524).

// tool 인자 JSON 검증. 비어 있거나 `null`이면 인자 없는 호출로 본다.
export function verifiedJsonObject(text: string): boolean {
  if (text.trim().length === 0) return true;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed === null || typeof parsed === "object" &&
        !Array.isArray(parsed);
  } catch {
    return false;
  }
}
