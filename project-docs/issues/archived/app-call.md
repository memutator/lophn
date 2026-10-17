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
