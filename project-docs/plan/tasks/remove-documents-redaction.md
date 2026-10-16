# remove-documents-redaction

`base/redaction`에서 쓰는 곳이 없어진 화면 상태 문자열 규칙(`redactScreen`)과 표본 규칙(`redactSample`)을 지운다. 쓰던 곳은 notifications(`remove-platform-notifications`가 지웠다)뿐이다. redactor 본체와 가리는 규칙은 그대로 둔다.

- 단위: remove-documents (wave 1)
- 선행: remove-documents-move, remove-platform-notifications
- 소유(이 task만 고친다):
  - `packages/base/redaction/`
- 읽을 것:
  - spec: 없음. 근거는 순서 제약 — `/home/pyosechang/projects/lophn/project-docs/tmp/implementation-inventory.md` 6장 "`redactScreen`을 쓰는 notifications …"
  - inventory: `I1.11#12` (`../assignment.md`에서 이 task가 맡은 줄 전부), `I6#32`(lead 몫 줄을 이 task가 한다)
  - 규칙: `/home/pyosechang/projects/lophn/project-docs/dev/code.md`
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: 없음(지우기만 한다)

## 할 일

1. 먼저 `grep -rn "redactScreen\|redactSample\|samplePathsAllowed\|SCREEN_LONG_STRING\|REDACTION_SCREEN_STRING_MAX_CHARS\|REDACTION_SAMPLE" packages tools`로 쓰는 곳이 `base/redaction/` 안뿐인지 본다. 밖에 쓰는 곳이 남아 있으면 지우지 말고 멈춰서 보고한다. (I6#32)
2. `screen.ts`(`redactScreen`, `SCREEN_LONG_STRING`)와 `samples.ts`(`redactSample`, `samplePathsAllowed`)를 지운다. (I1.11#12)
3. `model.ts`의 `REDACTION_SCREEN_STRING_MAX_CHARS`, `REDACTION_SAMPLE_MAX_CHARS`, `REDACTION_SAMPLE_MAX_BYTES`와 `mod.ts`의 그 export를 지운다.
4. `redaction` 실패 때 원문을 막는 장치(`omitted`, `timedOutResult`, `OMISSION_REASONS`)와 알려진 secret 등록 방식은 건드리지 않는다. 그 줄은 wave 3 platform 몫이다(다른 단위 몫).
5. `deno task check`를 돈다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(지우기만 한다. `remove-documents-move`의 redactor test가 규칙을 계속 본다)
- 남지 않음: `grep -rn "redactScreen\|redactSample\|samplePathsAllowed\|SCREEN_LONG_STRING" packages tools`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: 없음
- 안 쓰게 된 export: 없으면 "없음"
- 정한 것: 없으면 "없음"
- 계약 바꾸기 요청: 없음
