# rc-user-read

app test 검사 결과(`GetVerification`, `ListVerifications`)를 user 자격이 읽지 못하는 bug를 고친다. route actor에 user가 있는데 app target이 없는 user token은 `forbidden`이다.

- 단위: rewind-check (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/problems/tests/reads.ts`
  - `packages/core/problems/tests/model.ts`
  - `packages/core/problems/tests/reads_test.ts`
  - `packages/core/problems/tests/model_test.ts`
- 읽을 것:
  - 계획: `project-docs/plan/rewind-check/README.md`의 "진단"(검사 detail)
  - 지금 코드: `packages/core/problems/tests/reads.ts`의 `readVerification`·`sameApp`, `packages/core/problems/tests/model.ts`의 `canReadVerification`·`canListVerifications`, `packages/protocol/problems/tests.ts`의 `getVerification`·`listVerifications`(actors), `packages/core/main/daemon/parent.ts`의 `userOperations`(user token에는 app target이 없다), `packages/core/server/identity/coding-token.ts`(coding token은 `targets.app`이 있다)
- 계약:
  - 쓰는 것: route 정의 그대로
  - 내놓는 것: 없음(권한 판정 고침)

## 할 일

1. user 자격(app target 없음)은 어느 앱의 verification이든 읽는다. `detail: true`의 별도 권한 판정은 그대로다.
2. coding token(app target 있음)은 지금처럼 자기 앱의 것만 읽는다. 다른 앱은 지금처럼 같은 답(`forbidden`이나 `not_found`, 지금 코드가 주는 것)이다.
3. 위험 test를 쓴다(아래). `reads_test.ts`·`model_test.ts`가 없으면 그 중 판정 함수가 있는 쪽에 하나만 만든다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "user 자격은 앱 target 없이 verification을 읽고, coding token은 자기 앱의 것만 읽으며 다른 앱의 것은 거절된다" — 판정 함수에 표 하나. `write-test`: 권한 경계다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
