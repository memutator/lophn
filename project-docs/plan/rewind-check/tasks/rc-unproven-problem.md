# rc-unproven-problem

app test가 끝났을 때 `rewind` 검사의 증거에 "증명 못 함" tool(`unproven`)이 있으면 그 앱의 problem으로 알린다. activation은 막지 않는다.

- 단위: rewind-check (wave 1)
- 선행: rc-unproven. 그리고 계획 `domain-place` wave 2가 main에 land한 뒤 lead가 띄운다(`packages/core/problems/tests/control.ts`를 그쪽이 고쳤다).
- 소유(이 task만 고친다):
  - `packages/core/problems/tests/control.ts`
  - `packages/core/problems/tests/control_test.ts`
- 읽을 것:
  - 결정: `project-docs/issues/activation.md`의 "다시 정한 것"(증명 못 함은 problem으로 알리고 activation을 막지 않는다)
  - 지금 코드: `packages/core/problems/tests/control.ts`(test 요청이 끝난 뒤 처리, 이미 `problemReport` 자격(`REPORT_PRINCIPAL`)을 만드는 곳), `packages/protocol/problems/`의 `problemReport`(problem 이름과 묶임 규칙), `harness/checks.ts`의 `rewind` 증거 `unproven`(`rc-unproven`)
- 계약:
  - 쓰는 것: `rewind` 검사 증거의 `unproven: string[]`, route `problemReport`
  - 내놓는 것: problem 이름 하나(정해서 보고한다. 예: `rewind_unproven`). 같은 앱의 같은 이름은 한 problem으로 묶인다.

## 할 일

1. app test 결과가 기록된 뒤, `rewind` 검사 증거의 `unproven`이 비어 있지 않으면 그 앱에 problem 하나를 알린다. message는 증명 못 한 tool 이름들과 "만든 입력의 호출이 실패해 되돌리기를 증명하지 못했다. ticket examples에 그 tool의 write 호출을 넣으면 증명된다"이다.
2. 판정(pass·fail)과 activation 흐름은 바꾸지 않는다.
3. 위험 test 없음이 원칙이나, `control_test.ts`가 있으면 "unproven이 있으면 problem 하나를 알리고 없으면 알리지 않는다" 행 하나를 더한다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(있으면 위 행 하나).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것
- 정한 것: problem 이름과 message
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
