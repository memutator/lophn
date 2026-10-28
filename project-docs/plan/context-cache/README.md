# context-cache

- 목표: provider prompt cache가 실제로 hit하게 요청 모양을 고치고, OpenAI Responses에서도 tool 정의를 늦게 싣는다. 입력 예산 세기와 자동 줄이기·Compact는 `feat/auto-compact`에서 끝냈다.
- 재료:
  - `research_notes/omp-cache-compaction-tool-loading/README.md`, `prompt-cache.md`, `compaction.md`, `tool-loading.md` (OMP 분석 명세. lophn 대조는 같은 폴더 `analysis-evidence.md`의 "lophn 적용 범위")
  - `project-docs/architecture/agent-definition.md` (prompt 층, cache 표시, deferral, compact, 입력 예산, output 상한)
  - `project-docs/architecture/agent-call.md` (받은 입력은 뒤 turn에서도 같은 bytes)
  - `research_notes/omp-subscription-oauth/claude-code.md`, `google-antigravity.md` (구독 wire)
- 범위 밖: 아래 "범위 밖" 절.
- 단위: `cache`, `budget`, `context`, `defer`. 소유는 아래 task 표가 정한다.
- 순서: 아래 "순서" 절.

## 지금 코드 (2026-10-29, main `0dbf3658f`. 구독 OAuth가 land한 뒤)

| 무엇 | 지금 | 근거 |
| --- | --- | --- |
| Anthropic cache 표시 | system 층 셋(`place_kind`, `instructions`, `place`)과 대화 끝 하나. ttl 없음(5분) | `packages/core/lophn-agent/prompt-assembly/turn-prompt.ts`의 `CACHED`, `packages/core/lophn-agent/providers/adapters/messages.ts`의 `markConversationEnd` |
| 대화 끝 표시 위치 | 마지막 message의 마지막 block. turn마다 붙는 notice가 대화 맨 끝(마지막 user message)에 들어가므로 표시가 notice 글 위에 놓인다. notice는 저장하지 않아 다음 call에서 자리가 바뀐다 | `packages/core/lophn-agent/run-loop/turn.ts`의 `historyOf`(끝의 `context.notices`), `packages/core/lophn-agent/prompt-assembly/turn-prompt.ts`의 `appendNotices` |
| 오래 붙는 notice | 고정한 tool 목록과 지금 목록이 다르면 `tools_changed` notice가 그 session의 **모든 turn, 모든 call**에 붙는다 | `packages/core/lophn-agent/run-loop/prepare.ts`(`keyOf(m.current) === fixed.key` 비교) |
| steering | 보낸 call 뒤에 같은 자리로 이력에 들어간다. cache를 깨지 않는다 | `packages/core/lophn-agent/run-loop/turn.ts`("보낸 steering은 이 call에 반영됐다") |
| Claude 구독 profile | identity block 표시는 4개 안에 자리가 있을 때만, 값은 `{type:"ephemeral"}` 고정 | `packages/core/lophn-agent/providers/adapters/claude-code.ts`의 `countCacheMarks`, `CACHE_MARKS_MAX` |
| OpenAI Responses·Chat | cache 칸 없음. `store:false` | `packages/core/lophn-agent/models/binding.ts`의 주석("OpenAI 계열은 cache를 자동으로") |
| usage cache write | Responses·Chat 모두 top-level `cache_write_tokens`를 읽는다. OpenAI·OpenRouter는 `input_tokens_details` / `prompt_tokens_details` 안에 둔다. 그래서 늘 null이고, write token이 새 input으로 계산된다 | `packages/core/lophn-agent/providers/adapters/responses.ts`의 `responsesUsage`, `packages/core/lophn-agent/providers/adapters/chat-completions.ts` |
| Antigravity | envelope `sessionId`가 session마다 고정, usage cache read를 prompt로 자른다. cache_control은 wire에 없다 | `packages/core/lophn-agent/providers/adapters/cloud-code.ts`의 `cloudCodeUsage` |
| 입력 예산 | wire JSON의 UTF-8 **byte 수를 token 수로** 센다(보수 상한). 영어·code는 byte가 token의 3~4배라, 200k 창 model이 실제 약 5만 token 안팎에서 막힌다 | `packages/core/lophn-agent/prompt-assembly/budget.ts`의 `measureWire` |
| 예산을 넘으면 | 보내지 않고 turn이 `context_limit`으로 끝난다. provider overflow 오류도 `context_limit` | `packages/core/lophn-agent/run-loop/turn.ts`, `packages/core/lophn-agent/providers/failures.ts`의 `OVERFLOW_PATTERNS` |
| compact | 사람이 부를 때만. 최근 사람 message 3개를 남기고, 요약 상한은 `min(예산/10, 4000)` byte(약 1k token) | `packages/core/lophn-agent/session/compactor.ts`의 `KEEP_RECENT`, `packages/core/lophn-agent/prompt-assembly/compaction.ts`의 `summaryOutputCap` |
| turn 사이 이력 | user·assistant 글과 `tool.load` 재생뿐이다. turn 안의 tool loop는 다음 turn에 실리지 않는다. 그래서 context가 넘치는 곳은 거의 **turn 안**(앱 짓기 turn은 call 약 100번, tool 결과 하나 약 24 KiB)이다 | `packages/core/lophn-agent/session/history.ts`의 `readSessionConversation` |
| tool deferral | built-in `anthropic`의 Claude 4.5 이상만. `defer_loading` + `tool.load` → `tool_reference` | `packages/core/lophn-agent/providers/definitions.ts`의 `supportsDeferredTools`, `packages/core/lophn-agent/tools/bundles/tool.ts` |
| MCP tool 이름 | `mcp__<server>__<tool>`, 64자 상한 이미 있음 | `packages/core/lophn-agent/extensions/mcp-tools.ts` |

## credential별 결론

같은 vendor라도 credential에 따라 다른 것만 적었다. 빈 칸은 같은 vendor의 API key 줄과 같다.

| provider·credential | wire | 이 계획에서 바뀌는 것 |
| --- | --- | --- |
| `anthropic` API key | Messages | 대화 끝 표시를 notice 앞으로(`cache-tail`). TTL 5분 그대로 |
| `anthropic` Claude 구독 OAuth | Messages + Claude Code profile | 위에 더해 모든 표시 1시간, identity 표시도 같은 값(`cache-ttl`). extended-ttl beta는 보내지 않는다 |
| `openai` API key, ChatGPT 로그인 | 둘 다 `api.openai.com/v1/responses` | `prompt_cache_key`, `session_id`·`x-client-request-id` header, usage write 칸(`cache-openai`). 둘이 같은 길이다. gpt-5.4 이상은 tool 지연(`defer-responses`) |
| `xai` API key, SuperGrok | Chat Completions | `x-grok-conv-id` header(`cache-openai`) |
| `openrouter` | Chat Completions | `anthropic/` model에 `cache_control`(`cache-openai`). 지금은 cache가 전혀 안 된다 |
| `groq`, `deepseek`, `google-gemini` | Chat Completions | 없음(자동 cache, usage는 이미 읽는다) |
| `google-antigravity` (Gemini, Claude) | Cloud Code Assist | 없음. sessionId 고정과 usage 자르기는 이미 있다. 이 wire의 Claude는 5분 server cache뿐이고 1시간을 고를 수 없다 |
| custom `anthropic-messages` | Messages | `cache-tail`만. proxy가 `cache_control`을 거절하는 경우는 범위 밖 |

## 정한 것

- **대화 끝 표시는 저장되는 마지막 block에 둔다.** 매 call 자리가 바뀌는 notice 글에는 두지 않는다. 표시 개수(system 셋 + 대화 하나)는 그대로다. OMP가 같은 이유로 per-call message를 breakpoint에서 뺀다. notice를 저장해 자리를 고정하는 길은 버렸다: architecture가 "notice는 그 turn 요청에만 붙고 이력에 저장하지 않는다"로 정했고, 표시만 옮겨도 손해가 notice 글 bytes로 줄어든다. (agent)
- **표시를 다는 곳은 Anthropic packer 하나다.** 지금 `messages.ts`는 wire 배열만 보고 끝 block에 달아 어느 조각이 notice인지 모른다. 조각의 출처를 아는 `models/binding.ts`의 Anthropic packer가 대화 끝 표시를 단다. `messages.ts`의 `markConversationEnd`는 지운다. (agent)
- **Claude 구독 OAuth는 1시간 TTL이다.** OMP source 주석은 Claude Code가 구독자에게 1시간을 쓴다고 적고 그것을 따른다(직접 확인은 못 했다). 사람의 답이 5분보다 늦고 tool 하나가 몇 분씩 도는 lophn turn에 맞는다. 구독은 token당 과금이 아니라 추정 비용 계산(`packages/core/lophn-agent/usage/cost.ts`)은 5분 요율 그대로 둔다. API key는 5분 그대로 두고 사람 설정을 만들지 않는다(쓰는 곳이 생기면 만든다). land 전에 live 확인 L2가 필요하다. (agent)
- **identity block 표시는 다른 표시와 같은 값을 쓴다.** 한 요청에 1시간과 5분을 섞으면 1시간이 앞에 와야 하는데, identity는 system 앞쪽이라 5분 고정으로 두면 지침 층이 빈 session에서 400이 난다. profile은 packer가 이미 단 표시의 값을 복사한다. TTL을 profile에 따로 넘기지 않는다. (agent)
- **OpenAI cache key는 session에서 만든 고정 id다.** session id를 그대로 보내지 않고 같은 입력이면 같은 값인 hash(`packages/core/lophn-agent/providers/adapters/stable-id.ts`)로 만든다. 64자 안이다. header 둘도 같은 값이다. compact 요약 call도 session이 있으므로 같은 key를 쓴다. (agent)
- **OpenRouter의 Anthropic model에는 표시 둘을 단다**: system 글 하나, 저장되는 마지막 비지 않은 text 조각 하나. 빈 text에 달면 거절된다. (agent)
- **입력 예산은 "같은 turn 앞 call의 실제 prompt token + 그 뒤 늘어난 byte"로 센다.** 앞 call은 provider가 보고한 `input + cache_read + cache_write`다(같은 binding이고 값이 모두 있을 때). turn의 첫 call처럼 앞 call이 없으면 `ceil(byte / 3)`로 센다. 이미지는 지금처럼 하나에 4096이다. 늘어난 부분만 byte로 세므로 여전히 보수적이다. 낮게 센 경우는 provider overflow 오류가 되고 지금처럼 `context_limit`으로 끝난다. byte/3을 고른 이유: 영어·code는 약 3.5~4, 한국어는 약 3~4.5 byte가 token 하나다. 입력 예산 계산은 이미 두 번 고쳤다(0.2.0 base64, 0.3.0 기본 한계). 위험 test를 둔다. (agent)
- **compact 요약 상한과 chunk도 같은 세기로 센다.** `summaryOutputCap`은 token 추정 기준 `min(예산/10, 4000)`이다. 지금의 약 1k token 요약은 긴 session에 짧다. (agent)
- **turn 사이 이력은 줄이지 않는다(prune·shake 없음).** 글뿐이라 작다. 넘치는 곳은 turn 안이다. (agent)
- **OpenAI tool 지연은 client 실행 `tool_search`로 한다.** OpenAI 문서가 앱이 정하는 검색에 권하는 길이고, 불러온 tool을 context 끝에 넣어 cache를 지킨다. 지금 `tool.load` → `tool_result_reference` 이력 조각을 Responses packer가 `tool_search_call`·`tool_search_output` item으로 그린다. 숨긴 tool은 `tools[]`에 넣지 않는다. 조건은 built-in `openai` 정의와 gpt-5.4 이상이다. [OpenAI tool search](https://developers.openai.com/api/docs/guides/tools-tool-search/) (agent)

## 사람이 정한 것

1. **context가 넘칠 때 lophn이 사람 없이 줄인다(A).** turn 안은 오래된 tool 결과 본문을 바꾸고, turn 사이는 다음 turn 전에 자동 Compact한다. (사람, 2026-10-29)
   - `budget-anchor`, `context-shrink`, `context-autocompact`는 branch `feat/auto-compact`에서 했다. 동작은 `project-docs/architecture/agent-definition.md`의 입력 예산, turn 안 이력 줄이기, compact 절이고 결정은 `project-docs/products/change-log/0.9.0.md`의 마지막 항목이다.
   - 계획과 달리 한 것: 자동 Compact는 끝난 turn 뒤가 아니라 pump가 그 session의 다음 turn을 시작하기 직전에 한다(끝난 turn 뒤에 요청을 열면 같은 순간 새 입력이 turn을 시작해 요청이 실패한다). 판단 기준은 "첫 call이 예산의 절반보다 크고 이전 대화가 예산의 5분의 1 이상, 또는 turn이 `context_limit`으로 끝남"이다. 이전 대화가 작은 session을 매 turn 요약하지 않으려고 둘째 조건을 더했다. (agent)
2. **실제 provider 호출 확인은 보류한다.** (사람, 2026-10-29) 아래 확인이 필요한 task는 보류가 풀릴 때까지 `blocked`다.
   - L1 `cache-tail`: tool 목록이 바뀐 Anthropic session에서 연속 call의 `cache_read_input_tokens`가 앞 call prompt의 대부분이다(지금은 system 층만큼).
   - L2 `cache-ttl`: Claude 구독으로 call 하나. 400이 없고 `cache_creation.ephemeral_1h_input_tokens > 0`이다.
   - L3 `cache-openai`: OpenAI 연속 call의 `cached_tokens > 0`. OpenRouter `anthropic/` model의 두 번째 call `cache_read > 0`.
   - L4 `defer-responses`: gpt-5.4 이상에서 `tool.load` → `tool_search_call` → 불러온 tool 호출이 한 turn에 돈다. eval scenario 몇 개로 tool 지연 켜기·끄기의 완료율과 input token을 비교한다.
   `cache-tail`과 `cache-openai`는 fake로 요청 모양을 확인하고 합칠 수 있다. L1·L3는 효과를 재는 확인이라 나중에 해도 된다. `cache-ttl`(L2)과 `defer-responses`(L4)는 서버가 받는지 모르므로 확인 전에는 합치지 않는다.

## 범위 밖

| 무엇 | 하지 않는 이유 |
| --- | --- |
| cache warming | 쓰는 곳이 없다. 구독 경로는 token 과금이 아니고, Antigravity는 가격이 0이라 OMP에서도 돌지 않는다 |
| cache miss 표시 | 사용량을 보이는 화면이 없다(`ReadAgentUsage`만) |
| `cache_control` 거절 fallback | 거절하는 custom proxy를 본 적이 없다. 보이면 이슈로 연다 |
| 15턴 checkpoint, 두 번째 대화 표시, system 표시 수 조정 | turn 안 call은 lookback 20 안에서 이어진다. 효과를 재기 전에는 만들지 않는다 |
| GPT-5.6 explicit breakpoint, 12h, `previous_response_id` chain | implicit cache로 충분하다. `store:false`는 정한 설계다 |
| provider native compaction(Anthropic `compact`, OpenAI compaction) | 줄일 것이 turn 안 tool 결과라 local 대체가 단순하다 |
| Chat Completions·Antigravity·custom의 tool 지연(dispatcher) | 선언된 dispatcher tool로 부르게 하는 설계(`research_notes/omp-cache-compaction-tool-loading/tool-loading.md`의 device 방식)는 model 정확도를 eval로 재야 한다. L4 결과를 보고 roadmap으로 올린다 |
| 오래된 이미지 빼기를 묶어서 하기 | 새 이미지마다 빠지는 이미지는 끝에서 셋째라 다시 쓰는 범위가 작다 |
| Bedrock, Vertex, Codex backend | lophn에 없는 provider다 |

## 단위와 task

brief는 쓰지 않는다(task가 적고 결정이 위에 있다). lead가 worker prompt에 아래 할 일과 소유를 쓴다. `status.py`를 쓰려면 lead가 이 표대로 `tasks/<id>.md`를 짧게 만든다.

| id | 단위 | wave | 선행 | 소유 | 할 일 | 위험 test |
| --- | --- | --- | --- | --- | --- | --- |
| `cache-tail` | cache | 1 | 없음 | `packages/core/lophn-agent/prompt-assembly/model.ts`, `packages/core/lophn-agent/prompt-assembly/turn-prompt.ts`, `packages/core/lophn-agent/run-loop/turn.ts`, `packages/core/lophn-agent/models/binding.ts`, `packages/core/lophn-agent/providers/adapters/messages.ts` | text 조각에 "이 call에만 붙는다" 표시를 더한다. `appendNotices`와 `historyOf`의 `context.notices`가 그 표시를 단다. steering에는 달지 않는다. Anthropic packer가 대화 끝 표시를 표시 없는 마지막 block에 단다. 마지막 message가 모두 표시 조각이면 그 앞 message로 간다. `messages.ts`의 `markConversationEnd`를 지운다. 다른 packer는 표시를 무시한다 | notice가 붙은 연속 두 call에서 뒤 call의 body가 앞 call의 대화 끝 표시 block까지 byte 단위로 같다 |
| `cache-openai` | cache | 1 | `cache-tail` | `packages/core/lophn-agent/providers/adapters/responses.ts`, `packages/core/lophn-agent/providers/adapters/chat-completions.ts`, `packages/core/lophn-agent/providers/invoke.ts`, `packages/core/lophn-agent/models/binding.ts` | built-in `openai`: `prompt_cache_key`와 header `session_id`·`x-client-request-id`. built-in `xai`: header `x-grok-conv-id`. 값은 session의 고정 id. session은 `packages/core/lophn-agent/providers/work.ts`의 `session`에서 온다. `openrouter`의 `anthropic/` model: Chat body에 표시 둘. usage: Responses `input_tokens_details.cache_write_tokens`, Chat `prompt_tokens_details.cache_write_tokens`를 읽고 새 input에서 뺀다. DeepSeek hit·miss 계산은 그대로 | 없음 |
| `cache-ttl` | cache | 2 | 없음 | `packages/core/lophn-agent/models/binding.ts`, `packages/core/lophn-agent/providers/adapters/messages.ts`, `packages/core/lophn-agent/providers/adapters/claude-code.ts`, `packages/core/lophn-agent/models/resolve.ts` | Claude 구독 OAuth binding이면 Anthropic packer의 모든 표시가 `{type:"ephemeral", ttl:"1h"}`이다. API key는 그대로. profile의 identity 표시는 body에 이미 있는 표시의 값을 복사한다. extended-ttl beta는 더하지 않는다. land 전 L2 | 구독 body의 모든 `cache_control`이 같은 값이다 |
| `defer-responses` | defer | 2 | `cache-ttl` | `packages/core/lophn-agent/models/binding.ts`, `packages/core/lophn-agent/providers/adapters/responses.ts`, `packages/core/lophn-agent/providers/definitions.ts` | `supportsDeferredTools`를 built-in `openai`의 gpt-5.4 이상까지 넓힌다. Responses packer: 숨긴 tool은 `tools[]`에서 빼고, `tool.load` function 정의 대신 `{type:"tool_search", execution:"client", description, parameters}` 하나를 넣는다(description과 parameters는 지금 `tool.load`의 것). `tool.load` 호출·결과 조각을 `tool_search_call`·`tool_search_output`(숨긴 정의 그대로)으로 그린다. stream의 `tool_search_call` item을 `tool.load` 호출로 읽는다. 실행 쪽(`tool.load` 검사, Gate)은 그대로. land 전 L4 | 없음(`packages/core/lophn-agent/tools/bundles/tool_test.ts`가 권한 경계를 본다) |

`budget-anchor`, `context-shrink`, `context-autocompact`는 위 "사람이 정한 것" 1대로 끝났다.

## 순서

0. **선행 조건은 끝났다.** 구독 OAuth(Claude, Antigravity)가 main에 land했고(`0dbf3658f`) `feat/auto-compact`가 그 위에 올라갔다. `feat/claude-subscription-oauth`와 `feat/subscription-oauth`는 main에 들어오지 않은 이전 branch이고 이 계획의 소유 file(`turn.ts`, `turn-prompt.ts`, `compactor.ts`, `messages.ts`)을 고친다. 그것을 합칠 일이 있으면 이 계획의 task보다 먼저 정한다.
1. **wave 1**: `cache-tail` → `cache-openai`. 사람 결정이 필요 없다.
2. **wave 2**: `cache-ttl` → `defer-responses`. live 확인 보류가 풀릴 때까지 `blocked`다.

## 돌리기 전에

- 구독 OAuth land를 확인하고 이 README의 path와 줄 근거를 그 위에서 다시 본다(특히 `claude-code.ts`의 표시 수 계산과 `cloud-code.ts` usage).
- live 확인을 할 거면 사람이 lead session에 직접 허락한다.

## lead가 할 일

- merge마다: `project-docs/architecture/agent-definition.md`를 그 task가 바꾼 동작에 맞춘다.
  - `cache-tail`: "cache 표시는 system 층 셋과 대화 끝 하나다" 절에 "notice 같은 그 call에만 붙는 글에는 달지 않는다"와 다는 곳(packer).
  - `cache-ttl`·`cache-openai`: credential별 cache 표 한 줄씩.
  - `defer-responses`: "tool 정의는 늦게 싣는다"의 켜는 곳과 "OpenAI responses의 `tool_search` … 아직 켜지 않는다" 문장.
- 다 끝나면: changelog 열린 판(`project-docs/products/change-log/0.9.0.md`)에 항목. 결정은 위 "정한 것"의 `(agent)`와 사람 결정. 범위 밖의 dispatcher tool 지연은 L4 결과와 함께 `project-docs/products/roadmap/`에 한 편으로 올린다. 계획 폴더를 지운다.
