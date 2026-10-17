# harness-wire

녹화 재생 `fetch`와 손으로 만든 SSE fixture로 세 protocol의 adapter 판정과 HTTP 오류 분류를 table test로 본다. 의심 A·B(오류 분류)를 정한 동작으로 고친다.

- 단위: harness-wire (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/support/wire/`
  - `tests/harness/wire/`
  - `tests/fixtures/provider/`
  - `packages/core/lophn-agent/providers/failures.ts`
- 읽을 것:
  - `project-docs/products/roadmap/testing.md`("fake 셋"의 녹화 재생, "harness wire")
  - `project-docs/plan/testing/research/survey-cases.md` 2-1절(adapter 판정 표, HTTP 분류 표, invoke가 outcome을 만드는 규칙). 2-3절과 provider 등록 길은 옛 것이라 쓰지 않는다.
  - `project-docs/plan/testing/research/research-sdk.md`(Vercel AI SDK의 "녹화는 응답만, 사람이 commit")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `models`(provider 연결과 실패 분류가 여기 든다), `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`
  - `packages/core/lophn-agent/models/resolve.ts`(`createModelResolver`), `models/binding.ts`(`ModelBinding`), `providers/invoke.ts`(`createInvokeModelCall`), `providers/failures.ts`, `providers/adapters/{messages,responses,chat-completions,stream,transport}.ts`, `providers/work.ts`(`ModelCallInput`·`ModelCallOutput`)
  - `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: `createModelResolver({machine, catalog, fetch})`가 낸 `ModelBinding`(`call`, `endpoint`, `pack`, `invoke`, `usageRevision`, `timeoutMs`). `machine`은 `CoreCall`(`run-loop/core-call.ts`)이고 `providers/read`(`providerRead`) 하나만 답하면 된다. catalog는 `models/snapshot-catalog.ts`의 snapshot 항목(`anthropic/claude-sonnet-4-5`, `openai/gpt-5`)을 쓴다. `providerRead` 응답은 `providerRecordSchema`(`protocol/lophn-agent/provider-values.ts`)를 통과해야 한다: 정의는 내장 정의와 대조하지 않으므로 `auth_kinds:["none"]`, `credential.kind:"none"`, `secret_ref:null`, loopback endpoint(`http://127.0.0.1:1`)로 직접 만든다.
  - 내놓는 것(`harness-wire-idle`, `e2e-support-shape`가 쓴다):
    - `tests/support/wire/`의 `loadFixture(name): Fixture`(`name`은 `anthropic/text-end_turn` 꼴), `replayFetch(...cases): {fetch, requests}`(`cases`는 `Fixture` 또는 인라인 `{status, headers, body, disconnect?}`; `fetch`는 `init.signal`이 abort되면 pending이거나 읽는 중인 stream을 `AbortError`로 끝낸다; `requests`는 받은 `{url, method, headers, body(JSON)}` 기록), `wireBinding(protocol, fetch): Promise<ModelBinding>`, `callWire(binding, {tools?, user?}): Promise<ModelCallOutput>`(`binding.pack`으로 요청을 만들고 `ModelCallInput`을 채워 `binding.invoke`를 부른다).
    - fixture 저장 꼴(live-suite가 같은 꼴로 저장한다): `tests/fixtures/provider/<provider>/<case>.sse`(SSE 본문 그대로) 또는 `<case>.json`(JSON 본문 그대로), 선택 `<case>.meta.json` = `{status?, headers?, disconnect?: "error"}`. meta가 없으면 `.sse`는 200 + `content-type: text/event-stream`, `.json`은 200 + `application/json`. `disconnect:"error"`는 본문을 다 준 뒤 stream이 오류로 끝난다. 요청은 저장하지 않는다.

## 지켜야 할 것(계획 공통)

- `~/.lophn`, OS keychain, 사람의 전역 harness 설정을 건드리지 않는다. E2E data root는 `.dev-data/e2e/<run>/home`뿐이다.
- 진짜 model provider는 `deno task test:live`에서만, 사람이 key를 줄 때만 부른다. worker와 lead는 live를 돌리지 않는다(key 없는 실행으로 gate만 확인한다).
- 전역 mutable 상태를 두지 않는다. 고정 port와 고정 path를 쓰지 않는다. 병렬로 돌아야 한다. sanitizer를 끄지 않는다. sleep으로 기다리지 않는다(gate, 가짜 clock, 신호).
- `tests/support`에는 띄우기와 연결만 둔다. flow의 단계는 test file에 그대로 쓴다. 공통 불변식은 함수 하나로 둔다.
- case 하나는 단계 6, fake 대답 3, 단정 3 이하다. 화면 문구는 단정하지 않는다.
- 의심 A~D를 고칠 때는 먼저 그 행이 고치기 전 코드에서 실패하는 것을 확인하고 보고에 적는다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다.

## 정한 것

- 의심 A: Anthropic stream의 `rate_limit_error` frame(header 없음, reset을 모름)은 `temporary`다(`retry_at` 없음, 대기는 loop 기본 2초·4초). 지금은 429처럼 `credential_unavailable`(1시간 대기)이 된다. 단 message에 `retry after N`이 있고 N이 30초를 넘으면 `credential_unavailable`로 그대로 둔다(reset을 아는 긴 대기). HTTP 429는 그대로다(header가 있다). README "정한 것" 4.
- 의심 B: `server_is_overloaded`·`rate_limit_exceeded`·`slow_down` code(`failures.ts`의 `RATE_CODES`)는 status가 429가 아니면 `temporary`다. 지금은 Responses `response.failed`의 `server_is_overloaded`가 status 0이라 `unknown`이 되어 retry하지 않는다. `RATE_CODES` 위 주석("429가 아니면 temporary")의 뜻 그대로다. 429에서는 지금처럼 reset 근거(header·문구)로 갈린다.
- 변경은 `providers/failures.ts` 안에서 끝낸다. 구체: `fromStructuredCode`의 `RATE_CODES` 분기가 429가 아니면 `temporary`를 돌려주고, `rateVerdict`는 입력이 stream 오류(`kind: "stream_error"`)이고 reset이 null이면 `temporary`를 돌려준다.
- HTTP 4xx/5xx 행은 fixture file이 아니라 table의 인라인 case로 둔다(행마다 file 둘을 만들면 `fixtures/`가 table보다 커진다). roadmap의 "손 fixture(…4xx/5xx…)"와 다르다. SSE 모양이 필요한 행만 file이다.
- OpenAI 두 protocol의 fixture는 `openai/` 아래 `responses-…`, `chat-…` 이름으로 둔다(live-suite가 provider별로 저장한다).

## 할 일

1. `tests/support/wire/`를 위 "내놓는 것" 모양으로 만든다. `wireBinding`은 protocol 셋에 맞는 provider 기록(정의의 `protocols`, `endpoint`)과 catalog 항목을 골라 `createModelResolver`에 `fetch`를 꽂는다. 시계는 `manualClock`(`packages/base/clock.ts`)을 `nowMs`로 준다.
2. fixture를 손으로 만든다(`tests/fixtures/provider/`). 각 file은 실제 adapter parser가 읽는 event 이름을 쓴다(`messages.ts`·`responses.ts`·`chat-completions.ts`의 `applyFrames`가 보는 것). 이름 목록(다른 task가 이 이름으로 읽는다. 바꾸면 보고에 적는다):
   - `anthropic/`: `text-end_turn`, `tool-use`, `max-tokens`, `cut-no-stop`, `tool-args-cut`, `tool-args-not-json`, `refusal`, `error-overloaded`, `error-rate-limit`, `error-authentication`
   - `openai/`: `responses-text`, `responses-tool`, `responses-incomplete-max-output`, `responses-incomplete-content-filter`, `responses-cut`, `responses-tool-args-not-json`, `responses-failed-overloaded`, `responses-failed-invalid-prompt`, `chat-text`, `chat-tool`, `chat-length`, `chat-content-filter`, `chat-cut`, `chat-tool-args-not-json`
   - `text-*`·`tool-*` fixture에는 usage(token 수) event를 넣는다.
3. 판정 table `tests/harness/wire/judge_test.ts`: 준비(`wireBinding` 셋)는 file당 한 번, 한 줄씩 돈다. 단정은 `callWire`의 `outcome`·`text`·`toolCalls`·`usage`와 `replayFetch.requests`다(행당 3 이하).

| fixture | 기대 `outcome` | 그 밖의 바깥 결과 |
|---|---|---|
| anthropic/text-end_turn | complete | `text` 비어 있지 않다. `usage.input`·`output`이 숫자 |
| anthropic/tool-use | complete | `toolCalls` 1개, `args`가 JSON object |
| anthropic/max-tokens | partial(`finish_reason` max_tokens) | `toolCalls` 비어 있다 |
| anthropic/cut-no-stop | partial | `text`는 받은 만큼 |
| anthropic/tool-args-cut | partial | `toolCalls` 비어 있다(미완 인자의 tool은 안 나온다) |
| anthropic/tool-args-not-json | partial | `toolCalls` 비어 있다 |
| anthropic/refusal | failed, code `refused` | `toolCalls` 비어 있다 |
| anthropic/error-overloaded | failed, code `temporary` | `retry_at` null |
| anthropic/error-rate-limit | failed, code `temporary`(**의심 A**) | `retry_at` null. 고치기 전 `credential_unavailable` |
| anthropic/error-authentication | failed, code `credential_unavailable` | |
| openai/responses-text, responses-tool | complete | tool은 1개, JSON object |
| openai/responses-incomplete-max-output | partial | `toolCalls` 비어 있다 |
| openai/responses-incomplete-content-filter | failed, code `refused` | |
| openai/responses-cut, responses-tool-args-not-json | partial | `toolCalls` 비어 있다 |
| openai/responses-failed-overloaded | failed, code `temporary`(**의심 B**) | 고치기 전 `unknown` |
| openai/responses-failed-invalid-prompt | failed, code `invalid_request` | |
| openai/chat-text, chat-tool | complete | tool은 1개, JSON object |
| openai/chat-length | partial | |
| openai/chat-content-filter | failed, code `refused` | |
| openai/chat-cut, chat-tool-args-not-json | partial | `toolCalls` 비어 있다 |

   추가로 요청 모양 한 행씩(protocol마다): `requests[0]`의 path(`/messages`, `/responses`, `/chat/completions`), 본문 `stream === true`, 인증 header 없음(`auth_kind: none`).
4. HTTP table `tests/harness/wire/http_test.ts`: 인라인 case(`{status, headers, body}`)를 anthropic wire로 한 번에 돈다(분류는 protocol과 무관하다). 단정은 `outcome`(`kind`, `code`, `retry_at`, `http_status`)이다. `retry_at`은 `manualClock` 시각 기준으로 계산한다.

| 응답 | 기대 |
|---|---|
| 401, 403 | failed `credential_unavailable` |
| 403 + code `plan_access` | `credential_unavailable` (plan_access는 verdict 쪽 필드라 outcome에는 code만 본다) |
| 402 | `credential_unavailable` |
| 429 + `retry-after: 20` | `temporary`, `retry_at` = 지금 + 20초 |
| 429 + `retry-after: 90` | `credential_unavailable` |
| 429, header 없음 | `credential_unavailable` |
| 500, 502, 503, 529 | `temporary`, `retry_at` null |
| 504, 408 | `unknown` |
| 302(`location` header 있음, 본문 없음) | `unknown` (redirect를 따라가지 않았다: `replayFetch.requests`가 1개) |
| 400 `invalid_request_error`(overflow 문구 없음) | `invalid_request` |
| 413 + 본문에 context 초과 문구 | `context_exceeded` |
| 400 + code `context_length_exceeded` | `context_exceeded` |
| 404 + `not_found_error` + message에 model | `model_unavailable` |
| 404, 다른 자원 | `unknown` |

5. 먼저 A·B 행을 `failures.ts` 변경 전 코드에서 돌려 **실패하는 것을 확인**하고(두 행의 실제 값과 기대 값) 보고에 적는다. 그 다음 `failures.ts`를 "정한 것"대로 고쳐 초록으로 만든다. 다른 행이 바뀌면 그 행이 틀린 것인지 먼저 확인한다(코드를 table에 맞추지 않는다).
6. test 머리 주석에 세 질문의 답을 한 줄씩 남긴다.

## 세 질문

- contract: boundary ID `models`(adapter가 낸 판정이 loop에 닿는 `ModelOutcome`, 실패 분류 `PROVIDER_FAILURES`).
- 현실적 회귀: provider 응답 형식이 바뀌어 complete를 partial로 보거나 잘린 tool 인자를 실행 대상으로 내는 수정, 오류 분류 표를 손봐 retry할 것이 안 되고 안 할 것이 되는 수정(A·B가 지금 그 모양이다).
- 왜 지금 test로 못 잡나: `providers/`에는 `commands_test.ts`·`secret-refs_test.ts`뿐이고 adapter와 `failures.ts`에는 test가 없다.

## 끝남

- `deno task check`가 통과한다.
- `deno fmt --check tests`, `deno lint tests`, `deno check <내가 만든 tests/ file>`이 통과한다(이 worktree에 test-tasks가 아직 없으면 fast check는 `tests/`를 보지 않는다. 그래서 직접 돌린다).
- `deno test --no-check --allow-all tests/harness/wire`가 통과하고 5초 안에 끝난다.
- 의심 A·B: 두 행이 변경 전 코드에서 실패하는 것을 확인했고(보고에 적는다) 변경 뒤 통과한다.
- 위험 test: "잘린 응답과 틀린 tool 인자는 실행 대상이 아니고, 오류는 retry할 것과 안 할 것으로 맞게 갈린다"
- 남지 않음: `grep -rn "tools/fake-provider" tests`가 0줄이다(clean room: 옛 fake의 file을 열지 않는다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(없으면 "없음")
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

