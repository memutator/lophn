# app-call

앱 app-api 호출의 판정, 기록, write 직렬화와 changeset 기반 rewind. `project-docs/architecture/app-call.md`.

## 큰 앱 호출 changeset이 supervisor control frame을 못 지난다

```yaml
kind: bug
modules: [packages/core/apps, packages/core/supervision, packages/protocol]
```

지금: changeset 상한은 호출당 8MiB(`invocations/changesets.ts` `CHANGESET_MAX_BYTES`)인데, 호출 응답은 changeset을 base64로 싣고 supervisor control frame 하나(`CONTROL_MAX_BYTES` 256KiB, `protocol/base/frame.ts`)를 지난다. `runtime/supervisor/relay.ts`는 응답 상한을 `CONTROL_MAX_BYTES - 1024`로 두고, 넘으면 `{ sent: true, response: null }`이라 호출이 "결과 모름"으로 닫힌다. 원본 changeset이 약 190KiB를 넘는 write가 이렇게 된다. 앱 쪽(`runtime/entrypoint`)은 changeset 크기를 보고 줄이지 않는다.

영향: write는 DB에 반영됐는데 invocation은 unknown에 changeset 없음이다. 범위에 그런 write가 있으면 rewind가 통째로 막혀 그 앱은 그 시점 이전으로 못 돌아간다. 사람이 data를 잃을 수 있는 쪽이다.

고치려면:
- 앱 process가 응답을 만들 때 changeset이 frame에 안 들어가면 changeset을 빼고 "너무 큼"으로 알린다. core는 이미 있는 `too_large` 경로(`changesetVerdict`)로 "DB를 되돌리지 못함" 표시만 하고 rewind를 막지 않는다. 작음.
- changeset을 frame 밖(blob 준비 통로, 파일)으로 넘긴다. 8MiB까지 되돌릴 수 있다. 큼(supervisor를 지나지 않는 통로 설계).
- `CHANGESET_MAX_BYTES`를 frame에 맞춰 낮춘다(작음. 위 첫 안과 같이 가야 앱이 알 수 있음).
추천: 첫 안으로 막힘을 표시로 바꾸고, 큰 write가 실제로 나오면 둘째 안으로 간다. rewind 적용 쪽(`APPLY_BODY_MAX_BYTES` 64MiB)이 control frame을 지나는지도 같이 확인한다.

정한 것: frame에 안 들어가는 changeset은 앱이 빼고 too_large로 알린다. core는 그 write만 "되돌리지 못함"으로 표시하고 나머지 rewind는 막지 않는다.
