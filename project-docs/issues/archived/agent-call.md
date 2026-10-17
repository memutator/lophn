# agent-call (닫음)

## `AgentCallRecord.options`가 메모리에만 있다

```yaml
kind: bug
modules: [packages/core/router, packages/core/apps]
closed: fixed
guard: 없음
```

지금: 앱 줄에 선 coding 맡기기의 옵션(harness, model)이 transport 메모리에만 있어 재시작하면 잃는다고 했다.

영향: 줄에서 기다리던 call이 재시작 뒤 기본 옵션으로 열릴 수 있었다.

닫음: 옵션은 이제 `coding_lines.options` 열(`apps/tickets/coding/schema.ts`, `store.ts`의 `pushLine`)에 JSON으로 적히고, 줄에서 나중에 열릴 때 `launch.ts`의 `resolveLaunch`가 거기서 읽는다. 재시작 때는 `recoverCoding`이 줄을 비우고 `RecoverCalls`가 그 call을 `lophn_restarted`로 닫아 보낸 session에 알리므로, 옵션이 사라진 채 다른 설정으로 조용히 열리는 일이 없다.
