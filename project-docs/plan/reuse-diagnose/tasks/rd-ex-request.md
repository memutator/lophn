# rd-ex-request

kind `examples`의 test 요청을 접수하고 runner가 실행하게 한다. 요청은 machine만 낸다. 예시는 ticket에서 core가 읽어 접수 기록에 싣고, runner는 기록의 예시로 고정 시험을 다시 만들어 요청과 맞는지 확인한 뒤 `rd-ex-driver`가 만든 길로 돈다.

- 단위: rd-ex (wave 3)
- 선행: rd-ex-driver. `deriveAppTest`의 `examples` 인자와 `AppTestJob.examples`가 거기서 생긴다. `rd-ex-shape`가 닫아 둔 `lifecycle.ts`의 `unavailable` 줄도 이 task가 연다.
- 소유(이 task만 고친다):
  - `packages/core/problems/tests/lifecycle.ts`
  - `packages/core/problems/tests/request-ports.ts`
  - `packages/core/problems/tests/commands.ts`
  - `packages/core/problems/tests/model.ts`
  - `packages/core/problems/tests/build.ts`
  - `packages/core/problems/tests/examples-request.ts`
  - `packages/core/problems/tests/work/runner-service.ts`
  - `packages/core/problems/tests/work/prepare.ts`
  - `packages/core/problems/tests/mod.ts`
- 읽을 것:
  - issue: `project-docs/issues/coding-agent.md`의 "ticket의 `test_command` check를 runner가 돌리지 않는다"(정한 것: program이 준비된 release에 예시를 불러 비교한다. 새 runner를 만들지 않는다)
  - architecture: `project-docs/architecture/testing.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `problems`, `app-tickets`
  - 코드(읽고 시작한다. 계획 `prompt-text`의 `pt-reproduction-remove`가 이 file들에서 `reproduction`·연결 칸을 이미 지웠으니 그 뒤 모양을 읽는다): `lifecycle.ts`(`productAdmission`, `OpenTestRequest.payload`), `request-ports.ts`(접수 준비. 같은 tx의 SQL로 `releases` 표를 읽는 본보기가 있다), `work/runner-service.ts`(348행 근처의 `connection.kind !== "app_test"` 거절, `deriveAppTest`로 고정 시험을 다시 만들어 요청의 `test`와 견주는 곳, `runAppTestJob` 호출), `app-test/frozen.ts`, `packages/core/apps/tickets/store.ts`(`tickets.acceptance_check`, `ticket_completions.release`)
- 계약:
  - 쓰는 것: `deriveAppTest(bundle, bundleHash, { examples })`와 `AppTestJob.examples`(`rd-ex-driver`), 검증 행의 ticket 연결(`ticket`, `check_index`, `check_hash`, `completion_seq`)
  - 내놓는 것:
    - `RequestTest`(kind `examples`)를 받는다: actor가 `machine`이 아니면 `forbidden`. 접수 준비(`request-ports.ts`의 admission)가 같은 tx에서 확인한다: (1) ticket이 있고 `state = 'reported'`이며 `completion_seq`가 요청의 연결과 같고, (2) 그 보고의 release의 `bundle_hash`가 요청 `target.bundle_hash`와 같고 앱이 같고, (3) 연결의 `check_hash`가 ticket의 현재 `acceptance_check`(kind `examples`, `check_index` 0)의 canonical hash와 같다. 어긋나면 `refs_ok: false`. 맞으면 접수 기록 payload에 예시(`examples`)를 싣는다. 이유: 예시는 App Engineer만 쓰는 ticket 칸이므로 runner는 요청자가 보낸 값이 아니라 core가 읽어 기록한 값만 믿는다.
    - runner가 kind `examples`를 실행한다: 기록의 예시로 `deriveAppTest`를 불러 요청의 `test`와 다르면 준비 실패(기존 app_test와 같은 규칙), 같으면 `runAppTestJob({ ..., examples })`.
    - 함수 `requestExamples(deps)` (`examples-request.ts`): `{ ticket, completion_seq }`를 받아 core가 `RequestTest`(kind `examples`)를 machine 자격으로 내는 일을 한다: ticket 현재 check와 보고 release를 읽어 bundle 사본 폴더에서 `deriveAppTest`로 `test` hash를 구하고 요청을 만든다(`request_key`는 `examples:<ticket>:<completion_seq>`로 고정해 재전송이 하나가 되게 한다). `deps`는 dataRoot, ledger 읽기, machine 자격으로 command를 내는 함수다. 시각·id는 인자로 받는다. `rd-ex-trigger`의 handler가 이 함수를 `TicketCheckClient.requestExamples`로 쓴다.

## 할 일

1. `lifecycle.ts`: `unavailable`을 `false`로 두고(다른 kind도 접수 가능), `productAdmission`의 payload에 `examples`를 싣는 자리를 연다. `OpenTestRequest.payload`의 모양에 `examples`(없을 수 있음)를 더한다.
2. `request-ports.ts`의 `admission`: 위 (1)~(3)을 SQL로 확인하고 `examples`를 읽어 `productAdmission`에 넘긴다. actor 검사는 `commands.ts`의 `handleRequestTest`에서 한다(`input.kind === "examples" && ctx.actor !== "machine"`이면 `forbidden`).
3. `model.ts`·`build.ts`·`commands.ts`: payload에 `examples`가 canonical request에 들어가 요청 hash가 예시 내용에 묶이게 한다(같은 key로 다른 예시를 보내면 `conflict`).
4. `work/runner-service.ts`: 348행 근처의 거절을 "알 수 없는 kind"로 줄이고 kind별로 `deriveAppTest`·`runAppTestJob` 인자를 고른다. `work/prepare.ts`가 kind를 가정하면 맞춘다.
5. `examples-request.ts`에 `requestExamples`를 만들고 `mod.ts`에서 내보낸다.
6. 기동을 본다: orchestrate의 "core 확인" 방법으로 core를 한 번 띄워 runner가 뜨는 것까지 본다. 실제 흐름(보고 → 요청 → 실행 → 기록)은 `rd-ex-trigger` 뒤에 lead가 core를 띄워 본다.

## 끝남

- `deno task check`가 통과한다. `deno task check:full`에서 app test를 지나는 e2e가 통과한다(기존 app_test 접수가 그대로다).
- 위험 test: "examples 요청은 machine만 낼 수 있고, ticket의 현재 check·보고·bundle과 어긋나면 접수되지 않는다"(`request-ports` 단계의 admission 함수를 메모리 DB로 부르는 test. 기존 `packages/core/problems/tests/` 안 test 옆에 둔다)
- 남지 않음: 없음.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 `packages/core/main/daemon/wiring/` 중 problems를 조립하는 곳이 `requestExamples`에 필요한 인자(dataRoot, machine 자격으로 command를 내는 함수)를 `rd-ex-trigger`의 client에 넘기도록 잇는다. 필요한 인자를 보고에 적는다.
- 안 쓰게 된 export
- 정한 것: 예시를 접수 기록에 싣는 방식, 요청 key
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 이 task만으로는 보고가 나도 요청이 나가지 않는다(`rd-ex-trigger`).
