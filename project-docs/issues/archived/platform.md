# platform (닫음)

## daemon과 agent runtime의 crash가 diagnostic log에 안 남는다

```yaml
kind: bug
modules: [packages/core/main, packages/core/diagnostics]
closed: fixed
guard: 없음
```

지금: diagnostic log 쓰기는 I/O worker(`main/worker/io.ts`의 `createSafeLog`, `createDiagnosticIngress`)가 받는다. 그런데 daemon(`main/daemon/main.ts`)에는 `unhandledrejection`/`error` listener가 없고, agent runtime(`main/agent-runtime/main.ts`)은 기동 실패와 `child.run()` 거절만 자기 stderr writer(`createDiagnosticWriter`)로 쓴다. 이 쪽 어디도 ingress로 `platform.diagnostics.write`를 보내지 않는다. 앱 supervisor(`main/app-supervisor/main.ts`)는 stderr에 한 줄 남기고, 앱 process(`apps/runtime/entrypoint/crash.ts`)는 자기 보고 경로가 있다. 옛 text의 `createDiagnosticHost`는 지금 코드에 없다.

영향: daemon이나 agent runtime이 처리 못한 reject로 죽으면 원인이 터미널 stderr에만 남고 `diagnostics.list`에는 없다. 나중에 사람이 볼 수 없다.

고치려면: daemon `main.ts`와 agent runtime `main.ts`에 `unhandledrejection`/`error` listener를 달고, 로그에 쓴 뒤 종료한다. 쓰기 길은 I/O worker의 ingress를 재사용한다(작음~중간. 권한(`DiagnosticAuthority`)과 종료 직전 flush 순서를 정해야 함). 추천.

정한 것: log에 쓰다가 또 실패하면 stderr로만 둔다.

닫음: I/O worker의 `currentAuthority`를 core 고정 authority(`lophn_internal`만 허락)로 바꿔 diagnostics 쓰기를 받게 했다. `diagnostics/crash.ts`의 `installCrashHandler`가 daemon과 agent runtime에서 처리 못한 예외를 받아 원문은 가려 stderr에, 분류 한 줄(`lophn_internal`, `internal_exception`)은 diagnostic log에 쓰고 종료한다. 쓰기가 실패하거나 2초를 넘기면 stderr만 남는다. 일부러 낸 rejection으로 `logs/platform-0.jsonl`에 줄이 남는 것을 손으로 확인했다.

## Diagnostics 점검이 core·ledger 둘뿐이다

```yaml
kind: bug
modules: [packages/core/diagnostics, packages/core/main]
closed: fixed
guard: 없음
```

지금: `diagnostics/components.ts` `createComponentChecks`가 core와 ledger만 짓는다. `ctx.componentChecks`(`wiring/context.ts`)에 더하는 곳은 `wiring/diagnostics.ts` 하나뿐이고, events·앱·sandbox·agent runtime의 wiring은 아무것도 더하지 않는다(`componentChecks.push`를 쓰는 다른 파일이 없다).

영향: `diagnostics.status`가 나머지 component를 점검하지 않아 events, 앱 supervisor, agent runtime이 죽어도 status는 정상으로 보일 수 있다.

고치려면: 각 owner wiring(`events.ts`, `apps.ts`, `supervision.ts`, `lophn-agent-runtime.ts`)이 `ctx.componentChecks.push`로 자기 점검을 더한다. component마다 작음. 점검이 무엇을 보는지(살아 있음, 마지막 응답 시각) 정하는 쪽이 일이다. 추천.

정한 것: events와 agent runtime 점검만 더한다.

닫음: `wiring/events.ts`가 `events` 점검(읽기 연결이 열려 있고 Reactor가 start된 뒤 `events` 표를 한 번 읽는다), `wiring/lophn-agent-runtime.ts`가 `agent-runtime` 점검(I/O observation의 `available`)을 `componentChecks`에 더했다. 둘 다 고정 이유 문장만 낸다. `diagnostics/status`에 core, ledger, events, agent-runtime이 나오는 것을 손으로 확인했다.
