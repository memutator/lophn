# rc-unproven

app test의 `rewind` 검사에서 만든 입력의 호출 자체가 실패한 write tool을 fail이 아니라 "증명 못 함"으로 둔다. 호출이 성공했는데 되돌리기가 틀린 것만 fail이다. 증명 못 한 tool 이름은 검사 증거에 싣고, 그것을 problem으로 알리는 일은 `rc-unproven-problem`이 한다.

- 단위: rewind-check (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/problems/tests/harness/checks.ts`
  - `packages/core/problems/tests/harness/checks_test.ts`
  - `packages/core/problems/tests/harness/definitions.ts`
  - `packages/core/problems/tests/app-test/judge.ts`(추가 소유, lead: pass 이유 갈래만. `unproven`이 있으면 pass 이유에 "증명 못 한 write tool: …" 한 줄을 붙인다)
- 읽을 것:
  - 결정: `project-docs/issues/activation.md`의 "write app-api의 rewind 검사가 fail로 나온다"(다시 정한 것), `project-docs/plan/rewind-check/README.md`의 "정한 것"
  - architecture: `project-docs/architecture/app-call.md`(rewind, changeset)
  - 지금 코드: `harness/checks.ts`의 `rewind`(지금은 `called`가 false이면 fail), `harness/driver.ts`의 `RewindRun`, `harness/definitions.ts`의 `rewind` 설명, `app-test/judge.ts`(검사 status가 판정에 어떻게 들어가는가)
- 계약:
  - 쓰는 것: `RewindRun { called, changed, applied, restored, reason }`(바꾸지 않는다)
  - 내놓는 것: `rewind` 검사 증거(`actual`)에 `unproven: string[]`(호출이 실패해 증명하지 못한 tool 이름, 선언 순서). 기존 `runs`는 그대로 둔다. `rc-unproven-problem`이 이 칸을 읽는다.

## 할 일

1. `checks.ts`의 `rewind`: fail은 `called && changed && !(applied && restored)`뿐이다. `!called`는 unproven이다. 바꾼 것이 없는(`called && !changed`) tool은 지금처럼 통과다.
2. 증명 못 한 tool이 있어도 검사는 met다. reason에 "증명 못 한 tool: <이름들>(<호출 실패 이유>)"를 덧붙여 사람이 볼 수 있게 한다. 증거에 `unproven`을 싣는다.
3. `definitions.ts`의 `rewind` 설명을 새 규칙으로 고친다(호출이 실패한 tool은 증명 못 함이고 검사를 떨어뜨리지 않는다).
4. 위험 test(아래).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "호출이 성공하고 되돌리기가 틀린 write tool은 rewind fail이고, 호출 자체가 실패한 tool은 fail이 아니라 증거의 unproven에 실린다" — `checks_test.ts`에 가짜 driver로 표 하나. `write-test`: 사용자 data를 되돌리는 규칙의 판정이다.
- 남지 않음: 호출 실패를 fail로 치는 길이 없다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
