# app-call

앱 app-api 호출의 판정, 기록, write 직렬화와 changeset 기반 rewind. `project-docs/architecture/app-call.md`.

## rewind 적용 요청이 control frame 256KiB를 넘을 수 있다

```yaml
kind: bug
modules: [packages/core/apps, packages/core/main]
```

지금: `core/apps/rewind/run.ts`의 `link.apply`가 되돌릴 changeset을 모두 base64로 한 요청에 담는다(`runtime/supervisor-link.ts`의 `apps.apply`, `runtime/control-protocol.ts`의 `applyInputSchema`, `main/app-supervisor/assembly.ts`). 이 요청은 core와 supervisor 사이 control pipe의 json frame 하나라 `protocol/base/frame.ts`의 `CONTROL_MAX_BYTES`(256KiB)를 넘으면 `encodeFrame`이 `control frame exceeds limit`로 throw한다. `entrypoint/limits.ts`의 `APPLY_BODY_MAX_BYTES`(64MiB)는 supervisor와 앱 process 사이 socket의 한도라 이 frame을 막지 못한다. 호출 하나의 changeset은 이제 frame 안에 들지만(too_large로 뺌) 여러 write를 한꺼번에 되돌리면 합이 넘을 수 있다. 코드로만 따라갔고 재현하지 않았다.

영향: 사람이 여러 write를 되돌리려 하면 rewind 적용이 통째로 실패한다. 요청이 나가기 전에 부호화에서 실패하므로 앱 data는 바뀌지 않는다. throw가 `channel.request`에서 어떤 오류 코드로 바뀌는지는 따라가지 않았다.

고치려면:
- changeset을 write 하나씩 나눠 보낸다(중간. 중간에 실패하면 일부만 되돌린 상태가 된다).
- apply 본문을 bytes frame stream으로 보낸다(중간). 추천.

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
