# rc-examples-restore

ticket `examples` 검사가 모든 예시를 통과한 뒤, 예시의 write 호출이 남긴 changeset을 뒤집어 적용해 첫 호출 전 상태로 돌아오는지 본다. 돌아오지 않으면 examples 검사가 fail이다. 이것이 write tool의 되돌리기를 실제로 성공한 호출로 증명하는 길이다.

- 단위: rewind-check (wave 1)
- 선행: rc-restore. driver의 `restore`와 `CallOutcome.changeset`을 쓴다.
- 소유(이 task만 고친다):
  - `packages/core/problems/tests/harness/examples.ts`
  - `packages/core/problems/tests/harness/examples_test.ts`
- 읽을 것:
  - 결정: `project-docs/issues/activation.md`의 "다시 정한 것", `project-docs/plan/rewind-check/README.md`의 "정한 것"
  - architecture: `project-docs/architecture/coding-agent.md`(examples 절: 차례로 부르고 첫 불일치에서 멈춘다, 앞 예시의 data가 뒤 예시에 보인다), `project-docs/architecture/app-call.md`(rewind)
  - 지금 코드: `harness/examples.ts`, `harness/driver.ts`(`CallOutcome.changeset`, `AppDriver.restore`, `RestoreRun`)
- 계약:
  - 쓰는 것: `rc-restore`의 `AppDriver.restore`, `CallOutcome.changeset`
  - 내놓는 것: examples 검사 증거에 `proven: string[]` — 되돌리기가 증명된 write tool 이름(restore가 `applied && restored`일 때 changeset을 남긴 step의 tool, 중복 없이). restore를 부르지 않았거나 실패하면 빈 목록이다. `rc-unproven-problem`이 이 칸을 읽는다.

## 할 일

1. 예시를 차례로 부를 때 `ok` 결과의 `changeset`을 호출 순서대로 모은다.
2. 모든 예시가 맞았고 모은 changeset이 하나라도 있으면 `driver.restore(changesets)`를 부른다. `applied && restored`가 아니면 examples 검사는 fail이고 이유는 "예시의 write를 되돌리지 못했다: <reason>"이다. 증거에 restore 결과와 `proven`(위 계약)을 싣는다.
3. 예시가 하나라도 틀렸으면 지금처럼 그 불일치로 끝내고 restore는 부르지 않는다. changeset이 없으면(read만 부름) restore를 부르지 않는다.
4. 위험 test(아래).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "예시가 모두 맞고 그 write를 뒤집어 첫 호출 전 상태로 돌아오면 pass, 돌아오지 않으면 fail이고, 예시가 틀리면 restore 없이 그 불일치로 끝난다" — `examples_test.ts`에 가짜 driver로 표 하나. `write-test`: 사용자 data를 되돌리는 규칙의 판정이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**

## lead가 더함

- 추가 소유: `packages/core/problems/tests/app-test/generate.ts`의 `rewind` 검사 설명 한 줄(96행 근처, "write app-api를 부른 뒤 changeset을 뒤집어 적용하면 원래 상태로 돌아오는지"). 호출이 성공한 write만 되돌리기를 보고, 호출이 실패한 tool은 증명 못 함이며 검사를 떨어뜨리지 않는다는 뜻으로 고친다(`rc-unproven`이 `harness/definitions.ts`를 이미 고쳤다. 그 글과 맞춘다).
- `rc-restore` 보고: 실패한 호출(error)의 `CallOutcome`에는 changeset이 없다. examples는 오류로 끝난 호출을 불일치로 보아 거기서 멈추므로 restore까지 가지 않는다. 그 순서를 바꾸지 않는다.
- driver의 비교 기준(baseline)은 앱을 처음 띄울 때(seed 뒤, 첫 호출 전) 잡힌다. examples는 첫 호출 전에 다른 write를 하지 않으므로 그 기준이 "첫 호출 전 상태"다.
