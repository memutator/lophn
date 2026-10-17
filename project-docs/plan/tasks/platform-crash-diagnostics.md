# platform-crash-diagnostics

daemon과 agent runtime이 처리 못한 예외(`unhandledrejection`, `error`)로 죽을 때 원인이 stderr에만 남고 `diagnostics.list`에는 없는 bug를 고친다. 죽기 직전에 I/O worker의 diagnostics ingress로 분류 한 줄을 쓰고, 쓰지 못하면 stderr로만 둔다.

- 단위: platform (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/diagnostics/crash.ts` (새 file), `packages/core/diagnostics/mod.ts`
  - `packages/core/main/worker/io.ts`
  - `packages/core/main/daemon/wiring/diagnostics.ts`
  - `packages/core/main/daemon/wiring/context.ts` (`Late`에 칸 하나 더함)
  - `packages/core/main/daemon/wiring/lophn-agent-runtime.ts` (`afterReady`의 `startAgentRuntimeChild`에 한 줄만)
  - `packages/core/main/agent-runtime/main.ts`
  - `packages/core/lophn-agent/run-loop/runtime.ts` (`AgentRuntimeDeps`와 `onMessage`에 diagnostic 전달만)
- 읽을 것:
  - 이슈: `project-docs/issues/platform.md`의 "daemon과 agent runtime의 crash가 diagnostic log에 안 남는다" (정한 것: log에 쓰다가 또 실패하면 stderr로만 둔다). 이 주제의 architecture 문서는 없다.
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `diagnostics`(없으면 `core`), `project-docs/module-catalog.yaml`의 `packages/core/diagnostics`, `packages/core/main`(wiring file끼리 import하지 않는다. 둘 이상이 쓰는 값은 `wiring/context.ts`로 나눈다)
  - 코드(먼저 읽는다): `core/diagnostics/{pipe,log,list,files}.ts`, `protocol/diagnostics/write.ts`(`DIAGNOSTICS_WRITE_OP`, `diagnosticsWriteRequestSchema`), `protocol/supervision/supervision.ts`(`diagnosticSchema`의 `lophn_internal`, `workerRequestEnvelopeSchema`, `childMessageSchema`에 `diagnosticSchema`가 이미 있다), `core/main/worker/io.ts`(`runPlatformIo`), `core/main/daemon/wiring/{supervision,storage}.ts`(`ctx.io.send`, `ctx.ioListeners`)
- 계약:
  - 쓰는 것(바꾸지 않는다): `DIAGNOSTICS_WRITE_OP`와 요청 모양(`{type:"worker_request", request_id, op, payload:{records:[Diagnostic], dropped}}`), `diagnosticSchema`의 `lophn_internal`(`component`, `observed_at`, `error_class`, `location`, `count`), child -> core `diagnostic` ChildMessage.
  - 내놓는 것: `core/diagnostics/crash.ts`의 위치 ID 상수와 `installCrashHandler`, `wiring/context.ts` `Late`의 새 칸 `diagnosticsWrite`(다음 task `platform-component-checks`는 쓰지 않는다).

## 지금 코드에서 확인한 사실 (설계 근거)

- `diagnostics.list`는 I/O worker가 쓰는 `<root>/logs/platform-N.jsonl`만 읽는다(`list.ts`, `files.ts`). daemon이 직접 쓰는 `maintenance.jsonl`·`shell-view.jsonl`은 list에 안 보인다. 그래서 crash도 ingress로 가야 list에 나온다.
- 제품의 I/O worker(`runPlatformIo`)는 `currentAuthority: () => undefined`라 diagnostics 요청을 전부 `forbidden`으로 거절하고, catalog의 `locations`가 `{}`라 `lophn_internal`을 전부 버린다. 아직 제품에서 diagnostics write를 보내는 곳이 없다. 이 둘을 채우는 것이 이 task의 일부다.
- agent runtime은 daemon이 감독하는 별도 process라 I/O worker 통로가 없다. 감독 pipe로 core에 `diagnostic` ChildMessage를 보낼 수는 있지만(`childMessageSchema`) core의 `startAgentRuntimeChild`(`runtime.ts`)가 이 메시지를 안 받는다.
- 앱 supervisor(`app-supervisor/main.ts`)와 앱 process(`apps/runtime/entrypoint/crash.ts`)는 이 task 대상이 아니다.

## 할 일

1. 새 `packages/core/diagnostics/crash.ts` (순수, IO는 인자로 받는다). `mod.ts`에서 내보낸다.
   - `CRASH_LOCATIONS = { daemon: "daemon-crash", agentRuntime: "agent-runtime-crash" }` (`locationId` 규칙 `^[a-z][a-z0-9._-]*$`). 위치 ID -> 표시 문자열(file 경로) 표를 같이 둔다: I/O worker catalog의 `locations`에 쓰인다.
   - `crashDiagnostic({ component, location, at }): Diagnostic`: `{ type: "diagnostic", kind: "lophn_internal", payload: … }` 꼴(`diagnosticSchema`)이고 `error_class: "internal_exception"`, `count: 1`.
   - `installCrashHandler({ target, write, stderr, exit, deadlineMs })`: `target.addEventListener("unhandledrejection"|"error", …)`로 한 번 감는다(둘 다 `preventDefault()`). 처리 순서: (1) 이미 처리 중이면(두 번째 crash) 바로 `exit(1)`. (2) 원인 글을 `stderr`에 먼저 쓴다(지금처럼 stderr에 남는 것이 fallback이다. 값은 기존 redaction을 거친 문장만. agent runtime은 `main/agent-runtime/redact.ts`의 `redact`). (3) `write(diagnostic)`를 `deadlineMs`(예: 2초) 안에서 기다린다. 실패·기한 초과는 삼킨다. (4) `exit(1)`. 해제 함수를 돌려준다. IO(`target`, `stderr`, `exit`, 시계)는 인자라 전역을 읽지 않는다.
2. `core/main/worker/io.ts`의 `runPlatformIo`(제품 entry)
   - `currentAuthority`를 고정 authority로 바꾼다: `principal: "core"`, `process: "platform/core"`, `task: "diagnostics"`, `scope: [DIAGNOSTICS_WRITE_OP]`, `permits`는 `lophn_internal`만 true. 이 pipe는 core만 쓰는 비공개 pipe이고 `createPlatformIo`가 이미 `session.credentialUsable`일 때만 authority를 쓴다. "Product authority is supplied by the core entry composition" 주석을 맞춘다.
   - `catalog`: `components`에 `"lophn-agent/runtime"`을 더하고 `locations`를 `crash.ts`의 표로 채운다.
   - 진단 요청 처리(`onParent`의 diagnostics 분기)에서 `ingress.accept`가 ok이면 응답을 보내기 전에 `await log.flush()`를 한다(죽기 직전 쓰기가 파일에 닿은 뒤에 응답이 가게 한다. 이 분기 안 한 곳만).
3. `core/main/daemon/wiring/context.ts`: `Late`에 `diagnosticsWrite: (diagnostic: Diagnostic) => Promise<boolean>`를 더한다(`ctx.provide("diagnosticsWrite", …)`로 채운다).
4. `core/main/daemon/wiring/diagnostics.ts`
   - `prepare`: `ctx.ioListeners.push({ onMessage })`로 `worker_response`를 받아 대기 중인 `request_id`를 푸는 작은 표(wiring 닫힘 안)를 만들고, `diagnosticsWrite`를 `ctx.provide`한다. 구현: `request_id`를 만들어 `ctx.io.send("platform/io", { type: "worker_request", request_id, op: DIAGNOSTICS_WRITE_OP, payload: { records: [d], dropped: 0 } })`, 응답(`ok: true`)을 기한 안에 받으면 true. `ctx.io`는 호출 때 읽는다(supervision wiring이 나중에 채울 수 있다).
   - `start`: `installCrashHandler({ target: globalThis, write: …(component "platform/core", location `CRASH_LOCATIONS.daemon`), stderr, exit: Deno.exit })`를 건다. `closeIntake`(종료 첫 단계)에서 해제 함수를 부른다(정상 종료 중의 예외가 exit(1)로 바뀌지 않게). 해제 함수는 wiring 닫힘 안에 둔다(전역 mutable 상태가 아니다).
5. `core/lophn-agent/run-loop/runtime.ts`: `AgentRuntimeDeps`에 `diagnostic?(message: Extract<ChildMessage, { type: "diagnostic" }>): void`를 더하고 `callbacks().onMessage` 맨 앞에서 `message.type === "diagnostic"`이면 `lophn_internal`일 때만 `deps.diagnostic?.(message)`로 넘기고 끝낸다(다른 kind는 버린다). 나머지 흐름은 그대로.
6. `core/main/daemon/wiring/lophn-agent-runtime.ts`: `startAgentRuntimeChild({ … })`에 `diagnostic: (message) => void ctx.diagnosticsWrite({ ...message, payload: { ...message.payload, component: AGENT_RUNTIME_KIND } })` 꼴로 한 줄을 더한다. 보낸 child가 `lophn-agent/runtime`이라는 것을 core가 알므로 child가 적은 `component`를 믿지 않고 그 값으로 덮는다(`AGENT_RUNTIME_KIND`는 이 file이 이미 import한다). `diagnosticsWrite`가 실패해도 삼킨다.
7. `core/main/agent-runtime/main.ts`
   - `Runtime`에 `reportInternal(): Promise<void>`를 더한다: `send(child, { type: "diagnostic", kind: "lophn_internal", payload: { component: "lophn-agent/runtime", observed_at, error_class: "internal_exception", location: CRASH_LOCATIONS.agentRuntime, count: 1 } })`(`send` helper가 이미 있다. 시각은 `new Date().toISOString()`을 `import.meta.main` 쪽에서 `installCrashHandler`가 받는 시계로 넘기거나 `Runtime`이 받은 clock을 쓴다).
   - `import.meta.main` 블록: `startAgentRuntime`이 성공한 뒤 `installCrashHandler({ target: globalThis, write: …runtime.reportInternal, stderr: Deno.stderr.writable, exit: Deno.exit })`를 건다. `stop`(SIGINT/SIGTERM)과 `await runtime.done` 뒤에는 해제한다. `startAgentRuntime`이 실패한 기동 오류는 지금처럼 stderr + `exit(1)`이다.

## 정한 것

- 기록은 `kind: lophn_internal`의 고정 분류(`internal_exception`, 위치 ID, 구성 요소) 한 줄이다. 오류 원문·stack은 log가 아니라 stderr에만 간다(`diagnostics`는 자유 text를 받지 않는다는 기존 규칙, `protocol/diagnostics/write.ts` 머리 주석).
- daemon crash listener는 `main.ts`가 아니라 diagnostics wiring이 `start`에서 건다. 쓰는 길(`ctx.io`)이 그때 생기기 때문이다. 그전(기동 중) 예외는 지금처럼 stderr + 종료다.
- 쓰기가 실패하면(I/O worker 없음, 기한 초과) stderr로만 둔다(이슈의 정한 것).
- component 이름은 `Diagnostic`이 요구하는 process kind 꼴(`platform/core`, `lophn-agent/runtime`)이다. `DIAGNOSTIC_COMPONENTS`(status 점검 이름)와 다른 체계다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(crash 분류 기록은 화면·내부 구현이고 데이터를 잃는 규칙이 아니다. 새 test를 만들지 않는다).
- 남지 않음: `grep -n "currentAuthority: () => undefined" packages/core/main/worker/io.ts`가 0줄. `grep -rn "locations: {}" packages/core/main/worker/io.ts`가 0줄.
- 직접 확인(필수, 코드에 남기지 않는다): `mkdir -m 700 -p $PWD/.dev-data/platform-crash-diagnostics && export LOPHN_HOME=$PWD/.dev-data/platform-crash-diagnostics`. (a) daemon: 임시로 `diagnostics.ts`의 `start` 끝에 `setTimeout(() => Promise.reject(new Error("probe")), 3000)`을 넣고 core를 띄워 3초 뒤 process가 exit 1로 끝나고 `$LOPHN_HOME/logs/platform-0.jsonl`에 `component: "platform/core"`, `code: "lophn_internal"` 줄이 생기는지 본 뒤 그 줄을 지운다. (b) agent runtime: 같은 방식으로 `main.ts`의 `import.meta.main` 블록에 임시 rejection을 넣어 `logs/`에 `lophn-agent/runtime` 줄이 생기는지 본 뒤 지운다. (c) I/O worker가 없을 때(예: `ctx.io`를 못 쓰는 경우)는 기한 안에 exit 1로 끝나는지만 코드로 확인한다. `$!`로 받은 PID만 끈다. 실제 `~/.lophn`은 건드리지 않는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 정한 것
- 넘길 줄: `wiring/lophn-agent-runtime.ts`는 다음 task `platform-component-checks`도 고친다. 이 task는 `startAgentRuntimeChild`의 `diagnostic` 한 줄만 건드렸다고 적는다.
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**: 앱 supervisor·앱 process·shell main의 crash, daemon 기동 중 crash는 이 task 밖이다
