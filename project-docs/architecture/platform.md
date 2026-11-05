# platform

lophn이 Linux x64, macOS arm64, Windows x64에서 무엇을 다르게 하는가. OS마다 다른 규칙이 어디 있고, 어느 기능이 어느 OS에서 꺼져 있고, 다른 OS를 어떻게 확인하는가.

## OS마다 다른 규칙의 자리

- **순수 규칙은 `packages/base/os/`다.** `homeOf(env, platform)`(POSIX `HOME`, win32 `USERPROFILE`, 없으면 `HOMEDRIVE`+`HOMEPATH`), `ipcPath(dir, name, platform)`·`ipcPathLimit(platform)`(POSIX는 `<dir>/<name>.sock`과 sun_path 107·103 byte, win32는 `\\.\pipe\lophn-<dir의 FNV-1a 64>-<name>`과 256), `signalTree`·`treeGone`·`nodeTreeDeps(spawn)`(process tree 신호). base는 node 내장을 import하지 않아 spawn은 인자로 받는다.
- **OS로 가르는 함수는 platform을 인자로 받는다.** 기본값이 `process.platform`이고 test는 다른 값을 넘긴다. protocol은 runtime 전역을 읽지 않는다. 앱 socket 경로 schema(`packages/protocol/apps/app-start.ts`)는 가장 큰 한도(256)만 보고, OS별 길이는 core가 경로를 만드는 곳(`packages/core/apps/runtime/processes/socket-dir.ts`, `entrypoint/wire-check.ts`)에서 본다.
- **path는 `node:path`와 `node:url`로 다룬다.** module 자리는 `fileURLToPath(new URL(…, import.meta.url))`이고 `import.meta.url).pathname` 꼴은 `packages/` 안에서 `tools/check-source.ts`(`meta-url-pathname`)가 막는다(Windows는 `/C:/…`, 공백·한글 path는 `%20`으로 깨진다). 절대 경로 판정은 `isAbsolute`, PATH는 `delimiter`로 잇고 나눈다. 앱 안의 상대 path(bundle 목록, data area)만 `/` 꼴이다.

## process와 IPC

- **child tree 끄기.** POSIX(linux, darwin)는 child를 `detached`로 띄워 group leader로 두고 `process.kill(-pid, sig)`로 group째 끈다. `ESRCH`가 "없다"다. Windows는 `detached`가 새 console을 열어 쓰지 않고(`windowsHide`), `taskkill /PID <pid> /T /F`로 tree를 끈다. 없어졌는지는 POSIX는 `kill(-pid, 0)`, Windows는 root pid만 `kill(pid, 0)`으로 본다. supervisor(`packages/core/supervision/responsiveness/`)는 group이 없어졌음을 확인한 뒤에 자원을 푼다. core 쪽 helper는 `packages/core/supervision/security/tree-kill.ts`(`killTree`, `treeSpawnOptions`)다.
- **앱 IPC.** POSIX는 unix socket(`$XDG_RUNTIME_DIR/lophn/<hash>`나 `$TMPDIR/lophn-<uid>/<hash>`, 0700), Windows는 named pipe다. Node `net`·`http`가 같은 API로 받아 transport 코드는 경로 문자열만 다르다. Windows는 socket directory가 없고 낡은 pipe를 지울 일도 없다.
- **child env.** OS가 넘겨야 하는 이름은 `packages/core/supervision/security/child-env.ts`(`WINDOWS_ENV_NAMES`: `SystemRoot`, `ComSpec`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `TEMP`, `TMP`)가 갖고, Windows env 이름은 대소문자를 가리지 않고 읽는다. 임시 폴더는 `os.tmpdir()`다.
- **node shim.** 앱과 agent shell이 부르는 `node`·`npm`은 `run/bin/`의 shim이 Electron의 Node(`ELECTRON_RUN_AS_NODE=1`)로 돌린다. POSIX는 sh script, Windows는 `node.cmd`·`npm.cmd`(cmd·CreateProcess용)와 확장자 없는 sh script(Git Bash용)를 같이 쓴다.
- **agent shell tool.** POSIX는 `/bin/sh -c`, Windows는 Git for Windows의 `bash.exe`다(`LOPHN_GIT_BASH`, `%ProgramFiles%\Git\bin\bash.exe`, `%ProgramFiles(x86)%\…`, `%LOCALAPPDATA%\Programs\Git\bin\bash.exe` 차례). 못 찾으면 tool이 `unavailable`과 설치 안내를 내고 아무것도 띄우지 않는다. shell 규칙(`packages/protocol/approvals/shell-rules.ts`)은 bash라 OS와 상관없이 그대로다.
- **SIGUSR2 snapshot**은 Windows에서 걸지 않는다. core·apps supervisor·agent runtime은 stdin EOF와 stop 메시지로 끝나서 Windows에 SIGTERM이 안 와도 끝난다.

## file

- **data root.** 기본은 `homeOf` 아래 `.lophn`(Windows `%USERPROFILE%\.lophn`)이다. POSIX는 소유 uid와 mode(group·other 권한 없음)를 보고 아니면 기동을 거절한다. Windows는 mode·uid가 없어 보지 않고 user profile ACL을 믿는다. `secrets.json`·`run/user-token`도 같은 file 그대로이고 Windows는 0600 검사를 하지 않는다.
- **봉인.** 앱 bundle 사본(`apps/<app>/bundles/<hash>/`)은 file 0444·폴더 0555로 좁힌 뒤 옆에 빈 표지 `<사본>.sealed`를 쓴다. 봉인 판정은 표지가 있는가 하나다(Windows 폴더에는 쓰기 bit가 없다). 표지 없는 사본은 끊긴 준비가 남긴 것이라 쓰기 권한을 돌려준 뒤 지우고 다시 쓰고, 못 지우면 준비가 실패한다. 옛 data root는 data step `apps.sealed-marker`(`packages/core/main/daemon/wiring/sealed-marker.ts`)가 쓰기 bit 없는 사본에 표지를 써서 옮긴다.
- **연결.** bundle과 flow host의 directory 연결은 Windows에서 junction(권한이 필요 없다), 그 밖은 symlink다. file 연결은 모든 OS에서 symlink다.
- **권한 path 비교**(`packages/core/apps/permissions/model.ts` `isSameOrInside`)는 `relative`로 보고, Windows와 macOS는 대소문자를 가리지 않는다.

## shell과 터미널

- **macOS PATH.** Finder·Dock으로 켠 앱은 PATH가 짧아서 shell main이 시작할 때 login shell(`$SHELL -ilc`)의 PATH를 한 번 읽어 둔다(`packages/shell/main/desktop/core/login-path.ts`, 5초). core·terminal-host·extension이 그 env를 물려받는다. harness 찾기 fallback에 `/opt/homebrew/bin`, `/usr/local/bin`이 있다.
- **macOS Dock.** 창이 없을 때 Dock을 누르면(`activate`) 창을 다시 연다.
- **harness 찾기**(`packages/coding-agent/harnesses/detect.ts`). Windows는 이름마다 `PATHEXT` 확장자로 찾고 실행 bit 대신 확장자로 판정한다. `.cmd`·`.bat`은 shell로 띄운다.
- **터미널 끄기.** POSIX는 `SIGHUP` 뒤 process group, Windows는 `pty.kill()` 뒤 `taskkill /T`다.

## Windows에서 꺼진 기능

그 기능이 기대는 OS 장치가 없어서 끈 채다. 코드가 win32에서 일부러 건너뛴다.

| 기능 | 왜 | 그 대신 |
|---|---|---|
| terminal hook socket(`lophn hook`, 시작 층) | unix socket과 sh hook에 기댄다 | 탭의 harness를 hook으로 알지 못한다 |
| browser bridge(`$BROWSER` shim) | sh shim과 unix socket | link는 OS browser로 간다 |
| 터미널 foreground 판정 | `/proc`가 없다 | harness TUI를 process로 알아보지 못한다 |
| 터미널 `signal` 요청(harness GUI toggle의 TUI 끄기) | foreground process group이 없다 | toggle이 없다 |
| 앱 RSS 감시(85%) | RSS를 읽는 길이 없다(macOS는 `ps`) | 감시가 꺼져 있다 |

macOS는 foreground 판정이 `pty.process` 이름뿐이고(`/proc`가 없다) 터미널 `signal` 요청이 Linux만이다.

## 설치 묶음

`npm run package`(`tools/package/main.ts [--target linux|mac|win] [--dir] [--out <dir>]`). 공통 단계는 shell·renderer build → 따로 둔 app 폴더에서 electron-builder `dir` → `platform/`(core·cli와 그 의존의 production `node_modules`), `extensions/`, `desktop/`, `skills/`를 넣기 → OS 묶음이다. `--dir`은 풀린 앱까지만 한다. 서명하지 않는다.

| | Linux | macOS | Windows |
|---|---|---|---|
| 묶음 | `.deb`(`/opt/lophn`) | dmg(`lophn-desktop.app`) | NSIS |
| 설치 root(`packagedInstall`) | `dirname(resourcesPath)` | `Contents/Resources`(`resourcesPath`) | `dirname(resourcesPath)` |
| CLI | `/usr/bin/lophn`(sh) | `<root>/bin/lophn`(sh) | `<root>\bin\lophn.cmd` |
| node-pty | source compile | N-API prebuild | N-API prebuild |

macOS·Windows는 CLI를 PATH에 깔지 않는다. shell이 앱 안 launcher의 절대 경로를 쓴다. Windows의 `platform/node_modules/@lophn/*`는 npm이 만드는 절대 경로 junction 대신 copy다. node-pty는 Linux만 rebuild한다(`packages/shell/main/build.ts` `rebuildNodePty`).

## 다른 OS 확인

`.github/workflows/os.yml`이 ubuntu·macos·windows에서 `npm ci` → `npm run check:full` → `node tools/ci/boot-core.ts`(새 data root로 core를 두 번 띄운다) → `node tools/package/main.ts --dir`을 돈다. `workflow_dispatch`와 `ci/**` branch push로만 돈다(private repo에서 macOS minute은 10배). 돌리기: `git push origin <branch>:ci/<이름>`. push와 실행은 사람에게 묻는다.

macOS·Windows는 아직 이 workflow로 돌려 보지 않았다. 위의 macOS·Windows 동작은 코드와 platform 인자를 넘긴 test로만 확인했다.

## 불변 조건

- POSIX data root 검사는 Windows를 위해 느슨해지지 않는다. platform이 win32일 때만 건너뛴다.
- 봉인된 사본은 표지가 있는 한 다시 쓰지 않는다. 표지 없는 사본은 지우지 못하면 준비가 실패한다(조용히 넘어가지 않는다).
- base와 protocol은 OS를 runtime 전역으로 읽지 않는다.
- Windows에서 꺼진 기능은 조용히 다른 길로 가거나 꺼진 것을 보인다. 반쯤 도는 채로 두지 않는다.
