# term-host

terminal host 안에서 요청 하나가 던져도 그 탭만 실패하고 host는 다른 탭에 계속 답하게 한다. main이 사라지거나 앱이 끝날 때 host가 PTY 자식을 SIGKILL까지 정리하고 끝나게 하며, 끝나는 이유와 PTY spawn 실패 원인을 stderr에 남긴다. 터미널 env 청소가 ssh-agent·X 인증·git 작성자·proxy 변수를 지우지 않게 한다.

- 단위: term (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/terminal-host/{cli,main,env}.ts`
  - `packages/shell/terminal-host/env_test.ts`
  - `packages/shell/terminal-host/main_test.ts`(새 file)
- 읽을 것:
  - 계획 README "정한 것"의 "터미널 env 청소는 이름 허용 목록을 둔다"
  - architecture: `project-docs/architecture/terminal-agent.md` 지키는 것 3(터미널 env), 11(PTY 수명과 ref·generation), 12(host가 가진 화면)
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/shell/terminal-host`(boundary `shell`)
  - `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: host pipe 줄 protocol(`HostRequest` in `packages/shell/terminal-host/main.ts`, `TerminalReply`·`TerminalFailure` in `packages/shell/ipc/terminal.ts`). 실패 이유는 지금 있는 `TerminalFailure` 값만 쓴다. `packages/shell/ipc/terminal.ts`는 고치지 않는다.
  - 내놓는 것: host가 끝나는 이유와 요청별 실패를 stderr에 한 줄씩 쓴다. `term-supervisor`가 host stderr를 pipe로 받아 끝부분을 log에 남긴다(그쪽 일이다. 이 task는 stderr에 쓰기만 한다). host의 stdin을 main이 닫거나 SIGTERM을 보내면 host는 PTY를 정리하고 스스로 끝난다.

## 할 일

1. **요청 하나의 예외를 그 요청에 가둔다(term #10).** 지금은 `cli.ts`의 `lines.on("line", async ...)`이 `await host.handle(request)`를 try 없이 부른다. `handle`이 던지면 unhandledRejection으로 host process가 끝나고, supervisor가 열린 탭을 모두 `unknown(host_lost)`로 만든다. 실제로 던지는 것은 `main.ts`의 `session.handle.resize(...)`다. PTY fd가 막 닫혔는데 node-pty의 `exit`가 아직 오지 않은 틈(ms 단위)에 `state === "running" && handle` 검사를 지나 native `ioctl`이 `EBADF`로 던진다.
   - `createHost`의 `handle`을 감싼다: 지금 분기는 안쪽 함수(예: `dispatch`)로 옮기고, `handle`은 `async`로 동기 throw와 reject를 모두 받아 `{ ok: false, reason: "host_lost", message: "terminal host failed: <error.message>" }`로 답한다. stack은 `console.error`로 stderr에 쓴다. 그 탭은 곧 node-pty `onExit`가 `exited`로 바꾸므로 따로 표시하지 않는다.
   - `Host.handle`의 type은 늘 `Promise<TerminalReply | TerminalSnapshotReply>`가 된다. 부르는 곳은 `cli.ts` 하나다.
   - `start()` 안 `session.handle?.onData(...)`의 `void acceptChunk(session, chunk)`에 `.catch`를 달아 stderr에 쓰고 넘긴다. 한 탭 출력의 parse 예외가 host 전체를 끝내지 않게 한다.
   - `restart()`의 `throw new Error("restart replayed input")`를 지운다. `start()`가 늘 `typed: []`인 새 `Session`을 만들어 닿지 않는 code다. 그러면 `Session.typed`는 쓰기만 하고 읽는 곳이 없으니 field와 `typed.push`, `typed.length = 0`도 지운다.
2. **main이 사라지면 host도 끝난다(term #11).** 지금 `cli.ts`의 `createInterface({ input: process.stdin })`에는 `close` 처리가 없다. main이 SIGKILL로 죽으면 stdin은 EOF가 되지만 살아 있는 PTY handle이 event loop를 붙잡아, host와 shell이 고아로 남는다(shell이 무언가를 출력해 stdout이 EPIPE로 터질 때까지). 
   - `lines.on("close", ...)`에서 아래 3의 종료 함수를 부른다. main에서 오는 pipe의 EOF가 가장 싸고 OS마다 같은 신호라 이것을 쓴다(`ppid` 감시는 하지 않는다).
   - `process.stdout.on("error", ...)`도 같은 종료 함수를 부른다. main이 사라진 뒤 `onRuntime`·출력 줄을 쓰다 EPIPE가 나도 처리하지 않은 `error`로 터지지 않게 한다.
3. **앱이 끝날 때 PTY 자식을 SIGKILL까지 정리하고, 아무도 보내지 않는 `host-lost` 요청을 지운다(term #12).** 지금 앱 종료는 supervisor `stop()`의 `child.kill("SIGTERM")`뿐이다. host에 SIGTERM handler가 없어 Node가 바로 죽고, 커널 hangup만 남는다. SIGHUP을 무시하는 shell group의 process는 남는다. host의 정리 code(`dispose()`·`finish()`)는 `host-lost` 요청에서만 도는데, 그 요청을 보내는 곳이 없다(grep에서 `main.ts`의 type·분기와 `cli.ts`의 주석뿐이다. `packages/shell/ipc/`와 `tests/`에는 없다).
   - `Host`에 `shutdown(): Promise<void>`를 둔다. 도는(`running`·`starting`) 모든 session에 지금 있는 `stop(session, deps.sleep)`을 함께 돌린다(SIGHUP, 1초 동안 group 확인, 그다음 SIGKILL, 다시 1초).
   - `cli.ts`에 종료 함수 하나를 둔다. 처음 한 번만 돌고(flag), `host.shutdown()`이 끝나면 `process.exit(code)`한다. SIGTERM(`process.on("SIGTERM", ...)`), stdin `close`(2), stdout `error`(2), 처리 못 한 예외가 부른다. 처리 못 한 예외(`process.on("uncaughtException" | "unhandledRejection", ...)`)는 stack을 stderr에 쓰고 code 1로 끝낸다. 나머지는 이유를 한 줄(`terminal host exiting: SIGTERM` 등)로 stderr에 쓰고 0으로 끝낸다.
   - `HostRequest`의 `{ id: string; type: "host-lost" }`과 `handle`의 그 분기를 지운다. 그러면 `dispose()`와 `finish()`는 부르는 곳이 없으니 지운다. `cli.ts` 92행 주석의 "host-lost"도 고쳐 쓴다("host가 사라졌을 때").
4. **PTY spawn 실패 원인을 남긴다(term #4).** 지금 `start()`의 `catch {`가 예외를 버리고 `failure_reason: "spawn_failed"`만 남긴다. 그래서 `SHELL`이 가리키는 file이 실행되지 않거나 cwd 권한이 없을 때 원인을 알 길이 없다. `catch (error)`로 받아 `program.file`과 `error.message`를 stderr에 한 줄 쓴다. 화면에 원인을 보이는 일(`TerminalRuntime`에 칸 더하기)과 `SHELL` 대신 다른 shell로 띄우기는 하지 않는다.
5. **env 청소에 이름 허용 목록을 둔다(term #5).** 지금 `env.ts`의 `SECRET_NAME`(`/(TOKEN|SECRET|PASSWORD|CREDENTIAL|KEYCHAIN|HANDLE|API_KEY|AUTH)/i`)이 `SSH_AUTH_SOCK`, `XAUTHORITY`, `GIT_AUTHOR_NAME`·`GIT_AUTHOR_EMAIL`을 지운다. 또 `INTERNAL_VALUE`의 `127\.0\.0\.1:\d{2,5}`가 `HTTP_PROXY=http://127.0.0.1:7890`를 지운다. 그래서 터미널 탭에서 ssh-agent와 local proxy가 사라진다.
   - `stripPlatformEnv`에서 `INTERNAL_NAME`과 `SESSION_MARKER_NAME` 검사 뒤, `SECRET_NAME` 앞에 허용 목록을 본다. 목록의 이름이면 이름 규칙과 값 규칙을 모두 건너뛰고 남긴다. 목록 밖의 이름에는 local port 값 규칙(`INTERNAL_VALUE`)을 그대로 둔다. lophn 자신의 endpoint 값은 `LOPHN_*` 이름이라 `INTERNAL_NAME`이 먼저 지운다.
   - 목록은 정확한 이름이다: `SSH_AUTH_SOCK`, `XAUTHORITY`, `GIT_AUTHOR_NAME|EMAIL|DATE`, `GIT_COMMITTER_NAME|EMAIL|DATE`, `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`, `FTP_PROXY`. proxy 이름은 소문자 꼴(`http_proxy` 등)도 받는다.
   - 파일 머리 주석(1~2행)에 "사용자 env는 남긴다"는 뜻을 한 줄로 더한다.

## 정한 것

- 요청 하나의 실패는 새 이유를 만들지 않고 `host_lost`로 답한다. `TerminalFailure`에 값을 더하면 `packages/shell/ipc/terminal.ts`와 renderer 문구가 따라 바뀐다. 지금도 "terminal is not running", "generation does not match"가 `host_lost`다.
- 격리는 `cli.ts`가 아니라 `createHost().handle`에 둔다. 그래야 subprocess 없이 주입한 가짜 `PtyAdapter`로 test할 수 있다.
- 처리 못 한 예외에서 host는 계속 돌지 않고 PTY를 정리한 뒤 끝난다. 요청 안의 예외는 1에서 이미 갇힌다. 그 밖의 예외는 상태를 믿을 수 없어서다.
- 종료 정리는 동기 `finish()`가 아니라 기다리는 `stop()`을 쓴다. `finish()`는 SIGHUP 바로 뒤(같은 tick)에 SIGKILL을 보내 shell이 history를 쓸 틈이 없다. 지금 앱 종료도 커널 hangup이라 shell이 정상으로 끝난다. 그보다 나빠지면 안 된다. main은 종료 정리를 기다리지 않는다(host가 2초쯤 더 살다 끝난다).
- `GIT_AUTHOR_*`·`GIT_COMMITTER_*`는 git이 정의한 세 이름(NAME, EMAIL, DATE)만 받는다. `GIT_AUTHOR_TOKEN` 같은 token 꼴 이름까지 통과시키지 않으려는 것이다.

## 끝남

- `npm run check`가 통과한다. 다만 새 `main_test.ts`가 `project-docs/flows/tests/shell.yaml`에 없어서 flows 단계가 실패하는 것은 예상한 일이다. project-docs는 고치지 말고 보고한다.
- 위험 test(`packages/shell/terminal-host/env_test.ts`, 표 하나로): "터미널 env는 `SSH_AUTH_SOCK`, `XAUTHORITY`, `GIT_AUTHOR_NAME`, `GIT_COMMITTER_EMAIL`, 127.0.0.1 port를 가리키는 `HTTP_PROXY`·`https_proxy`를 남기고, `LOPHN_*`, token 꼴 이름(`GITHUB_TOKEN`, `OPENAI_API_KEY`, `GIT_AUTHOR_TOKEN`), 목록 밖 이름의 127.0.0.1 port 값, `lophn-core://` 값은 지운다"
- 위험 test(`packages/shell/terminal-host/main_test.ts`, 새 file): "PTY 하나의 resize가 던져도 그 요청만 `host_lost`로 답하고 다른 터미널의 input·resize는 계속 ok다". `hostFromNodePty({ pty: <가짜 PtyAdapter>, ... })`로 만든다. 가짜 handle의 `resize`가 던지고, `group()`은 바로 끝난 group을 준다. subprocess와 node-pty는 띄우지 않는다.
- 남지 않음: `grep -rn "host-lost" packages/shell/terminal-host packages/shell/main/terminal packages/shell/ipc tests`가 0줄이다(`packages/shell/main/dist/`는 gitignore된 build 산출물이라 보지 않는다).
- 남지 않음: `grep -rn "restart replayed input\|typed" packages/shell/terminal-host/main.ts`가 0줄이다.

## 보고

`.claude/skills/orchestrate/brief-template.md` "보고" 꼴. 특히:
- 등록할 것: lead가 `project-docs/flows/tests/shell.yaml`에 `packages/shell/terminal-host/main_test.ts` 줄을 더한다. `env_test.ts`의 `covers`·`note`에 env 허용 목록을 더할지도 lead가 정한다. `project-docs/architecture/terminal-agent.md` 지키는 것 3(env에서 지우는 것)이 허용 목록과 달라지므로 lead가 merge 때 고친다.
- Windows에서 SIGTERM은 handler 없이 process를 끝낸다(`child.kill`이 TerminateProcess다). 그 경로는 stdin `close`에 기대는데 이 기계에서 확인할 수 없다. 확인한 것과 못 한 것을 적는다.
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
