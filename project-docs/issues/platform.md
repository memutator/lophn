# platform

config, diagnostics, storage, server, supervision 같은 바닥 module. 이 주제의 architecture 문서는 없다.

## agent runtime child가 stderr에 쓴 진단을 core가 버린다

```yaml
kind: bug
modules: [packages/core/supervision, packages/core/main]
```

지금: supervisor의 `drainStderr`(`packages/core/supervision/responsiveness/run.ts`)는 child stderr를 줄로 읽어 `slot.callbacks.onStderr`로 넘긴다. 그런데 제품 코드에 `onStderr`를 거는 곳이 없어(`grep -rn onStderr packages/core`가 정의와 부르는 곳뿐이다) 줄이 그대로 버려진다. agent runtime(`packages/core/main/agent-runtime/main.ts`)은 진단 원문을 `createDiagnosticWriter(streams.stderr)`로 stderr에 쓴다. 예: turn 시작이 던진 오류 이름과 message(`turn start failed: …`).

영향: diagnostic log에는 분류(`internal_exception`과 location)만 남고, 개발자가 core.log에서 원인 글을 볼 수 없다. turn이 시작하지 않는 bug를 E2E timeout으로만 알게 된 일이 이것으로 다시 생길 수 있다.

고치려면: daemon wiring이 agent runtime slot에 `onStderr`를 걸어 core stderr에 접두를 붙여 쓴다(작음). child가 이미 redaction해서 쓰니 그대로 옮겨도 된다. 추천.
