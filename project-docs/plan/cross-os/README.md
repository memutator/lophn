# cross-os: macOS·Windows에서 build·기동·package

- 목표: Linux에서만 짜고 돌리던 lophn을 macOS arm64와 Windows x64에서도 check, core 기동, 서명 없는 package까지 되게 한다. 사람은 Linux 한 대뿐이라 다른 OS는 GitHub Actions matrix로만 확인한다.
- 재료: 조사 보고 두 편(core 쪽, shell·도구·packaging 쪽. 사실과 path는 각 brief에 옮겼다), `project-docs/issues/platform.md`, `project-docs/architecture/terminal-agent.md`·`browser-tab.md`·`harness-gui.md`(Windows에서 꺼 둔 기능), `packages/shell/main/electron-builder.yml`, `tools/package/main.ts`(옛 `package-linux.ts`).
- 범위 밖: 코드 서명·notarization, `npm run dev`·`npm run e2e`·`npm run doctor`·lead script(`project-docs/plan/tools/lead/*.sh`)의 다른 OS 지원, Windows에서 이미 꺼 둔 기능(browser bridge, terminal hook socket, foreground 판정, terminal signal), keychain·DPAPI, CLI를 PATH에 까는 설치, Intel mac·Windows arm64.

## 정한 것

1. 대상은 Linux x64(지금 그대로), macOS arm64, Windows x64다. 서명하지 않는다. (agent, 비용 0. 사람이 바꿀 수 있다)
2. 다른 OS 확인은 `.github/workflows/os.yml` 하나다. matrix ubuntu·macos·windows, 단계는 `npm ci` → `npm run check:full` → core 두 번 기동 → 서명 없는 package(dir) build. `workflow_dispatch`와 `ci/**` branch push로만 돈다. (agent, private repo라 macOS minute이 10배라 push마다 돌리지 않는다)
3. OS마다 다른 순수 규칙(home, IPC 경로, process tree 신호)은 `packages/base/os/` 한 곳에 두고 platform을 인자로 받는다. (agent, AGENTS.md "인자로 받는다")
4. process group: POSIX(linux, darwin)는 `detached` spawn과 `process.kill(-pid, sig)`(ESRCH가 "없다")로 하고 `/usr/bin/kill` adapter를 지운다. Windows는 `taskkill /PID <pid> /T /F`로 tree를 끄고 `process.kill(pid, 0)`의 ESRCH로 없어졌음을 본다. Linux 전용 fail-closed 검사는 지운다. (agent, Node가 kill(2)의 errno를 code로 준다. taskkill /T는 VS Code·tree-kill의 길. Job Object는 native addon이라 하지 않는다)
5. Windows data root는 `%USERPROFILE%\.lophn`이다. 0700·uid 검사는 POSIX만 하고 Windows는 user profile ACL을 믿는다. secrets·user-token도 지금 file 그대로다. (agent, Claude Code·Codex가 Windows에서 같은 식이다)
6. 봉인 판정은 mode bit가 아니라 봉인 끝에 쓰는 표지 file `<사본>.sealed`다. 기존 data root의 봉인 사본에는 data step이 표지를 쓴다. (agent, Windows는 directory mode가 없어 끝난 사본을 지우고 다시 쓴다)
7. Windows IPC는 unix socket 대신 named pipe `\\.\pipe\lophn-<hash>-<이름>`이다. Node `net`·`http`가 같은 API로 받는다. (agent)
8. agent shell tool은 Windows에서 Git for Windows의 `bash.exe`를 쓴다. 못 찾으면 tool이 `unavailable`과 설치 안내를 낸다. shell 규칙(POSIX)은 그대로다. (agent, Claude Code가 Windows에서 Git Bash를 요구한다)
9. macOS에서 GUI로 켠 앱은 PATH가 짧다(Homebrew 없음). shell main이 시작할 때 login shell의 PATH를 한 번 읽어 core와 터미널에 넘긴다. harness 찾기 fallback에 `/opt/homebrew/bin`, `/usr/local/bin`을 더한다. (agent)
10. package: macOS는 `.app`(dmg), Windows는 NSIS. macOS는 `platform/`·`desktop/`·`extensions/`·`skills/`를 `Contents/Resources/`(`process.resourcesPath`) 안에 둔다. Linux·Windows는 지금처럼 `dirname(resourcesPath)`다. CLI launcher는 앱 안 `bin/lophn`(sh)과 `bin\lophn.cmd`이고 harness hook은 그 절대 경로를 쓴다. Windows의 platform tree는 `npm ci --install-links`로 junction 없이 둔다. (agent, `.app` 밖 `Contents/`에 file을 두면 bundle이 깨진다)
11. 되돌아감은 CI matrix와 check 하나로 막는다: `packages/`에서 `import.meta.url).pathname` 꼴을 금지한다(`fileURLToPath`). (agent, 같은 bug가 30곳 가까이 있었다)

## task

| wave | id | 한 줄 |
|---|---|---|
| 1 | `os-base` | `packages/base/os/`(home, IPC 경로, tree 신호), `fileURLToPath` 일괄 교체, `~/.lophn` 해석, check-source 규칙 |
| 1 | `os-ci` | check 도구를 Windows에서 돌게, node-pty rebuild는 Linux만, 이식되는 core 기동 script, `.gitattributes`, `.github/workflows/os.yml` |
| 2 | `os-process` | core의 process와 IPC: supervision 세 OS, kill 자리를 tree 신호로, signal, RSS, node shim, child env, named pipe, agent shell tool |
| 2 | `os-fs` | core의 file: Windows data root, log root, 봉인 표지와 data step, symlink·junction, 권한 path 비교 |
| 2 | `os-shell` | shell·coding-agent: Windows terminal kill, harness 찾기, cwd 검사, macOS login PATH와 Dock |
| 2 | `os-package` | `tools/package.ts`(deb·dmg·nsis, `--dir`), install 값, CLI launcher, packaged 경로, workflow의 package 단계 |

## lead가 할 일

- wave 2가 merged면 사람에게 push 허락을 받고 `git push origin plan/cross-os:ci/cross-os`로 CI를 돌린다. 깨진 job마다 log를 읽어 `os-fix-<영역>` task를 띄운다(wave 3). CI가 셋 다 green일 때 land한다.
- merge마다 등록할 것(wiring 목록의 data step, `packages/base/mod.ts`의 export, root `package.json` script)을 고친다.
- 끝나면 `project-docs/architecture/platform.md`(OS마다 다른 것, 꺼 둔 기능, `packages/base/os/`, CI 돌리는 법)를 새로 쓰고 `project-docs/context-component-registry.yaml`과 `project-docs/issues/platform.md` 머리줄을 고친다. AGENTS.md "코드"에 "OS마다 다른 규칙은 `packages/base/os/`에 두고 platform을 인자로 받는다"와 CI 돌리는 명령 한 줄을 더한다. changelog 열린 판에 항목을 붙인다(옮기기: data step의 봉인 표지).
- 사람에게 묻는 것: push, CI 실행(돌 때마다 macOS minute 10배).
