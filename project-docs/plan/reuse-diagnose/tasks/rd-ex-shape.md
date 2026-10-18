# rd-ex-shape

ticket의 acceptance check `test_command`를 App Engineer가 쓰는 app-api 예시 `examples`로 바꾼다: check의 모양, 검증 종류, `ticket.verify`의 관문. `test_command`는 protocol과 core 어디에도 남기지 않는다. 예시를 실제로 돌리는 길은 뒤 task들(`rd-ex-driver`, `rd-ex-request`, `rd-ex-trigger`)이 한다.

- 단위: rd-ex (wave 1)
- 선행: 없음. 다만 계획 `prompt-text`의 `pt-reproduction-remove`가 먼저 land해 있다(계획 시작 조건). 그 task가 `packages/protocol/problems/tests.ts`, `app-test-lookup.ts`, `packages/core/problems/tests/{commands,model,build,reads}.ts`에서 `reproduction`과 연결 칸(`problem`, `basis_seq`, `reports`, `before`, `after`), `symptom`, `ticket_source`를 지웠다. 이 brief의 줄 번호와 `TEST_KINDS` 모양은 그 뒤 file 기준이다: `TEST_KINDS`는 지금 `["app_test", "test_command"]`이고 `validConnections`의 남는 조건은 `value.kind === "test_command" || value.ticket === null`이다. 먼저 file을 읽고 시작한다.
- 소유(이 task만 고친다):
  - `packages/protocol/coding-agent/ticket/values.ts`
  - `packages/protocol/problems/tests.ts`
  - `packages/protocol/problems/app-test-lookup.ts`
  - `packages/core/apps/tickets/checks.ts`
  - `packages/core/apps/tickets/checker/result.ts`
  - `packages/core/apps/tickets/checker/work.ts`
  - `packages/core/apps/tickets/commands.ts`
  - `packages/core/apps/tickets/tickets_test.ts`
  - `packages/core/apps/agent-tools/ticket.ts`
  - `packages/core/apps/packages/publish.ts`
  - `packages/core/problems/tests/schema.ts`
  - `packages/core/problems/tests/judge.ts`
- 읽을 것:
  - issue: `project-docs/issues/coding-agent.md`의 "ticket의 `test_command` check를 runner가 돌리지 않는다"(정한 것: coding agent가 쓴 test를 돌리지 않는다. App Engineer가 app-api 입력과 기대 결과의 예시를 ticket에 적고, program이 준비된 release에 불러 비교해 맞아야 통과한다. `test_command`는 지운다)
  - architecture: `project-docs/architecture/coding-agent.md`, `project-docs/architecture/testing.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-tickets`, `problems`, `coding-agent-cli-interface`
  - 코드: `packages/core/apps/tickets/commands.ts`(`create`·`update`·`verify`, 모두 `agentActor`만), `packages/core/apps/tickets/checks.ts`(`loadCheckWork`의 SQL이 `kind = 'test_command'` 행을 찾는다), `packages/core/apps/tickets/checker/result.ts`(`checkOutcomeOf`), `packages/core/problems/tests/{schema,judge,lifecycle}.ts`
- 계약:
  - 쓰는 것: `appApiKeySchema`·`jsonValueSchema`(`packages/protocol/apps/channel-values.ts`), 검증 행의 ticket 연결(`ticket`, `check_index`, `check_hash`, `completion_seq`)
  - 내놓는 것(모양을 여기서 정한다. 뒤 task가 기댄다):
    - acceptance check `{ kind: "examples", steps: [{ api, input?, expect }] }`. `steps`는 1~20개, `api`는 app-api key, `input`·`expect`는 JSON 값(각 canonical JSON 8 KiB 이하). 이것이 `test_command`를 대신한다. `app_test`·`text`는 그대로다.
    - 검증 종류 `examples`가 `test_command`를 대신한다. `TEST_KINDS = ["app_test", "examples"]`, DB `kind in ('app_test','examples')`. `examples` 검증은 `ticket` 연결을 가진다(지금 `test_command`의 규칙: `kind === "examples" || ticket === null`).
    - 고정 시험(`FrozenTest`)의 `examples` 모양은 `app_test`와 같다(`blueprint`·`sdk_dependencies`·`failure_paths`가 있고 bundle에서 나온다). `validFrozenTest`의 "command"(셋 다 null) 가지는 지운다.
    - 비교 규칙(`rd-ex-driver`가 구현한다. 여기서는 정하고 근거를 적는다): 호출이 성공하면 그 `result`가 `expect`와 `matches(expect, actual)`이어야 한다. 객체는 `expect`의 모든 key가 actual에 있고 각각 `matches`, actual의 나머지 key는 무시. 배열은 길이가 같고 원소마다 `matches`. 나머지(문자열·숫자·boolean·null)는 `===`. 호출이 오류로 끝나면 불일치다.
      - 근거: 결정적이고(정규식·시각·순서 의존 없음) 쓰기 쉽다. actual의 id·시각처럼 앱이 만드는 값은 `expect`에 안 적으면 무시되고, 배열 길이는 엄격해 "주간 4건" 같은 수량을 검사할 수 있다. 와일드카드를 따로 두지 않는다: 쓸지 모르는 일반화이고, 필요하면 App Engineer가 그 칸을 `expect`에서 뺀다.
    - `ticket.verify`의 관문: check가 `examples`인 ticket을 `verified`로 바꾸려면 그 보고(`completion_seq`)에 대해 기록된 check 결과(`ticket_check_results`)가 `pass`이고 그 결과의 검증이 **지금 ticket의 check**(canonical hash 일치)에 대한 것이어야 한다. 아니면 `conflict`("the examples have not passed for this report"). `failed`로 바꾸는 것은 언제나 된다. `app_test`·`text`는 지금처럼 관문이 없다.
    - coding agent가 예시를 못 고친다(확인된 사실): `ticket.create`·`ticket.update`는 route actors가 `["agent"]`이고 handler가 `agentActor`로 막으며, CLI 표(`cli-commands.ts`)에 ticket을 만들거나 고치는 명령이 없다. coding agent는 `ticket show`로 읽기만 한다.

## 할 일

1. `ticket/values.ts`: `acceptanceCheckSchema`에서 `test_command` 가지(와 `executableSchema`·`noShell` 등 이것에만 쓰던 것)를 지우고 `examples` 가지를 더한다. 위 모양. 안 쓰게 된 import를 지운다.
2. `problems/tests.ts`: `TEST_KINDS`와 `validConnections`·`validFrozenTest`·`verificationRecordedPayloadSchema`의 `test_command`를 `examples`로 바꾸고 "command" 가지를 지운다. `app-test-lookup.ts`의 kind 목록에서 `test_command`를 뺀다(`app_test`만. `examples` 검증은 release 준비의 근거가 아니다). `packages/core/apps/packages/publish.ts`의 `fact.kind !== "app_test" && fact.kind !== "test_command"`는 `app_test`만 받게 하고, 안내 문구도 맞춘다.
3. core: `problems/tests/schema.ts`의 `kind in ('app_test','test_command')`를 `('app_test','examples')`로 고친다(옛 schema step을 그 자리에서 고친다. migration step을 더하지 않는다: AGENTS.md "호환성". 개발 data는 지우고 새로 만든다. 보고에 적는다). `problems/tests/judge.ts`의 `exitMismatch`(`test_command` 전용)를 지운다. `lifecycle.ts`의 `unavailable: input.kind === "test_command"`는 `"examples"`로 바꾼다(`rd-ex-request`가 접수 길을 열 때까지 닫아 둔다. 이 file은 그 task의 소유다. 이 한 줄만 고친다).
4. `tickets/checks.ts`의 SQL과 `checker/result.ts`·`checker/work.ts`에서 `test_command`를 `examples`로 바꾸고 `reproduction`이 남았으면 지운다(pt-reproduction-remove가 지웠는지 확인). `fromTests`의 label은 "examples"다.
5. `tickets/commands.ts`의 `verify`에 관문을 더한다(위 규칙). 같은 tx에서 `ticket_check_results`와 그 `verification` 행의 check hash를 읽는다. 검증 행의 check hash 칸 이름은 `problems/tests/schema.ts`의 `verifications` 표에서 찾는다. 오류는 `conflict`.
6. `agent-tools/ticket.ts`: `ticket.create`의 설명을 "…one acceptance check: app_test (the platform checks), examples (app-api calls with their expected results, which the program runs on the reported release) or text (judged by you)…"로, `ticket.verify`의 설명에 "A ticket whose check is examples can be verified only after its examples passed."를 더한다. `ticket.update` 설명은 그대로 둔다.
7. 위험 test 하나(아래).
8. `git ls-files packages tests tools | xargs grep -n "test_command"`로 남은 곳을 찾아 이 task 소유면 고치고, 소유 밖이면 고치지 말고 보고에 적는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test(`tickets_test.ts`, 기존 "확인됨은 App Engineer가 정하고…" test 옆에 하나): "examples check의 ticket은 예시가 맞지 않으면 verified가 되지 못하고, 맞으면 된다". 메모리 DB에 ticket(check = examples)과 `ticket_check_results`(fail, 그 뒤 pass)를 넣고 `verify` command를 부른다.
- 남지 않음: `git ls-files packages tests tools | xargs grep -n "test_command"`가 0줄이다(소유 밖에서 나온 것은 보고에 적는다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export
- 정한 것: 관문이 확인하는 check hash의 읽는 법
- 넘길 줄: `test_command`가 소유 밖 file에 남았으면
- 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: `rd-ex-request`·`rd-ex-trigger`가 land하기 전에는 examples check를 돌리는 길이 없다
