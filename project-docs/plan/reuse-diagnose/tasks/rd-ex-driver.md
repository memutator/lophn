# rd-ex-driver

app test runner가 앱을 격리 사본에서 구동하는 길(`AppDriver`, 시험 자식, 관측 frame, 판정)에 `examples` 검사를 더한다. 새 runner를 만들지 않는다. 앱 bundle 사본과 일회용 DB에서 예시의 app-api를 순서대로 부르고, 결과를 비교 규칙대로 견주어 frame 하나를 낸다.

- 단위: rd-ex (wave 2)
- 선행: rd-ex-shape. check와 검증 종류 `examples`, 비교 규칙이 거기서 정해진다.
- 소유(이 task만 고친다):
  - `packages/core/problems/tests/harness/**`
  - `packages/core/problems/tests/work/app-driver.ts`
  - `packages/core/problems/tests/work/app-test-run.ts`
  - `packages/core/problems/tests/app-test/**`
- 읽을 것:
  - issue: `project-docs/issues/coding-agent.md`의 "ticket의 `test_command` check를 runner가 돌리지 않는다"(정한 것)
  - architecture: `project-docs/architecture/testing.md`, `project-docs/architecture/app-call.md`(같은 호출 길)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `problems`, `app-runtime`
  - 코드(읽고 시작한다): `work/app-driver.ts`(`createRealAppDriver`: 봉인 bundle 사본을 mode=test로 띄우고 `/_lophn/control/call`로 호출한다. `rewind`·`rejectsInvalidInput`이 호출하는 방법이 본보기. 앱 data는 작업 폴더 안 DB를 새 schema까지 migration해 시작하고 net·secret은 대역이다), `harness/driver.ts`(`AppDriver`, `HarnessPlan`), `harness/checks.ts`(`runChecks`: 검사마다 frame 하나), `harness/rpc.ts`(자식이 부를 수 있는 `METHODS`), `harness/definitions.ts`(`REQUIRED_CHECKS`·`SOURCES`·`COVERAGE`), `app-test/generate.ts`(`generateAppTestChecks`: 검사별 required/not_applicable), `app-test/frozen.ts`(`deriveAppTest`), `app-test/judge.ts`, `work/app-test-run.ts`(`runAppTestJob`)
- 계약:
  - 쓰는 것: check `{ kind: "examples", steps }`와 비교 규칙(`rd-ex-shape`), 검증 종류 `examples`
  - 내놓는 것:
    - `AppDriver.call(api: string, input: unknown): Promise<{ status: "ok"; result: unknown } | { status: "error"; code: string }>`. `rpc.ts`의 `METHODS`에 넣어 시험 자식이 부른다.
    - `HarnessPlan.examples: { api: string; input?: unknown; expect: unknown }[]`(예시가 없는 app_test 계획은 빈 목록).
    - 검사 이름 `examples`(source `harness`). `generateAppTestChecks`의 입력(`AppTestInput`)에 `examples?`가 있으면 `examples`만 `required`이고 나머지 다섯 검사는 `not_applicable`("예시 검증 실행이다"). 없으면 지금과 같다(다섯 required, `examples`는 `not_applicable`).
    - 순수 함수 `exampleMatches(expect: unknown, actual: unknown): boolean`(`rd-ex-shape`의 비교 규칙. `harness/examples.ts`)
    - `AppTestJob.examples?`(`work/app-test-run.ts`): 있으면 `runAppTestJob`이 위 계획으로 돈다. `deriveAppTest`는 `examples`가 있으면 `FrozenTest.input`에 `{ version, checks: ["examples"], examples }`의 canonical blob을, `expected`에 "every example matches"를 쓴다(`rd-ex-request`가 이 함수를 요청 접수·runner에 쓴다).

## 할 일

1. `work/app-driver.ts`에 `call`을 더한다: `rewind`와 같은 호출 본문(`ids.newId("inv")`, `context.mode = "test"`, `effect`는 blueprint 선언)으로 `/_lophn/control/call`을 부르고 응답의 `status`·`result`·`error.code`를 위 모양으로 돌려준다. 호출 전에 `probeAttestation()`으로 앱을 준비한다. 앞선 호출이 만든 data가 뒤 호출에 보여야 하므로 같은 앱 process·같은 DB를 쓴다(예시 하나를 호출하는 사이 앱을 다시 띄우지 않는다. 앱이 스스로 끝나면 `ensureApp`이 다시 띄운다).
2. `harness/driver.ts`·`rpc.ts`: `AppDriver`에 `call`을, `METHODS`와 `rpcDriver`에 `call`을 더한다. `HarnessPlan`에 `examples`를 더한다.
3. `harness/examples.ts`: `exampleMatches`와 검사 함수 `examples(driver, plan)`: 예시를 순서대로 `driver.call`하고 첫 불일치에서 멈춘다. verdict의 `evidence`는 `{ steps: n, failed_step: index | null, api, expected(앞부분), actual(앞부분) }`이고 각 값은 canonical JSON 2 KiB로 자른다(frame 한도 `TEST_OBSERVATION_FRAME_MAX_BYTES`). 이유: 앱이 큰 결과를 돌려줘도 frame이 거절되어 판정이 inconclusive가 되지 않게 한다. `reason`은 영어 한 줄("step 2 event.list: result does not match the expected rows")로, 값이 아닌 위치와 api만 쓴다.
4. `harness/checks.ts`의 `run`에 `examples`를 더하고, `harness/definitions.ts`에 검사 이름·source·coverage(`criteria`: 예시마다 호출 결과가 기대와 맞는다 / `input_range`: ticket에 적힌 예시 순서, 빈 DB에서 시작)를 더한다. `CHECK_DEFINITIONS_VERSION`을 올린다.
5. `app-test/generate.ts`: 위 계약대로. `app-test/frozen.ts`: `deriveAppTest(bundle, bundleHash, options?: { examples })`. `app-test/judge.ts`: 판정이 검사 목록을 계획에서 읽는지 확인하고, `examples` 검사 하나만 required인 계획도 같은 규칙(required 검사가 모두 met이어야 pass, 빠진 frame은 inconclusive)으로 판정되게 한다.
6. `work/app-test-run.ts`: `AppTestJob.examples?`를 받아 `AppTestInput`·`HarnessPlan`에 넘긴다.
7. 위험 test 하나(아래). 비교 함수는 순수 함수라 가장 싸다.

## 끝남

- `deno task check`가 통과한다. 기존 app test 흐름(`tests/e2e/app-release_test.ts` 등)이 깨지지 않는다: `deno task check:full`.
- 위험 test: "예시와 맞지 않는 결과는 불일치이고 맞는 결과(extra key 무시, 배열 길이 엄격)는 일치다"(`harness/examples_test.ts`의 표. `exampleMatches`와 가짜 `AppDriver`를 쓰는 `examples` 검사: 맞지 않는 첫 단계에서 met=false, 모두 맞으면 met=true)
- 남지 않음: 없음.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export
- 정한 것: frame 한도에 맞춘 evidence 자르기
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 이 task만으로는 요청이 접수되지 않는다(`rd-ex-request`).
