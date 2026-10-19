# dt-examples

ticket의 `examples` check가 앱의 tool 이름을 쓰게 한다: `steps[{ api, input, expect }]`가 `steps[{ tool, input, expect }]`가 된다. 실행 길(test bundle의 control socket으로 바로 보낸다. Gate·invocation·rewind를 거치지 않는다)은 그대로다. 예시를 돌리는 test runner(`core/problems/tests`)와 ticket을 만드는 agent tool의 설명, 관련 fixture를 맞춘다.

- 단위: domain-tools (wave 3)
- 선행: dt-call-route
- 소유(이 task만 고친다):
  - `packages/protocol/coding-agent/ticket/values.ts`
  - `packages/core/problems/tests`
  - `packages/core/apps/agent-tools/ticket.ts`
  - `packages/core/apps/tickets/tickets_test.ts`
  - `packages/core/apps/tickets/checker/handler_test.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/coding-agent.md`("업무 규칙은 App Engineer가 쓴 app-api 예시(`examples`)를 program이 돌려 확인한다" 절)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `coding-agent-cli-interface`, `project-docs/module-catalog.yaml`의 `packages/core/problems`
  - 계획: `project-docs/plan/domain-tools/README.md`의 "ticket examples"
  - 지금 코드: `packages/protocol/coding-agent/ticket/values.ts`의 `exampleStepSchema`, `packages/core/problems/tests/harness/examples.ts`·`driver.ts`(`HarnessExample`), `packages/core/problems/tests/examples-request.ts`(`examples: check.steps`), `packages/core/problems/tests/work/app-driver.ts`(`call`)
- 계약:
  - 쓰는 것: `toolNameSchema`(`dt-decl`, `packages/protocol/apps/channel-values.ts`)
  - 내놓는 것: `exampleStepSchema = { tool: toolNameSchema, input?: json, expect: json }`(`strictObject`. `api` 칸은 없다). `HarnessExample`도 `{ tool, input?, expect }`다. 앱 process와의 wire(`api` 칸)는 바꾸지 않는다(`app-driver.ts`가 `tool` 값을 control socket의 `api` 칸에 싣는다).

## 할 일

1. `packages/protocol/coding-agent/ticket/values.ts`: `api: appApiKeySchema`를 `tool: toolNameSchema`로 바꾸고 `appApiKeySchema` import를 정리한다. 주석("app-api 한 번의 호출 예시", "app-api 예시")도 tool로 맞춘다.
2. test runner(`packages/core/problems/tests`): `harness/driver.ts`의 `HarnessExample`, `harness/examples.ts`(`example.api`, 실패 `reason`의 `where`, `evidence.api`→`evidence.tool`), `harness/checks.ts`·`definitions.ts`의 설명 문자열, `work/app-driver.ts`·`work/app-test-run.ts`, `app-test/generate.ts`의 설명(`examples: "ticket의 예시마다 app-api 호출 결과가…"`)을 맞춘다. `HarnessPlan.app_api`·`write_api` 같은 plan 안의 이름 목록 칸은 이름을 바꾸지 않는다(이 계획의 이름 경계). 이름을 바꾸면 `deriveAppTest`의 test hash가 바뀌는 곳이므로 바뀐 hash를 비교하는 fixture가 있으면 같이 고친다(`grep -rn "test_hash\|canonicalHash" packages/core/problems/tests`).
3. `packages/core/apps/agent-tools/ticket.ts`: `ticket.create`의 description ("examples (app-api calls with their expected results …)")과 입력 설명에서 api 표현을 tool로 바꾼다. 입력 schema는 protocol의 `acceptanceCheckSchema`를 그대로 쓰므로 칸 이름은 따라온다.
4. fixture: `packages/core/apps/tickets/tickets_test.ts`(243행 근처 `steps: [{ api: ... }]`), `packages/core/apps/tickets/checker/handler_test.ts`(22행 근처), `packages/core/problems/tests/request-ports_test.ts`, `packages/core/problems/tests/harness/examples_test.ts`, `packages/core/problems/tests/app-test/generate_test.ts`, `packages/core/problems/tests/harness/checks_test.ts`의 `api:` 칸을 `tool:`로 바꾼다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음 — 칸 이름만 바뀌고 비교 규칙(객체 부분 일치, 배열 길이, 첫 불일치에서 멈춤)은 그대로라 기존 `examples_test.ts`가 그대로 지킨다. 새 test를 더하지 않는다.
- 남지 않음:
  - `grep -rnE "\bapi:" packages/core/problems/tests packages/core/apps/tickets packages/protocol/coding-agent/ticket --include=*.ts`가 0줄이다(앱 process wire의 `api:`를 쓰는 `work/app-driver.ts`의 control socket 호출 줄만 예외로 남을 수 있다. 남으면 줄 번호를 보고에 적는다).
  - `grep -rn "example.api\|HarnessExample" packages/core/problems/tests | grep "api"`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**: 이미 만든 ticket의 옛 `api` 예시는 거절된다(개발 data는 새로 만든다)
