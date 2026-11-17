# term-host

PTY host를 core의 자식으로 띄우고 `terminals/*` route와 날 출력 stream을 낸다. 사람의 login env와 `lophn` 경로를 core가 읽고, 터미널이 열려 있는 동안 core가 idle-exit하지 않게 한다. node-pty를 core가 load할 수 있는지가 첫 일이다.

- 단위: term (wave 2)
- 선행: `term-contract`.
- 소유(이 task만 고친다):
  - `packages/core/terminals/`(`ports.ts`는 계약이라 고치지 않는다)
  - `packages/core/main/daemon/wiring/terminals.ts`(새 file), `packages/core/main/daemon/wiring/idle.ts`
  - `packages/core/package.json`과 root `package-lock.json`
  - `packages/shell/main/build.ts`, `tools/package/`, `tools/dev.ts`
  - `project-docs/flows/tests/core-rest.yaml`
- 읽을 것:
  - 계획 README "정한 것"(일을 가진 process, code는 core 쪽으로, 터미널은 core가 연다, 출력 stream, 입력 자격, Quit, 사람의 환경)
  - 계약: `project-docs/plan/core-terminals/tasks/term-contract.md` "고정할 모양"(자리, 옮기는 법, `terminals.ts`, 입력 자격, 날 출력 stream)
  - architecture: `project-docs/architecture/terminal-agent.md` 지키는 것 3·11·12·16·17, `project-docs/architecture/platform.md` "core 수명"의 idle-exit와 지키는 것 8·9
  - 조사 `reports/multi-device/survey-s3-shell-work.md` 1.1, 2.3, 그룹 A·B, 5.4
  - 지금 code: `packages/shell/terminal-host/`, `packages/shell/main/terminal/{supervisor,ipc,output}.ts`, `packages/shell/main/desktop/wiring/coding.ts`(supervisor 만들기, `projectFolders`, `lophnCliPath` 부르기), `packages/shell/main/desktop/paths.ts`(`lophnCliPath`), `packages/shell/main/desktop/core/login-path.ts`, `packages/shell/main/desktop/wiring/extensions.ts`의 `readLoginEnv`, `packages/core/main/daemon/wiring/terminal-view.ts`(입력 허락을 읽는 본보기), `packages/core/main/daemon/entry-layout.ts`
- 계약:
  - 쓰는 것: `packages/protocol/coding-agent/terminals.ts`, `TerminalOutputAppended`·`TerminalRuntimeChanged`, `hostTabTargetSchema`의 `{terminal: {terminal_ref}}`, `packages/core/terminals/ports.ts`의 `Terminals`·`PersonEnv`, `ctx.terminals`·`ctx.personEnv`(`Late`), `ctx.hostQueue.openTab`, `ctx.peek.terminalInputGrant`, `ctx.peek.shellCapabilities`
  - 내놓는 것: `ctx.terminals`(뒤의 `coding-core`가 tracker·GUI·hook env를 이 위에 얹는다), `ctx.personEnv`(`ext-host`의 spawner가 읽는다), `terminals/*` route(`saved_sessions`·`rename_saved` 밖)

## 할 일

1. **node-pty 확인(먼저, 멈출 수 있다).** core는 Electron 실행 file을 `ELECTRON_RUN_AS_NODE=1`로 돌린다(`tools/dev.ts`, `packages/core/always-on/os/entries.ts`). 같은 방식으로 `.dev-data/term-host/` 안의 확인 script를 띄워 `require("node-pty")`로 `/bin/sh -c 'echo ok'`를 열고 출력을 읽는다. 설치본은 `tools/package/main.ts`의 `stagePlatform`이 `platform/`에 `npm ci --omit=dev --ignore-scripts`를 하므로 Linux에서는 node-pty가 build되지 않는다(mac·win은 N-API prebuild). core가 PTY host를 띄울 때 어느 node-pty를 load할지(`platform/`에서 build, 또는 앱 쪽의 Electron용 build를 가리키기) 정한다. 개발 실행의 확인이 실패하면 code를 쓰지 말고 멈춰 무엇이 왜 실패했는지 보고한다. 설치본은 `--dir` build를 돌릴 수 없으면 "확인 못 함"으로 보고하고 lead가 확인한다.
2. **사본.** 계약의 "옮기는 법"대로 shell 원본은 두고 `packages/shell/terminal-host/`를 `packages/core/terminals/host/`로, `packages/shell/main/terminal/supervisor.ts`와 그 test를 `packages/core/terminals/supervisor.ts`로 복사해 고친다. `../ipc/terminal.ts` import는 protocol(`terminals.ts`의 schema type, 화면 줄은 `terminal-view.ts`의 `TerminalLine`)로 바꾸고, host와 supervisor 사이 줄 모양(요청과 답)만 이 module 안에 둔다. shell에서 따로 두던 `TerminalLine`·`TerminalScreen` 사본은 core 쪽에 만들지 않는다.
3. **service.** `packages/core/terminals/`에 `Terminals` port를 구현한다. 열기 순서는 `packages/shell/main/terminal/ipc.ts`의 `open`(폴더 다시 읽기, `folder_ref = <project>_<index>`, `LOPHN_WORKSPACE`, `LOPHN_SESSION_ID`, command·resume을 첫 출력 뒤 300ms 잠잠할 때 친다, 늦어도 5초)을 가져오고 창 구독·focus 표·clipboard·bridge는 가져오지 않는다. 터미널마다 더할 env는 port의 hook으로 받는다(hook·bridge env는 `coding-core`가 꽂는다). host는 첫 요청 때 띄우고, 죽은 host는 열기·다시 시작만 되살린다(지킴 17). 폴더 목록은 wiring이 port로 준다(바닥 module은 projects를 import하지 않는다).
4. **출력.** `terminals/watch`의 lease(30초, key (principal, watcher))가 있는 터미널의 host 출력만 `TerminalOutputAppended`로 낸다. runtime이 바뀌면 `TerminalRuntimeChanged`를 낸다. `terminals/snapshot`은 host `snapshot{after_seq}`를 그대로 준다. lease 만료는 5초 주기로 본다(`wiring/terminal-view.ts`와 같은 꼴).
5. **사람의 환경.** `PersonEnv`를 만든다: login shell의 env를 한 번 읽어 둔다(`readLoginEnv`의 규칙: `$SHELL -ilc env`, 표시 사이 값, 5초 한도, 못 읽으면 core의 env). `cli`는 `lophnCliPath`의 규칙(설치 layout이면 설치한 launcher, 개발이면 절대 경로인 `LOPHN_CLI`)이다. host는 이 env로 띄운다(터미널 env는 host의 `terminalEnv`가 거른다, 지킴 3). 개발 core가 `LOPHN_CLI`를 받도록 `tools/dev.ts`를 맞춘다.
6. **wiring.** `wiring/terminals.ts`가 `ctx.terminals`·`ctx.personEnv`를 낸다. `terminals/list|open|close|restart|input|resize|snapshot|watch|name` handler를 둔다. 입력 자격은 계약 그대로 handler에서 본다(기기 → `ctx.peek.terminalInputGrant`, 아니면 `ctx.peek.shellCapabilities?.has`). `open`의 `tab`이 있으면 `ctx.hostQueue.openTab`으로 `{terminal: {terminal_ref}}` 탭을 그 project에 넣는다. `closeWork`에서 `ctx.terminals.stop()`(host stdin을 닫아 host가 모든 PTY를 끝낸다, 지킴 16).
7. **core 수명.** `wiring/idle.ts`의 `activity.busy()`가 `starting`·`running` 터미널이 있으면 일로 본다(README "앱을 Quit해도 터미널은 돈다", `platform.md` idle-exit). GUI coding session은 터미널 위에 있어 이것으로 같이 덮인다. 문서는 lead가 고친다.
8. **build와 packaging.** `packages/core/package.json`에 `node-pty`, `@xterm/headless`, `@xterm/addon-serialize`, `@xterm/addon-unicode11`를 지금과 같은 판으로 정확히 고정해 더하고 `npm install`로 lock을 맞춘다. 1에서 정한 대로 설치본의 `platform/`이 Electron용 node-pty를 갖게 `tools/package/`를 고친다. shell 쪽 `terminal-host` bundle과 node-pty rebuild는 shell이 아직 쓰므로 그대로 둔다(`term-desktop`이 걷는다). `ext-host`가 보고할 extension build·packaging 줄은 lead가 merge 때 넣는다.
9. flows: 새 test file을 `project-docs/flows/tests/core-rest.yaml`에 올린다(`flows` skill). route entry는 `term-contract`가 이미 올렸다.

### 정한 것
- PTY host는 TypeScript source(`packages/core/terminals/host/cli.ts`)를 core와 같은 Electron Node로 띄운다: core가 이미 source로 돌아 따로 묶을 build가 없다. 1에서 안 되면 보고에 적고 가장 단순한 대안을 고른다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test(subprocess를 띄우지 않는다. fake `HostProcess`와 fake `PtyAdapter`, handler는 route의 actor 검사를 지나는 가장 가벼운 층):
  - "agent 자격과 터미널 입력 허락이 없는 기기는 터미널에 치지 못한다": 표 하나로 agent 자격, 허락 없는 기기, capability 없는 사람 token은 `forbidden`이고 PTY에 아무것도 가지 않는다. 허락 있는 기기와 capability를 실은 shell main은 친 글이 host까지 간다. `restart`는 capability 없이 `forbidden`이다.
  - "core가 끝나면 PTY가 남지 않는다": terminals를 멈추면 host의 stdin이 닫히고, host는 stdin EOF에 모든 PTY를 끝낸다(fake PTY가 하나도 살아 있지 않다).
  - "화면이 다시 붙어도 터미널의 출력을 잃거나 두 번 받지 않는다": 출력이 이어지는 중에 watch·snapshot으로 붙고, lease를 놓쳐 seq가 건너뛴 뒤 다시 snapshot으로 맞추면, 붙은 쪽이 쓴 seq가 빠짐도 겹침도 없다.
- 남지 않음: `grep -rn "ipc/terminal\|terminal-host.cjs" packages/core`가 0줄이다.
- 새 E2E와 subprocess·서버를 띄우는 test는 만들지 않는다(1의 확인 script는 test가 아니고 commit하지 않는다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`). 이 task는 적어도 `TERMINAL_ROUTES`의 등록(`packages/protocol/registry.ts`), `terminalsWiring`의 `WIRINGS` 자리(`packages/core/main/daemon/assembly.ts`, `hostQueueWiring` 뒤, `idleWiring` 앞), 기기 route 목록 `packages/protocol/remote/allowlist.ts`에 `terminals/open`·`terminals/input`을 적는다.
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것(1에서 고른 node-pty 자리를 꼭 적는다)
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"(desktop은 `term-desktop` 전까지 shell의 PTY를 쓰므로 core가 연 터미널은 화면에 탭으로 그려지지 않는다. 이것은 예정된 것이라 적지 않아도 된다)
