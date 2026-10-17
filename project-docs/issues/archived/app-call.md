# app-call (닫음)

## 앱 rewind가 안 된다

```yaml
kind: bug
modules: [packages/core/apps, packages/core/lophn-agent, packages/core/main]
closed: fixed
guard: 없음
```

지금: session rewind는 파일과 대화만 되돌린다. 앱 데이터 되돌리기 요청은 wiring(`ctx.peek.appRewind`)이 비어 늘 `unavailable`로 rejected가 남는다.

영향: 앱 데이터는 rewind로 되돌릴 수 없다.

고치려면: 앱 rewind 계약을 짓고 wiring을 채운다.

닫음: `core/main/daemon/wiring/apps.ts`가 `createAppRewind`로 만든 값을 `ctx.provide("appRewind", rewind)`로 내놓고, `wiring/lophn-agent-session.ts`의 `requestRewind`가 `ctx.peek.appRewind.apply(app, from, "user")`를 부른다. 앱 module 쪽 계약(`apps/rewind`, `appRewind` route)도 등록돼 있다. 연결 자체를 보는 test는 없다(`apps/rewind/rewind_test.ts`는 앱 rewind, `lophn-agent/session/rewind/rewind_test.ts`는 가짜 `requestRewind`).

## 앱 rewind 요청(`rewind_apps` 표)이 wiring 없이 늘 rejected다

```yaml
kind: defect
modules: [packages/core/lophn-agent]
closed: fixed
guard: 없음
```

지금: 앱 rewind 요청(`rewind_apps` 표, background, accepted/applied/rejected)을 두었는데 지금은 wiring이 없어 늘 rejected.

영향: 쓰이지 않는 표와 흐름이다.

고치려면: MVP는 앱 rewind를 빼고 파일·대화만 되돌린다(`apps` 입력과 표를 지움).

닫음: 지우지 않고 wiring을 채웠다(위 "앱 rewind가 안 된다"). `lophn-agent/session/rewind/commands.ts` `handleApps`가 `rewind_apps`에 앱별 결과(accepted에서 applied/rejected)를 기록한다.

## 큰 앱 호출 changeset이 supervisor control frame을 못 지난다

```yaml
kind: bug
modules: [packages/core/apps, packages/core/supervision, packages/protocol]
closed: fixed
guard: fit_test.ts
```

지금: changeset 상한은 호출당 8MiB(`invocations/changesets.ts` `CHANGESET_MAX_BYTES`)인데, 호출 응답은 changeset을 base64로 싣고 supervisor control frame 하나(`CONTROL_MAX_BYTES` 256KiB, `protocol/base/frame.ts`)를 지난다. `runtime/supervisor/relay.ts`는 응답 상한을 `CONTROL_MAX_BYTES - 1024`로 두고, 넘으면 `{ sent: true, response: null }`이라 호출이 "결과 모름"으로 닫힌다. 원본 changeset이 약 190KiB를 넘는 write가 이렇게 된다. 앱 쪽(`runtime/entrypoint`)은 changeset 크기를 보고 줄이지 않는다.

영향: write는 DB에 반영됐는데 invocation은 unknown에 changeset 없음이다. 범위에 그런 write가 있으면 rewind가 통째로 막혀 그 앱은 그 시점 이전으로 못 돌아간다. 사람이 data를 잃을 수 있는 쪽이다.

고치려면:
- 앱 process가 응답을 만들 때 changeset이 frame에 안 들어가면 changeset을 빼고 "너무 큼"으로 알린다. core는 이미 있는 `too_large` 경로(`changesetVerdict`)로 "DB를 되돌리지 못함" 표시만 하고 rewind를 막지 않는다. 작음.
- changeset을 frame 밖(blob 준비 통로, 파일)으로 넘긴다. 8MiB까지 되돌릴 수 있다. 큼(supervisor를 지나지 않는 통로 설계).
- `CHANGESET_MAX_BYTES`를 frame에 맞춰 낮춘다(작음. 위 첫 안과 같이 가야 앱이 알 수 있음).
추천: 첫 안으로 막힘을 표시로 바꾸고, 큰 write가 실제로 나오면 둘째 안으로 간다. rewind 적용 쪽(`APPLY_BODY_MAX_BYTES` 64MiB)이 control frame을 지나는지도 같이 확인한다.

정한 것: frame에 안 들어가는 changeset은 앱이 빼고 too_large로 알린다. core는 그 write만 "되돌리지 못함"으로 표시하고 나머지 rewind는 막지 않는다.

닫음: 앱 process(`entrypoint/fit.ts`의 `fitChangeset`)가 응답이 `CALL_RESPONSE_MAX_BYTES`(control frame 256KiB에서 1KiB를 뺀 값)를 넘으면 changeset을 빼고 `changeset_dropped: "too_large"`를 싣는다. 호출은 결과 모름이 아니라 `succeeded`/`failed`로 닫히고 요약에 `changeset_dropped`가 남는다. 그 write만 되돌리지 못하고 나머지 rewind는 막지 않는다.

## rewind 적용 요청이 control frame 256KiB를 넘을 수 있다

```yaml
kind: bug
modules: [packages/core/apps, packages/core/main]
closed: fixed
guard: packages/core/apps/runtime/supervisor-link_test.ts
```

지금: `core/apps/rewind/run.ts`의 `link.apply`가 되돌릴 changeset을 모두 base64로 한 요청에 담는다(`runtime/supervisor-link.ts`의 `apps.apply`, `runtime/control-protocol.ts`의 `applyInputSchema`, `main/app-supervisor/assembly.ts`). 이 요청은 core와 supervisor 사이 control pipe의 json frame 하나라 `protocol/base/frame.ts`의 `CONTROL_MAX_BYTES`(256KiB)를 넘으면 `encodeFrame`이 `control frame exceeds limit`로 throw한다. `entrypoint/limits.ts`의 `APPLY_BODY_MAX_BYTES`(64MiB)는 supervisor와 앱 process 사이 socket의 한도라 이 frame을 막지 못한다. 호출 하나의 changeset은 이제 frame 안에 들지만(too_large로 뺌) 여러 write를 한꺼번에 되돌리면 합이 넘을 수 있다. 코드로만 따라갔고 재현하지 않았다.

영향: 사람이 여러 write를 되돌리려 하면 rewind 적용이 통째로 실패한다. 요청이 나가기 전에 부호화에서 실패하므로 앱 data는 바뀌지 않는다. throw가 `channel.request`에서 어떤 오류 코드로 바뀌는지는 따라가지 않았다.

고치려면:
- changeset을 write 하나씩 나눠 보낸다(중간. 중간에 실패하면 일부만 되돌린 상태가 된다).
- apply 본문을 bytes frame stream으로 보낸다(중간). 추천.

닫음: `apps.apply`는 json 요청(`worker_request`에 `channel`, payload는 `{ app }`만)을 먼저 보내고 본문(`ProcessApplyRequest` JSON)을 같은 channel의 `bytes` frame(`STREAM_CHUNK_MAX_BYTES` 단위, 쓰기가 끝나야 다음)과 `end`로 보낸다. 보내다 실패하거나 기한이 지나면 core가 `abort`를 보내고 `unavailable`로 끝낸다. supervisor(`supervisor/control-link.ts`)는 `end`까지 모았다가 op 처리기에 body로 넘긴다. 뒤집은 changeset 전부가 한 transaction으로 가는 것은 그대로다. 같은 변경에서 core가 `CALL_BODY_MAX_BYTES`를 넘는 호출 입력을 보내기 전에 `invalid_input`으로 거절한다.

## changeset을 빼도 `result`가 control frame을 넘으면 결과 모름으로 닫힌다

```yaml
kind: bug
modules: [packages/core/apps]
closed: fixed
guard: packages/core/apps/runtime/entrypoint/fit_test.ts
```

지금: 앱 호출 결과 값 상한 `RESULT_MAX_BYTES`(1MiB, `entrypoint/limits.ts`)가 응답이 지나는 control frame(256KiB)보다 크다. `fitChangeset`은 changeset만 빼므로 `result`가 256KiB 근처를 넘으면 relay가 응답을 거절하고 호출이 결과 모름(`unknown`)으로 닫힌다.

영향: 큰 읽기 결과를 내는 앱 호출이 실패가 아니라 결과 모름이 되고, write라면 rewind가 막힌다.

고치려면:
- `RESULT_MAX_BYTES`를 frame 한도 아래로 낮춘다(작음). 추천.
- 응답을 bytes frame stream으로 보낸다(중간).

닫음: `RESULT_MAX_BYTES`는 `CALL_RESPONSE_MAX_BYTES - 1024`(결과 밖 칸 몫)라 상한 안의 결과는 changeset을 빼면 늘 control frame에 든다. 같은 이유로 입력 상한 `CALL_BODY_MAX_BYTES`도 `CONTROL_MAX_BYTES - 2 * 1024`(target·envelope 몫)로 낮췄고, core가 그보다 큰 입력은 보내기 전에 `invalid_input`으로 거절한다(`createAppProcessLink.call`). 큰 값은 blob이나 file로 넘긴다.
