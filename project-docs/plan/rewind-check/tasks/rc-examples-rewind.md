# rc-examples-rewind

`rewind` 검사가 ticket `examples`가 실제로 성공시킨 write 호출의 changeset으로 되돌리기를 증명하게 한다. examples에 없는 write tool은 만든 입력으로 한 번 불러 보고, 호출이 실패하면 fail이 아니라 "증명 못 함"으로 problem에 알리고 activation을 막지 않는다. 검사 detail을 user token이 읽지 못하는 `sameApp` bug도 고친다.

- 단위: rewind-check (wave 2)
- 선행: rc-wire. domain-place wave 2가 main에 land한 뒤 띄운다(`packages/core/problems/`가 겹친다).
- 소유(이 task만 고친다):
  - `packages/core/problems/tests/harness`
  - `packages/core/problems/tests/work/app-driver.ts`
  - `packages/core/problems/tests/app-test`
  - `packages/core/problems/tests/reads.ts`
  - `packages/core/problems/tests/model.ts`
- 읽을 것:
  - 결정: `project-docs/issues/activation.md`의 "write app-api의 rewind 검사가 fail로 나온다"(다시 정한 것), `project-docs/plan/rewind-check/README.md`의 "진단"과 "정한 것"
  - architecture: `project-docs/architecture/app-call.md`(changeset을 최신부터 뒤집어 한 transaction으로 적용, 충돌하면 통째로 취소), `project-docs/architecture/activation.md`, `project-docs/architecture/coding-agent.md`(ticket check는 하나이고 `app_test`·`examples`·`text` 중 하나, examples 실행 길)
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/core/problems`
  - 지금 코드: `harness/driver.ts`(`CallOutcome`, `AppDriver`), `harness/examples.ts`, `harness/checks.ts`(`rewind`), `harness/rpc.ts`(`METHODS`, `rpcDriver`), `work/app-driver.ts`(`call`, `rewind`, `invertAll`, `/_lophn/control/apply`, `dataState`), `app-test/generate.ts`(필수 검사 목록), `app-test/judge.ts`, `reads.ts`(`readVerification`, `sameApp`), `model.ts`(`canReadVerification`, `canListVerifications`), problem을 내는 길(`packages/core/problems/`에서 harness나 app test 결과가 problem을 여는 곳을 찾는다)
- 계약:
  - 쓰는 것: 앱 runtime의 write 응답에 실리는 `changeset`(base64. `packages/core/apps/runtime/entrypoint/invoke.ts`)
  - 내놓는 것: 없음(검사 판정의 동작 고침)

## 할 일

1. examples가 증명 재료가 되게 한다.
   - `CallOutcome`(`harness/driver.ts`)에 write 호출의 `changeset`을 싣고, `app-driver.ts`의 `call()`이 응답의 `changeset`을 버리지 않게 한다.
   - examples가 모두 통과한 뒤 성공한 write step들의 changeset을 최신부터 뒤집어 적용하고(`invertAll`, `/_lophn/control/apply`), DB가 첫 호출 전 상태와 같은지(`dataState()`) 본다. driver에 그 일을 하는 메서드 하나를 더하고 `harness/rpc.ts`의 표에 넣는다.
   - 되돌리기가 틀리면(적용 실패, 상태가 다름) fail이다. 어느 tool의 어느 step인지 이유에 싣는다.
2. examples에 없는 write tool: 지금 `rewind` 검사처럼 만든 입력(`validValue`)으로 한 번 부른다.
   - 호출이 성공했고 되돌리기가 틀리면 fail이다.
   - 호출 자체가 실패하면 fail이 아니라 "증명 못 함"이다. app test 판정(`judge.ts`)이 그것으로 떨어지지 않게 하고, 그 tool 이름들을 problem으로 알린다(같은 이름으로 묶이게). activation은 막지 않는다.
   - examples가 없는 ticket(check가 `app_test`·`text`)도 이 규칙만으로 돈다.
3. user token: `reads.ts`의 `sameApp`(그리고 `model.ts`의 `canReadVerification`·`canListVerifications`)이 app target이 없는 user token을 `forbidden`으로 막는다. route actor에 user가 있다. user 자격은 app target 없이 읽을 수 있게 한다. coding token(app target 있음)의 범위 판정은 그대로다. `detail:true`의 별도 권한도 그대로다.
4. 위험 test(아래)를 쓴다. 기존 harness test의 fixture를 맞춘다.
5. 확인: 진단 script(`/home/pyosechang/projects/lophn/.claude/worktrees/plan-rewind-check/.dev-data/rc-diagnose/repro.ts`. git 밖)를 이 task의 worktree에 복사해 template 앱으로 돌린다. app test가 `pass`이고, user token으로 `GetVerification`(`detail:false`)이 읽히는지 본다. commit하지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "examples의 write 호출이 남긴 changeset을 뒤집어 적용하면 첫 호출 전 상태로 돌아와야 pass이고, 돌아오지 않으면 fail이며, examples에 없는 write tool의 호출이 실패하면 fail이 아니라 증명 못 함이다" — 가짜 driver로 판정을 표 하나로 본다. `write-test`: 사용자 data를 되돌리는 규칙(틀린 되돌리기)의 판정이다. 다른 test를 더하지 않는다.
- 남지 않음: 호출 실패를 `rewind` fail로 치는 길(`fixture 입력의 호출이 성공하지 못했다`로 fail)이 없다.

## 보고

- 바꾼 file
- 통과한 check
- 확인 결과
- 등록할 것
- 정한 것: problem 이름, "증명 못 함"을 판정에 싣는 모양
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
