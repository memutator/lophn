# term-supervisor

shell main의 terminal supervisor가 host pipe의 `error`와 답이 없는 요청 때문에 앱 전체를 끝내거나 영영 기다리지 않게 한다. host가 끝난 원인(exit code, signal, stderr 끝)을 log에 남긴다. 거절된 입력을 성공으로 보지 않고, 조각 하나가 거절된 paste의 나머지 조각은 보내지 않는다.

- 단위: term (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/main/terminal/{supervisor,ipc}.ts`
  - `packages/shell/main/terminal/supervisor_test.ts`
  - `packages/shell/main/desktop/wiring/coding.ts`
  - `packages/shell/renderer/terminal/displays.ts`
- 읽을 것:
  - 계획 README "정한 것"의 "shell은 core의 pipe 방어를 import하지 않고 spawn하는 곳에 직접 쓴다"
  - architecture: `project-docs/architecture/terminal-agent.md` 지키는 것 11(PTY 수명, 입력과 `respond`), 결정 "터미널 진단 기록은 이벤트 이름·mode·개수만 남긴다"
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/shell/main`·`packages/shell/renderer`(boundary `shell`)
  - `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: host pipe 줄 protocol(`packages/shell/terminal-host/main.ts`의 `HostRequest`, 답 줄 `{id, reply, runtime}`), `TerminalReply`·`TerminalFailure`(`packages/shell/ipc/terminal.ts`, 고치지 않는다), `ctx.log`(`packages/shell/main/desktop/wiring/context.ts`)
  - 기대는 것: `term-host`가 host의 실패와 끝나는 이유를 stderr에 한 줄씩 쓴다. 이 task가 stderr를 pipe로 받아 끝부분을 남긴다. `term-host`가 아직 합쳐지지 않았어도 이 task는 그대로 돈다(stderr가 비어 있을 뿐이다).

## 할 일

1. **host child와 pipe의 `error`를 받는다(term #9의 host 쪽).** shell main은 처리 못 한 예외나 reject 하나에 `app.exit(1)`한다(`packages/shell/main/desktop/wiring/crash.ts`). 지금 `supervisor.ts`의 `ensure()`·`revive()`는 `child.on("exit")`만 건다.
   - host가 `exit`가 보이기 전에 죽으면 다음 input·resize의 `current.stdin?.write(payload)`가 EPIPE를 stdin `error`로 낸다. 받는 곳이 없어 앱이 끝난다.
   - execPath spawn이 실패하면(EAGAIN 등) child `error`가 나고 `exit`는 오지 않는다. 그래서 앱이 끝나거나 `onExit()`가 돌지 않는다.
   - `void readLines(stdout, ...)`에 `.catch`가 없어 stdout stream 오류가 unhandledRejection이 된다.
   - 고치는 법: `ensure()`와 `revive()`에 똑같이 있는 여섯 줄을 `attach(proc)` 하나로 모은다. 그 안에서 `proc.on("exit", ...)`, `proc.on("error", ...)`, `readLines(...).catch(...)` 셋이 모두 같은 끝 처리를 부른다. 끝 처리는 child마다 한 번만 돌고(지역 flag), 그 child가 지금 `child`일 때만 `onExit`를 부른다(새 host를 띄운 뒤 옛 host의 늦은 event가 새 host를 lost로 만들지 않게). `proc.stdin?.on("error", () => {})`와 stderr(아래 3)의 `error` listener도 단다. 한 줄짜리라 core의 `responsiveness/pipe.ts`를 옮기지 않고 그 자리에 쓴다.
   - `HostProcess` type에 `on("error")`, `stdin.on`, `stderr`를 더한다. `spawnNodeHost`가 돌려주는 `ChildProcess`가 그대로 맞아야 한다.
2. **요청 기한을 둔다(term #8).** 지금 `request()`는 `pending.set(id, resolve)` 뒤 아무것도 기한을 두지 않는다. host event loop가 멈추거나 host가 답 줄을 내지 못하면(던진 요청, 버린 줄) renderer의 IPC가 영영 기다린다.
   - `request()`에 timer를 둔다(`REQUEST_TIMEOUT_MS = 10_000`, 모든 요청에 하나). 기한이 지나면 pending에서 지우고 `{ ok: false, reason: "host_lost", message: "terminal host did not answer" }`로 푼다. 답이 오면 timer를 지운다. 늦은 답은 지금처럼 `pending.get`이 비어 버려진다. close·restart는 host가 최대 2초쯤 종료를 확인하므로 10초면 넉넉하다. heartbeat는 두지 않는다.
   - "읽지 못한 줄에 답하기"는 기한으로 해결한다. host가 parse하지 못한 요청 줄과 supervisor가 parse하지 못한 답 줄에는 id가 없어 어느 요청의 답인지 알 수 없다. 그 요청은 기한에 `host_lost`로 끝난다. 던진 요청에 대한 답은 `term-host`가 host 안에서 만든다.
   - timer는 `createSupervisor`의 option으로 주입하거나, test가 `node:test`의 `mock.timers`로 돌린다. 실제로 10초를 기다리는 test는 쓰지 않는다.
3. **host가 끝난 원인을 남긴다(term #15).** 지금 `child.on("exit", () => onExit())`는 code와 signal을 버린다. host stderr는 `spawnNodeHost`에서 `inherit`라 설치한 앱에서는 아무 데도 남지 않는다. `coding.ts`의 `hostLost` listener는 runtime만 다시 보낸다.
   - `spawnNodeHost`의 stdio를 `["pipe", "pipe", "pipe"]`로 바꾼다. `attach()`에서 stderr를 받아 마지막 4 KiB를 메모리에 두고, 받은 조각은 지금처럼 `process.stderr`로도 흘린다(개발 terminal에서 보이던 것이 그대로 보이게).
   - `exit`의 `(code, signal)`과 stderr 끝을 `onExit`로 넘긴다. `SupervisorListener.hostLost?(exit?: { code: number | null; signal: string | null; stderr: string })`로 싣는다. host가 스스로 끝났을 때(`onExit`)만 싣고, `stop()`·`markHostLost()`에서는 싣지 않는다. 인자가 선택이라 `packages/shell/main/desktop/wiring/agent.ts`의 `hostLost()` listener는 고치지 않아도 맞는다.
   - `coding.ts`에서 `offOutputs`를 만드는 `terminals.on({... hostLost() ...})` listener가 인자를 받으면 `ctx.log`로 한 줄 쓴다: `terminal host exited: code=<code> signal=<signal> stderr=<끝>`. core diagnostics(새 `location` 값)와 terminal trace file(`diagnostics.trace`가 켜졌을 때만 쓰는 file)은 쓰지 않는다. 앱 종료 때는 `stop()`에서 `offOutputs()`가 먼저 불려 이 줄이 남지 않는다.
4. **`typeInto`가 답을 버리지 않는다(term #35).** 지금 `ipc.ts`의 `typeInto`는 `await deps.host.request(...)` 뒤 `reply.ok`를 보지 않는다. 그래서 host가 거절했거나 사라져도 `coding.ts`의 `interrupt()`가 `{ ok: true }`를 돌려주고 tracker에 `humanInput`을 알린다(그 try/catch는 지금 닿지 않는다). GUI `terminals.type`도 실패를 모른다.
   - `typeInto`도 옆의 `signalForeground`처럼 `!reply.ok`면 `throw new Error(reply.message)`한다. `interrupt()`는 이미 throw를 `unavailable`로 바꾸고, GUI의 `type`(`packages/shell/main/terminal/gui.ts`)은 이미 `.catch`로 log한다. 둘 다 고칠 것이 없다.
   - `open` 흐름(`ipc.ts`의 `open:`)에서 resume 줄·command를 치는 `await typeInto(...)`를 try/catch로 감싸고 실패는 버린다. 탭은 이미 열렸으므로, 친 줄이 거절됐다고 open IPC 전체를 실패로 만들지 않는다. 다시 치지 않는다.
5. **거절된 paste 조각 뒤의 조각을 보내지 않는다(term #36).** 지금 `displays.ts`의 `view.onData` handler는 `splitInput(text)` 조각을 `.then`으로 이어 보낸다. 한 조각이 거절돼도 trace만 남기고 나머지를 보낸다. 그래서 bracketed paste가 닫는 `ESC[201~` 없이 끝나거나 중간이 빠진 채 PTY에 들어간다.
   - onData 한 번(paste 하나)마다 지역 flag를 두고, 한 조각이 거절되면 그 뒤 조각은 보내지 않는다. 건너뛴 조각은 `input_refused` trace를 남기지 않는다(거절된 첫 조각만 남긴다). 다음 onData는 새로 시작한다. DECSET 2004 처리는 하지 않는다.

## 정한 것

- 기한은 새 이유(`timeout`)를 만들지 않고 `host_lost`를 쓴다. 새 값은 `packages/shell/ipc/terminal.ts`와 renderer 문구를 바꾼다.
- 기한은 요청 종류마다 다르게 두지 않고 10초 하나다. 가장 긴 정상 요청(close·restart)이 2초쯤이다.
- 원인 기록은 `ctx.log`(지금은 `console.log`) 한 줄이다. README와 계획이 core diagnostics를 쓰지 않기로 했고, trace file은 사람이 켠 진단 기록이라 늘 쓰는 곳으로 바꾸지 않는다.
- host stderr는 pipe로 받되 main의 stderr로도 흘린다. `inherit`일 때 개발 terminal에 보이던 것을 잃지 않는다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test(`packages/shell/main/terminal/supervisor_test.ts`, 가짜 `HostProcess`(EventEmitter)를 `spawnHost`로 주입한다. subprocess 없음):
  - "host child가 exit 없이 `error`를 내도 main이 던지지 않고, 기다리던 요청이 `host_lost`로 끝나며 `hostLost`가 한 번 불린다"
  - "답이 오지 않는 요청은 기한 뒤 `host_lost`로 끝나고, 늦게 온 답은 무시된다"
- 남지 않음: `grep -n "void readLines" packages/shell/main/terminal/supervisor.ts`가 0줄이다.

## 보고

`.claude/skills/orchestrate/brief-template.md` "보고" 꼴. 특히:
- 등록할 것: `project-docs/flows/tests/shell.yaml`의 `packages/shell/main/terminal/supervisor_test.ts` 줄은 지금 `covers: []`다. 새 case가 덮는 outcome이 있으면 lead가 고친다. host가 끝날 때 log 한 줄이 생긴 것은 lead가 `project-docs/architecture/terminal-agent.md`에 맞춘다.
- `ctx.log`는 `console.log`라 설치한 앱에서 file로 남지 않는다. 그것으로 모자라면 "알려진 미완 동작"에 적는다(고치지 않는다).
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
