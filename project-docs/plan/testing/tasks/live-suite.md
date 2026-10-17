# live-suite

진짜 Anthropic·OpenAI를 부르는 provider live 시험을 `tests/live/`에 만든다: 공용 suite 하나와 provider별 얇은 file, 요청 셋(글 답, 실제 role tool 묶음으로 tool call, 이미지, OpenAI는 reasoning 잘림 한 행), 단정 넷, gate(task + env key), 호출당 timeout과 호출 수 상한, 응답을 `tests/fixtures/provider/`에 저장하는 option. **worker와 lead는 live를 돌리지 않는다.**

- 단위: live-suite (wave 2)
- 선행: harness-wire
- 소유(이 task만 고친다):
  - `tests/live/`
- 읽을 것:
  - `project-docs/products/roadmap/testing.md`("provider live", "정할 것" 7)
  - `project-docs/plan/testing/README.md`의 "정한 것" 7, 9
  - `project-docs/plan/testing/research/survey-cases.md` 4-(나)(core 없이 in-process로 진짜 `fetch` + key를 꽂는 길), 4-(다)(reasoning 한도). 4-(가)와 5절은 옛 것이라 쓰지 않는다.
  - `project-docs/plan/testing/research/research-sdk.md`(공식 SDK의 live, 녹화는 응답만), `research-hermes.md`(live canary와 비용 상한)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `models`, `agent-tools`(tool 묶음), `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`
  - 코드: `packages/core/lophn-agent/models/resolve.ts`(`createModelResolver`, `MAX_OUTPUT_TOKENS` 4096), `models/snapshot-catalog.ts`, `models/snapshot.json`, `providers/adapters/auth-transport.ts`(`SecretAttachLike`), `providers/definitions.ts`(`builtinProviderDefinition`), `packages/core/main/agent-tools.ts`(`agentTools`), `packages/core/agent-roles/tool-lists.ts`(`builtinToolNames`), `packages/core/lophn-agent/tools/registry.ts`(`selectTools`), `packages/core/agent-roles/hooks.ts`(`FILE_HOOKS`)
  - 앞 task가 만든 `tests/support/wire/`(`wireBinding`, `callWire`와 fixture 저장 꼴) — 같은 꼴을 쓴다
- 계약:
  - 쓰는 것: `createModelResolver({machine, attach, catalog, fetch})`, `ModelBinding.invoke`, `ModelCallOutput`(`outcome`, `text`, `toolCalls`, `usage`), `tests/support/wire/`의 fixture 저장 꼴(`<provider>/<case>.sse|.json` + 선택 `<case>.meta.json`).
  - 내놓는 것: `tests/live/run.ts`(`deno task test:live`의 진입. 이름은 `test-tasks`가 `deno.json`에 이미 적었다), `tests/live/suite.ts`(공용), `tests/live/anthropic_test.ts`, `tests/live/openai_test.ts`.

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

- model(README "정한 것" 7의 규칙 "tool과 이미지를 받는 가장 싼 model"을 `models/snapshot.json`에서 읽어 정했다. worker는 일할 때 snapshot을 다시 읽어 지금 값으로 확인한다):
  - Anthropic: `claude-haiku-5-5`(입력 $0.1 / 출력 $0.5 per 1M, tool·image 지원).
  - OpenAI 공용 행(글, tool, 이미지): `gpt-4.1-nano`(0.1 / 0.4, reasoning 없음, tool·image 지원). 이유: snapshot에서 가장 싼 `gpt-5-nano`(0.05 / 0.4)는 reasoning model이라 `MAX_OUTPUT_TOKENS` 4096 안에 reasoning이 들어 공용 행이 잘림으로 실패할 수 있다. 공용 행이 잘림 확인과 섞이지 않게 비 reasoning 중 가장 싼 것을 쓴다.
  - OpenAI 잘림 행만 reasoning model `gpt-5-nano`를 쓴다(reasoning model 중 가장 싸다). 사람이 다른 model을 원하면 `tests/live/openai_test.ts`의 상수 두 줄만 바꾼다.
- protocol은 Anthropic은 `anthropic-messages`, OpenAI는 `openai-responses`다(chat completions는 이번 live 범위 밖).
- 한 번 실행의 호출은 10번 이하: Anthropic 3(글, tool, 이미지) + OpenAI 4(글, tool, 이미지, 잘림) = 7. 호출당 timeout 90초(`AbortSignal.timeout(90_000)`을 호출의 signal로 준다). 상한은 공용 `fetch` 감싸개가 센다(11번째 호출은 보내지 않고 실패).
- gate: `deno task test:live`는 `tests/live/run.ts`를 돈다. run.ts는 `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` env를 본다. 둘 다 없으면 "키가 없어 live를 돌리지 않는다(필요한 env 이름 둘)"를 찍고 0으로 끝난다. 있으면 key가 있는 provider의 file만 `deno test --allow-all --no-check tests/live/<provider>_test.ts`로 돈다(run.ts가 subprocess를 띄우는 것은 task 진입이지 test가 아니다). test file 자체는 key가 없으면 **실패**한다(skip으로 통과하지 않는다). cron은 쓰지 않는다.
- 단정 넷(대답의 내용은 보지 않는다): (1) HTTP 2xx (`outcome.http_status`), (2) 잘림 판정(`outcome.kind`가 complete, partial이면 실패), (3) tool 행이면 `toolCalls[0].args`가 JSON object이고 tool 이름이 요청한 것, (4) `usage`에 input·output token 수가 숫자로 있다. 행마다 이 중 해당하는 것만 단다(3은 tool 행만).
- tool 행은 core 없이 만든 실제 role 묶음을 보낸다: `selectTools(builtinToolNames("project_manager"), {input_media:["text","image"]}, agentTools({file: FILE_HOOKS}))`의 정의를 `{name, description, input_schema}`(`inputJsonSchema`)로 바꿔 prompt에 싣고, 사용자 글은 "file.read로 README.md를 읽어 줘" 한 줄이다. 이미지 행은 test 안에 만든 작은 PNG(1x1)를 base64로 실어 "이 이미지를 설명해 줘" 한 줄을 보낸다.
- 키는 env에서 읽어 `attach.send(_input, transmit) => transmit(key)` 한 줄로 꽂는다. 제품의 `secrets.json`·core·`~/.lophn`은 쓰지 않는다. 키를 console에 찍지 않는다.
- 기록 option: env `LOPHN_LIVE_RECORD=1`이면 호출마다 받은 **응답만**(status, `content-type`, 본문) `tests/fixtures/provider/<provider>/<case>.sse|json` + `.meta.json`으로 쓴다(harness-wire와 같은 꼴). 요청은 저장하지 않는다. 쓰기 전에 본문에서 key와 `x-request-id`·`request_id`·organization id 같은 계정 식별 값을 지운다. 파일은 diff 확인 뒤 사람이 commit한다. case 이름은 `live-<행>`이다(`live-text`, `live-tool`, `live-image`, `live-truncation`). 손 fixture와 이름이 겹치지 않는다.
- 잘림 행은 결과를 보는 행이다. `outcome.kind`가 partial이면 이 행이 **실패**하고 그 실패가 발견이다(제품 한도 `MAX_OUTPUT_TOKENS` 4096과 reasoning의 관계, README "정한 것" 6 뒤쪽). 고치지 말고 보고한다.

## 할 일

1. `tests/live/suite.ts`: provider 설정 `{provider, protocol, endpoint, model, keyEnv, truncationModel?}`을 받아 위 요청 셋과 단정을 `Deno.test` 여러 개로 등록한다. 요청은 `createModelResolver`로 만든 `ModelBinding`의 `pack`/`invoke`로 보낸다(제품 번역·option 그대로). catalog는 `snapshot-catalog.ts`의 항목을 쓴다. 근거: roadmap "provider live".
2. `tests/live/anthropic_test.ts`, `tests/live/openai_test.ts`: 위 상수와 `suite.ts` 호출만 둔다(각 20줄 안팎).
3. `tests/live/run.ts`: gate와 subprocess 진입.
4. 호출 감싸개 `tests/live/budget.ts`: `fetch`를 감싸 호출 수를 세고 10 초과를 막으며 기록 option을 처리한다.
5. 점검(실제 provider를 안 부른다): (a) key env 없이 `deno task test:live`가 이유를 찍고 0으로 끝난다. (b) `ANTHROPIC_API_KEY=dummy deno test --allow-all --no-check tests/live/anthropic_test.ts`는 네트워크를 막은 환경이 아니면 진짜 호출이 나가므로 **돌리지 않는다.** 대신 임시 스크립트(commit하지 않음)에서 `suite.ts`의 요청·단정 코드를 harness-wire의 `replayFetch`와 손 fixture(`anthropic/text-end_turn` 등)에 꽂아 단정과 기록 꼴이 맞는 것을 확인한다. (c) `deno check tests/live/*.ts`.
6. test 머리 주석에 세 질문의 답을 한 줄씩 남긴다.

## 세 질문

- contract: boundary ID `models`(provider가 받나·잘리나·tool 인자가 JSON인가·token 수), `agent-tools`(실제 role tool 묶음을 보낸다).
- 현실적 회귀: provider API가 바뀌어(필드, 한도, stream 모양) fixture로는 통과하는데 진짜 응답을 못 읽는 것, 실제 tool 묶음이 커져 출력 한도에서 잘리는 것(OpenAI reasoning), 이미지 입력 모양이 거절되는 것.
- 왜 지금 test로 못 잡나: harness wire는 손으로 만든 응답만 본다. 진짜 응답과 진짜 한도는 provider를 불러야만 안다. 그래서 사람이 key를 줄 때만 돌고 그 응답이 fixture가 된다.

## 끝남

- `deno task check`가 통과한다.
- `deno fmt --check tests`, `deno lint tests`, `deno check <내가 만든 tests/ file>`이 통과한다(이 worktree에 test-tasks가 아직 없으면 fast check는 `tests/`를 보지 않는다. 그래서 직접 돌린다).
- key env 없이 `deno task test:live`가 이유를 찍고 exit 0이다. key가 있어도 worker는 돌리지 않았다(보고에 적는다).
- 위험 test: 없음(live는 위험 규칙을 지키는 test가 아니라 사람이 돌리는 점검이다)
- 남지 않음: `grep -rn "ANTHROPIC_API_KEY\|OPENAI_API_KEY" tests packages tools`에서 값을 찍거나 저장하는 줄이 없다(이름만 `tests/live`에 있다).

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

