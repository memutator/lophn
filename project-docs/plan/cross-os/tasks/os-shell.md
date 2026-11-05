# os-shell

shell(Electron main, terminal-host)과 coding-agent의 OS 가정을 고친다(README 정한 것 9). Windows에서 이미 꺼 둔 기능(browser bridge, terminal hook socket, foreground 판정, terminal signal)은 꺼 둔 채로 두고, 켜 둔 기능 가운데 깨지는 것만 고친다.

- 단위: os (wave 2)
- 선행: os-base. wave 1이 merge된 plan branch에서 시작한다.
- 소유(이 task만 고친다):
  - `packages/shell/terminal-host/`
  - `packages/shell/main/terminal/`
  - `packages/shell/main/desktop/{main.ts,window.ts,shortcuts.ts}`
  - `packages/shell/main/desktop/wiring/{agent.ts,desktop.ts,core.ts,extensions.ts,editor.ts}`
  - `packages/shell/main/desktop/core/`
  - `packages/shell/main/extensions/bundled/harness-gui/index.ts`
  - `packages/shell/main/workspace/window-state_test.ts`
  - `packages/coding-agent/`
  - `packages/protocol/coding-agent/terminal-hook.ts`
- 소유 밖: `packages/shell/main/desktop/paths.ts`, `packages/shell/main/desktop/wiring/coding.ts`, `packages/shell/main/{package.json,electron-builder.yml,build.ts}`, `packages/base/install/`는 `os-package`의 것이다.
- 읽을 것:
  - `packages/base/os/`(wave 1의 `signalTree`, `homeOf`)
  - `project-docs/architecture/terminal-agent.md`(OS마다 foreground·hook이 어떻게 다른가), `harness-gui.md`(CLI 환경: login shell env)
  - `packages/shell/terminal-host/{child-group.ts,pty.ts:69-97,main.ts:300-320,419,452-462}`
  - `packages/coding-agent/harnesses/{detect.ts,system-ports.ts}`
- 계약:
  - 쓰는 것: `packages/base/os/`
  - 내놓는 것: core child env에 넘기는 macOS login PATH(할 일 4). `os-process`의 shell tool env가 이 PATH를 그대로 받는다(core가 받은 `PATH`).

## 할 일

1. terminal kill(Windows): `terminal-host/main.ts:419,452-462`의 `kill("SIGHUP")` 뒤 `posixGroup.kill(-pid)`와 `pty.ts:81`이 모든 OS에서 `posixGroup`을 쓴다. Windows에서 `process.kill(-pid)`는 틀리고 node-pty는 신호를 거절한다. win32는 `pty.kill()` 뒤 `signalTree(pid, "SIGKILL", "win32", deps)`(taskkill /T)로 tree를 끈다. `child-group.ts` 머리의 Job Object 주석은 실제와 맞게 고친다.
2. harness 찾기(`coding-agent/harnesses/`):
   - `detect.ts:58` `PATH.split(":")`는 `node:path` `delimiter`.
   - `detect.ts:15-25` `FALLBACK_DIRS`에 darwin의 `/opt/homebrew/bin`, `/usr/local/bin`을 더한다. win32는 `%APPDATA%\npm`, `%LOCALAPPDATA%\Programs`(쓰는 CLI가 까는 곳만), `%USERPROFILE%\.local\bin`, `%USERPROFILE%\.bun\bin`.
   - `detect.ts:70-74`와 adapter의 `commands`: win32에서는 이름마다 `.exe`, `.cmd`, `.bat`, `.ps1`이 아닌 `PATHEXT` 순서로 찾는다.
   - `system-ports.ts:17` `executableOf`의 `(mode & 0o111) !== 0`은 win32에서 늘 false다. win32는 확장자로 판정한다. `system-ports.ts:82`의 `child.kill("SIGKILL")`은 `signalTree`.
   - `local/harness-run.ts:80-85`의 `lastIndexOf("/")`와 dir `chmod 0o755`는 `dirname`·`mkdir`로.
   - `harnesses/install.ts:258-259`(`CLINE_OWNED`)와 `hook-bodies.ts`의 `#!/bin/sh` hook은 win32에서 hook socket이 꺼져 있어 쓸 일이 없다. win32에서 Cline hook을 깔지 않는지 확인만 하고 고칠 것이 있으면 고친다.
3. cwd 검사: `protocol/coding-agent/terminal-hook.ts:42`의 `cwd … startsWith("/")`, `shell/main/terminal/agent/tracker.ts:387` `cwd.startsWith("/")`, `shell/main/desktop/wiring/agent.ts:259` `LOPHN_CLI.startsWith("/")`는 `isAbsolute`(`C:\` cwd를 거절한다).
4. macOS login PATH(정한 것 9): packaged macOS에서 Finder·Dock으로 켜면 PATH가 `/usr/bin:/bin:/usr/sbin:/sbin`뿐이다. shell main이 시작할 때 darwin이면 `$SHELL -ilc 'printf %s "$PATH"'`(앞뒤 표지로 감싸 rc 출력과 섞이지 않게, 5초 넘으면 버린다)로 PATH를 한 번 읽어 `process.env.PATH`에 둔다. core·terminal-host·extension은 이 env를 물려받는다. `extensions/bundled/harness-gui/index.ts:45-51`의 `$SHELL -ilc "env -0"`이 BSD env에서 되는지 보고(macOS `env`에 `-0`이 있는 판인지), 안 되면 같은 표지 방식으로 바꾼다. Linux·Windows는 그대로다.
5. macOS Dock: `app.on("activate")`이 없어 창이 없을 때 Dock을 눌러도 아무것도 안 한다. darwin에서 창이 없으면 마지막 창(혹은 home 창)을 다시 연다. 열 함수는 `desktop/main.ts`·`wiring/desktop.ts`에 이미 있는 것을 쓴다.
6. `shell/main/workspace/window-state_test.ts:22`의 `mode & 0o777 === 0o600` assert는 win32에서 건너뛴다.
7. `shell/main/desktop/wiring/extensions.ts:84-100`의 extension child 끄기(POSIX group, win32 plain kill)는 win32에서 `signalTree`.

## 끝남

- `npm run check:full`이 통과한다. `node packages/shell/renderer/build.ts`가 된다. `project-docs/plan/tools/lead/boot.sh`가 통과한다.
- Linux 동작이 바뀌지 않는다(터미널 닫기, harness 찾기, hook).
- 위험 test: 없음.
- 남지 않음: `grep -rn 'split(":")' packages/coding-agent`가 0줄이다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. Windows·macOS에서 아직 안 되는 터미널·harness 기능을 "알려진 미완 동작"에 OS별로 적는다(lead가 `architecture/platform.md`에 옮긴다).

## 더할 것 (lead가 더함)

- `packages/base/os/`의 `nodeTreeDeps`는 spawn을 인자로 받는다: `nodeTreeDeps(spawn)`(`spawn`은 `node:child_process`의 것). base는 node 내장을 import하지 않는다.
