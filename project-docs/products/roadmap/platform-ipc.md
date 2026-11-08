# platform IPC: Windows에서도 hook과 browser bridge가 돈다

상태: 계획 `platform-ipc`로 열림. 2026-11-08 사람이 물었고 planner가 정리했다. `standalone-core.md`보다 먼저 한다(core control socket이 같은 socket 자리 규칙을 쓴다).
배경 문서: `project-docs/architecture/platform.md`, `terminal-agent.md`, `browser-tab.md`, `harness-gui.md`.

## 사람의 말 (원문)

2026-11-08:

> 근데 윈도우에서는 우리가 unix socket 쓰다보니까 그 뭐냐 coding agent hook 같은 게 안 된다던데

> 그 플랫폼 대응은 어때

## 왜

- Windows 터미널 탭에서 harness의 turn 끝·권한 물음·질문을 hook으로 알지 못하고, `claude gui` 같은 탭 전환도 없고, 터미널 안 link는 lophn browser 탭이 아니라 OS browser로 간다.
- 이유는 unix socket이 아니다. `ipcPath`(`packages/base/os/ipc.ts`)가 이미 win32에서 named pipe를 내고, 앱 IPC는 Windows에서 named pipe로 돈다. 막는 것은 hook과 bridge가 POSIX 전용 run dir와 sh shim 위에 지어진 것이다.
- `platform.md` "Windows에서 꺼진 기능" 표가 이유를 "unix socket과 sh hook에 기댄다"로 적어 socket이 원인처럼 읽힌다.

## 지금 코드

- `packages/shell/main/desktop/wiring/bridge.ts:64` `if (process.platform === "win32") return off;` 한 줄이 browser bridge를 끄고 `runDir`를 null로 둔다. `wiring/agent.ts:236-237`이 `runDir`를 기다려 null이면 hook server(`terminal/agent/socket.ts` `listenHooks`)와 shell 시작 층(`terminal-host/shell-integration.ts` `writeShellInit`)도 열지 않는다. 그래서 win32에는 `h.sock`도, `LPN_TERMINAL_HOOK`·`LPN_SHELL_INIT` env도, `<harness> gui`도 없다.
- run dir(`packages/shell/main/browser-bridge/run-dir.ts`)가 POSIX 전제다: `XDG_RUNTIME_DIR` 또는 `${tmpdir}/lophn-${uid}`(`process.getuid!()`, `wiring/bridge.ts:90`), 폴더 0700 chmod, socket 0600 chmod(`browser-bridge/socket.ts:53`, `terminal/agent/socket.ts:53`), 경로 104 byte 한도.
- shell은 `ipcPath`를 쓰지 않고 core `packages/core/apps/runtime/processes/socket-dir.ts`의 자리 규칙을 따로 적었다(`run-dir.ts:1-3` "거기와 같은 규칙이어야 한다"). 한도도 다르다(shell 104, core `ipcPathLimit` 107·103). `ipcPath`를 부르는 곳은 `packages/protocol/apps/socket-slots.ts` 둘뿐이다.
- `$BROWSER` shim(`browser-bridge/shim.ts:129`)은 `#!/bin/sh` script다. 그 안의 JS는 `net.createConnection(socket)`이라 OS를 가리지 않는다. opener fallback은 darwin `open`, 그 밖 `xdg-open`(`shim.ts:100`).
- hook client(`packages/coding-agent/local/hook.ts:40`)는 `net.connect({path})`라 named pipe에도 그대로 붙는다(추정).
- shell 시작 층은 bash·zsh·fish만 다룬다(`shell-integration.ts:28` `integrateShell`). Windows 터미널의 login shell은 PowerShell 7 또는 5.1이다(`terminal-host/env.ts:76`).
- foreground 판정은 win32에서 null이다(`terminal-host/foreground.ts:46`). hook과 따로다.

## 무엇을 만드나

1. **socket 자리 규칙 하나.** core `socket-dir.ts`의 자리 규칙(data root마다 key 폴더, POSIX 0700, win32는 폴더 없이 named pipe)을 shell도 import하는 곳(`packages/base/os/` 또는 `packages/protocol`)으로 옮긴다. hook과 bridge socket 경로는 `ipcPath`로 낸다. shell의 따로 적은 규칙과 104 byte 한도를 지운다.
2. **run dir를 hook·bridge에서 뗀다.** win32에서도 hook server와 bridge가 named pipe로 연다. chmod는 POSIX만 한다. shim·시작 층 file을 둘 폴더는 win32에서 data root 아래(예: `<data root>/run/shell-<pid>/`)에 둔다.
3. **shim을 OS마다.** POSIX는 지금 sh 그대로, win32는 같은 JS를 Electron Node로 돌리는 `.cmd`. opener fallback에 win32(`start`)를 더한다.
4. **PowerShell 시작 층.** `claude`·`codex`·`opencode`·`omp` 등의 `gui` 분기와 wrapper를 PowerShell 함수로 낸다. PowerShell 7과 5.1 모두 `-NoExit -Command ". '<init.ps1>'"` 꼴로 싣는다.
5. **win32 gate를 지운다.** `wiring/bridge.ts:64`를 없애고 `platform.md`의 "Windows에서 꺼진 기능" 표에서 hook·bridge 줄을 지운다. foreground 판정 줄은 남는다.

## 정한 것

1. win32 hook·bridge의 인증은 지금 key(64 hex, 터미널 env로만 준다) 검사 그대로다. named pipe에 SID·DACL 검사를 더하지 않는다. 같은 사용자의 process는 이미 env로 key를 알고, 다른 사용자는 key를 모른다. Hermes(`gateway/runtime_bootstrap_windows.py`)는 key 없이 pipe ACL을 신뢰 경계로 써서 그 검사가 필요했다. (agent)
2. 경로가 한도를 넘을 때 pointer file로 우회하지 않는다. 자리 규칙이 `XDG_RUNTIME_DIR`이나 tmp 아래 짧은 hash 폴더라 넘는 경우는 이상한 tmp 설정뿐이고, 그때는 지금처럼 끄고 로그 한 줄을 남긴다. (agent)
3. foreground 판정(Windows는 `/proc`가 없다)은 이 일에 넣지 않는다. hook이 harness를 알려 주므로 상태 표시는 hook으로 충분하다. (agent)

## 하지 않는 것

- Windows foreground process 판정, 터미널 `signal` 요청(harness GUI toggle의 TUI 끄기).
- cmd.exe 시작 층.
- WSL 안 shell을 위한 bridge.

## 끝남 기준

- Windows 터미널 탭에서 Claude Code를 돌리면 turn 끝·권한 물음이 탭 상태와 알림으로 온다.
- Windows 터미널 탭에서 `claude gui`가 탭을 GUI로 바꾼다.
- Windows 터미널 안 `$BROWSER` link가 lophn browser 탭으로 열린다.
- Linux·macOS 동작은 그대로다.
