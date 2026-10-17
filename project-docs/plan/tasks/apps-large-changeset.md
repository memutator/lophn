# apps-large-changeset

앱 호출 응답의 changeset이 supervisor control frame(256KiB)에 안 들어가면 호출이 "결과 모름"으로 닫혀 rewind가 통째로 막히는 bug를 고친다. 앱 process가 changeset을 빼고 "너무 큼"으로 알리고, core는 그 write를 `changeset_dropped: "too_large"`로 닫아 그 write만 "되돌리지 못함"으로 표시한다. 나머지 rewind는 막지 않는다.

- 단위: apps (wave 1)
- 선행: dead-platform. 둘 다 `packages/protocol/apps/calls/process-wire.ts`를 고친다.
- 소유(이 task만 고친다):
  - `packages/protocol/apps/calls/process-wire.ts` (계약을 바꾼다. 아래)
  - `packages/protocol/base/frame.ts`
  - `packages/core/apps/runtime/supervisor/relay.ts`
  - `packages/core/apps/runtime/entrypoint/invoke.ts`
  - `packages/core/apps/runtime/entrypoint/{fit,fit_test}.ts` (새 file)
  - `packages/core/apps/calls/record.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/app-call.md`(changeset, rewind, 결과 모름이 닫히는 때). 문서는 lead가 고친다.
  - 이슈: `project-docs/issues/app-call.md`의 "큰 앱 호출 changeset이 supervisor control frame을 못 지난다" (정한 것: 첫 안)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-runtime`, `project-docs/module-catalog.yaml`의 `packages/core/apps`
  - 코드: `core/apps/invocations/ledger.ts`의 `finish`(`changeset_dropped`를 요약에 넣는 곳), `core/apps/rewind/plan.ts`(`reverts_db: inv.changeset !== null`, `blocked`는 `unknown`+changeset 없음일 때만)
- 계약:
  - 바꾸는 것: `processCallResponseSchema`(`protocol/apps/calls/process-wire.ts`)의 `ok`와 `error` 두 변형에 `changeset_dropped: z.literal("too_large").optional()`을 더한다. `changeset`이 `null`이고 이 칸이 `"too_large"`이면 "DB를 바꿨을 수 있으나 changeset이 frame에 안 들어가 뺐다"는 뜻이다.
  - 이 shape를 쓰는 곳(같은 task에서 고친다): 앱 process 응답을 만드는 `core/apps/runtime/entrypoint/invoke.ts`, 읽는 `core/apps/runtime/supervisor/relay.ts`(`processCallResponseSchema.safeParse`, strict라 칸을 더하지 않으면 응답 전체가 결과 모름이 된다), 요약으로 옮기는 `core/apps/calls/record.ts`의 `settleResponse`. `core/apps/runtime/control-protocol.ts`의 `callOutputSchema`는 같은 schema를 재사용하므로 자동으로 따라온다(확인만).
  - 새 상수: `protocol/base/frame.ts`에 `CALL_RESPONSE_MAX_BYTES = CONTROL_MAX_BYTES - 1024`(지금 relay.ts의 지역 상수). 앱 process와 relay가 같은 값을 쓴다. `protocol/base/mod.ts`가 `export *`로 이미 내보낸다.
  - 쓰는 것: 8MiB `CHANGESET_MAX_BYTES`와 `changesetVerdict`는 그대로다(실제로는 frame이 먼저 막는다).

## 할 일

1. `protocol/base/frame.ts`: `CALL_RESPONSE_MAX_BYTES`를 더하고 주석에 "envelope와 감싼 칸의 여유"라는 이유를 옮긴다. `relay.ts`는 지역 상수를 지우고 이것을 import한다.
2. `process-wire.ts`: 위 계약대로 두 변형에 optional 칸을 더한다. 주석을 "실패한 write도 DB가 일부 바뀌었을 수 있으므로 changeset을 싣는다. frame에 안 들어가면 빼고 `changeset_dropped`로 알린다"로.
3. 새 `entrypoint/fit.ts`: 순수 함수 `fitChangeset(body)`. body(`{status, ..., changeset}`)를 JSON으로 만든 byte 수가 `CALL_RESPONSE_MAX_BYTES`를 넘고 `changeset`이 `null`이 아니면 `changeset: null`, `changeset_dropped: "too_large"`를 넣은 새 body를 돌려준다. 아니면 그대로. 앱 runtime graph는 Zod를 쓰지 않으므로 protocol의 `frame.ts`(순수)만 import한다.
4. `entrypoint/invoke.ts`: `handleCall`이 `run` 결과(`status: 200`인 body)에 `fitChangeset`을 적용해 돌려준다. `failed()`가 만드는 `status: "error"` 본문과 `status: "ok"` 본문 모두 지난다. `fail()`(4xx/5xx)은 changeset이 없어 건드리지 않는다.
5. `core/apps/calls/record.ts` `settleResponse`: 응답에 `changeset_dropped`가 있으면 `summary`에 `changeset_dropped: "too_large"`를 더한다(ok·error 둘 다). 호출은 `succeeded`/`failed`로 닫히고 `decodeChangeset`은 `null`을 돌려주므로 `ledger.finish`가 changeset 없이 닫는다. 새 상태를 만들지 않는다.
6. rewind 쪽 확인(고치지 않는다): 이 write는 `status: succeeded`, `changeset: null`이라 `plan.ts`에서 `reverts_db: false`일 뿐 `blocked`(`unknown` + changeset 없음)가 아니다. 그대로 두면 "나머지 rewind는 막지 않고 그 write만 되돌리지 못함"이 되는지 코드를 따라 확인하고 보고에 한 줄 쓴다. 다르게 동작하면 고치지 말고 보고한다(소유 밖).
7. rewind 적용 쪽 확인(고치지 않는다): `APPLY_BODY_MAX_BYTES`(64MiB, `entrypoint/limits.ts`)의 changeset 목록이 `core -> supervisor` control frame(256KiB, `relay.ts`의 `apply` 요청 본문)을 지나는지 따라가 본다. 넘을 수 있으면 증거(file:line)와 함께 "알려진 미완 동작"에 적는다. 설계를 새로 하지 않는다.

## 정한 것

- 이슈의 "정한 것"대로 첫 안만 한다(앱이 빼고 too_large로 알림). blob 통로와 상한 낮추기는 하지 않는다.
- `result`(앱 응답의 결과 값, `RESULT_MAX_BYTES` 1MiB)가 changeset을 뺀 뒤에도 frame을 넘는 경우는 이 task가 다루지 않는다(여전히 결과 모름). 보고의 "알려진 미완 동작"에 적는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test(`write-test` 기준: 사용자 data를 잃는 쪽): "frame에 안 들어가는 changeset을 실은 응답은 changeset을 빼고 `changeset_dropped: 'too_large'`로 나가고, 들어가는 응답은 그대로 나간다"(`fit_test.ts`, 순수 함수 test 하나). 쉬우면 `calls_test.ts`에 "`changeset_dropped`가 있는 응답은 `unknown`이 아니라 `succeeded`로 닫히고 요약에 남는다" case 하나(소유에 `calls_test.ts`를 더해도 된다). 그 이상은 만들지 않는다.
- 남지 않음: `grep -rn "CALL_RESPONSE_MAX_BYTES" packages`에서 정의가 `protocol/base/frame.ts` 한 곳이다.
- core가 뜬다: `mkdir -m 700 -p $PWD/.dev-data/apps-large-changeset && export LOPHN_HOME=$PWD/.dev-data/apps-large-changeset`로 core를 띄워 기동 오류가 없는지 본다(`$!` PID만 끈다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export
- 정한 것
- 계약 바꾸기 요청: 이 task가 `processCallResponseSchema`를 바꿨다는 사실과 쓰는 곳을 한 번 더 확인해서 적는다
- 확인한 것: 위 6, 7번
- **무겁게 짠 것**
- **알려진 미완 동작**
