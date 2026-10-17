# app-call

앱 app-api 호출의 판정, 기록, write 직렬화와 changeset 기반 rewind. `project-docs/architecture/app-call.md`.

## changeset을 빼도 `result`가 control frame을 넘으면 결과 모름으로 닫힌다

```yaml
kind: bug
modules: [packages/core/apps]
```

지금: 앱 호출 결과 값 상한 `RESULT_MAX_BYTES`(1MiB, `entrypoint/limits.ts`)가 응답이 지나는 control frame(256KiB)보다 크다. `fitChangeset`은 changeset만 빼므로 `result`가 256KiB 근처를 넘으면 relay가 응답을 거절하고 호출이 결과 모름(`unknown`)으로 닫힌다.

영향: 큰 읽기 결과를 내는 앱 호출이 실패가 아니라 결과 모름이 되고, write라면 rewind가 막힌다.

고치려면:
- `RESULT_MAX_BYTES`를 frame 한도 아래로 낮춘다(작음). 추천.
- 응답을 bytes frame stream으로 보낸다(중간).
