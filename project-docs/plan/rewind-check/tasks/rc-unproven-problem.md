# rc-unproven-problem

examples ticket의 examples run이 끝났을 때, 같은 (app, bundle_hash)의 app test가 "증명 못 함"으로 남긴 write tool 가운데 이번 examples가 되돌리기를 증명하지 못한 것만 그 앱의 problem으로 알린다. examples가 아닌 ticket에서는 problem을 내지 않는다. activation은 막지 않는다.

- 단위: rewind-check (wave 1)
- 선행: rc-unproven, rc-examples-restore. 그리고 계획 `domain-place` wave 2가 main에 land한 뒤 lead가 띄운다(`packages/core/problems/tests/control.ts`를 그쪽이 고쳤다).
- 소유(이 task만 고친다):
  - `packages/core/problems/tests/control.ts`
  - `packages/core/problems/tests/record.ts`
  - `packages/core/problems/tests/app-test-lookup.ts`
  - `packages/core/problems/tests/unproven.ts`(새 file. 차이 계산이 따로 있으면)
  - `packages/core/problems/tests/unproven_test.ts`(새 file)
- 읽을 것:
  - 결정: `project-docs/issues/activation.md`의 "다시 정한 것"(증명 못 한 tool은 examples ticket일 때만 problem으로 알린다), `project-docs/plan/rewind-check/README.md`의 "정한 것"
  - 지금 코드: `packages/core/problems/tests/control.ts`(test 요청이 끝난 뒤 처리, `problemReport` 자격(`REPORT_PRINCIPAL`)을 만드는 곳), `packages/core/problems/tests/record.ts`(verification 기록), `packages/core/problems/tests/app-test-lookup.ts`(app test verification 조회: `app`, `kind`, `target_bundle_hash`), `packages/core/problems/tests/examples-request.ts`(examples verification의 target `{bundle_hash, release}`), `packages/core/problems/tests/blobs.ts`(observations blob. problems가 주인이라 안에서 읽는다), `packages/protocol/problems/`의 `problemReport`(이름과 묶임 규칙)
  - 계약: `harness/checks.ts`의 `rewind` 증거 `unproven: string[]`(`rc-unproven`), `harness/examples.ts`의 examples 증거 `proven: string[]`(`rc-examples-restore`)
- 계약:
  - 쓰는 것: 위 두 증거 칸, route `problemReport`
  - 내놓는 것: problem 이름 하나(정해서 보고한다. 예: `rewind_unproven`). 같은 앱의 같은 이름은 한 problem으로 묶인다.

## 할 일

1. examples run(kind `examples`)의 verification이 기록된 뒤, 같은 app이고 `target_bundle_hash`가 같은 app test verification을 찾는다. 없으면 아무것도 하지 않는다.
2. 그 app test의 `rewind` 증거 `unproven`에서 이번 examples 증거의 `proven`을 뺀다. examples가 fail이면 `proven`은 비어 있는 것으로 본다.
3. 남은 tool이 있으면 그 앱에 problem 하나를 알린다. message는 남은 tool 이름들과 "만든 입력의 호출이 실패하고 ticket examples도 그 write를 부르지 않아 되돌리기를 증명하지 못했다"이다. 없으면 알리지 않는다.
4. app test run(kind `app_test`)이 끝날 때는 problem을 내지 않는다. examples가 아닌 ticket은 `unproven`이 app test 증거와 pass 이유 한 줄로만 남는다(`rc-unproven`).
5. 판정(pass·fail)과 activation 흐름은 바꾸지 않는다.
6. 차이 계산은 순수 함수로 두고 위험 test를 쓴다(아래).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "examples run 뒤 알릴 tool은 같은 bundle app test의 unproven에서 그 examples가 증명한 tool을 뺀 것이고, examples가 fail이면 아무것도 빼지 않으며, app test가 없으면 알리지 않는다" — `unproven_test.ts`에 순수 함수 표 하나. `write-test`: 사용자 data를 되돌리는 규칙의 알림이 빠지거나 넘치는 것을 막는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것
- 정한 것: problem 이름과 message, 알리는 자리
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
