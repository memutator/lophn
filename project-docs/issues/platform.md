# platform

config, diagnostics, storage, server, supervision 같은 바닥 module. 이 주제의 architecture 문서는 없다.

## daemon과 agent runtime의 crash가 diagnostic log에 안 남는다

```yaml
kind: bug
modules: [packages/core/main, packages/core/diagnostics]
```

지금: diagnostic log 쓰기는 I/O worker(`main/worker/io.ts`의 `createSafeLog`, `createDiagnosticIngress`)가 받는다. 그런데 daemon(`main/daemon/main.ts`)에는 `unhandledrejection`/`error` listener가 없고, agent runtime(`main/agent-runtime/main.ts`)은 기동 실패와 `child.run()` 거절만 자기 stderr writer(`createDiagnosticWriter`)로 쓴다. 이 쪽 어디도 ingress로 `platform.diagnostics.write`를 보내지 않는다. 앱 supervisor(`main/app-supervisor/main.ts`)는 stderr에 한 줄 남기고, 앱 process(`apps/runtime/entrypoint/crash.ts`)는 자기 보고 경로가 있다. 옛 text의 `createDiagnosticHost`는 지금 코드에 없다.

영향: daemon이나 agent runtime이 처리 못한 reject로 죽으면 원인이 터미널 stderr에만 남고 `diagnostics.list`에는 없다. 나중에 사람이 볼 수 없다.

고치려면: daemon `main.ts`와 agent runtime `main.ts`에 `unhandledrejection`/`error` listener를 달고, 로그에 쓴 뒤 종료한다. 쓰기 길은 I/O worker의 ingress를 재사용한다(작음~중간. 권한(`DiagnosticAuthority`)과 종료 직전 flush 순서를 정해야 함). 추천.

정할 것: crash를 log에 쓰다가 또 실패하면 stderr로만 두어도 되는지.

## Diagnostics 점검이 core·ledger 둘뿐이다

```yaml
kind: bug
modules: [packages/core/diagnostics, packages/core/main]
```

지금: `diagnostics/components.ts` `createComponentChecks`가 core와 ledger만 짓는다. `ctx.componentChecks`(`wiring/context.ts`)에 더하는 곳은 `wiring/diagnostics.ts` 하나뿐이고, events·앱·sandbox·agent runtime의 wiring은 아무것도 더하지 않는다(`componentChecks.push`를 쓰는 다른 파일이 없다).

영향: `diagnostics.status`가 나머지 component를 점검하지 않아 events, 앱 supervisor, agent runtime이 죽어도 status는 정상으로 보일 수 있다.

고치려면: 각 owner wiring(`events.ts`, `apps.ts`, `supervision.ts`, `lophn-agent-runtime.ts`)이 `ctx.componentChecks.push`로 자기 점검을 더한다. component마다 작음. 점검이 무엇을 보는지(살아 있음, 마지막 응답 시각) 정하는 쪽이 일이다. 추천.

정할 것: 어떤 component를 점검 대상에 넣을지(MVP는 events와 agent runtime만으로 충분한지).
