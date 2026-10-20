# platform

config, diagnostics, storage, server, supervision 같은 바닥 module. 이 주제의 architecture 문서는 없다.

## events 점검이 Reactor backoff를 보지 못한다

```yaml
kind: bug
modules: [packages/core/main, packages/core/events]
```

지금: `core/main/daemon/wiring/events.ts`의 `events` 점검은 연결이 열려 있고 `start` 뒤인지, `events` 표를 한 번 읽을 수 있는지만 본다. `ReactorRunner`에 상태를 내는 칸이 없어 handler가 실패해 backoff 중이어도 `available`이다. 두 점검 모두 마지막 응답 시각은 보지 않는다.

영향: reaction이 멈춰 있어도 Diagnostics는 정상으로 보인다.

고치려면: `ReactorRunner`에 마지막 성공 시각이나 backoff 여부를 내는 읽기를 더하고 점검이 본다(작음). 필요해질 때 한다.

## agent runtime child가 stderr에 쓴 진단을 core가 버린다

```yaml
kind: bug
modules: [packages/core/supervision, packages/core/main]
```

지금: supervisor의 `drainStderr`(`packages/core/supervision/responsiveness/run.ts`)는 child stderr를 줄로 읽어 `slot.callbacks.onStderr`로 넘긴다. 그런데 제품 코드에 `onStderr`를 거는 곳이 없어(`grep -rn onStderr packages/core`가 정의와 부르는 곳뿐이다) 줄이 그대로 버려진다. agent runtime(`packages/core/main/agent-runtime/main.ts`)은 진단 원문을 `createDiagnosticWriter(streams.stderr)`로 stderr에 쓴다. 예: turn 시작이 던진 오류 이름과 message(`turn start failed: …`).

영향: diagnostic log에는 분류(`internal_exception`과 location)만 남고, 개발자가 core.log에서 원인 글을 볼 수 없다. turn이 시작하지 않는 bug를 E2E timeout으로만 알게 된 일이 이것으로 다시 생길 수 있다.

고치려면: daemon wiring이 agent runtime slot에 `onStderr`를 걸어 core stderr에 접두를 붙여 쓴다(작음). child가 이미 redaction해서 쓰니 그대로 옮겨도 된다. 추천.
