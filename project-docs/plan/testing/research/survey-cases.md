# test 넷으로 나누기 재료: harness case, core E2E, provider live, tests/ 폴더

기준: main `ed75e9412`. 코드는 고치지 않았고 deno test·check는 돌리지 않았다(file과 git 기록만 읽음). 짐작은 "짐작"으로 표시했다. 앞선 `survey-model.md`, `survey-runtime.md`와 겹치는 것은 다시 적지 않는다.

## 0. 먼저: 앞 조사와 달라진 것

- **harness-domain 계획은 끝나서 main에 들어왔다.** `e8c19f91e Close the harness domain plan`. `project-docs/plan/harness-domain/`과 `.claude/worktrees/plan-harness-domain/`은 지금 없다(조사 도중에 사라짐. 처음엔 있었다). 그래서 아래 "끝나면"은 main 지금 상태가 곧 끝난 상태다. 남은 것은 `project-docs/issues/layers.md`의 `HARNESS_LEFTOVERS`(harness 폴더 file 25개가 domain protocol·role 이름을 아직 안다. `tools/check-deps.ts`에 file별 이유로 면제).
- `survey-model.md` 5절의 "main에 `listRoleTools`" 같은 표현은 옛 것이다. 지금은 `packages/core/agent-roles/tool-lists.ts`의 `builtinToolNames(role)`(이름 목록) + `packages/core/lophn-agent/tools/registry.ts`의 `selectTools(names, {input_media}, definitions)` + `packages/core/main/agent-tools.ts`의 `agentTools({file: FILE_HOOKS})`(정의 전부, 조립의 유일한 곳)다.
- **`survey-model.md`의 "기동 시 models.dev에 실제 GET이 나간다"는 틀렸다** (5절).
- 지금 `project-docs/issues/agent-definition.md`에는 credential operation 이름 이슈가 없다. `archived/agent-definition.md:228-245`에 "닫음"으로 있고 guard는 `packages/core/main/agent-tools_test.ts`다(App Engineer 상한에 `CreateTicket`이 있고 `ticket.create`는 없다). 열린 이슈 중 flow를 막는 것은 `place-session.md`의 "agent runtime process의 Deno 권한에 place 폴더가 없다" 하나다.

## 1. fake provider를 fetch로 꽂기

### 1-1. 한 요청 처리 함수
- **이미 `(Request) => Promise<Response>` 꼴이 있다**: `FakeServer.handle(request: Request): Promise<Response>` (`tools/fake-provider/server.ts:80`, class는 :28, export됨). `startFakeProvider`(`mod.ts:15`)는 이걸 `Deno.serve`에 물릴 뿐이다.
- 떼려면 필요한 것: 없다. 다만 `mod.ts`는 `FakeServer`를 안 내보낸다(`server.ts`에서 직접 import해야 한다). 한 줄짜리 helper(`fakeFetch(options)` = `new FakeServer(options)` + `(input, init) => fake.handle(new Request(input, init))` + `requests/assertDone/release/close`)를 `mod.ts`에 더하면 끝난다(짐작: 이 정도면 충분. `request.signal`만 쓰고 소켓 정보는 안 쓴다 `server.ts:124,150`).
- 주의: path는 `URL(request.url).pathname`으로 분기한다(`/messages`, `/responses`, `/chat/completions`). endpoint가 `http://fake.test` 같은 가짜 host여도 되지만 `joinEndpoint`가 붙이는 path가 그대로여야 한다(base에 `/v1` 금지). 요청은 `#admission` promise로 접수 순서를 직렬화한다(`server.ts:80-89`). stream 소비는 그 밖이다.
- SSE 응답은 script step의 `response.headers`에 `content-type: text/event-stream`을 직접 줘야 한다. 안 주면 `createFetchTransport`(`providers/adapters/transport.ts:79`)가 SSE로 안 보고 64KiB 안에서 JSON 한 덩어리로 읽어 `framesFromBatch`가 null → "원인 불명" 실패가 된다(`providers/invoke.ts` batch 분기). semantic `reply`(비stream JSON)는 `application/json`이라 batch 경로로 정상 처리된다.

### 1-2. fetch 하나만 갈아 끼우면 loop가 닿나
- model 쪽 사슬은 `fetch`만 받는다: `createModelResolver({machine, attach?, catalog, fetch?, nowMs?, timeoutMs?})`(`models/resolve.ts:67`)가 `createFetchTransport(deps.fetch)`(:70) → `createInvokeModelCall({transport, nowMs, at})`(`providers/invoke.ts:167`) → `ModelBinding.invoke`. `productDriver({fetch})`(`main/agent-runtime/product-driver.ts:76`)는 그 `fetch`를 resolver에만 넘긴다.
- **하지만 "port 없이"는 아니다.** `startTurnLoop(deps, input)`(`run-loop/loop.ts:16`)은 `LoopDeps.ports: TurnPorts` 여덟 개를 반드시 받는다. `fetch`만으로는 loop가 안 돈다. `createTurnDriver`(`run-loop/driver.ts:51`)는 `source`(TurnSource), `credentials`(TurnCredentials), `preparer`(TurnPreparer)를 받고 preparer가 core 읽기 수십 개를 한다(아래 1-3). harness test는 driver·preparer를 건너뛰고 `startTurnLoop`를 직접 부르는 쪽이 맞다(짐작).
- 진짜 child process(`main/agent-runtime/main.ts`의 `import.meta.main`, 줄 ~495)는 `startAgentRuntime({driver: productDriver(), pump: true})`를 `fetch` 없이 부른다. `startAgentRuntime`(:94)은 export되지 않고 그 `input.fetch`는 core loopback(`machineCall`/`agentCall`)과 catalog·MCP auth pump에만 가지 `productDriver`로는 안 간다. 즉 **core E2E에서 model fetch를 갈아 끼울 길은 없고**, provider endpoint를 HTTP fake로 돌려야 한다(맞는 설계).

### 1-3. loop를 in-process로 돌릴 때 채울 port와 지금 test에서 채우는 법

`TurnPorts`(`run-loop/ports.ts:216`): `stop, inputs, context, model, tools, checkpoint, answer, finish`. 그 위에 `LoopDeps`: `clock, wait, deadline?, random, abortGraceMs?`.

두 길이 있다.
- **(A) `createCorePorts`(`run-loop/core-ports.ts:128`)를 쓰고 `machine: CoreCall`만 가짜로**: 진짜 model/tool 기록 코드가 같이 돈다. 필요한 것: `seat`, `clock`, `ids`, `machine`, `blobs`, `redact`, `agentHash`, `model: ModelBinding`, `tools: ToolSetup`, `context()`, `turnInputs`, `events`.
- **(B) TurnPorts를 손으로**: 가장 가볍다. `model.call`은 `binding.invoke`를 얇게 감싸 `ModelAttempt`로 바꾼다(`core-ports.ts:modelAttempt`를 참고). `tools.attempt`는 `executeToolCall`(`tools/work.ts`)을 직접 부른다.

(A)에서 가짜 `machine`(path → 결과 맵)이 답해야 하는 route는 8개+1: `turns/read`(`turnRead`, stop·finish·checkpoint가 부른다. state가 `running`이면 계속), `model-calls/start`, `model-calls/finish`, `tool-calls/request`, `tool-calls/finish`, `messages/record`(답 기록), `turns/checkpoint`, `turns/finish`, 그리고 resolver의 `providers/read`(`providerRead`, `available()`도 다시 부른다). 출력은 route의 output schema로 다시 parse되니(`readOf`, `core-call.ts`) schema에 맞게 줘야 한다. `commandOf` 응답은 best-effort라 실패해도 turn은 간다(`core-ports.ts` 주석).

| port / 입력 | harness test에서 | 비고 |
|---|---|---|
| `stop` | 가짜로 쉬움 | `turns/read`를 `running`으로 고정. stop 시험은 `finished`+`outcome.interrupted`로 바꾼다 |
| `inputs`/`TurnInputs` | 쉬움 | `first()`=요청 글, `steering()`=빈 배열, `settled()` no-op (`createInbox`는 core 메모리라 안 씀) |
| `context` | 손으로 | `prompt`(role_prompt, tools[], instructions, skills, place, limits, reserved_output) + `session`(SessionConversation) + `notices`. `prepare.ts` `build`의 모양을 따라 하면 된다. role prompt·place 글을 진짜로 하려면 `agent-roles/roles/prompts.ts` `rolePrompt`, `agent-roles/place/place-data.ts` `placeData(call, resolved)`(core 읽기 필요)를 부른다 |
| `model` | **진짜**: `createModelResolver({machine: 가짜(providerRead만), catalog: ()=>ok(snapshot entries), fetch: fakeFetch})` | provider 기록 `credential.kind:"none"`이면 `attach`도 필요 없다. catalog는 `models/snapshot.json`(4개)을 `parseEntries`로 읽어 쓴다 |
| `tools.listed` / `ToolSetup.context` | **진짜 정의** | `agentTools({file: FILE_HOOKS})` → `selectTools(builtinToolNames(role), {input_media}, defs)`. 정의 file은 store·DB를 import 안 해서(`tools/spi.ts` 규칙) core 없이 import된다 |
| `ToolContext.core`(agent 자격 loopback) | 가짜 `CoreCall` | tool이 부르는 route(`CreateTicket` 등)를 기록하고 schema에 맞는 결과를 돌려준다. domain 동작은 안 본다 |
| `ToolContext.gate` | 가짜 쉬움 | `{check: ()=> ok(허락 결과)}`. 진짜 Gate 판정은 core(approvals)에 있다 |
| `router`(call/reply/cancel/sendable) | 가짜 | `call` tool을 시험하려면 기록하는 가짜 |
| `questions`(ask) | 가짜 | 사람 답을 즉시 돌려주거나 안 돌려줘서 `pause`(시간 안 셈)를 시험 |
| `scope`(file tool 폴더) | **진짜 FS** | 임시 폴더를 `{read:[dir], write:[dir]}`로 직접 준다. in-process라 Deno 권한 문제(place-session 이슈)가 없다 |
| `skills`, `fetch`(web tool) | 가짜/빈 | `UNWIRED_TOOL_PORTS`(`run-loop/unwired.ts`)가 닫힌 기본값 |
| `blobs`(BlobPort) | 쉬움 | `prepare(purpose, bytes)`가 hash와 size를 돌려주면 된다 |
| `redact` | 쉬움 | `(t)=>t` |
| `events`(AgentEventSink) | 쉬움 | 배열에 push |
| `FILE_HOOKS.aroundWrite`의 rewind | 가짜 core가 답하거나 실패해도 쓰기는 간다 | `recordBeforeWrite`는 기록이 실패해도 쓰기는 한다(place-session 이슈 본문) |
| `LoopDeps.clock/wait/deadline/random` | 쉬움 | 가짜 시계와 즉시 도는 `wait`. 한도·retry 대기·timeout을 실제 시간 없이 시험 |
| `credentials`/`source`/`preparer`(driver 쪽) | **쓰지 않는다** | `prepare()`가 core 읽기를 열 개 넘게 한다(`agentSessionRead`, `settingsList`, agent 정의 해석 `resolveTurnAgent`, `instructionsGet`, `readSessionConversation`, `startTurn` …). 여기까지 흉내 내는 건 사실상 core다 |

core가 있어야 되는 것: 진짜 Gate 판정, Router(`call`), ledger 기록의 일관성(turn 상태 전이), agent credential 상한 대조(`roleOperations`는 `agent-tools_test.ts`가 따로 지킨다), place 폴더 실제 Deno 권한, 사람 결정 대기.

## 2. harness case 후보

### 2-1. adapter 판정 → `ModelOutcome` (invoke.ts가 하는 일)

세 protocol의 judge는 `complete / partial / refused / failed` 넷을 낸다(`messages.ts:397 judge`, `responses.ts:344 judgeResponses`, `chat-completions.ts:354 judgeChat`).

| 결과 | anthropic-messages 조건 | openai-responses 조건 | openai-chat 조건 |
|---|---|---|---|
| complete(답) | `message_stop` 봄 + stop_reason `end_turn`/`stop_sequence`/`pause_turn` | `response.completed`, tool 없음 | `finish_reason: stop` |
| complete(tool) | stop_reason `tool_use` + 모든 block start 봄 + 모든 tool이 `content_block_stop` 완료 + 인자가 JSON object(빈 문자열은 허용) | `response.completed`이고 모든 function_call이 `output_item.done`으로 확정 + 인자 JSON object | `finish_reason: tool_calls` + tool 있음 + 모든 tool 완료 + 인자 JSON object |
| partial | `message_stop` 없이 끝남, stop_reason 없음, `max_tokens`, tool 인자 미완·JSON 아님·block 구멍 | `response.completed/incomplete` 못 봄, `incomplete`(`max_output_tokens` 등 `content_filter` 외 전부), tool 인자 미완·JSON 아님 | `finish_reason` 없이 끝남, `length`, 모르는 값, tool 미완·잘못된 index·JSON 아님 |
| refused | stop_reason `refusal`/`sensitive` | `incomplete` + `content_filter` | `finish_reason: content_filter` |
| failed(판정) | stream `error` frame | `response.failed` | error chunk |

invoke.ts가 실제로 outcome을 만드는 규칙(`providers/invoke.ts:167-300`):
- 판정의 `failed`는 adapter의 code를 안 쓰고 `classifyStreamFailure({type: errorType})`(`failures.ts`)로 다시 분류한다. 표에 있는 type만 status로 옮긴다: `overloaded_error`→529(temporary), `api_error`→500(temporary), `rate_limit_error`→429, `authentication_error`→401, `permission_error`→403, `billing_error`→402, `invalid_request_error`→400 등. 표에 없는 type(Responses의 `server_is_overloaded` 같은 code 포함)은 status 0으로 넘어가 구조화 code 단계에서 null이 되고 `unknown`이 된다(짐작: `failures.ts`의 RATE_CODES 주석은 "429 아니면 temporary"라고 하지만 status가 0이라 `fromStatus`가 null → unknown. 코드로만 읽었고 안 돌렸다. live·harness test로 확인할 만한 곳).
- `refused` → `outcome.kind:"failed", code:"refused"` (tool은 비움).
- stream이 중간에 끊김(소켓 reset, 읽기 throw) → `disconnected`만 세우고 collector 판정으로 간다 → 대개 **partial**이다(failed temporary가 아니다). 연결 자체 실패(응답 header 전: fetch throw)만 `temporary`다(`transport: "connection_failed"`).
- 호출자가 abort → `cancelled`. `timeoutMs`가 지나 abort(signal은 안 취소) → 받은 글이 있으면 partial, 없으면 `temporary`. **단 제품은 `timeoutMs`를 항상 null로 넘긴다**(`createModelResolver`의 `timeoutMs`를 `productDriver`가 안 줌, `grep timeoutMs` 결과). 그래서 per-call timeout은 지금 없고 loop의 한도 timer만 있다.
- 크기 상한(line 256KiB, event 2MiB, total 64MiB) 초과 → partial.
- HTTP status: 아래 표.

| HTTP | 분류(`failures.ts`) | loop 반응 |
|---|---|---|
| 401, 403 | `credential_unavailable`(authentication, `plan_access` code면 plan_access) | `configuration_unavailable`로 turn failed. retry 없음 |
| 402 | `credential_unavailable`(quota) | 같음 |
| 429 + `retry-after` ≤30초(또는 reset header·본문 "retry after N") | `temporary`+`retry_at` | retry(아래), 대기는 `max(0, retry_at - clock.nowMs())` |
| 429 그 밖(헤더 없음, >30초) | `credential_unavailable`(quota, until=+reset 또는 1시간) | `configuration_unavailable`로 failed, retry 없음 |
| 500, 502, 503, 529 | `temporary` | retry |
| 504, 408, 520대, 3xx(redirect는 안 따라감), 그 밖 | `unknown` | `model_error`로 failed, retry 없음 |
| 413/400 + overflow 문구 또는 `context_length_exceeded` | `context_exceeded` | `context_limit`으로 failed |
| 400 `invalid_request_error`(문구 없음), `invalid_prompt` | `invalid_request` | `model_error`로 failed |
| 404 + `not_found_error` + "model" | `model_unavailable` | `configuration_unavailable` |
| 모든 비-2xx 본문 | 구조화 code·문구 조각만 분류에 쓰고 버림 | — |

### 2-2. loop가 outcome으로 하는 일 (`run-loop/turn.ts`)

`runTurn`은 순서가 고정이다: stop 확인 → inputs → 한도 → provider 살아 있나(`model.available()`) → prompt 조립(`prepare`) → `callModel` → complete면 tool 묶음 또는 답.

- **complete + tool 없음** → `conclude`: 새 steering이 없으면 `answer(text)`(빈 글이면 기록 없이 ok) → `finish(completed/answer_completed)`. 새 steering이 있으면 종료하지 않고 한 판 더.
- **complete + tool** → `runToolBatch`(`tool-batch.ts`): 모두 읽기면 병렬, 아니면 순서대로. 없는 tool·인자 schema 위반은 인자를 고치지 않고 call별 `failure`로 돌려주고(`close`) 모델에게 결과로 전한다. 읽기 tool만 `unavailable/internal/uncertain` 실패에서 **1번** 자동 retry(`TOOL_RETRY_MAX=1`, 약 1초±10%). 쓰기·external은 retry 없음.
- **partial** → `[machine] The previous response was cut off (<finish_reason|unknown>). None of its tool calls were started. Continue from what is confirmed.`를 user 이력에 붙이고 `checkpoint` 후 `continue`(`turn.ts` partial 분기). tool은 하나도 시작 안 함.
  - **되풀이가 끝나는 곳** (partial은 retry가 아니라 새 판이다): `TurnLimiter`(`run-loop/limits.ts`)의 세 한도. (1) `model_attempts`(기본 30, 시도마다 +1, partial·failed·cancelled도 센다), (2) `stall_ms`(기본 300_000, **complete만 0으로 되돌린다**. partial은 시간만 쌓는다), (3) `active_ms`(기본 1_800_000). 한도는 settings `lophn-agent.run.model_attempts/stall_ms/active_ms`(양의 정수)로 turn 시작 때 고정된다(`DEFAULT_TURN_LIMITS`, `protocol/lophn-agent/turn-values.ts:77`). 닿으면 `finish(failed, model_attempt_limit|stall_limit|active_limit)`. 그 전에 또 하나: 이력이 계속 자라서 prompt가 예산을 넘으면 `blocked(input_over_budget)` → `context_limit`으로 failed(`blockedEnd`).
- **failed(temporary)** → `MODEL_RETRY_MAX=2`번 같은 입력으로 새 ModelCall을 보낸다(`kind:"retry"`, `retry_of`=직전 id). 대기: `retry_at`이 있으면 그 시각까지, 없으면 2초, 4초(`retry.ts`). 대기 뒤 stop·provider 철회·새 steering(→ `restart`)·한도를 다시 본다. 두 번 retry 뒤에도 temporary면 `model_error`. retry도 시도 횟수 한도에 센다.
- **failed(그 밖)** → 바로 끝: `context_exceeded`→`context_limit`, `credential_unavailable`/`model_unavailable`→`configuration_unavailable`, 나머지(refused, invalid_request, unknown, uncertain)→`model_error`. 모델을 다시 부르지 않는다.
- **`invoke`가 Result error**(secret 부착 거절, state-free 계속 불가 등) → `core-ports`가 outcome을 `credential_unavailable`로 기록하고 loop는 `configuration_unavailable`로 failed.
- **cancel**: 멈춤(`stop(reason)` 또는 core가 turn을 닫음) → `abortEnd` → `{kind:"stopped"}`, `FinishTurn`은 다시 안 부른다. provider 철회(`revoke({provider:true})`) → `configuration_unavailable`. 한도 timer(`limiter.nextDeadlineMs`, stall/active 중 가까운 쪽)가 진행 중 호출을 abort → `limitEnd`(stall_limit/active_limit). abort를 요청했는데 호출이 `abortGraceMs`(기본 5초) 안에 안 돌아오면 결과를 기다리지 않고 끝낸다(`awaitAbortable`).
- **timeout 요약**: per-call HTTP timeout 없음. "공급자가 말이 없다"는 stall_ms(complete로만 리셋)로 잡힌다. 사람 결정 대기(`pause`)는 시간에서 뺀다.

### 2-3. 각 꼴을 지금 fake provider로 낼 수 있나

fake의 도구: semantic `reply{text,toolCalls,usage,stop}`(비stream JSON), raw `response{status,headers,body|chunks[],end}`, `chunks[].delayMs/gate`, `end: close|reset|hold`, `release(gate)`, `instant`, 요청 log와 `aborted`.

| 꼴 | 낼 수 있나 | 방법 |
|---|---|---|
| complete 답 | O | `reply:{text, stop:"end"}` |
| complete tool 하나 | O | `reply:{toolCalls:[{id,name(wire 이름, `.`→`_`),arguments(JSON 문자열)}], stop:"tool_calls"}` |
| complete tool 여럿(병렬/순차) | raw만 | semantic은 `toolCalls` 배열을 받지만 `buildReply`가 protocol별로 한 body에 다 넣는다(Anthropic·Responses·Chat 모두 배열 지원, `semantic.ts`). 주석("여러 tool은 raw로")과 달리 코드는 배열을 처리한다(짐작: 쓸 만하다. 안 돌려 봄) |
| partial: 길이 한도 | O | `stop:"max_tokens"`(messages, responses) / `"length"`(chat) / `"incomplete"`(responses) |
| partial: stream 끊김 | O | raw `chunks`(SSE 글자 직접 작성) + `end:"close"`(종료 event 없이 닫힘) 또는 `end:"reset"`. SSE builder는 없다 |
| partial: tool 인자가 잘림/JSON 아님 | O | raw chunks에 `input_json_delta`를 반쯤만. Anthropic은 인자가 빈 문자열이어도 complete라 `{"a":`처럼 깨진 것을 써야 한다 |
| refused | O(raw JSON body) | `response:{status:200, headers:{content-type: application/json}, body: <stop_reason:"refusal" / incomplete_details.reason:"content_filter" / finish_reason:"content_filter">}`가 `framesFromBatch`를 타서 판정된다. semantic `stop`에는 refused가 없다 |
| failed: stream error frame | O | Anthropic은 200 + JSON `{type:"error",error:{type:"overloaded_error"}}`(batch) 또는 SSE `error` frame. `overloaded_error`면 temporary, `rate_limit_error`면 헤더가 없어 credential_unavailable(1시간 usage_wait)이 된다(2-1 짐작) |
| HTTP 401/403/402/404/413/429/500/502/503/529/504 | O | `response:{status, headers, body}`. 429의 `retry-after`(초)·`retry-after-ms`·reset 헤더도 `headers`로 준다 |
| retry 2회 후 성공 | O | step 3개(503, 503, 정상). 대기는 `LoopDeps.wait`로 즉시 |
| 연결 실패(header 전) | harness는 fetch가 throw하면 O; HTTP fake는 server를 닫으면 | fake의 `end:"reset"`은 header 뒤 stream 오류라 연결 실패가 아니라 partial이 된다 |
| timeout/무응답 | O | chunk에 `gate`(release 안 함) 또는 `end:"hold"` + 작은 `stall_ms` 또는 가짜 `deadline`. fake 요청 log의 `aborted:true`로 abort 확인 |
| cancel(사람 멈춤) | O | 같은 gate 상태에서 `handle.stop("user_stopped")`. `aborted:true` 확인 |
| provider 철회 | O | `handle.revoke({provider:true})` |
| 느린 stream 순서(delay) | O | `chunks[].delayMs`; `instant:true`면 건너뜀 |
| 요청 본문 검사(`stream:true`, tools wire 이름, header) | O | `step.match.body/headers`, `requests()` log. 인증 header는 값 대신 종류만 log |
| 같은 요청 N번(partial 되풀이 한도) | O | step을 N개 나열. step이 모자라면 500 `exhausted` → fake log에 실패가 남고 `assertDone`이 던진다. 한도 시험은 `model_attempts`를 작게 |
| usage/token | O | `usage:{input,cacheRead,cacheWrite,output,reasoning}` (protocol별로 cache 위치가 다르게 번역됨) |
| 빈 답(text도 tool도 없음) | O | `reply:{}`; loop는 complete로 보고 답 기록 없이 completed(`answer`가 빈 글이면 ok) |

## 3. core E2E flow 셋

### 3-0. 공통 준비 (flow 모두)
1. **core 띄우기와 user token**: user token은 core가 parent pipe(stdin/stdout, 길이 frame JSON)로 보내는 hello frame(`{user_token, api_port, core_epoch}`, `main/daemon/parent.ts greet`)뿐이다. 길은 둘: (i) `deno run -A packages/core/main/daemon/main.ts --port=0`을 `LOPHN_HOME=<임시 0700 절대 경로>`, stdin·stdout을 `piped`로 spawn해서 `core/supervision/responsiveness`의 `readFrames`로 hello를 읽는다(stdin이 tty가 아니라서 `daemon/main.ts:12` 조건을 탄다. 진짜 process 하나). (ii) in-process `startCore({lophnHome, port:0, teams: TEAMS, teamModules: TEAM_MODULES, wirings: WIRINGS, parent:{stdin,stdout}, codingKeychain})`(`daemon/assembly.ts`). 둘 다 `agent runtime` child(Deno subprocess)는 core가 afterReady에서 띄운다.
2. **요청 client**: `createRpcClient({baseUrl:"http://127.0.0.1:<api_port>", token, fetch})`(`packages/protocol/client/client.ts`). `fetch`는 `(url, {method, headers, body}) => {status, headers, bytes}` 꼴 어댑터를 직접 써야 한다(`RpcFetch`, 응답 `bytes`가 Uint8Array). `client.call(route, body)`가 `Result`를 낸다. command는 `{input, idempotency_key, compare, prepared: []}` 봉투(`commandRequestSchema`). upload route는 못 부른다(`kind:"upload"`이면 invalid_input, 별도 client).
3. **fake provider 등록**: `startFakeProvider({script:{steps:[]}, instant:true})`(HTTP), 그 `url`로 route `providers/register`(`registerProvider`, `protocol/lophn-agent/providers.ts:60`): `{id: pvd_*, name, definition:{key:"anthropic", display_name, protocols:["anthropic-messages"], auth_kinds:["none"], models_endpoint:null, oauth:null, revision}, endpoint:<url>, protocol:"anthropic-messages", credential:{kind:"none", preparation:null}}`. `none`은 loopback endpoint에서만(`provider-inputs.ts loopback()`). 이 provider에 `definition.key:"anthropic"`을 쓰는 이유는 catalog(`snapshot.json`)에 `anthropic/claude-sonnet-4-5`가 있기 때문(`resolve.ts`가 못 찾으면 invalid_input).
4. **model 선택**: `model-default/change`(`modelDefaultChange`, `models.ts:320`) `{default:{provider:<pvd>, model_name:"claude-sonnet-4-5", option_values:{}}}`(모양은 `modelChoiceSchema`, 안 열어 봄).
5. **script 주입**: fake에 `POST /__fake/script` 또는 프로그램의 `script`. 첫 matched 뒤에는 교체 못 한다(409). 시작 전에 다 넣는다.
6. **한도 줄이기(선택)**: 기동 전에 `<LOPHN_HOME>/settings.json`(flat JSON, 0600, `config/store.ts`)에 `"lophn-agent.run.model_attempts"` 등을 쓰면 시작 때 읽는다. 틀린 값이면 파일 전체를 거절하고 기본값(`store.ts` 머리 주석).
7. **끝 확인(공통 read)**: `turns/list`·`turns/read`(`turnRead`)로 turn `state:"finished"`와 outcome, `tool-calls/list`(`toolCallList`), `messages/list`(`messagesList`), `model-calls/list`(`modelCallList`), fake `requests()`.
8. 정리: process 종료(SIGTERM) + 임시 data root 삭제. 사람의 `~/.lophn`과 OS keychain은 안 건드린다(`LOPHN_HOME` 지정, provider가 `none`이라 secret 참조가 없고 keychain은 참조가 있을 때만 열린다 — `secrets/store.ts` 머리 주석. MCP를 안 쓰면 `codingKeychain`도 호출되지 않는다).

### 3-(a) 사람이 말한다 → agent가 ticket.create → ticket 생김

**먼저: PM으로는 안 된다.** `ticket.create`는 App Engineer 전용이다. role 목록(`agent-roles/tool-lists.ts` `ROLE_WRITE_TOOLS`)에서 PM의 쓰기는 `context.draft/submit`, `glossary.set`, `operator.create/update`뿐이다. core도 `CreateTicket` handler가 "only an App Engineer creates tickets"로 거절한다(`apps/tickets/commands.ts:42` `agentActor`, `checkApp`). 사람이 PM에게 말해서 ticket을 만드는 길은 없다(PM → `call`로 App Engineer에게 넘기는 길은 prompt상 PM이 아니라 lophn/App Engineer가 쓴다). 추천: **사람 → App Engineer 직접**.

route 순서(전부 user 자격):
1. 3-0의 1~5.
2. `apps/create`(`appCreate`, `protocol/apps/apps.ts:84`, name `app.create`): `{slug, name, description}` → 출력 `app` 객체(id `app_*`). `actors: user/coding_agent/agent`.
3. `sessions/open`(`openAgentSession`, `protocol/lophn-agent/agent-sessions.ts:77`): `{id: ses_*, agent:{role:"app_engineer", app:<app id>}, opening_context:null}`. (`sessions/open`은 `registry.ts`가 옛 `openSession`을 빼고 이 새 route를 올린다.)
4. `messages/send`(`sendMessage`, `inputs.ts:45`): `{id: msg_*, session, content:{schema_version:1, parts:[{kind:"text", text:"..."}]}, delivery: "next_turn"(INPUT_DELIVERIES 값은 확인 안 함), attached:[], refs:[]}`.
5. fake script 두 step(protocol `messages`): ① `reply:{toolCalls:[{id:"toolu_1", name:"ticket_create", arguments:'{"app":"<app id>","goal":"...","check":{"kind":"text","text":"..."}}'}], stop:"tool_calls"}` ② `reply:{text:"done", stop:"end"}`. tool 이름은 wire 이름(`toWireToolName`: `.`→`_`)이고 입력은 `ticketCreateInputSchema`(`protocol/coding-agent/ticket/routes.ts:35`): `app`, `goal`, `check`(`kind: app_test | text | test_command`), `evidence?`.
6. 확인: `tickets/list`(`ticketList`) 또는 `tickets/show`(`ticketShow`, `routes.ts`, 읽기는 user 가능), `tool-calls/list`에서 `ticket.create` 성공, `turns/read`가 `completed`. 상태 `open`, goal 일치.
- 막는 것: 지금 열린 이슈 없음. credential operation 이름 이슈는 닫혔고(`CreateTicket`이 상한에 듦) `main/agent-tools_test.ts`가 지킨다. place 폴더 이슈와도 무관(file tool을 안 씀). coding agent도 안 거친다(ticket 생성은 core 안에서 끝).
- 위험 요소: AE session은 `place={kind:"app"}`인데 `placeData`가 앱 source 폴더를 읽는다(`agent-roles/place/place-data.ts`). 앱에 source가 없을 때 동작은 안 읽음(짐작: 빈 scope로 진행).

### 3-(b) agent가 data root 밖 project 폴더에 file을 쓴다

route 순서:
1. 3-0의 1~5.
2. `projects/create`(`projectApi.register`, `protocol/projects/project-api.ts:83`, name `project.create`, user): `{id: prj_*, name: slug, title, purpose, folders:[{...절대 경로 임시 폴더}]}` (folders 모양은 `projectFoldersSchema`, 안 열어 봄).
3. `sessions/open` `{agent:{role:"project_manager", project:<prj id>}}`.
4. `messages/send`.
5. fake script: ① `toolCalls:[{id, name:"file_write", arguments:'{"path":"note.md","content":"hello"}'}]` ② 종료 글. `file.write` 입력은 `z.strictObject({path, content})`, 상대 경로는 place의 첫 폴더 기준(`tools/bundles/file.ts`).
6. 확인: 시험이 임시 폴더에서 `Deno.readTextFile`로 직접 읽는다. `tool-calls/list` 성공. rewind 기록은 `session-rewinds` 읽기 route(선택).
- **막힘: 지금은 실패한다.** `project-docs/issues/place-session.md` "agent runtime process의 Deno 권한에 place 폴더가 없다": `run-loop/runtime.ts` `specFor`가 늘 `placeFolders:{read:[],write:[]}`를 줘서 child의 `--allow-read/--allow-write`에 project 폴더가 없다. `file.write`는 scope 검사는 통과하지만 `Deno.writeFile`이 `NotCapable`이다(이슈 본문: 같은 flag 조합으로 확인, 실제 turn은 안 돌려 봄). 즉 이 flow의 test는 고치기 전에는 빨갛다(이슈가 고쳐졌다는 증거로 쓸 만하다). 또 하나: 같은 이슈 파일의 PM `context.draft` 같은 turn 쓰기 forbidden은 이 flow(project 폴더에 직접 쓰기)와 무관.
- 이 flow는 harness test(in-process, 임시 폴더를 scope로 직접)에서도 같은 tool 코드를 볼 수 있다: **Deno 권한 경계만 core E2E에서만 보인다.**

### 3-(c) 앱 만들기 → release → activation → 앱 호출

**coding agent(PTY)를 거쳐야 한다. lophn agent tool만으로는 안 된다.**
- App Engineer prompt는 "You do not write the app's code"이고(`agent-roles/roles/app-engineer/prompt.md`), release를 준비하는 route `releases/prepare_bundle`·`releases/preparation`(`protocol/apps/releases.ts:209-212`)은 actors가 `coding_agent`, `machine`뿐이다. App Engineer의 tool은 `release.list/get`(읽기), `package.publish`(package registry, 앱 release가 아님)뿐이다(`apps/agent-tools/release.ts`, `package.ts`). file.write·shell.run 도구는 있지만(WORK_TOOLS) 거기서 release를 확정하는 길은 없다.
- 그래서 test가 **coding agent 역할을 직접 맡는다**: coding token은 `call` conversation mode로 coding session을 열 때 `createCodingTokens.issue({session, app})`(`server/identity/coding-token.ts`)가 만들고 `open` 터미널 요청의 `plan.env.LOPHN_CODING_TOKEN`에만 실린다(`apps/tickets/coding/launch.ts` `openSession`, `protocol/coding-agent/terminal-requests.ts`). 그 frame은 shell main(사람 token을 가진 Gateway client 하나)에게만 간다. 화면 없이 하려면 test가 사람 token으로 Gateway WebSocket(`core/events/gateway*.ts`)에 붙어 `coding_terminal` frame을 받아야 한다(짐작: Gateway 프로토콜은 안 읽음).

route 순서(제안, 안 돌려 봄):
1. 3-0의 1~5.
2. `coding_agent_harnesses/report`(`harnessReport`, user, memory): 가짜 harness 감지 결과(`selected_executable`은 임시 가짜 실행 파일). `launchPlanOf`가 실행 파일 절대 경로를 요구한다.
3. `apps/create`(user) → source 연결(`apps/connect_source`, `app.link_source` tool과 같은 route) → App Engineer `sessions/open` + `messages/send`.
4. fake script: App Engineer가 ① `ticket_create`(위 3-a) ② `call`(`calls/send` route를 부르는 tool, 입력은 `call` tool 정의 `tools/bundles/call.ts` 참고, conversation mode로 coding agent 지정) ③ 종료.
5. test가 Gateway에서 `open` frame의 `LOPHN_CODING_TOKEN`을 꺼내 coding_agent 자격 client로: `tickets/claim`(`ticketClaim`) → 앱 source에 `blueprint`·`src/screens/<key>/main.tsx`·handler 작성(파일 쓰기는 test가 직접) → `releases/prepare_bundle`(`releasePrepareBundle`, bytes 업로드는 별도 client가 필요할 수 있음, 짐작) + `releases/preparation`(진행 조회) → `tickets/report_completion`(`ticketReportCompletion`).
6. App Engineer 쪽 두 번째 message로 fake script ④ `ticket_verify`(`ticket.verify` tool, 입력 `{ticket, result, note}`) → core가 `TicketVerified` domain event → Reactor의 activation handler(`architecture/activation.md`).
7. 첫 activation은 선언이 늘어서 보류 request가 생긴다: user가 `approvals/pending`(`approvalsPending`) 읽고 `approvals/decide`(`approvalsDecide`)로 허락. activation 상태는 `activations/queue`(`activationsQueue`), release 기록은 `releases/list_records`(`releasesListRecords`), 앱 process 상태는 `apps/runtime`(`appRuntime`).
8. 앱 호출: `apps/call_api`(`appCallApi`, memory, user 가능, `protocol/apps/calls/call.ts`) → 결과, 이어서 `apps/invocations`(`appInvocations`)로 호출 기록 확인.
- 의존/위험(짐작): release 준비는 `core/apps/releases/ui-build/app-build.ts`가 staging에서 esbuild(`@luca/esbuild-deno-loader`)로 화면을 빌드하므로 template의 `deno.json`/`deno.lock`·npm 패키지 캐시가 필요하다(네트워크/캐시 의존일 수 있음). 앱 process는 공유 app supervisor가 Deno child로 띄운다. 이 flow는 test 중 가장 무겁고 플래키할 가능성이 높다.
- 막는 이슈: 열린 이슈 목록(`project-docs/issues/activation.md`, `coding-agent.md`, `app-call.md`)은 안 읽었다. 이번에 확인한 범위에서 `agent-definition`/`place-session` 이슈는 이 flow를 막지 않는다(file tool을 쓰는 건 coding agent 역할을 맡은 test라서).
- **coding agent를 안 거치는 단축**: 없다(릴리스 준비 actors 제한). "App Engineer가 lophn agent tool로 앱을 끝까지 만든다"는 flow는 제품 설계에 없다. 대신 flow를 두 토막으로 나눌 수 있다: (c1) App Engineer 쪽(ticket.create → ticket.verify, fake model)과 (c2) coding_agent 자격을 직접 쥔 test가 release 준비 → activation → 호출. 후자는 coding token 입수가 막혀서 사실상 Gateway stand-in이 필요하다.

## 4. provider live test: key와 길

### 4-(가) core를 띄워 provider 등록 route로 api_key를 넣는 길
- **지금 끝까지 가는 길이 없다 (secret 이주가 중간).** 확인한 것:
  - 새 저장소: `<data root>/secrets.json`(0600 평문 JSON, `secrets/file-store.ts`). 입력은 upload route `secrets/put`(`secretPut`, `protocol/secrets/secret-file.ts:43`)이고 shell main의 보호 입력 창이 부른다(`packages/shell/main/secret-input/submit.ts`). wiring은 `main/daemon/wiring/secrets.ts`.
  - provider 등록은 아직 옛 길이다. `providers/register`(`registerProvider`)는 `credential.preparation`(옛 OS keychain 보호 입력의 준비 증거)을 요구하고, 새 길용 `providers/connect`(`connectProvider`, `credential:{secret:<이름>}`)는 `protocol/lophn-agent/providers.ts:50`에 정의만 있고 **core에 handler가 없다**(`packages/core` grep 0건; `providers/commands.ts`의 register·disconnect·refresh·record-availability·login뿐). `secrets/input`(옛 보호 입력 upload)·`secret.prepare` pipe도 core에서 handler를 못 찾았다(grep 0건).
  - 런타임 전송은 옛 keychain 쪽이다: `lophn-agent/run-loop/runtime-secret.ts`가 `createSecretAttach({keychain: deps.keychain(), …})`로 `secret_ref.sealed_ref`를 OS keychain에서 읽는다. 새 파일 저장소의 `createFileSecretAttach`(`secrets/file-attach.ts`)는 `wiring/secrets.ts`에서 allowance가 늘 forbidden, destinations가 빈 목록이다("context에 아직 없어 모두 거절").
  - 그래서 api_key provider를 core로 등록해 model을 부르는 길은 막혀 있다(짐작: 이주 도중. 끝까지 따라가 확인하진 않았다).
- 저장 위치만 답하면: (옛) OS keychain = Linux Secret Service를 `secret-tool` 명령으로(`secrets/adapters/product.ts productKeychain()`: linux가 아니면 `unavailableAdapter()`, 파일·환경변수 fallback 없음). core는 `startCore({codingKeychain})`로 주입받는다(이름과 달리 secret store 전체가 이걸 쓴다: `core.ts:62,180`). 주입하지 않는 daemon `main.ts`는 `productKeychain()`을 넘긴다. **keychain은 ledger에 secret 참조가 있을 때만 연다**(`secrets/store.ts` 머리). (새) `secrets.json`은 data root 안(임시 root면 임시).
- 사람의 전역 keychain·`~/.lophn`을 건드리나: `LOPHN_HOME`을 임시 폴더로 주고 provider가 `none`이면 안 건드린다. api_key를 넣으려 하면 옛 길은 사람의 Secret Service에 항목을 만든다(`lophn_ref` 속성). 그래서 (가)는 live test에 쓰지 않는 게 안전하다.

### 4-(나) core 없이 in-process로 진짜 `fetch` + env key
- **된다, 그리고 이게 맞는 길이다.** 필요한 조각은 모두 export되어 있다.
  - 가장 얇게: `createInvokeModelCall({transport, nowMs, at})`(`providers/invoke.ts:167`)에 `transport = createAuthTransport({attach, transport: createFetchTransport(), context: {} as never, use: {sealed_ref, revision, purpose:"provider_credential", destination}, operation:"model.call", headerName:"x-api-key"(anthropic) 또는 "authorization", kind:"api_key"|"bearer"})`(`providers/adapters/auth-transport.ts`).
  - `attach`는 `SecretAttachLike`(`{send(input, transmit)}`): `send: (_input, transmit) => transmit(Deno.env.get("ANTHROPIC_API_KEY")!)` 한 줄이면 된다. `attach`가 목적지 대조 같은 일을 안 하므로 `use`는 모양만 맞추면 된다.
  - 더 제품에 가깝게: `createModelResolver({machine: 가짜(providerRead가 `credential:{kind:"api_key", secret_ref:{name,sealed_ref,revision}, state:"available", ...}` provider 기록을 돌려줌), attach, catalog, fetch: 진짜 fetch})`. 그러면 `option_values`→wire 번역, packer, `max_tokens`까지 제품 그대로 탄다.
  - 요청 body는 `anthropicPacker/responsesPacker/chatPacker`(`models/binding.ts:100/190/282`)가 `PromptRequest{system, tools, messages}`로 만든다.
- **role의 실제 tools payload를 core 없이 만들 수 있다.** 순수 함수 조합: `agentTools({file: FILE_HOOKS})`(`main/agent-tools.ts`, 정의 전부) → `selectTools(builtinToolNames(role), {input_media:["image"]}, defs)`(`tools/registry.ts:67`) → `{name: tool.name, description, input_schema: tool.inputSchema ?? z.toJSONSchema(tool.input)}[]`(`run-loop/prepare.ts`의 `prompt.tools` 만드는 부분과 같다). 정의 file은 store·DB를 import하지 않는다(`tools/spi.ts`). wire 이름은 packer가 `toWireToolName`으로 바꾼다. `main/agent-tools_test.ts`가 같은 조합을 이미 core 없이 부른다. harness-domain 뒤라 `rolePrompt(role)`(`agent-roles/roles/prompts.ts`)도 core 없이 쓸 수 있다(파일 읽기 없음 짐작).
- 환경: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`는 test가 env로 읽는다(권한 `--allow-env=...`, `--allow-net=api.anthropic.com,api.openai.com`). 결과는 `ModelCallOutput{outcome, text, toolCalls, usage}`로 받나·잘렸나(`outcome.kind`)·tool 인자 JSON(`toolCalls[].args` 파싱, judge가 이미 검사)·token(`usage`)을 본다. 대답 내용은 안 본다.

### 4-(다) 실제 model 이름과 reasoning, `MAX_OUTPUT_TOKENS`
- `models/snapshot.json`은 4개: openai `gpt-5`, anthropic `claude-sonnet-4-5`, openrouter `anthropic/claude-sonnet-4-5`, ollama `qwen3:8b`. models.dev 갱신이 안 켜져 있어(5절) 동봉본이 전부다. live test는 이 이름을 그대로 쓰거나 catalog를 직접 만들어 넘기면 된다(resolver를 안 쓰면 catalog도 필요 없다).
- **OpenAI `gpt-5`는 reasoning model이다.** catalog에 `effort` option 축이 있다(`minimal/low/medium/high`, default `medium`, wire=null → `wire.ts responsesEffort`가 `reasoning:{effort:<이름>}`, chat은 `reasoning_effort`). `claude-sonnet-4-5`도 `effort` 축(off/low/medium/high/maximum, default null, `budget` min 1024 max 64000)이다. 값이 `off`가 아니면 `thinking:{type:"enabled", budget_tokens}`가 붙는다(`messagesEffort`). Anthropic 쪽 `max_tokens = min(output_limit, 4096 + budget)`(`resolve.ts anthropicMaxTokens`)이라 thinking 예산을 켜면 답 몫 4096이 보장된다.
- **얽히는 곳 (OpenAI)**: `MAX_OUTPUT_TOKENS = 4096`(`resolve.ts:40`)이 Responses에서는 `max_output_tokens`로 간다(`binding.ts:207`, `Math.min(4096, output_limit)`). OpenAI reasoning model은 reasoning token이 이 상한 안에 들어간다. `gpt-5`를 default `medium`으로 부르면 reasoning이 상한을 먹고 답이 비거나 `status: incomplete`(`max_output_tokens`) → **partial**이 나올 수 있다(짐작: OpenAI 동작에 대한 지식이고 안 돌려 봤다. live test가 확인할 점). live test는 option `effort: "minimal"`로 부르면 잘림 판정만 따로 볼 수 있다. Anthropic은 위 계산이 이미 예산을 더한다.
- **Chat Completions는 `max_tokens`를 보낸다**(`binding.ts:304`, `chat-completions.ts:140`). OpenAI의 reasoning model은 `max_completion_tokens`만 받는 것으로 알고 있어 `gpt-5`+`openai-chat-completions`는 400 `invalid_request`가 날 가능성이 있다(짐작, 안 돌려 봄. compat quirk 표 `compat.ts`는 deepseek·openrouter만). live test에서 protocol별로 확인할 만하다.

## 5. models.dev 끄기

- **지금 제품은 models.dev에 GET을 아예 안 보낸다.** 이유: `main/agent-runtime/main.ts`의 `startAgentRuntime`이 `startCatalogRefresher({dataRoot, …(input.fetch ? {fetch: …} : {})})`(:168-173)로 만들고, `import.meta.main`은 `startAgentRuntime({driver: productDriver(), pump: true})`로 `fetch`를 안 준다. `createCatalogRefresher`(`models/work.ts:102`)의 `runRefresh`는 `if (!input.fetch) return current`(:206, 주석 "테스트 주입이 없으면 network을 만지지 않는다")에서 나간다. `refreshNow()`를 부르는 route·호출자도 없다(`grep refreshNow` = 정의뿐). 따라서 `survey-model.md`가 쓴 "기동 시 실제 GET"은 이 code로는 일어나지 않는다(읽고 판단. 안 돌려 봄).
- **첫 읽힘**: `onHello` 안에서 `ready`를 보낸 직후 `refresher?.kickAutoUpdate()`(:209)가 불린다. 안에서 `load()`로 `<dataRoot>/derived/lophn-agent/catalog-state.json`을 읽고 `refreshDueAt(state, now)`가 `state.auto_update`가 true이고 24시간 지났거나 한 번도 안 확인했으면 `runRefresh`로 간다(`work.ts:274-285,300`). 즉 기동 직후 바로 시도되는 *구조*이지만 위 이유로 network는 안 나간다.
- **`lophn-agent.model.catalog_auto_update` 설정은 아무도 읽지 않는다.** `lophn-agent/register.ts:198-206`에 `declareSetting`(default true)만 있고 소비자가 없다(`grep catalog_auto_update`는 선언 2곳 + renderer fake). 실제 on/off는 `catalog-state.json`의 `auto_update`가 정하고, 그 file이 없으면 snapshot에서 다시 만들면서 `initialState(true, hash)`로 항상 true다(`work.ts:143,171`). 설정 → state 전달 코드가 없다.
- **기동 전에 끌 길**: 설정으로는 안 된다(위). 정확히는 `<data root>/derived/lophn-agent/catalog.json`(entries, source가 user가 아닌 것이 있어야 "정상본"으로 인정)과 `catalog-state.json`(`auto_update:false`, `etag:null`, `last_checked_at`, `last_received_at`, `last_failure`, `snapshot_hash`)을 먼저 써 두면 된다(파일 모양은 `models/model.ts` `parseState`/`initialState`). 그러나 지금 필요 없다. 나중에 fetch를 주입하게 되면 그때 이 seed가 필요하다. env·`startCore` 옵션 중 이걸 끄는 것은 없다. `settings.json` 선결(`<root>/settings.json`)은 다른 설정(turn 한도 등)에는 통하지만 이 설정은 소비자가 없어 효과가 없다.
- E2E에서 바깥 network를 막는 보조: agent runtime child의 `net_any: true`는 web.fetch 때문이다. fake script에 `web_fetch`/`web_search` tool 호출을 안 넣으면 나가지 않는다.

## 6. `tests/` 폴더와 check

### 6-1. `tools/check.ts` test 단계가 고르는 file
- 고르는 규칙(`check.ts:292-302`): `deno test --no-check [--parallel] --allow-all --permit-no-files` + (full이 아니면) **돌 package 폴더의 `packageFiles(folder, /_test\.tsx?$/)`**. package 폴더는 `ALL_PACKAGES = base, protocol, core, coding-agent, design, sdk, shell, tools`의 `FOLDERS`(`packages/<p>`, tools는 `tools`)다. 바뀐 package는 `git diff <merge-base main>` + untracked로 `packageOf(file)`가 정하고 `expand`가 `USES`(= `PACKAGE_DEPENDENCIES` + shell→coding-agent, tools→전부)로 그걸 쓰는 package를 더한다.
- `packageOf("tests/x_test.ts")`는 `undefined`(`packages/`로 시작 안 함, `tools/`도 아님). 그래서 **`tests/`만 바뀌면 어떤 package도 안 돈다.** 새로 만든 `tests/…_test.ts`는 non-full에서 한 번도 안 잡힌다. 더 이상한 점: `run`이 비면 `pkgFolders`가 빈 배열이라 `testArgs`에 file 인자가 하나도 안 붙는다. 그러면 `deno test`가 file 없이 cwd를 뒤져 **저장소 전체 test(tests/ 포함)를 다 돌린다**(짐작: `--permit-no-files`는 "없어도 통과"일 뿐 "없으면 안 돈다"가 아니다. 안 돌려 봄). docs만 바뀐 변경에서도 같은 일이 생긴다.
- `check:full`(`--full`)은 file 인자 없이 `deno test --parallel …`이라 `tests/`의 `*_test.ts`(및 `*.test.ts`, `test.ts`)를 deno 기본 discovery로 전부 잡는다. E2E를 두면 병렬 8개로 같이 돈다(고정 port·경로 금지, `write-test` skill).
- fmt·lint·`deno check`도 non-full은 package 폴더 file 목록만 준다. `tests/`는 full에서만 검사된다.
- 고치려면(`tests/`를 정식 package로): `ALL_PACKAGES`에 `"tests"` 추가, `FOLDERS`(tools처럼 `tests` 특수 처리, `check.ts:29`), `USES.tests = 전부`(`check.ts:35`; `expand`가 `USES[p].some`을 부르므로 없으면 TypeError), `packageOf`에 `file.startsWith("tests/")`. 그러면 core 한 줄 고쳐도 tests/ 전체(E2E 포함)가 돈다. **E2E·live를 default check에서 빼려면** 별도 폴더(`tests/e2e`)를 `ALL_PACKAGES`에 안 올리고 `deno task test:e2e` 같은 task를 따로 두거나, E2E file 이름을 `_test.ts`가 아니게 하는 식이 필요하다(`packageFiles` regex는 `_test.tsx?$`만, deno 기본 discovery는 `.test.ts`, `test.ts`도 잡는다). live test는 `deno test`가 아니라 env gate 또는 별도 명령으로 분리해야 key 없는 `check`가 깨지지 않는다.

### 6-2. 새 최상위 폴더가 deno.json·check-*.ts에 요구하는 것
- `deno.json`: workspace는 `./packages/*`, `./packages/sdk/*`, `./packages/shell/renderer`, `./tools/wireframes`, `./packages/design/wording`. `tests/`는 member로 안 올려도 root config(imports `@std/assert`, `zod`, lock frozen)를 쓴다. `@lophn/*` import가 필요하면 상대 경로(`../packages/…`)로 써도 된다(`check-deps`는 상대 import도 해석). `deno.json` `exclude`에 안 들어 있으니 fmt·lint·test 대상이 된다. 새 npm/jsr 의존성은 `deno.lock` frozen이라 lock을 같이 고쳐야 한다.
- `tools/check-modules.ts`: 폴더 목록 검사의 `expected`는 `tools` + `packages/*` + `packages/core/*` + `packages/shell/*`뿐(`check-modules.ts:~125`). **`tests/`는 catalog에 없어도 통과한다.** 넣고 싶으면 `module-catalog.yaml`에 `path: tests`, `boundary: null`, `notes` 필요(`boundary`가 null이면 notes 필수).
- `tools/check-deps.ts`: package 의존 규칙은 `file.split("/")[1]`이 `packages/<own>`일 때만 건다(`own in PACKAGE_DEPENDENCIES`). `tests/` file은 `own`이 없어 import 방향 제약이 없다. `core-layer` 규칙은 `packages/core/…` 파일 사이만 본다. `numberedName`(v2·phase 등 이름 금지)은 `packages|tools` 경로만 본다. `testing/` 규칙(`testing/`은 `_test.ts`와 같은 폴더만 import)은 폴더 이름이 정확히 `testing`일 때만이라 `tests/support`는 해당 없다.
- `tools/check-source.ts`: `packages|tools` 경로만 본다(주석의 TODO·요구 ID 검사). `tests/`는 안 본다.
- `tools/check.ts`의 `DENO_EXCLUDED`, `ALL_PACKAGES`는 위 6-1.

### 6-3. `tools/fake-provider` → `tests/support/fake-provider/` 옮길 때 고칠 곳
- 옮길 file: `git ls-files tools/fake-provider` 13개, 1,609줄(`main, mod, types, server, script, semantic, stream, queue, match, normalize, oauth, record-gate, record`). 안에서 `./`만 import하고 밖 import는 없다 → 내부 경로 수정은 없다. 옮기기는 `tools/move-files.ts`(mapping JSON, `--dry-run`, 경로 문자열은 보고서로 남김)로 한다.
- 고칠 곳 (`git grep`, tracked 기준):
  - `tools/dev.ts:72` 경로 `${root}/tools/fake-provider/main.ts`(실제 spawn 경로), 주석 `:7`(`tools/fake-provider를 함께…`).
  - `tools/fake-provider/record.ts:2` 실행 예 주석(`deno run … tools/fake-provider/record.ts`)과 `main.ts`/`mod.ts` 머리 주석에 경로가 있으면.
  - `project-docs/context-component-registry.yaml:355-362` (`id: tool-fake-provider`, `path: tools/fake-provider/`, `run: deno run -A tools/fake-provider/main.ts`, change_reasons `boundaries: [models]`).
  - `project-docs/module-catalog.yaml:103` `tools`의 notes "개발 도구(check, wireframes, fake provider)". 옮긴 뒤 문장에서 fake provider를 빼고 `tests`를 따로 둘지 정한다.
  - `AGENTS.md:50` "(개발과 test는 `tools/fake-provider`)".
  - `.claude/skills/write-test/SKILL.md:48` ("fake provider의 script"; 경로가 아니라 말만 있어 바로 깨지진 않지만 `tests/support/`에 대한 설명 추가가 필요할 때 같이).
  - 추적 안 되는 `LEAD-harness-domain.md:38`(참고용. 이번에 건드릴 필요 없음).
  - 이름만 같은 `packages/shell/renderer/.../testdata/fake-providers.ts`는 UI mock이라 무관.
- 부수: dev에서 쓰면 `tools/dev.ts`가 `tests/`를 import하는 의존이 생긴다(spawn만 하고 import는 안 하므로 module graph는 안 얽힌다). `tools/check.ts`의 `USES.tools`는 전부라 영향 없음. `LOPHN_FAKE_PROVIDER_URL` reader가 제품에 없는 점은 그대로(dev에서 fake provider는 떠 있기만 한다, `survey-model.md`).

## 눈에 띈 것 (결정 재료)
1. PM → `ticket.create`는 불가능(role 목록과 core 둘 다). flow (a)는 App Engineer 직접.
2. flow (b)는 지금 `NotCapable`로 빨갛다(place-session 이슈). 같은 tool 코드는 harness test에서는 초록으로 보이니 두 test가 서로 다른 것을 지킨다.
3. flow (c)는 coding_agent 자격(coding token)이 필요해 Gateway stand-in 없이는 못 간다. release 준비는 lophn agent tool로 불가능.
4. provider api_key를 core로 넣는 길은 이주 중이라 끊겨 있다. live test는 in-process(`createInvokeModelCall`/`createModelResolver` + env key)가 유일하게 깨끗한 길.
5. models.dev GET은 제품에서 안 나간다(fetch 미주입). `catalog_auto_update` 설정은 소비자가 없다.
6. `tools/check.ts`: `tests/`는 package가 아니라 non-full에서 안 돈다. 반대로 "돌 package가 없는 변경"은 전체 test를 돈다(짐작). tests/를 넣으려면 `check.ts` 세 곳 수정, E2E·live를 default에서 빼려면 task 분리.
7. fake provider의 `FakeServer.handle`이 이미 `(Request)=>Promise<Response>`라 `mod.ts`에 helper 한 개면 harness에 꽂힌다. SSE는 `content-type: text/event-stream`을 step 헤더에 직접 줘야 하고 builder는 없다.
8. 2-1의 `rate_limit_error`/Responses `server_is_overloaded` 분류는 코드를 읽고 낸 짐작이다. harness case 1순위 후보(temporary가 아닌 쪽으로 가는 것이 의도인지 확인 필요).
