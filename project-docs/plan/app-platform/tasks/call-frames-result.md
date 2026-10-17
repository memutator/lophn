# call-frames-result

앱 호출 결과 상한 `RESULT_MAX_BYTES`를 supervisor control frame에 들어가는 크기 아래로 낮춘다. 지금은 1 MiB라 `result`가 256 KiB 근처를 넘으면 changeset을 빼도 응답이 frame에서 거절되어 호출이 결과 모름(unknown)으로 닫히고, write면 rewind가 막힌다.

- 단위: call-frames (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/apps/runtime/entrypoint/limits.ts`
  - `packages/core/apps/runtime/entrypoint/fit_test.ts`
- 겹침: 같은 단위의 `call-frames-rewind`는 `limits.ts`를 읽기만 한다(`APPLY_BODY_MAX_BYTES`). 이 task는 `RESULT_MAX_BYTES` 한 줄만 고친다. `CALL_BODY_MAX_BYTES`, `APPLY_BODY_MAX_BYTES`는 건드리지 않는다. 다른 단위(`sdk-install`, `release-files`, `crash-log`, `test-wait`)와 겹치는 path는 없다. `apps/runtime/entrypoint/invoke.ts`와 `fit.ts`는 고치지 않는다(`RESULT_MAX_BYTES` import만 하므로 바꿀 곳이 없다).
- 읽을 것:
  - 이슈: `project-docs/issues/app-call.md`의 "changeset을 빼도 `result`가 control frame을 넘으면 결과 모름으로 닫힌다"
  - architecture: `project-docs/architecture/app-call.md`("지키는 것"의 `CALL_RESPONSE_MAX_BYTES`와 `changeset_dropped` 문단)
  - 코드: `packages/protocol/base/frame.ts`의 `CONTROL_MAX_BYTES`, `CALL_RESPONSE_MAX_BYTES`, `packages/core/apps/runtime/entrypoint/fit.ts`, `invoke.ts`(결과 크기 검사), `supervisor/relay.ts`(응답 `maxBytes`)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `apps` 자식 중 앱 호출/runtime 경계
- 계약:
  - 쓰는 것: `CALL_RESPONSE_MAX_BYTES`(`protocol/base/frame.ts`). 이 값은 고치지 않는다.
  - 내놓는 것: `RESULT_MAX_BYTES`(`limits.ts`)는 `CALL_RESPONSE_MAX_BYTES`보다 작은 값이다. 결과 JSON이 `RESULT_MAX_BYTES` 이하이면 `fitChangeset`이 changeset을 빼고 난 응답 body(`{status, result, changeset: null, changeset_dropped}` 칸 포함)가 `CALL_RESPONSE_MAX_BYTES` 이하다. 상한을 넘는 결과는 지금처럼 `internal` "result exceeds the size limit"로 닫힌다.

## 할 일

1. `limits.ts`: `RESULT_MAX_BYTES`를 `CALL_RESPONSE_MAX_BYTES`에서 응답의 결과 밖 칸(`status`, `changeset`, `changeset_dropped`, 오류 body 등)이 쓰는 여유를 뺀 값으로 정한다. 숫자를 따로 쓰지 말고 `protocol/base/frame.ts`의 상수에서 식으로 낸다(한 곳에서 바뀌면 같이 움직인다). 여유는 넉넉히(예: 1 KiB 단위로 한 칸) 잡고 이유를 주석 한 줄로 쓴다. `CALL_RESPONSE_MAX_BYTES`가 이미 envelope 몫 1 KiB를 뺀 값이므로 그 위에 결과 밖 칸 몫만 더 뺀다. 근거: 이슈 "고치려면" 첫째(추천), architecture app-call.md의 frame 한도 문단.
2. `limits.ts` 주석 "호출 본문과 결과의 상한이다"가 `CALL_BODY_MAX_BYTES`와 `RESULT_MAX_BYTES`를 한 줄에 묶고 있다. 결과 상한이 frame 한도에서 나온다는 것을 맞게 고친다. 큰 값은 blob이나 file로 넘긴다는 말은 남긴다.
2-1. 같은 문제가 입력에도 있다: `CALL_BODY_MAX_BYTES`(1 MiB)인 호출 입력이 `apps.call` control frame(256 KiB)에 담긴다. 입력 상한도 같은 식으로 frame 한도 아래로 낮춘다(planner 결정, 결과와 같은 이유). 큰 입력은 blob이나 file로 넘긴다는 말을 주석에 둔다.
3. 위험 test를 `fit_test.ts`에 더한다(아래 "끝남"). 이미 있는 test 이름과 겹치면 합친다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "결과 상한만큼 큰 결과가 있는 응답은 changeset을 빼고 나면 frame 한도 안이다". `result`를 상한 크기로 만든 body에 큰 `changeset`을 붙여 `fitChangeset`을 돌리고, 결과 body의 JSON byte가 `CALL_RESPONSE_MAX_BYTES` 이하이며 `changeset_dropped: "too_large"`인지 본다. 상수끼리 크기만 비교하는 test는 쓰지 않는다.
- 남지 않음: `grep -rn "RESULT_MAX_BYTES" packages tools --include=*.ts`에서 `1_048_576` 같은 직접 숫자로 정의한 줄이 없다.
- 새 E2E·subprocess·서버 test는 쓰지 않는다. core를 띄워 손으로 확인하는 일도 하지 않는다. 확인은 unit test와 `deno task check`까지다.

## 지켜야 할 것(계획 README에서 그대로)

- module은 `core/main`을 import하지 않는다. 바닥은 위층을 import하지 않는다. domain끼리는 problems → apps만.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다. 못 끊으면 `tools/check-deps.ts` 예외로 드러낸다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- 설치 사본은 읽기 전용이고 release bundle에 굳힌 사본과 섞지 않는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 여유로 뺀 byte 수와 이유
- 넘길 줄: 없음
- 계약 바꾸기 요청: 없음
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 호출 입력 쪽 `CALL_BODY_MAX_BYTES`(1 MiB)도 core에서 supervisor로 가는 `apps.call` control frame(256 KiB)에 담기므로 같은 종류의 문제가 있을 수 있다(`apps.call` payload의 `request.input`). 이 task 범위 밖이다. 코드로 따라간 결과만 적는다. lead가 이슈로 올린다.
- 문서: `project-docs/architecture/app-call.md`의 frame 한도 문단 수정은 plan 끝에 lead가 한다.
