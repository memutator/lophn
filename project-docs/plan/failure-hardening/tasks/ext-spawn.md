# ext-spawn

extension이 띄우는 자식 process(`nodeSpawn`)가 pipe 오류, 이른 `exit`, 앱 종료, 시작 실패에서 main을 죽이거나 원인을 잃지 않게 하고, 사람의 login shell env를 `nodeSpawn` 한 곳이 갖게 한다. harness-gui 입구(`index.ts`)는 `start` 실패와 `stop` 기한을 지킨다.

- 단위: shell (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/main/desktop/wiring/extensions.ts`
  - `packages/shell/main/extensions/bundled/harness-gui/index.ts`
  - `packages/shell/main/extensions/bundled/harness/host.ts`
- 읽을 것:
  - 계획 README "정한 것"(`project-docs/plan/failure-hardening/README.md`): shell은 core의 pipe 방어를 import하지 않는다, login shell env는 `nodeSpawn`이 가진다
  - architecture: `project-docs/architecture/extension.md` 지키는 것 6(spawn 계약), 8(process는 extension이 끈다), `project-docs/architecture/harness-gui.md` 지키는 것 4, 6, 7, 9
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `extension-api`, `extension-host`, `shell-extension`. `project-docs/module-catalog.yaml`의 `packages/shell/main`(bundled extension은 protocol, base, 자기 폴더만 import한다)
  - skill: `.claude/skills/harness-gui/SKILL.md`(이 extension을 고칠 때의 순서와 확인), `.claude/skills/write-test/SKILL.md`
  - 대조 기록(commit하지 않은 file이라 main checkout 절대 경로로 읽는다): `/home/pyosechang/projects/lophn/research_notes/error-handling-verify/harness-gui.md`의 2절과 #1, #2, #7, #9, #11, #12, #19, #20, `/home/pyosechang/projects/lophn/research_notes/error-handling-verify/terminal.md`의 #9, #2, #3
- 계약:
  - 쓰는 것: `ExtensionSpawn`·`ExtensionProcess`·`ExtensionContext`(`packages/protocol/extensions/manifest.ts`, 바꾸지 않는다), adapter 계약 `HarnessGuiAdapter`·`HarnessGuiRun`(`packages/shell/main/extensions/bundled/harness-gui/adapter.ts`, 바꾸지 않는다), `cliEnv`(`packages/shell/main/terminal/gui.ts`, 그대로 쓴다), `prependPath`(`packages/base/os/mod.ts`), `redactCredentials`(`packages/base/telemetry/log.ts`, import만)
  - 내놓는 것(type은 그대로, 동작만 바뀐다. adapter task 넷이 같은 wave에 이 동작을 모른 채 고치므로 adapter에 기대는 것을 만들지 않는다):
    - 자식의 stdin·stdout·stderr `error`가 main으로 가지 않는다. 닫힌 stdin에 `write`·`end`는 아무것도 하지 않는다.
    - `onExit`는 한 번만 온다. 시작한 process는 `close`가 오거나 `exit` 뒤 250ms가 지나면(먼저 온 것) 온다. `onExit` 뒤에는 `onStdout`·`onStderr` listener를 부르지 않는다.
    - 시작하지 못하면 그 오류 글(`spawn claude ENOENT` 등)이 `onStderr` listener에 먼저 가고 `onExit(null)`이 온다.
    - 띄운 process의 env는 `process.env` < login shell env < (`lophn` CLI 폴더를 앞에 둔 PATH) < 넘긴 env다(`cliEnv`가 data root와 session 표지를 맞춘다).
    - 앱이 끝날 때(wiring `stop()`) 살아 있는 자식의 process group 모두에 SIGTERM이 동기로 간다.

## 할 일

순서는 crash 막기 → 수명 → 원인 → env → 입구다. 근거는 architecture `extension.md` 6·8과 `harness-gui.md` 4·7·9.

1. **pipe 오류(gui #11, term #9의 `nodeSpawn` 쪽).** 지금: CLI가 죽는 사이 adapter가 승인 답이나 omp 요청을 쓰면 `child.stdin`에 EPIPE `error`가 오는데 listener가 없어 uncaught exception이 되고 `packages/shell/main/desktop/wiring/crash.ts`가 앱을 끈다. `nodeSpawn`에서 `child.stdin`, `child.stdout`, `child.stderr`에 빈 `error` listener를 단다(core `packages/core/supervision/responsiveness/pipe.ts`의 `toWriter`와 같은 한 줄, import하지 않고 직접 쓴다). `write`·`end`는 `child.stdin.writable`이 false면 아무것도 하지 않는다.
2. **exit와 stdio drain(gui #12).** 지금: `exit`가 stdout을 다 읽기 전에 와서 마지막 `result` 줄이나 stderr 꼬리를 잃을 수 있고, Claude `spawned()`는 exit에서 SDK stdout을 `end()`하므로 그 뒤 온 data가 write-after-end가 된다. `exit`를 받으면 `close`나 250ms 중 먼저 온 때에 `onExit` listener를 부른다. 한 번만 부른다(아래 3의 `error` 길과 같은 flag). 그 뒤 온 stdout·stderr data는 listener에 주지 않는다. `close` 하나만 기다리지 않는다: CLI가 띄운 손자가 pipe를 물려받으면 `close`가 오지 않는다.
3. **시작 실패 원인(gui #1, term #3).** 지금: `child.on("error", ...)`가 오류를 버리고 `exits(null)`만 부르므로 headless host가 "`claude failed: exit code null`"을 쓰고 ENOENT·EACCES를 가르지 못한다. 또 시작한 뒤의 `error`(kill 실패 등)도 `exit(null)`로 보낸다. `error` handler는 `child.pid === undefined`(시작하지 못함)일 때만 `error.message`를 stderr listener들에게 먼저 주고 exit를 알린다. 이를 위해 `onStderr`는 listener를 목록에 모으고 `child.stderr`의 `data`는 그 목록에 나눈다. 시작한 뒤의 `error`는 무시한다. `ExtensionProcess.onExit`의 모양은 바꾸지 않는다.
4. **앱 종료 때 자식(gui #20).** 지금: will-quit → wiring `stop()` → `void registry.stop()`은 비동기라 Claude·omp의 `stop()`이 polite 단계를 기다리는 동안 앱이 끝나 CLI가 남는다. `register` 안에 살아 있는 자식 `Set`을 두고 `nodeSpawn`이 시작한 child를 넣고 `onExit`를 부를 때 뺀다(전역 상태로 두지 않는다). wiring `stop()`은 `void registry.stop()` 뒤에 그 `Set`의 모든 process group에 `kill()`과 같은 길로 SIGTERM을 동기로 보낸다(win32는 `signalTree`). SIGKILL 유예 timer는 앱이 끝나 돌지 않는다: SIGTERM까지만 받아들인다. `packages/shell/main/desktop/main.ts`, `packages/shell/main/desktop/wiring/context.ts`, `packages/shell/main/desktop/wiring/crash.ts`는 고치지 않는다.
5. **login shell env(gui #2, term #2).** 지금: harness-gui `index.ts`의 `login ??= loginEnv(ctx.spawn)`이 실패(5초 timeout, 표시 없음)한 Promise까지 앱이 끝날 때까지 기억해 느린 rc file 한 번이면 모든 GUI가 앱 PATH로 뜨고, headless `harness` extension은 login env를 아예 읽지 않아 Linux에서 데스크톱 메뉴로 띄운 앱의 harness가 ENOENT로 실패한다.
   - `index.ts`의 `splitEnv`, `parseLoginEnv`, `loginEnv`, `ENV_BEGIN`·`ENV_END`·`ENV_WAIT_MS`·`LOGIN_ONLY`를 `extensions.ts`로 옮긴다(tmux·updater guard, 표시 사이 값만 읽기, darwin 줄바꿈 출력은 그대로). 조회 process는 login env를 얹지 않은 같은 spawn 길로 띄운다.
   - 성공한 결과만 지닌다. 실패하면 지니지 않고, 다음에 env가 필요할 때 다시 읽는다. 읽는 중이면 그 하나를 같이 기다린다(동시에 둘 띄우지 않는다).
   - 다시 읽는 때: `registry.sync()`를 부르는 곳 모두의 앞(`sync`, `handlers()`, Settings의 `list`. 그래서 extension은 첫 조회가 끝난 뒤에 activate된다), GUI 열기 앞(`bindTabGui`의 `handlers()`가 돌려주는 handlers의 `gui`를 감싸 기다린다), 그리고 env 없이 `nodeSpawn`이 불렸을 때(기다리지 않고 뒤에서 시작해 다음 spawn이 쓴다).
   - win32는 조회하지 않는다(login shell이 없고 지금도 늘 실패한다).
   - `nodeSpawn`은 `cliEnv({ base: { ...process.env, ...login, ...cliPath }, dataRoot, given: options?.env })`로 합친다. `cliPath`는 `LOPHN_CLI`가 절대 경로일 때 `prependPath(<login이 얹힌 env>, dirname(cli), process.platform)`이다.
   - `harness/host.ts`의 `harnessEnv`에서 PATH 만지기(`prependPath`, `LOPHN_CLI` 읽기)를 지운다. 남기면 host가 넘긴 PATH가 login PATH를 덮는다.
   - `index.ts`의 `spawnFor`는 기다릴 것이 없어진다. 탭 hook env만 얹는 동기 함수로 줄인다(`{ ...terminal?.env, ...options?.env }`).
6. **headless host의 실패 글(term #3).** `host.ts` `execute`의 실패 글(`why`: `end?.error`, stderr 꼬리)을 `redactCredentials`로 가린 뒤 싣는다. 시작 실패는 3으로 stderr에 원인이 오므로 "`claude failed: spawn claude ENOENT`"가 된다.
7. **`start`가 던질 때(gui #7 바깥 쪽).** 지금: `gui()`의 `await adapter.exitTui(...)`·`await adapter.start(...)`가 던지면 `packages/shell/main/terminal/gui.ts`의 catch로 가고, 이미 연 handle은 입력 listener 없이 남아 빈 GUI가 된다(지키는 것 7과 어긋난다). `exitTui`부터 `start`까지를 try/catch로 감싸 `fail(session, { code: "internal", message })`로 끝낸다(던졌다는 것은 adapter가 예상하지 못한 것이라 `internal`. `Result`로 온 실패는 지금처럼 adapter의 code를 쓴다). message는 `redactCredentials`를 거친다. `within()`은 `work`가 reject되면 `otherwise`로 끝낸다(지금은 `void work.then(...)`이 unhandledRejection이 된다).
8. **떠 있는 promise(gui #9의 `index.ts` 쪽).** 지금: `onClose`의 `void run?.stop()`, 시작 중 닫힌 handle의 `void started.value.stop()`, `publish` 안의 `void followSession(tab)`이 reject되면(omp `stop()`의 `readState` TypeError 등) `crash.ts`가 unhandledRejection으로 앱을 끈다. 셋 다 `.catch`로 받는다. 닫힌 handle이라 보일 곳이 없으니 버린다.
9. **`tui()`의 `stop` 기한(gui #19의 `index.ts` 쪽).** 지금: restart handoff의 `await run.stop()`에 기한이 없어 답 없는 CLI면 toggle이 끝나지 않는다. `within(STOP_WAIT_MS, run.stop().then(() => true), false)`(8초)로 감싼다. 기한을 넘으면 handle은 닫고 TUI 명령은 치지 않으며(지키는 것 6: 앞 process가 끝났는지 모른다) Error를 던져 toggle 답이 `failed`와 그 글을 싣게 한다("The coding agent did not stop in 8 seconds, so the terminal view was not started." 같은 글).

정한 것:
- login env 조회는 extension activate 앞에서 한 번 기다린다. 이유: `ExtensionSpawn`은 동기라 spawn 안에서 기다릴 수 없고, headless host는 `ctx.spawn`만 쓰므로 activate 전에 env가 있어야 같은 PATH를 얻는다. 잃는 것: rc file이 느리면 앱을 켠 뒤 extension이 서는 데 최대 5초 늦다(앱 시작은 막지 않는다).
- `lophn` CLI 폴더를 PATH 앞에 두는 일을 `host.ts`에서 `nodeSpawn`으로 옮긴다. 이유: 위 5. GUI가 띄운 CLI도 터미널 탭의 CLI(`packages/shell/main/desktop/wiring/agent.ts`의 `cliPath`)와 같이 `lophn`을 찾게 된다.
- 시작 실패 원인은 stderr로 보낸다(README 결정). GUI adapter 셋(Claude, Codex, OpenCode)은 `proc.pid === undefined`에서 "`<bin>` was not found on PATH."로 먼저 끝나므로 이 글을 보지 않는다. omp와 headless host만 원인을 보인다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음. 지키는 동작(pipe 오류, exit 순서, 종료 때 SIGTERM)은 진짜 자식 process가 있어야 보이고, subprocess test는 사람에게 먼저 묻는다(AGENTS.md). 새로 만들지 않는다. 바꾼 뒤 `packages/shell/main/extensions/bundled/harness-gui/*_test.ts`(adapter test 넷)와 `packages/shell/main/extensions/registry_test.ts`가 그대로 통과하는지 돌린다.
- 남지 않음: `grep -rn "parseLoginEnv\|loginEnv\|ENV_BEGIN\|prependPath" packages/shell/main/extensions`가 0줄이다.

## 보고

`.claude/skills/orchestrate/brief-template.md` "보고" 꼴. 아래 둘은 꼭 쓴다.
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 예를 들어 win32의 종료 때 `signalTree`가 끝나기 전에 앱이 끝나는지, SIGTERM을 무시하는 CLI가 남는지. 없으면 "없음"
- 문서와 달라진 곳: `project-docs/architecture/extension.md` 6·8, `project-docs/architecture/harness-gui.md` 9가 이 변경과 다르게 적힌 줄(lead가 고친다. worker는 project-docs를 고치지 않는다).
