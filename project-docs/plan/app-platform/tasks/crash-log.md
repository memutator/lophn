# crash-log

처리 못한 예외로 죽는 process가 log에 한 줄 남게 한다. 지금 `installCrashHandler`는 daemon의 diagnostics wiring `start` 뒤와 agent runtime 성공 뒤에만 걸린다. daemon 기동 앞, 앱 supervisor, shell main에도 건다. 앱 process는 이미 다른 길이 있어 걸지 않는다(아래 "정한 것").

- 단위: crash-log (wave 1)
- 선행: approval-reads, call-frames-rewind. 셋 다 `wiring/apps.ts`를 고친다(서로 다른 줄이지만 같은 file이라 순서를 둔다).
- 소유(이 task만 고친다):
  - `packages/core/diagnostics/crash.ts`
  - `packages/core/main/worker/io.ts`(I/O worker catalog의 `components` 한 줄만)
  - `packages/core/main/daemon/wiring/diagnostics.ts`
  - `packages/core/main/daemon/wiring/apps.ts`(supervisor child message를 받는 `onMessage` 줄만)
  - `packages/core/main/daemon/parent.ts`
  - `packages/core/main/daemon/core.ts`(`watchParent`를 부르는 곳 한 군데만)
  - `packages/core/main/app-supervisor/main.ts`
  - `packages/shell/main/desktop/wiring/crash.ts`(새 file)
  - `packages/shell/main/desktop/main.ts`(조립 한 줄)
- 읽을 것:
  - 이슈: `project-docs/issues/platform.md`의 "기동 중 crash와 supervisor·앱 process·shell main의 crash가 log에 안 남는다"(닫는 일은 lead가 한다. 이 task가 다 닫지 못한다. 아래 "알려진 미완 동작")
  - architecture: 이 주제 문서는 없다. 흐름은 코드가 본보기다: `packages/core/diagnostics/crash.ts`(`installCrashHandler`, `crashDiagnostic`, `CRASH_LOCATIONS`), `packages/core/main/agent-runtime/main.ts`(child가 `Diagnostic`을 감독 pipe로 보내는 꼴. 이 file은 계획 `agent-io`가 소유하니 읽기만 한다), `packages/core/main/daemon/wiring/lophn-agent-runtime.ts`(core가 받아 `component`를 덮어쓰고 `ctx.diagnosticsWrite`로 쓴다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `diagnostics`, `supervision`, `shell`, `core`, `project-docs/module-catalog.yaml`의 `packages/core/diagnostics`, `packages/core/main`, `packages/shell/main`
- 계약:
  - 쓰는 것: `Diagnostic`의 `lophn_internal` 꼴(`packages/protocol/supervision/supervision.ts`의 `diagnosticSchema`). `childMessageSchema`(supervisor → core)와 `mainToCoreMessageSchema`(shell main → core)가 이미 `diagnosticSchema`를 받는다. protocol은 바꾸지 않는다.
  - 내놓는 것: `CRASH_LOCATIONS`에 `appSupervisor`, `shellMain`을 더하고 `CRASH_LOCATION_NAMES`에 표시 문자열을 더한다. `diagnostics/mod.ts` export 모양은 그대로다.

## 지켜야 할 것(계획 README 그대로)

- module은 `core/main`을 import하지 않는다. 바닥은 위층을 import하지 않는다. domain끼리는 problems → apps만.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다. 못 끊으면 `tools/check-deps.ts` 예외로 드러낸다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- 설치 사본은 읽기 전용이고 release bundle에 굳힌 사본과 섞지 않는다.

이 task에서 닿는 것: shell은 `core`를 import하지 않는다(`tools/check-deps.ts`의 `PACKAGE_DEPENDENCIES.shell`은 protocol, base, design). 그래서 shell main은 `installCrashHandler`를 못 가져오고 아래처럼 자기 handler를 쓴다.

## 알고 시작할 것(코드를 보고 안 것)

- daemon: `installCrashHandler`는 `wiring/diagnostics.ts`의 `start`에서 걸린다. 그런데 `ctx.diagnosticsWrite`는 `ctx.peek.io`(I/O worker)가 있어야 쓴다. I/O worker는 `wiring/supervision.ts`의 `start`가 띄우고, 그 `start`가 다른 wiring의 `start`보다 앞이다. 그래서 I/O worker가 뜨기 전에는 log에 쓸 길이 없다(`diagnosticsWrite`가 바로 `false`를 돌려준다). 손으로 파일에 덧붙이는 길을 새로 만들지 않는다(log 파일은 I/O worker가 소유한다).
- 앱 supervisor(`main/app-supervisor/main.ts`)에는 이미 `unhandledrejection` listener가 하나 있다: 메시지를 stderr에 찍고 `shutdown()`(앱 자식을 정지하고 exit 0). `error` 이벤트는 듣지 않는다. 이 listener는 "supervisor가 예상 밖으로 죽어도 detached 앱 자식을 남기지 않는다"는 약속을 지킨다. 새 handler도 그 약속을 지켜야 한다.
- 앱 process: `apps/runtime/entrypoint/main.ts`에 이미 `installCrashExit`(`entrypoint/crash.ts`)가 있어 stderr에 원인을 남기고 exit 1 하며, 예외는 앞서 설치한 exception observer가 broker를 거쳐 problems에 한 번 보고한다. supervisor는 예상 밖 종료·기동 실패·crash loop·V8 OOM을 `apps/runtime/observations/crash.ts`로 problems(`process_exit` 관측)에 보낸다. 앱 process는 core 진단 입구가 아닌 broker credential만 갖는다. 이슈의 "앱 process에 handler가 없다"는 지금 코드와 맞지 않는다.
- shell main: Electron main(Node)이고 `desktop/main.ts`는 조립만 하고 영역마다 `desktop/wiring/<이름>.ts` 한 file이 자기 값을 등록한다(`module-catalog.yaml` `packages/shell/main` notes). core로 가는 안전 진단 통로는 이미 있다: `ctx.core.diagnostic(message)`(`desktop/core/supervise.ts`가 `mainToCoreMessageSchema`로 확인해 pipe에 쓴다). 그런데 core `parent.ts`의 `handleParent`는 `shell_view_lifetime`만 받고 다른 diagnostic은 무시한다.
- I/O worker는 `catalog.components`에 든 component와 `catalog.locations`에 든 location만 받는다(`diagnostics/log.ts`의 `admit`). 없으면 조용히 버린다. 새 component·location은 둘 다 올려야 한다(`main/worker/io.ts`의 `catalog`와 `diagnostics/crash.ts`의 `CRASH_LOCATION_NAMES`).

## 할 일

1. `diagnostics/crash.ts`: `CRASH_LOCATIONS`에 `appSupervisor: "app-supervisor-crash"`, `shellMain: "shell-main-crash"`를 더하고 `CRASH_LOCATION_NAMES`에 각각 `packages/core/main/app-supervisor/main.ts`, `packages/shell/main/desktop/wiring/crash.ts`를 더한다. `main/worker/io.ts`의 `catalog.components`에 `"platform/app-supervisor"`, `"platform/shell-main"`을 더한다. 근거: `diagnostics/log.ts`의 catalog 검사(이슈의 "location이 catalog에 없으면 ingress가 버린다"가 새 location에서 되풀이되지 않게 한다), `diagnostics/crash.ts`의 "I/O worker catalog의 `locations`에 쓴다" 주석.
2. daemon: `wiring/diagnostics.ts`의 `installCrashHandler` 호출을 `start`에서 `prepare`로 옮긴다(`diagnosticsWrite`를 `provide`한 직후). 근거: 기동의 `prepare` 뒤에 나는 crash도 stderr 원문을 redaction을 거쳐 한 번 남기고 같은 경로로 exit 1 하게 한다. I/O worker가 뜬 뒤에는 log에도 한 줄 남는다. 뜨기 전은 `write`가 `false`로 끝나 stderr만 남는다(위 "알고 시작할 것"). `redact`는 이미 `ctx.peek.knownSecrets`를 호출 때 읽으니 그대로 쓴다. `closeIntake`의 uninstall은 그대로 둔다. 기동 오류를 `Result`로 돌려주는 경로(`main.ts`의 `start_failed`)는 crash가 아니므로 건드리지 않는다.
3. 앱 supervisor: `main/app-supervisor/main.ts`의 `unhandledrejection` listener를 `installCrashHandler`로 바꾼다. 근거: 이슈 "고치려면", 위 supervisor listener.
   - `target: globalThis`, `stderr: Deno.stderr.writable`, `exit: Deno.exit`. `redact`는 같은 폴더의 `log-redact.ts`를 쓸 수 있으면 쓰고, 맞지 않으면 문자열을 그대로 돌려주는 함수로 한다(이전 listener도 원문을 찍었다).
   - `write`: 먼저 `send(crashDiagnostic({ component: "platform/app-supervisor", location: CRASH_LOCATIONS.appSupervisor, at: systemClock.now() }))`(기존 `send`가 frame으로 쓴다)로 core에 보내고, 그 뒤 `assembled.supervisor.stop()`으로 앱 자식을 정지한다. 둘 다 끝나야 exit 한다. `stop`이 걸리는 시간을 `apps/runtime/supervisor/`에서 확인해 `deadlineMs`를 그보다 길게 준다(기본 2초는 정지에 모자랄 수 있다).
   - 기존 `shutdown`(SIGINT·SIGTERM)의 `stopping` 가드와 겹치지 않게 한다: crash 중에 신호가 오거나 그 반대여도 `stop`이 두 번 돌지 않게. exit code가 0에서 1로 바뀐다. core의 supervision(`appsSupervision`)이 exit code를 가르는 곳이 있는지 `main/daemon/wiring/apps.ts`의 `onEnd`와 `supervision/`에서 확인하고 있으면 맞춘다.
4. core가 supervisor의 진단을 받는다: `main/daemon/wiring/apps.ts`의 `appsSupervision.start(..., { onMessage })`에서 `appsControl.onSupervisorMessage(message)` 앞에 `message.type === "diagnostic" && message.kind === "lophn_internal"`을 처리한다. `ctx.diagnosticsWrite({ ...message, payload: { ...message.payload, component: "platform/app-supervisor", location: CRASH_LOCATIONS.appSupervisor } })`(결과는 기다리지 않고 실패는 삼킨다). 근거: `wiring/lophn-agent-runtime.ts`가 같은 꼴로 child의 진단에서 `component`를 덮어쓴다. 보내는 쪽 값을 믿지 않는다. `CRASH_LOCATIONS`는 `diagnostics/mod.ts`에서 가져온다.
5. shell main: 새 file `desktop/wiring/crash.ts`가 `register(ctx)`로 `{ stop() }`을 돌려준다. `process.on("uncaughtException")`와 `process.on("unhandledRejection")`에서 `ctx.core.diagnostic({ type: "diagnostic", kind: "lophn_internal", payload: { component: "platform/shell-main", observed_at: <ISO>, error_class: "internal_exception", location: "shell-main-crash", count: 1 } })`를 보내고, 원인을 stderr에 찍고, pipe 쓰기가 나갈 짧은 시간(예: 200ms) 뒤 `app.exit(1)` 한다. `stop()`은 listener를 푼다. `desktop/main.ts`에 `add(crash.register(ctx))` 한 줄과 import 한 줄만 더한다(다른 줄은 정리하지 않는다). 근거: `desktop/main.ts`는 조립만 한다는 규칙, shell은 core를 import하지 못한다는 `check-deps` 규칙, 이슈 "고치려면". payload 모양은 `diagnosticSchema`의 `lophn_internal`(`packages/protocol/supervision/supervision.ts`)에서 확인한다. `core.diagnostic`이 `false`를 돌려주면(연결 전·종료됨) stderr만 남는다.
6. core가 shell main의 진단을 받는다: `main/daemon/parent.ts`의 `ParentDiagnostics`에 `internal(diagnostic)`을 더하고 `handleParent`가 `message.data.kind === "lophn_internal"`을 그 메서드로 넘긴다(지금 주석 "main이 보내는 진단은 view 수명뿐이다"를 고친다). `main/daemon/core.ts`의 `watchParent(..., shellViewLog(root.path))`를 `{ ...shellViewLog(root.path), internal: (d) => void ctx.diagnosticsWrite({ ...d, payload: { ...d.payload, component: "platform/shell-main", location: CRASH_LOCATIONS.shellMain } }).catch(() => {}) }`처럼 바꾼다. 근거: 4와 같은 이유(보내는 쪽 값을 믿지 않고 core가 component·location을 정한다), `handleParent`가 frame을 순서대로 읽으므로 main이 죽어 pipe가 닫히기 전에 보낸 한 줄은 처리된다.

## 정한 것(문서에 답이 없어 정했다. worker는 이대로 한다)

- **앱 process entry는 걸지 않는다.** 위 "알고 시작할 것"대로 `installCrashExit`와 exception observer, supervisor의 crash 관측이 이미 stderr와 problems에 남긴다. 앱 process에서 core 진단 입구를 열려면 앱 쪽에 새 권한 길이 든다. 이슈 절의 이 부분은 lead가 사실에 맞게 고친다. 이 task는 문서를 고치지 않는다.
- **agent runtime 재기동이 crash를 줄마다 쌓는 문제는 하지 않는다.** 재기동은 `lophn-agent/run-loop/runtime.ts`(계획 `agent-place` 소유)에 있고 `main/agent-runtime/main.ts`는 계획 `agent-io` 소유다. 고쳐야 하면 "계약 바꾸기 요청"으로 올린다.
- **`location`이 catalog에 없어 버려지는 문제는 새 location을 catalog에 올리는 것으로 닫는다**(할 일 1). 지금 코드에서 agent runtime의 `agent-runtime-crash`는 이미 catalog에 있다. 새 location이 생길 때 두 곳(`CRASH_LOCATION_NAMES`, `io.ts` components)이 같이 바뀌어야 한다는 것은 주석 한 줄로 남긴다(검사하는 test는 만들지 않는다).
- **stderr 원문이 기존 redaction 규칙에 안 걸리는 값을 못 가리는 문제는 하지 않는다**(redaction 규칙의 일이라 이 이슈 절과 따로다).
- **I/O worker가 뜨기 전 crash는 stderr까지만 남긴다**(할 일 2). log 파일에 직접 쓰는 길을 만들지 않는다. 필요하면 lead가 이슈에 남긴다.
- shell main은 `installCrashHandler`를 쓰지 않고 작은 자체 handler를 둔다(할 일 5). `installCrashHandler`를 `packages/base`로 옮기는 안은 base를 이 계획이 소유하지 않아 하지 않았다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. `installCrashHandler`의 동작은 바꾸지 않고 건 곳만 늘린다. core가 받은 진단의 `component`·`location`을 덮어쓰는 줄(할 일 4, 6)은 ingress가 이미 catalog 밖 값을 버리는 것과 겹쳐 새 test를 쓰지 않는다. 새 subprocess·서버 test는 쓰지 않는다. process를 띄워 보는 확인은 이 계획이 하지 않는다.
- 남지 않음: `grep -n "unhandledrejection" packages/core/main/app-supervisor/main.ts`가 0줄이다(`installCrashHandler`가 대신 듣는다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(`CRASH_LOCATION_NAMES`와 `io.ts` catalog는 이 task가 소유한다). `desktop/main.ts`의 조립 한 줄은 이 task가 더한다.
- 안 쓰게 된 export: 없으면 "없음"
- 정한 것: 위 "정한 것" 외에 worker가 더 정한 것(예: `deadlineMs`, supervisor exit code)
- 넘길 줄: `main/daemon/core.ts`와 `wiring/apps.ts`를 최소로 고친 곳
- 계약 바꾸기 요청: agent runtime 재기동 제한이 필요하면 여기에 적는다
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: I/O worker 뜨기 전 crash는 log에 안 남는다. agent runtime 재기동 중복, stderr redaction 한계는 그대로다. 앱 process는 걸지 않았다.
