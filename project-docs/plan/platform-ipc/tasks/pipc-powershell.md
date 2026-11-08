# pipc-powershell

PowerShell 7·5.1에 기존 harness wrapper와 `gui` 분기를 싣고 마지막 win32 gate를 지운다. Windows foreground·signal과 도는 TUI를 GUI로 넘기는 toggle은 구현하지 않는다.

- 단위: pipc-powershell (wave 3)
- 선행: pipc-shell-ipc
- 소유(이 task만 고친다):
  - `packages/shell/terminal-host/shell-integration.ts`
  - `packages/shell/main/desktop/wiring/agent.ts`
  - `packages/shell/main/desktop/wiring/bridge.ts`
- 읽을 것:
  - 계획: `project-docs/plan/platform-ipc/README.md`, `project-docs/products/roadmap/platform-ipc.md`, `project-docs/plan/platform-ipc/tasks/pipc-shell-ipc.md`
  - architecture: `project-docs/architecture/terminal-agent.md`의 private server wrapper·시작 층·gui, `project-docs/architecture/harness-gui.md`의 터미널 함수·foreground 제약, `project-docs/architecture/platform.md`의 Windows 제약
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`·`coding-agent-harness-api`, `project-docs/module-catalog.yaml`의 `packages/shell/terminal-host`·`packages/shell/main`
  - shell 실행: `packages/shell/terminal-host/env.ts`의 `resolveLoginShell`, `packages/shell/terminal-host/main.ts`의 `integrateShell` 호출, `packages/shell/main/terminal/ipc.ts`의 env 조립
  - hook·GUI 계약: `packages/protocol/coding-agent/terminal-hook.ts`, `packages/protocol/coding-agent/harnesses.ts`, `packages/shell/main/terminal/agent/ingress.ts`, `packages/shell/main/terminal/gui.ts`
  - 앞 task 결과: `packages/shell/main/browser-bridge/run-dir.ts`, `packages/shell/main/desktop/wiring/coding.ts`
  - 기존 경계 test: `packages/shell/main/terminal/agent/agent_test.ts`, `packages/shell/main/browser-bridge/bridge_test.ts`, `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: 앞 task의 `run: Promise<ShellRun | null>`·hook endpoint, 기존 `SHELL_INIT_ENV = "LPN_SHELL_INIT"`, `TERMINAL_GUI_EVENT = "lophn-gui"`, 기존 hook payload `{ resume?: string }`와 CLI가 더하는 cwd를 유지한다.
  - 내놓는 것: `writeShellInit(fs, runDir, cli, platform)`가 POSIX 기존 file 또는 Windows `shell-init/functions.ps1`을 쓰고 폴더를 돌려준다. platform은 main이 넘기고 shell 시작 층이 runtime 전역으로 고르지 않는다. `agent.ts` 호출도 같은 변경에서 고친다.
  - 내놓는 것: `integrateShell(file, args, env)`의 모양은 유지하고 `pwsh.exe`·`powershell.exe`를 알아본다. 기존 `-NoLogo` 뒤에 `-NoExit -Command ". '<init.ps1>'"`를 더해 profile을 읽은 뒤 시작 층을 dot-source한다. `.ps1` 경로의 작은따옴표는 PowerShell 규칙으로 escape한다.
  - 유지하는 것: bash·zsh·fish 동작, key·env·GUI ack 계약, profile·alias·function 우선권, 명령 인자와 종료 상태를 유지한다. cmd.exe 시작 층은 만들지 않는다.

## 확인한 코드

- `packages/shell/terminal-host/shell-integration.ts:27-59`의 `integrateShell`은 `/`로만 basename을 구하고 bash·zsh·fish만 다룬다. 같은 file `:374-388`의 `writeShellInit`도 POSIX file만 쓴다.
- `packages/shell/terminal-host/env.ts:75-87`의 `resolveLoginShell`은 win32에서 PowerShell 7을 먼저, 없으면 5.1을 고르고 둘 다 `-NoLogo`로 연다. `packages/shell/terminal-host/main.ts:173-182`는 최종 env로 `integrateShell`을 거쳐 PTY를 연다.
- GUI 분기는 `claude`·`codex`·`opencode`·`omp` 넷이고, private-server wrapper는 `codex`·`opencode`·`kilo`·`cline`이다. 둘을 같은 목록이라고 보고 빠뜨리지 않는다.
- `packages/shell/terminal-host/foreground.ts:46`은 win32에서 null을 낸다. hook으로 GUI 진입을 요청하는 것과 이미 도는 TUI의 foreground를 알아 꺼야 하는 toggle은 다른 일이다.

## 할 일

1. `writeShellInit`에 명시적 platform을 받고 Windows `functions.ps1`을 낸다. PowerShell 5.1에서도 main이 넣은 한글·공백 경로를 읽도록 UTF-8 BOM을 포함한다. 사용자 profile이나 전역 harness 설정은 고치지 않는다. 근거는 기존 시작 층의 per-run file 소유와 roadmap의 PowerShell 7·5.1 지원이다.
2. `integrateShell`이 Windows의 `\`·POSIX `/` 경로와 shell 이름의 대소문자를 다루게 한다. PowerShell은 기존 profile을 끄지 않고 그 뒤에 위 dot-source 명령을 붙인다. bash·zsh·fish의 startup 순서는 바꾸지 않는다. `-ExecutionPolicy Bypass` 같은 정책 우회는 넣지 않는다. 정책으로 시작 층을 못 읽으면 수동 확인 결과에 적고 사람에게 알린다.
3. PowerShell wrapper는 현재 실제 외부 명령일 때만 정의한다. 사용자의 alias·function은 건드리지 않고, 감싼 명령의 경로를 잡아 call operator와 argument array로 실행해 자기 함수를 다시 부르지 않는다. `Invoke-Expression`으로 인자를 명령 문자열에 붙이지 않는다. CLI 경로는 `writeShellInit` 인자를 쓰며 터미널의 `LOPHN_*` env에서 찾지 않는다. `.cmd` launcher도 PowerShell이 실행하게 한다.
4. GUI 넷은 첫 인자가 `gui`일 때만 분기한다. `gui`, `gui --resume <id>`, `gui --resume=<id>`만 받고 id는 `[A-Za-z0-9._-]` 1~200자다. 잘못된 인자는 사용법과 종료 상태 2, 올바른 인자는 `{}` 또는 `{ "resume": "…" }`를 `lophn hook <harness> lophn-gui` stdin에 보낸다. cwd는 기존 `hook.ts`가 더한다. GUI 아닌 `claude`·`omp`는 인자를 그대로 넘긴다.
5. PowerShell의 private-server wrapper도 기존 `FUNCTIONS`·`FISH`와 같은 규칙을 쓴다. Codex는 `--help`가 지원할 때만 `--no-daemon`을 붙이고 `--no-daemon`·`agents`·`queue`·`--remote`·`--remote=*`는 그대로 보낸다. OpenCode는 현재 flag·subcommand 예외를 그대로 옮기고 `run`·`mini` 뒤, TUI 앞에 `--standalone`을 넣는다. Kilo의 `KILO_NO_DAEMON=1`·Cline의 `CLINE_SESSION_BACKEND_MODE=local`은 해당 호출 동안만 두고 원래 값/없음을 복원하며 `kilo daemon`·`kilo console`·`cline hub`는 그대로 부른다. 인자·native 종료 상태를 보존한다.
6. `agent.ts`에서 `writeShellInit`에 platform을 넘긴다. 준비와 호출이 모두 이어진 뒤 `bridge.ts`의 `if (process.platform === "win32") return off`를 지운다. 앞 task가 file 준비 뒤 hook을 별도로 여는지, `LPN_TERMINAL_HOOK`·`LPN_SHELL_INIT`이 strip 뒤 터미널에 들어가는지 확인한다. hook 설치를 자동 허락하거나 foreground가 없는 Windows에서 설치 dialog가 뜬다고 가정하지 않는다. 필요하면 사람이 Settings의 기존 Install hooks를 쓴다.
7. 이번 변경에는 새 test를 붙이지 않는다. shell script·문구·launcher 문자열 test를 만들거나 확인하려고 소스 file을 읽는 test를 쓰지 않는다. 앞 task의 위험 unit과 기존 인증 경계 test를 유지하고 Windows에서만 확인할 실행 의미는 아래 수동 확인으로 넘긴다. task 끝에는 `npm run check`가 통과해야 한다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 새 test 없음. 앞 task의 socket path·cleanup·permission test와 기존 key 경계 test를 유지한다.
- 남지 않음: `createBridgeWiring`의 Windows 전체 off gate, `process.getuid!()`, `options.runDir`가 없다. foreground·signal의 기존 Windows 분기는 남아야 한다.
- lead에게 넘길 수동 확인: PowerShell 7·5.1 각각에서 profile·alias 유지, native 명령 인자·종료 상태·env 복원, 한글·공백이 있는 data root와 CLI 경로, synthetic hook의 turn 끝·권한 물음 상태와 알림, `claude gui`의 탭 GUI 진입, browser link와 bridge 실패 시 OS fallback을 본다. URL query의 cmd metacharacter가 명령으로 풀리지 않아야 한다.
- Linux·macOS의 shell wrapper·bridge 동작을 유지한다. Windows의 foreground·TUI 끄기·toggle·adapter 전체 실행을 지원했다고 보고하지 않는다.

## 사람에게 물을 것

- 새 PowerShell subprocess·named pipe 서버·브라우저·E2E test를 만들려면 먼저 사람에게 묻는다. 수동 확인을 자동 test로 몰래 바꾸지 않는다.
- 실제 Claude turn으로 roadmap의 끝남 기준을 확인하려면 provider 호출 허락을 먼저 받는다. 허락 전에는 synthetic hook과 GUI 진입까지만 확인한다.
- Windows 실행 환경이 없으면 사람에게 위 수동 확인을 요청한다. CI push나 macOS runner 비용이 드는 실행은 사람이 고른다. 이 허락들은 제품 설계 결정의 미정 항목이 아니다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 보고 꼴을 따른다. 등록할 것, 안 쓰게 된 export, 계약 바꾸기 요청, 무겁게 짠 것, 알려진 미완 동작을 빼지 않는다. OS별로 실행한 것과 확인하지 못한 것을 나눠 적는다.

## lead가 더함

- 추가 소유: `packages/shell/main/browser-bridge/shim.ts`의 generated `browser.js` 본문만.
- Windows 개발 실행의 file 폴더는 저장소 `.dev-data` 아래라 root `package.json`의 `"type": "module"`을 물려받는다. 지금 generated JS의 `require("node:net")`가 Electron Node에서 `ReferenceError: require is not defined in ES module scope`로 실패했다. 공개 경로 `browser.js`와 shim API를 바꾸지 말고, async IIFE 안의 dynamic import처럼 CJS·ESM 양쪽에서 도는 가장 작은 본문으로 고친다. POSIX shim·Windows quoting·wire 정책은 그대로 둔다. 새 test는 만들지 않으며 lead가 실제 generated file을 두 module context에서 실행한다.
