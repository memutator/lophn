# ev-collect

한 trial이 끝난 뒤 session 하나의 ledger를 읽어 `SessionRecord`를 만들고, 공통 수치(`Metrics`)를 계산한다. tool 정확도 넷, 분모에서 뺄 `not_executed`, 잘림, 되풀이를 포함한다.

- 단위: ev (wave 2)
- 선행: ev-contracts
- 소유(이 task만 고친다):
  - `tests/eval/collect.ts`
  - `tests/eval/metrics.ts`
- 읽을 것:
  - 계획: `project-docs/products/roadmap/eval.md`의 "공통 수치"(tool 정확도의 넷, 한계), `project-docs/plan/eval-base/README.md`
  - 조사: `project-docs/plan/eval-base/research/coding-agent-eval.md` 4절(4.1 model call, 4.2 turn 시간, 4.3 tool call과 code 표), `roles-and-outcomes.md` 0절(읽는 route 표 R-tools, R-args, R-call, R-callid, R-text)와 7절 1·2번(list-calls route 없음, send 때 실패한 call은 agent_calls 행이 없다)
  - protocol(칸 이름의 정본): `packages/protocol/lophn-agent/{tool-calls,tool-values,model-calls,model-call-values,turn-reads,turn-values,calls,messages,sessions,places}.ts`, `packages/protocol/apps/mod.ts`의 `appList`, `packages/protocol/projects/mod.ts`의 `projectList`
  - 본보기: `tests/e2e/agent-call_test.ts:143-178`(`callOf`, `callRecord`), `tests/e2e/session_test.ts:129`, `tests/e2e/registration_test.ts`(messageBody)
  - 계약: `tests/eval/types.ts`(`SessionRecord`, `Metrics`, `ToolCallRecord`, `CallRecord`, `AskRecord`, `ModelCallRecord`, `EXCLUDED_NOT_EXECUTED`, `OUTPUT_TOOLS`)
- 계약:
  - 쓰는 것: `tests/eval/types.ts`, `tests/support/core/mod.ts`의 `Core`
  - 내놓는 것:
    - `collectSession(core: Core, args: { target: Target; session: string; ids: WorldIds }): Promise<SessionRecord>`
    - `readNames(core: Core): Promise<RunRecord["names"]>`(`appList`, `projectList`로 id → name. run 중 생긴 앱 포함)
    - `metricsOf(parts: { turns; tool_calls; calls; model_calls }): Metrics`와 `sumMetrics(list: Metrics[]): Metrics`, `meanMetrics(list: Metrics[]): Metrics`(순수 함수. checks와 scorecard가 쓴다)

## 할 일

1. `collectSession`: 아래를 읽어 `SessionRecord`를 채운다. 모두 사람 자격(`core.call`)의 읽기다.
   - turn: `turnList({session})`(`turnsOf`와 같이 시작 순서).
   - tool call: `toolCallList({session})`를 cursor로 끝까지(limit 100). `order`는 (turn 시작 순서, `response_order`) 순으로 0부터 매긴다. `input`은 `turnBodyView({kind:"tool_call_input", id})`로 읽고, 못 읽으면(64 KiB 상한 `truncated`, `not_found`) null로 둔다. `OUTPUT_TOOLS`(`call`, `app.create`)만 `tool_call_output`을 읽어 `output`에 담는다. `decision`은 record의 `decision.decision`이다.
   - call: tool이 `call`인 것마다 `CallRecord`를 만든다. `asked`는 입력, `result`는 출력의 `content`(`{call, state, fail_reason}`), `record`는 `result.call`이 있으면 `callRead`로 읽는다. 받는 쪽은 `to.kind`가 `new_session`/`open_session_or_new`면 `agent`, `open_session`이면 `agentSessionRead({session})`의 agent를 쓰고, 앱·project는 `readNames`로 이름으로 바꾼다(모르면 id). send 때 실패한 call(`not_found`, `not_allowed`)은 행이 없어 `record: null`이고 `result.fail_reason`만 있다.
   - ask: tool이 `ask`인 것마다 입력의 `questions`에서 `question`, `header`, option label들, `multiSelect`를 담는다. 질문 본문 route인 `askRead`는 turn이 끝나면 풀리므로 쓰지 않는다.
   - message: `messagesList({session})`와 `messageBody`로 사람과 agent의 글을 담는다(분류가 안 되는 종류는 건너뛴다).
   - model call: `modelCallList({session})`를 끝까지. `usage`와 `cost.amount`(decimal 문자열 → number)는 아래 규칙으로 옮긴다.
2. `metricsOf`/`sumMetrics`/`meanMetrics`:
   - **token**: 칸마다 null이 아닌 값을 더하고, 하나라도 null인 호출 수를 `unknown_calls`로 센다. 어댑터가 이미 정규화한 값이라 다시 맞추지 않는다. `usage.input`은 OpenAI 쪽 어댑터(`providers/adapters/responses.ts`, `chat-completions.ts`)가 cached를 이미 뺀 새 입력이고, Anthropic은 원래 cache 제외다. `reasoning`은 `reasoning_in_output`이 true라 `output`에 들어 있다. 그러므로 output과 reasoning을 더하지 않는다. 이 사실은 `cache_in_input`을 보고 다시 빼면 이중으로 빼는 것이라는 뜻이다(roadmap "공통 수치"의 token 줄과 다르다. 코드가 맞다).
   - **비용**: `cost.kind`가 `reported`나 `estimated`인 호출의 `amount`를 더한다. 그 밖(`unknown` 등)은 `unknown_calls`로 센다. currency가 섞이면 첫 값을 쓰고 섞였다고 `currency: null`로 둔다.
   - **시간**: turn은 `finished_at - started_at`(ms)의 합, model은 `duration_ms`의 합, tool은 `duration_ms`의 합.
   - **tool 정확도**(roadmap "공통 수치"):
     - 분모 `total - excluded`. `excluded`는 `outcome.kind === "not_executed"`이고 code가 `EXCLUDED_NOT_EXECUTED`에 드는 것의 수.
     - `format_errors`: `outcome.kind === "failure"`이고 code가 `invalid_input`이나 `not_found`.
     - `success`: `outcome.kind === "success"`.
     - `blocked`: `decision`이 `ask`나 `deny`(사람이 거절한 `rejected`, 취소된 `cancelled`는 물었던 call이라 여기 든다).
     - `repeats`: `(tool, input_hash)`가 같은 call들에서 첫 call을 뺀 수의 합. `repeated_tool_failure`: 어느 turn의 `outcome.reason`이 `repeated_tool_failure`.
     - 한계(고치지 않는다): 저장된 outcome에는 실행 여부 칸이 없어 schema가 거절한 `invalid_input`과 handler가 낸 `invalid_input`을 가르지 못한다. 보고에 "정한 것"으로 한 줄 남긴다.
   - **잘림**: `outcome.kind === "partial"`인 model call 수. `agent_calls`: tool `call`의 수. `model_calls`: 수.
   - `sumMetrics`는 숫자를 더하고 boolean은 or. `meanMetrics`는 숫자를 trial 수로 나눈다(`repeated_tool_failure`는 true인 trial 수).
3. 진짜 ledger로 확인한다(진짜 provider 없이): scratch script(`.dev-data/ev-collect/check.ts`, commit하지 않는다)에서 `bootCore` + `connectFakeProvider` + fake가 `call`(lophn → project PM, reply `result`), `ask`, 없는 tool 이름, 잘못된 입력의 tool을 차례로 부르게 대본을 짜서 한 turn을 돌린 뒤 `collectSession`을 부른다. `calls[0].record.to`가 PM이고, `asks`에 질문이 있고, 형식 오류가 센 값과 맞는지 눈으로 본다. `ask`는 사람 답을 기다리므로 마지막에 두고 `stopTurn`으로 끊는다(끊긴 call은 `not_executed`/`stopped`로 분모에서 빠져야 한다). 참고: `tests/e2e/agent-call_test.ts`의 `callStep`, `tests/e2e/approval_test.ts`의 ask 대본.
4. 순수 함수 `metricsOf`는 손으로 만든 입력 몇 개로 `deno eval` 등으로 한 번 확인해도 된다. test file은 만들지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. `tests/eval`은 check의 test discovery에 들지 않고, 이 계산이 틀려도 사용자 데이터는 상하지 않는다. 확인은 위 3번의 진짜 ledger 한 번이다.
- 남지 않음: scratch script를 commit하지 않았다. `/tmp/lophn-e2e-*`와 core process가 남지 않았다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 정한 것: 못 읽는 body를 다룬 방식, message 분류, currency가 섞일 때
- 계약 바꾸기 요청: `types.ts`의 칸을 바꿔야 하면 여기 적는다
- **무겁게 짠 것**: 없음이면 "없음"
- **알려진 미완 동작**: schema 거절과 handler `invalid_input`을 가르지 못하는 한계, `agentUsageRead`는 쓰지 않았다는 것(호출마다 더한다)
