---
type: research
concerns: [lophn-agent/harness/provider, lophn-agent/harness/usage]
---
# Provider adapter 조사: Anthropic Messages · OpenAI Responses · OpenAI Chat Completions

## 질문

세 protocol의 요청 번역, SSE 파싱, stop reason과 complete/partial 판정, reasoning replay, reasoning-effort 대응, cache 표시, 오류 분류, usage 포함 관계, OpenAI 호환 서버의 quirk, TTFT·abort·idle timeout, 테스트 fixture를 코드로 확인한다. lophn은 protocol을 model 이름이 아니라 provider 정의가 명시한다(`lophn-agent/harness/provider#R3`, `docs/architecture/lophn-agent.md` §5.2).

## 0. 조사 범위

조사일 2026-10-04. shallow clone(`/tmp/claude-1000/lophn-research/`). `[확인]`은 해당 revision 코드, `[추측]`은 정황, `[미확인]`은 이번 조사에서 못 본 것(기능 부재가 아님). 줄 번호는 revision 기준.

| 프로젝트 | revision | 본 범위 |
|---|---|---|
| Pi | `83692682f095` | `pi/packages/ai/src/api/{anthropic-messages,openai-responses-shared,openai-completions}.ts`, `utils/{overflow,provider-retry,error-body,json-parse,abort}.ts`, `api/simple-options.ts` |
| Codex | `3a69ec3ef8fb` | `codex-rs/codex-api/src/sse/{responses,responses_error}.rs`, `codex-rs/core/src/client.rs`, `codex-rs/model-provider-info/src/lib.rs` |
| OpenCode | `907b3bc518fa` | `opencode/packages/llm/src/protocols/{shared,anthropic-messages,openai-responses,openai-chat}.ts`, `provider-error.ts`, `opencode/packages/opencode/src/provider/{error,transform}.ts` |
| Hermes | `343500b3547e` | `hermes-agent/agent/{error_classifier,retry_utils,anthropic_adapter,anthropic_message_convert,codex_responses_adapter,chat_completion_helpers}.py`, `agent/transports/chat_completions.py` |

OpenClaw(`37efa0b4a644`)는 provider 호출 지점을 이번 조사에서 확인하지 못했다 `[미확인]`. Claude Code 저장소는 harness 소스가 없어 근거로 쓰지 않았다.

## 프로젝트별

### Pi (`83692682f095`)

- **SSE 디코더를 직접 구현**한다. `iterateSseMessages`/`decodeSseLine`/`consumeLine`(`pi:packages/ai/src/api/anthropic-messages.ts` 379–569)이 `TextDecoder({stream:true})`로 UTF-8 경계를 넘기고 `\n`과 `\r\n`을 모두 자른다. `message_stop` 전에 끝나면 "Anthropic stream ended before message_stop", stop reason 없이 끝나면 "Anthropic stream ended without a stop reason"을 던진다 `[확인]`.
- **stop reason**: `mapStopReason`(1613–1639)은 `end_turn→stop`, `max_tokens→length`, `tool_use→toolUse`, `refusal→error`, `pause_turn→stop`, `stop_sequence→stop`, `sensitive→error`, 그 외는 throw `[확인]`.
- **usage**: `message_start`(680–688)와 `message_delta`(828–857)에서 잡는다. `output_tokens_details.thinking_tokens`는 output의 부분집합으로 취급(848–852). `totalTokens = input + output + cacheRead + cacheWrite`로 **Anthropic input이 cache를 제외**함을 전제로 더한다 `[확인]`.
- **thinking**: adaptive는 `{type:"adaptive", display}` + `output_config.effort`, budget은 `{type:"enabled", budget_tokens: options.thinkingBudgetTokens || 1024}`(1233–1263). `redacted_thinking`은 `redacted:true` thinking block으로 저장하고 signature = data(713–722). replay(`convertMessages` 1404–1438)는 signature를 그대로 다시 보내고, signature가 없으면 plain text로 낮춘다(`allowEmptySignature` 제외) `[확인]`.
- **cache**: `getCacheControl`(79–93)은 retention이 long이고 `supportsLongCacheRetention`일 때만 ttl "1h", 아니면 ephemeral 5분. system, 마지막 user/system block, 마지막 tool에 건다(1483–1509, 1608) `[확인]`.
- **SDK retry 0**: `maxRetries: 0`(647)을 넘기고 자체 `retryProviderRequest`(`pi:packages/ai/src/utils/provider-retry.ts`, 기본 maxRetries 0, 상한 60_000ms)로 감싼다. retryable은 `x-should-retry` 또는 status 408/409/429/≥500. `retry-after-ms` 다음 `retry-after`(초 또는 HTTP-date)를 읽고, backoff는 `min(0.5·2^n, 8)s · (1−0.25·rand)`. 서버 delay가 cap을 넘으면 기다리지 않고 throw `[확인]`.
- **OAuth 위장**: `isOAuthToken`이 `sk-ant-oat`를 감지하면(978–1034) user-agent `claude-cli/2.1.280`, beta `claude-code-20250219`·`oauth-2025-04-20`로 Claude Code를 가장하고 tool 이름을 `toClaudeCodeName`으로 바꾼다 `[확인]`. lophn `provider#R15`가 금지하는 바로 그 동작.
- **tool id**: `normalizeToolCallId`(1290–1292)가 `[a-zA-Z0-9_-]{1,64}`로 자른다. 연속 toolResult는 user message 하나로 합친다(1462–1478). 오류 시 partialJson scratch를 지우고 stopReason을 aborted/error로 둔다(887–897) `[확인]`.
- **Responses**: `convertResponsesMessages`(`pi:packages/ai/src/api/openai-responses-shared.ts` 145–354)는 developer/system role, tool id `call_id|itemId`에 `fc_`/`ctc_` 접두 규칙을 적용하고 cross-model이면 item id를 버린다. `processResponsesStream`(433–777)은 output_index slot으로 모으고, reasoning item 전체를 JSON으로 `thinkingSignature`에 저장(692). 종료 이벤트 없이 끝나면 throw(760–762), stopReason이 toolUse인데 tool call이 미완이면 throw(766–775). `backfillReasoningSignatures`(538–551)는 Azure `encrypted_content`를 종료 response에서 복구한다(pi issue 6409) `[확인]`. `mapStopReason`(779–809): `completed→stop`, `incomplete`+`max_output_tokens→length` 그 외 error, `failed`/`cancelled→error`. usage(560–575): `input = max(0, input_tokens − cached_tokens − cache_write_tokens)`, output은 reasoning 부분집합 포함 `[확인]`.
- **Chat**: tool call을 `index`와 `id` 둘 다로 누적(`toolCallBlocksByIndex`/`toolCallBlocksById`, `openai-completions.ts` 401–551). reasoning 필드를 `reasoning_content`, `reasoning`, `reasoning_text` 순으로 시도(606–633), OpenRouter `reasoning_details`는 `appendOpenAIReasoningDetail`로 합친다(665–676). `parseChunkUsage`(1511–1552): cached는 `prompt_tokens_details.cached_tokens ?? prompt_cache_hit_tokens ?? cached_tokens`, `input = prompt − cached − cache_write`. `mapStopReason`(1554–1578): `stop`/`end→stop`, `length→length`, `function_call`/`tool_calls→toolUse`, `content_filter`/`network_error→error`, null→stop, 그 외 error. finish_reason 없이 끝나면 throw(690–698, `supportsFinishReason` false면 예외) `[확인]`. `buildParams`(797–1002)는 `stream_options.include_usage`, 지원 시 `store:false`, `api.openai.com` 또는 long retention일 때만 `prompt_cache_key`, `prompt_cache_retention:"24h"`, thinking 형식을 deepseek/zai/qwen/openrouter 등으로 분기. DeepSeek은 assistant message마다 빈 `reasoning_content`라도 강제(1378–1384). tool id는 hash로 40자 이하(1194–1218) `[확인]`.
- **overflow**: `OVERFLOW_PATTERNS`/`NON_OVERFLOW_PATTERNS`(`pi:packages/ai/src/utils/overflow.ts` 37–80)가 provider별 overflow 문구를 정규식으로 매칭(Anthropic·OpenAI·Google·xAI·Groq·OpenRouter·llama.cpp·LM Studio·Ollama 등). `isContextOverflow`는 silent overflow(input+cacheRead > window)와 MiMo식 length+output 0(≥99% window)도 잡는다 `[확인]`.
- **budget**: `DEFAULT_THINKING_BUDGETS`(`simple-options.ts`) minimal 1024/low 2048/medium 8192/high 16384, `MIN_ANSWER_TOKENS=1024`, `CONTEXT_SAFETY_TOKENS=4096`. `clampReasoning`이 xhigh/max를 high로 낮춘다 `[확인]`.
- **JSON 조각**: `parseStreamingJson`(`json-parse.ts` 104–124)은 불완전 JSON도 repair 후 항상 객체를 돌려주고, 실패하면 `{}` `[확인]`. 즉 "완성"을 판정하지 않고 부분 결과를 내놓는다.
- **abort**: `operationSignal`/`raceWithAbortSignal`(`abort.ts` 9–17)로 signal을 race시킨다. TTFT 측정 지점은 이번 조사에서 확인하지 못했다 `[미확인]`.

### Codex (`3a69ec3ef8fb`)

- **Responses SSE**: `process_responses_event`(`codex:codex-rs/codex-api/src/sse/responses.rs` 344–505)이 `output_item.done/added`, `output_text.delta`, `reasoning_summary_text.delta/done`, `reasoning_text.delta`, `response.created/failed/completed/incomplete`를 처리한다. `function_call_arguments.delta/done`은 **의도적으로 무시**(483–491)하고 인자는 `output_item.done`의 전체 값만 쓴다 `[확인]`.
- **incomplete 처리**: reason `content_filter→ContentFilter`, `interrupted→end_turn Some(false)`, **그 외 모든 reason은 `ApiError::Stream`**("Incomplete response returned, reason: …", 418–435) `[확인]`. lophn은 incomplete를 partial(tool 미실행)로 보므로 여기가 다르다.
- **idle timeout**: `process_sse_with_treatment`(524–570)이 `timeout(idle_timeout, stream.next())`로 "idle timeout waiting for SSE", 스트림 close는 "stream closed before response.completed"로 처리하고 JSON 파싱 실패는 그 이벤트를 skip한다 `[확인]`. 기본값은 `ModelProviderInfo::stream_idle_timeout`(`codex:codex-rs/model-provider-info/src/lib.rs` 512–517) = `DEFAULT_STREAM_IDLE_TIMEOUT_MS` **300_000ms**(66행), 재연결 `stream_max_retries` 기본 5·상한 100(67, 73행) `[확인]`.
- **오류 코드**: `parse_failed_response`(`responses_error.rs` 26–103)가 `context_length_exceeded→ContextWindowExceeded`, `insufficient_quota|credit_balance_exhausted|organization_spend_limit_exceeded|project_spend_limit_exceeded→QuotaExceeded`, `usage_not_included`, `cyber_policy`, `bio_policy`, `misalignment_policy_violation`, `invalid_prompt`, `server_is_overloaded`, `rate_limit_exceeded|slow_down`(delay는 RetryAfter 헤더 또는 메시지 정규식 `(?i)try again in\s*(\d+(?:\.\d+)?)\s*(s|ms|seconds?)`, 137–143행)로 매핑하고 나머지는 Retryable `[확인]`.
- **요청**: `ResponsesApiRequest`(`codex:codex-rs/core/src/client.rs` 956–1016)는 `store:false`, `stream:true`, `include:["reasoning.encrypted_content"]`, `prompt_cache_key`, `tool_choice:"auto"`를 보낸다. 비-OpenAI provider에는 `encrypted_function_args`와 내부 metadata를 제거(944–955) `[확인]`.
- **TTFT**: `stream_responses_api` 루프(2403, 2476–2479)가 첫 `ResponseEvent::OutputItemAdded`에서 `request_start.elapsed()`를 `ttft_ms`로 재고 `sse_event_completed(usage, ttft_ms)`(2448)에 넘긴다 `[확인]`. 첫 출력 item 기준이라 첫 token보다 늦을 수 있다.

### OpenCode (`907b3bc518fa`)

- **usage 산술**: `totalTokens`(`opencode:packages/llm/src/protocols/shared.ts`)는 input·output 둘 다 모르면 undefined를 반환해 **0을 만들지 않고**, `subtractTokens`는 0 아래로 내리지 않는다 `[확인]`. lophn `usage#R5`·`R6`과 같은 방향.
- **SSE**: `sseFraming`이 decodeText + Sse.decode로 자르고 Retry control 이벤트와 `[DONE]`을 버린다 `[확인]`.
- **Anthropic cache cap**: `ANTHROPIC_BREAKPOINT_CAP = 4`, `cacheControl()` 카운터가 넘는 breakpoint를 **조용히 버린다**(`anthropic-messages.ts` 234–251). ttl은 `Cache.ttlBucket`으로 5분/1시간 `[확인]`.
- **signature**: `providerMetadata.anthropic.signature`로 왕복(253–259, 449–455). `signature_delta`가 reasoning block을 닫는다(728–742) `[확인]`.
- **finish reason**: `mapFinishReason`(558–564)은 `end_turn|stop_sequence|pause_turn→stop`, `max_tokens→length`, `tool_use→tool-calls`, `refusal→content-filter`, 그 외 "unknown" `[확인]`.
- **usage 포함 관계**: `mapUsage`(573–588)는 Anthropic `input_tokens`를 non-cached로 보고 inclusive input = nonCached+cacheRead+cacheWrite로 합친다. reasoningTokens는 undefined로 둔다(thinking이 output에 포함) `[확인]`. `mergeUsage`(595–617)는 message_start와 message_delta를 오른쪽 우선으로 합친다.
- **thinking**: `lowerThinking`(493–503)은 `{type:"enabled", budget_tokens}`만 지원하고 budget이 없으면 오류 `[확인]`. adaptive effort는 별도 표(`transform.ts`, 아래).
- **Responses**: `store:false`면 `encrypted_content` 문자열이 없는 reasoning item을 걸러낸다(`openai-responses.ts` 446–453), `store !== false`면 `item_reference`로 보낸다(389–391). `lowerOptions`(456–476)가 store·prompt_cache_key·include·reasoning{effort,summary}·verbosity·service_tier를 전달. `mapUsage`(507–521): input inclusive, nonCached = input − cached, reasoning은 부분집합, total은 total_tokens. `mapFinishReason`(523–529)은 `incomplete_details.reason` 기준: null이면 function call 있으면 tool-calls 아니면 stop, `max_output_tokens→length`, `content_filter→content-filter` `[확인]`. `TERMINAL_TYPES` = completed/incomplete/failed(613), `response.failed`는 providerError(915).
- **Chat**: `mapFinishReason`(`openai-chat.ts` 378–384)은 stop/length/content_filter/function_call·tool_calls, 그 외 "unknown". `mapUsage`(391–405)는 `prompt_tokens`를 inclusive로, `cached_tokens`를 빼 nonCached를 만들고 `reasoning_tokens`를 부분집합으로 둔다. `stream_options:{include_usage:true}`(360). tool 인자는 `finish_reason`이 도착하는 순간 `ToolStream.finishAll`로 확정하고 JSON 파싱 실패를 스트림 경계에서 실패시킨다(443–448) `[확인]`.
- **overflow**: `isContextOverflow`(`provider-error.ts`)가 Pi보다 문구를 더한다("tokens in request more than max tokens allowed", "request entity too large", "context length is only N tokens", "input length.*exceeds.*context length")와 제외 패턴, 그리고 무조건 `/^4(00|13)\s*(status code)?\s*\(no body\)/i` `[확인]`.
- **오류**: `parseStreamError`(`opencode/packages/opencode/src/provider/error.ts`)가 `context_length_exceeded→context_overflow`, `insufficient_quota`(retry 아님), `usage_not_included`(retry 아님), `invalid_prompt`, `server_is_overloaded`/`server_error`(retry)로 매핑. `parseAPICallError`는 `isContextOverflow(message)` 또는 status 413 또는 code `context_length_exceeded`. 주석(30–31)이 "z.ai can overflow silently"를 인정한다. OpenAI 404는 retryable(`isOpenAiErrorRetryable`, 23–28) `[확인]`.
- **effort 표**(`transform.ts` 600–799): `openaiReasoningEfforts`는 gpt-5에 minimal, gpt-5.1은 minimal 대신 none, gpt-5.2+에 xhigh. `anthropicAdaptiveEfforts`는 opus/sonnet 4.6 low/medium/high/max, modern ≥4.7 low/medium/high/xhigh/max. `anthropicBindsThinking`(Claude 5.1+ except mythos)은 `ANTHROPIC_BLOCK_BINDING = {prefixMismatchBehavior:"drop_block"}`. `googleThinkingLevelEfforts`는 flash minimal/low/medium/high, pro low/medium/high, gemma·flash-image minimal/high. `googleThinkingBudgetMax`는 gemini 2.5 pro 32_768 그 외 24_576, gemini 2.5 high=16000 `[확인]`.
- **기본 reasoning**: `gpt5DefaultOptions`(`providers/openai-options.ts`)가 reasoningEffort "medium", reasoningSummary "auto", include ["reasoning.encrypted_content"], `openAIDefaultOptions`가 `store:false`를 합친다 `[확인]`.

### Hermes (`343500b3547e`)

- **오류 분류 파이프라인**: `classify_api_error`(`hermes-agent:agent/error_classifier.py` 965–998)가 단계를 거친다. status별(1217–1224): 400은 `_classify_400`(1134–1203, `invalid_encrypted_content` 1150–1162, reasoning-mandatory, 큰 세션 heuristic→overflow), 401 auth-rotate, 402 billing, 403 billing/upstream-blocked/auth, 404 billing-code 또는 model_not_found, 408 timeout, 413 payload_too_large, 422 image/tool, 429(1049–1078)는 billing code > overloaded > OpenRouter-upstream > quota wall > rate_limit(reset_at 포함), 500/502 server, 503/529 overloaded `[확인]`.
- **코드 verdict**: `_ERROR_CODE_VERDICTS`(639–647)가 `context_length_exceeded`·`max_tokens_exceeded→context_overflow`, `invalid_encrypted_content`, `resource_exhausted`·`throttled`·`rate_limit_exceeded→rate_limit`, billing code 묶음을 매핑 `[확인]`. provider별 코드(`_PROVIDER_CODE_VERDICTS` 656–660): openai `server_error`, gemini `unavailable`/`deadline_exceeded`/`internal`, anthropic `api_error`/`rate_limit_error`.
- **overflow 문구**: `_CONTEXT_OVERFLOW_PATTERNS`(253–266)가 "context length", "max_tokens", "exceeds the max_model_len", "tokens in request more than max tokens allowed", "maximum allowed input length", 중국어 문구까지 포함한다. `_MEMORY_CEILING_PATTERNS`(238–242)는 byte 단위 메모리 한도를 overflow와 **분리**해 overloaded로 보낸다("memory limit exceeded"가 "limit exceeded"에 걸려 billing으로 오인되는 것을 막음) `[확인]`.
- **reset 파싱**: `parse_retry_after_seconds`(`retry_utils.py` 30–64)가 Retry-After 숫자·HTTP-date를 초로, `reset_delay_from_message`(110–118)가 `quotaResetDelay`, "retry after N s", `resets_in_seconds`, "resets in 4hr 5min"을 순서대로 읽는다. 명시 "retry after"가 "resets in"보다 우선(93–101, 짧은 throttle이 긴 quota window 안에 있는 경우) `[확인]`.
- **thinking 예산**: `THINKING_BUDGET`(`anthropic_adapter.py` 73) xhigh 32000/high 16000/medium 8000/low 4000. `ADAPTIVE_EFFORT_MAP`(77–80) ultra·max→max, xhigh, high, medium, low, minimal→low. `_thinking_kwargs`(583–607)는 adaptive면 `{type:"adaptive", display:"summarized"}`+`output_config.effort`, 아니면 `{type:"enabled", budget_tokens}` + `temperature:1` + `max_tokens = max(effective, budget+4096)`. disable은 `_accepts_thinking_disable`일 때만 `{type:"disabled"}`, 아니면 필드를 생략(mandatory 모델이 400을 내기 때문) `[확인]`.
- **모델 분류**: 모르는 Claude는 adaptive로 기본, `_LEGACY_MANUAL_THINKING_CLAUDE_SUBSTRINGS`(91–96)만 manual. `_NO_XHIGH_CLAUDE_SUBSTRINGS`(99, opus/sonnet 4.6)는 xhigh를 max로 낮춘다. `_MANDATORY_THINKING_CLAUDE_SUBSTRINGS`(103, "claude-fable")는 disable을 거절. `_ANTHROPIC_OUTPUT_LIMITS`(120–129)는 모델별 출력 상한, 모르면 128_000 `[확인]`.
- **thinking replay**: `_replay_thinking`/`_replay_redacted_thinking`(`anthropic_message_convert.py` 293–299)이 signature·data를 그대로 다시 보낸다. `_manage_thinking_signatures`(573–607)는 route별: kimi는 그대로, deepseek은 서명된 것만 제거, third_party 또는 (마지막 턴 아니고 preserve_prior 아님)은 thinking 전부 제거, 그 외는 서명 유효한 것만 유지하고 무효·미서명은 plain text로 낮춘다. thinking block의 cache_control은 서명 검증을 깨므로 제거(602–605) `[확인]`.
- **tool 정합**: `_strip_orphaned_tool_blocks`(487–524)가 tool_use와 tool_result를 **인접 user message** 기준으로 맞추고(전역 id 매칭으로는 부족), 짝이 깨져 thinking 서명이 죽은 턴은 `_thinking_signature_invalidated`로 표시해 낮춘다. `_merge_consecutive_roles`(536–552)는 같은 role 연속을 합치되 문자열을 join하지 않는다(prompt cache prefix 보존, 526–533) `[확인]`.
- **Responses replay**: `_replay_reasoning_items`(`codex_responses_adapter.py` 407–445)는 `encrypted_content` 없는 item, 중복 id, 다른 issuer·model이 찍은 item을 버린다(모델 전환 시 400 방지). `_replay_message_items`(448–478)는 reasoning item과 묶인 `msg_*` id를 제거한다(id만 replay하면 "provided without its required reasoning item" 400). `_WireCallIds`(481–508)는 세션 내 반복 call_id에 `_dup<n>`을 붙여 "Duplicate function_call_output" 400을 피한다 `[확인]`.
- **Chat 스트림**: `_call_chat_completions`(`chat_completion_helpers.py` 3149–3319)가 delta를 모은다. reasoning은 `reasoning_content`→`reasoning`→`model_extra` 순(3244–3248), `reasoning_details`는 별도 누적(3258–3264). `finish_reason`·usage를 content 판정보다 먼저 읽는다(3237–3242, vLLM이 finish chunk를 삼키는 경우). choices 없는 chunk는 usage 전용(`_choiceless_chunk` 3048–3071), Nous Portal의 `lastOne=true`는 finish_reason "stop"으로 간주 `[확인]`.
- **reasoning 보존**: `build_assistant_message`(1666–1761)가 `reasoning_content`를 저장하고, DeepSeek v4/Kimi thinking 모드는 tool-call message에 없으면 공백 하나로 padding(1685–1693, 빈 문자열은 거절). `reasoning_details`·`anthropic_content_blocks`·`codex_reasoning_items`를 그대로 보존 `[확인]`. 전부 transcript에 남긴다.
- **cache key**: `_add_prompt_cache_key`(`transports/chat_completions.py` 72–111)가 정적 prefix(instructions+tools)의 content hash로 `prompt_cache_key`를 만들고 64자로 제한. `cache_scope_id`(compression lineage root)가 `session_id`보다 우선. xAI는 extra_body, GitHub/Copilot은 제외 `[확인]`.
- **router shim**: `is_router_timeout_shim`(131–150)이 HTTP 200에 "Connect timeout, please try again later."만 있고 tool call도 양수 completion token도 없으면 실패로 본다 `[확인]`.

## 비교

### stop reason → lophn 판정

| wire | Pi | OpenCode | Codex | lophn |
|---|---|---|---|---|
| Anthropic `end_turn`/`stop_sequence`/`pause_turn` | stop | stop | — | complete |
| Anthropic `max_tokens` | length | length | — | partial (tool 미실행) |
| Anthropic `tool_use` | toolUse | tool-calls | — | complete (인자 완성 후) |
| Anthropic `refusal`/`sensitive` | error | content-filter | — | refused |
| Responses `completed` | stop | stop/tool-calls | Completed | complete |
| Responses `incomplete`+`max_output_tokens` | length | length | **Stream 오류** | partial |
| Responses `incomplete`+`content_filter` | error | content-filter | ContentFilter | refused |
| Responses `incomplete`+`interrupted` | error | unknown | end_turn(false) | partial (disconnect) |
| Responses `failed` | error | providerError | 코드별 | 코드별 |
| Chat `stop` | stop | stop | — | complete |
| Chat `length` | length | length | — | partial |
| Chat `tool_calls` | toolUse | tool-calls | — | complete |
| Chat `content_filter` | error | content-filter | — | refused |
| Chat finish_reason 없음 | throw | "unknown" | — | partial (disconnect) |

Codex만 `incomplete`의 `max_output_tokens`를 오류로 올린다(`[확인]` `responses.rs` 418–435). lophn은 partial이다.

### usage 포함 관계

| | input에 cache 포함 | output에 reasoning 포함 | 미보고 |
|---|---|---|---|
| Anthropic | 제외 (별도 `cache_read_input_tokens`, `cache_creation_input_tokens`) | 포함 (`thinking_tokens`는 부분집합) | — |
| Responses | 포함 (`input_tokens`에서 `cached_tokens`·`cache_write_tokens`를 빼야 새 입력) | 포함 | — |
| Chat | 포함 (`prompt_tokens`에서 `prompt_tokens_details.cached_tokens`) | 포함 (`completion_tokens_details.reasoning_tokens`) | — |

Pi·OpenCode 모두 이 방향으로 정규화한다(`[확인]`). cached 필드는 provider마다 이름이 달라 Pi Chat은 `cached_tokens ?? prompt_cache_hit_tokens ?? cached_tokens` 세 곳을 본다(`openai-completions.ts` 1511–1552).

### reasoning-effort / budget

| | 낮음 | 중간 | 높음 | 최대 | 비고 |
|---|---|---|---|---|---|
| lophn (`model#R17`) | 2048 | 8192 | 16384 | 32768 | 확인된 min/max 안으로 clamp, 토글은 끔·높음만 |
| Pi | 2048 | 8192 | 16384 | — | xhigh/max를 high로 clamp, minimal 1024, `MIN_ANSWER_TOKENS` 1024 |
| Hermes | 4000 | 8000 | 16000 | 32000(xhigh) | adaptive는 effort 이름, manual만 budget. 4.6은 xhigh→max |

lophn 예산은 Pi와 중간·높음이 같고 최대만 32,768로 더 크다. Hermes manual budget은 전반적으로 작다 `[확인]`.

### 오류 분류 → ProviderFailure

| 신호 | Pi | Codex | OpenCode | Hermes | lophn |
|---|---|---|---|---|---|
| 500/502/503/529 | retryable | overloaded/retryable | retryable | server/overloaded | `temporary` |
| 429 + retry ≤30s | retryable(delay 그대로) | RateLimitExceeded | retryable | rate_limit(reset 전달) | `temporary` |
| 429 + retry >30s 또는 미상 | retryable | RateLimitExceeded | retryable | rate_limit | `credential_unavailable` (usage_wait) |
| `insufficient_quota` 등 | — | QuotaExceeded | non-retryable | billing | `credential_unavailable` |
| 401/403 인증 | — | — | — | auth | `credential_unavailable`(revoked와 구분) |
| `context_length_exceeded` | overflow 정규식 | ContextWindowExceeded | context_overflow | context_overflow | `context_exceeded` |
| overflow 문구 매칭 | 정규식 | — | 정규식 | 정규식 | `context_exceeded` (문구 없으면 `unknown`) |
| `model_not_found`/404 | — | — | retryable(OpenAI) | model_not_found | `model_unavailable` |
| `invalid_request`/400 검증 | — | InvalidPrompt | — | format_error | `invalid_request` |
| `content_filter`/`refusal` | error | ContentFilter/CyberPolicy/BioPolicy | content-filter | content_policy_blocked | `refused` |
| 분류 불가 | — | Retryable/Stream | — | unknown | `unknown` (인증 실패로 추정 금지) |

30초 경계로 429를 둘로 나누는 프로젝트는 없다 `[확인]`. 모두 서버가 준 delay를 그대로 쓴다.

## lophn에 가져올 것과 버릴 것

**`provider#R3` (세 protocol만, 명시 선택).** 가져올 것: Pi의 protocol별 모듈 분리(`anthropic-messages.ts`, `openai-responses-shared.ts`, `openai-completions.ts`)와 호환 서버 quirk를 한 구조로 모은 `detectCompat`(`openai-completions.ts` 1585–1726). 버릴 것: model 이름에서 protocol을 추론하는 모든 분기. Hermes는 `_supports_adaptive_thinking`처럼 모델 이름 substring으로 동작이 갈리는데(`anthropic_adapter.py` 169–175), lophn은 이를 protocol이 아니라 model catalog의 추론 방식으로 한정해야 한다.

**`provider#R15` (위장 금지).** 버릴 것: Pi의 OAuth 경로(`anthropic-messages.ts` 978–1034)가 `sk-ant-oat`를 감지해 user-agent `claude-cli/...`와 `claude-code` beta, tool 이름 치환으로 Claude Code를 가장하는 것. lophn은 lophn 제품 이름으로 식별하고 거절 뒤 위장 재호출을 하지 않는다. **open-issues 후보는 아님** — 요구가 명확하고 구현에서 빼면 된다.

**`provider#R19`·`R20` (오류 분류, SDK retry 0).** 가져올 것: 코드 우선·문구 후순위의 단계 분류. Codex `parse_failed_response`(`responses_error.rs` 47–102)와 Hermes `_ERROR_CODE_VERDICTS`(639–647)처럼 구조화 코드를 먼저 보고, 문구 정규식은 코드가 없을 때만. 가져올 것: Pi의 `maxRetries: 0` + 자체 retry 분리(647행, `provider-retry.ts`). 가져올 것: Retry-After 파싱 순서 — Pi는 `retry-after-ms` 다음 `retry-after` 숫자·HTTP-date, Hermes `reset_delay_from_message`는 "retry after N"이 "resets in"보다 우선(`retry_utils.py` 93–101). **open-issues 후보**: 어느 프로젝트도 429를 30초 경계로 `temporary`/`credential_unavailable`로 나누지 않는다. 서버가 reset 시각을 자주 빼는데(Hermes가 resets_in_seconds·resets_at·reset_at·retry_after 네 필드를 다 뒤지는 이유), 미상이면 `provider#R24`대로 1시간 usage_wait가 된다. 요구대로 구현하되 시각 미상 비율이 높다는 점을 남긴다.

**`provider#R23` (문맥 초과는 별도).** 가져올 것: overflow를 오류 본문 정규식으로 잡는 방식 자체는 네 프로젝트 모두 같고, 문구 목록은 Pi `OVERFLOW_PATTERNS`(`overflow.ts` 37–63)가 가장 주석이 충실하다. **open-issues 후보**: 감지가 본질적으로 불완전하다. Pi는 z.ai silent overflow, Xiaomi MiMo(length + output 0), Ollama silent truncation을 `isContextOverflow`의 별도 경로로 처리하고(`overflow.ts`), OpenCode도 "z.ai can overflow silently"를 주석으로 인정한다(`provider/error.ts` 30–31). 이런 provider는 `context_exceeded`로 확정할 수 없어 `provider#R19`대로 `unknown`으로 떨어져야 한다. 요구가 "문맥 초과를 구별"하라고 하므로, 구별 불가 케이스를 `unknown`으로 보내는 규칙을 구현 메모에 명시한다.

**`provider#R25` (opaque reasoning은 run 메모리만).** 가져올 것: 무엇을 다시 보내야 하는가의 규격. Anthropic은 `thinking.signature`와 `redacted_thinking.data`를 원문 그대로(Pi 1404–1438, Hermes `_replay_thinking` 293–299), Responses는 `store:false`일 때 `encrypted_content`(Pi `include:["reasoning.encrypted_content"]`, Codex `client.rs` 956–1016), Chat는 DeepSeek `reasoning_content`(assistant message마다 필수, Pi 1378–1384·Hermes 1685–1693)와 OpenRouter `reasoning_details`. **버릴 것: 저장 위치.** 네 프로젝트 모두 이것을 transcript에 영속한다(Hermes `build_assistant_message` 1726–1734가 `anthropic_content_blocks`·`codex_reasoning_items`를 메시지에 붙임). lophn은 같은 run·provider·model 메모리에만 두고 run 종료 시 버린다. **open-issues 후보**: 이 선택은 재시작·compaction 후 reasoning 상태가 없으면 그 세션을 이어가지 못한다. 아키텍처가 이미 "유실 후 state-free input으로 계속 가능한지 검증하지 못하면 configuration_unavailable로 끝낸다"고 정했으므로 요구와 일치하지만, 조사한 모든 구현이 반대를 택한 가장 큰 분기라 기록한다. 추가로 Hermes는 모델·issuer가 바뀌면 `encrypted_content`를 버려야 400을 피한다(`_replay_reasoning_items` 424–441) — lophn도 run 안이라도 provider·model이 바뀌면 그 상태를 버려야 한다(요구가 "같은 provider·같은 model"로 한정).

**`provider#R26` (Anthropic 5분만).** 가져올 것: cache 표시 위치는 Pi가 system·마지막 user/system block·마지막 tool(1483–1509). 버릴 것: Pi·OpenCode의 1시간 ttl 옵션(`getCacheControl`의 "1h", OpenCode `Cache.ttlBucket`)과 `prompt_cache_retention:"24h"`. lophn은 5분(300000ms)만, 경계 최대 3개. **open-issues 후보**: Anthropic은 breakpoint 4개 상한이 있고 OpenCode는 초과분을 조용히 버린다(`ANTHROPIC_BREAKPOINT_CAP = 4`, 234–251). lophn은 3개라 상한 안이지만, "cache 미지원은 실패로 취급하지 않는다"와 맞춰 초과·미지원 모두 표시를 빼는 쪽으로 구현해야 한다(오류로 올리지 말 것).

**`model#R14`–`R18` (추론 수준).** 가져올 것: OpenCode `transform.ts`의 모델별 effort 허용 표(600–799)와 Hermes의 "모르는 모델은 최신 계약으로 기본"(`_supports_adaptive_thinking` 169–175). lophn은 catalog가 확인한 수준만 보내고(`model#R16`), 확인된 기본이 없으면 추론 인자를 아예 보내지 않는다. 버릴 것: Hermes가 minimal을 low로, xhigh를 max로 임의 치환하는 것(`ADAPTIVE_EFFORT_MAP`, `_supports_xhigh_effort` 178–181) — lophn은 확인 안 된 수준을 다른 수준으로 바꾸지 않고 제외한다. budget 숫자는 Pi가 lophn과 가장 가깝다(low 2048/medium 8192/high 16384).

**`usage#R5`·`R6` (포함 관계, 모름).** 가져올 것: OpenCode `totalTokens`/`subtractTokens`(`protocols/shared.ts`)가 모르는 값을 0으로 만들지 않고 음수로 내리지도 않는 것. Pi의 usage 정규화(Anthropic은 cache를 더하고, OpenAI는 cache를 뺀다). 버릴 것: 필드가 없을 때 0으로 기록하는 경로. Hermes `_UsageNormalizingStream`(`anthropic_adapter.py` 723–742)은 usage가 null이면 `Usage(input_tokens=0, output_tokens=0)`으로 채우는데, 이건 lophn에서 `unknown`이어야 한다.

**`usage#R3` (TTFT).** 가져올 것: Codex가 첫 `OutputItemAdded`에서 측정(2476–2479). lophn은 "측정된 첫 출력 token 지연"이므로 첫 텍스트·tool delta 시각으로 재고, 못 재면 모름. 첫 item은 token보다 늦다 `[추측]`.

## 구현 메모

### 요청 번역 (protocol별)

```
anthropic-messages   POST <base>/messages
  system, messages[{role, content:[block]}], tools, max_tokens
  tool_use.id ↔ tool_result.tool_use_id     (id: [A-Za-z0-9_-]{1,64})
  cache_control: {type:"ephemeral"} 경계 block 최대 3개, ttl 5분 고정

openai-responses     POST <base>/responses
  instructions, input:[item], tools, stream:true, store:false
  include:["reasoning.encrypted_content"]   (opaque 재전송이 필요할 때만)
  function_call.call_id ↔ function_call_output.call_id   (item id는 fc_/ctc_)

openai-chat-completions  POST <base>/chat/completions
  messages, tools, stream:true, stream_options:{include_usage:true}
  tool_calls[].id ↔ tool message tool_call_id    (OpenAI 기준 ≤40자)
```

tool 결과 여러 개는 Anthropic에서 user message 하나의 content 배열로 합친다(Pi 1462–1478, Hermes `_convert_tool_message_to_result` 459–472). 짝 없는 tool_use·tool_result는 제거하되, 제거로 thinking 서명이 깨진 턴은 그 서명을 재전송하지 않는다(Hermes 487–524).

### SSE 파서 상태

프레임은 `\n`·`\r\n`로 자르고 `TextDecoder({stream:true})`로 UTF-8 경계를 넘긴다(Pi 379–569). 이벤트 타입별:

| protocol | delta | 인자 완성 신호 | 종료 |
|---|---|---|---|
| Anthropic | `content_block_delta` | `content_block_stop` | `message_delta`(stop_reason) + `message_stop` |
| Responses | `*.delta` | `response.output_item.done` (arguments.done은 누적만, Codex는 delta를 무시 483–491) | `response.completed` / `incomplete` / `failed` |
| Chat | `delta.tool_calls` (index로 누적) | `finish_reason` chunk | `finish_reason` + `[DONE]` |

완성 신호 전에 끝난 tool call은 실행하지 않는다(Pi Responses 766–775, OpenCode Chat 443–448). `parseStreamingJson`처럼 부분 JSON을 성공으로 반환하는 방식(Pi `json-parse.ts` 104–124)은 쓰지 않는다 — 완성 판정과 파싱을 분리한다.

### 종료 판정

| 조건 | 결과 | tool |
|---|---|---|
| stop/end_turn/stop_sequence/pause_turn/completed, 인자 완성 | complete | 실행 |
| tool_use/tool_calls, 모든 인자 완성 | complete | 실행 |
| max_tokens/length/max_output_tokens | partial | 미실행 |
| incomplete(interrupted)/finish_reason 없음/스트림 단절/idle timeout | partial (disconnect) | 미실행 |
| refusal/sensitive/content_filter/cyber_policy/bio_policy | refused | 미실행 |
| failed + 코드 | 코드별 ProviderFailure | 미실행 |

### 오류 분류 순서

1. 사람 취소 → `cancelled`.
2. 구조화 코드: `context_length_exceeded`→`context_exceeded`; `insufficient_quota`·`credit_balance_exhausted`·`organization_spend_limit_exceeded`·`project_spend_limit_exceeded`→`credential_unavailable`; `model_not_found`·`model_not_available`→`model_unavailable`; `invalid_prompt`·`invalid_request_error`(검증)→`invalid_request`; `content_filter`·`cyber_policy`·`bio_policy`·`refusal`→`refused`; `server_is_overloaded`·`rate_limit_exceeded`·`slow_down`은 아래로.
3. HTTP status: 500/502/503/529·연결 실패·스트림 단절 → `temporary`. 429는 retry 시각이 30_000ms 이내면 `temporary`(시각 전달), 초과·미상이면 `credential_unavailable`(미상은 `until = now+1h`, `provider#R24`). 401·403 인증 → `credential_unavailable`. 413 → `context_exceeded`로 단정하지 않고 본문에 한계 문구가 있을 때만, 없으면 `unknown`.
4. 본문 정규식: overflow 문구(Pi `OVERFLOW_PATTERNS` 기준) → `context_exceeded`. 메모리·byte 한도 문구는 overflow가 아님(Hermes `_MEMORY_CEILING_PATTERNS` 238–242) → `temporary`.
5. 남은 것 → `unknown`. 인증 실패로 올리지 않는다(`provider#R19`).
6. z.ai·Ollama처럼 overflow를 알리지 않는 provider(`[확인]` Pi `overflow.ts`, OpenCode `error.ts` 30–31)는 `unknown`.

SDK retry는 0. retry 횟수·간격은 run-loop가 정한다(`provider#R20`).

### usage 정규화

| 필드 | Anthropic | OpenAI (Responses·Chat) |
|---|---|---|
| 새 입력 | `input_tokens` | `input_tokens − cached − cache_write` (하한 0) |
| cache 읽기 | `cache_read_input_tokens` | `cached_tokens` (Chat는 `prompt_tokens_details.cached_tokens` 우선) |
| cache 쓰기 | `cache_creation_input_tokens` | `cache_write_tokens` (없으면 모름) |
| 출력 | `output_tokens` | `output_tokens`/`completion_tokens` |
| 추론 | 출력의 부분집합(합계에 재가산 안 함) | 동일 (`reasoning_tokens`) |

필드가 없으면 0이 아니라 모름(`usage#R6`). 실패·취소 응답에 usage가 있으면 보존. 포함 관계를 비교할 수 없으면 분리해서 기록(`usage#R5`).

### reasoning 상태 (run 메모리)

key는 `(run, provider, model)`. 값은 protocol별 opaque: Anthropic `signature`·`redacted_thinking.data`, Responses `encrypted_content` item, Chat `reasoning_content`·`reasoning_details`. run 종료·provider 변경·model 변경 시 폐기. 상태가 필요한데 없으면(재시작·compaction) `configuration_unavailable`로 끝내고 state-free 재시도를 하지 않는다(`docs/architecture/lophn-agent.md` §5.2). 사람이 읽을 reasoning 본문은 파싱 단계에서 버린다.

### cache

Anthropic만 `cache_control:{type:"ephemeral"}`, ttl 5분, prompt-assemble이 준 경계 최대 3개. 4개 상한(OpenCode 234–251) 안이므로 초과 처리 불필요. Responses·Chat는 `prompt_cache_key`를 보내지 않고 자동 cache에 맡긴다(`[추측]` 자동 cache가 key 없이도 동작하는지는 provider 문서 확인 필요, 코드로는 Pi가 key를 조건부로만 보냄 797–1002). cache 미지원 응답은 성공으로 처리(`provider#R26`).

### timeout·abort·TTFT

idle timeout은 Codex 기본 300_000ms(`model-provider-info/src/lib.rs` 66, 512–517)가 확인된 값. lophn 값 `[미확인]` — 요구에 숫자가 없다. abort는 Pi `raceWithAbortSignal`(`abort.ts` 9–17)처럼 요청 signal과 race. TTFT는 첫 텍스트 또는 tool delta 시각 − 전송 시각(Codex는 첫 `OutputItemAdded`, 2476–2479), 측정 못 하면 모름(`usage#R3`). 연결 테스트는 별도 상한 30초(`provider#R30`).

### fake provider 시나리오 (`tools/fake-provider/`, `fixtures/model/`)

Pi는 SSE fixture를 테스트 코드 안 인라인 문자열로 만든다(`pi:packages/ai/test/anthropic-sse-parsing.test.ts` `createSseResponse`, 9–46행). 파일 fixture 디렉터리는 확인하지 못했다 `[미확인]`. lophn은 아래를 시나리오로 고정할 것:

1. Anthropic 정상: `message_start`→`content_block_delta`→`content_block_stop`→`message_delta(end_turn)`→`message_stop`, usage 양쪽.
2. 분할 프레임: 이벤트 하나가 TCP chunk 둘로, UTF-8 멀티바이트가 경계에서 잘림.
3. tool 인자 분할: `input_json_delta` 여러 개 후 `content_block_stop`에서만 실행. stop 없이 종료하면 미실행.
4. Responses: `function_call_arguments.delta`는 누적만, `output_item.done`에서 확정. `incomplete`+`max_output_tokens`는 partial.
5. Chat: `delta.tool_calls`를 index로 누적, `finish_reason:tool_calls`에서 확정. `finish_reason` 없는 종료는 partial. `[DONE]` 전 usage chunk(choices 빈 배열).
6. 429 둘: `retry-after: 10` → temporary, `retry-after: 120` → credential_unavailable, 헤더 없음 → 1시간.
7. overflow: `context_length_exceeded` 코드, 문구만 있는 400, 코드도 문구도 없는 400(→ unknown).
8. usage 포함: Anthropic(input 제외 cache)과 OpenAI(input 포함 cache) 각 1개, 필드 누락(→ 모름, 0 아님).
9. reasoning: signature 있는 thinking 재전송, signature 없는 thinking은 plain text로 낮춤, `redacted_thinking.data` 원문 재전송, `encrypted_content` 없는 reasoning item은 `store:false`에서 제외.
10. 위장 금지 검증: OAuth 호출의 user-agent·beta·tool 이름이 API key 호출과 같은지.
