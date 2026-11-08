# platform

config, diagnostics, storage, server, supervision 같은 바닥 module과 OS마다 다른 것. architecture: `project-docs/architecture/platform.md`.

## Windows에서 깔린 hook 명령이 cmd에서 돌지 않고 GUI↔TUI toggle이 없다

```yaml
kind: bug
modules: [packages/shell/main, packages/shell/terminal-host, packages/coding-agent]
```

hook socket(named pipe)과 PowerShell 시작 층(`claude gui` 등)은 roadmap `platform-ipc`로 Windows에서도 열린다. 남은 것은 아래다. Windows 실기 확인은 루트 `WINDOWS-CHECKLIST.md`에 미확인으로 남아 있다.

지금:
- hook 명령: `packages/coding-agent/harnesses/install.ts`(`lineOf`)와 `json-hooks.ts`는 `${command} hook <harness> <event>`를 따옴표 없이 만든다. dev 경로(`C:/…/lophn.cmd`)는 Git Bash에서는 돌지만 cmd에서는 따옴표 없는 `C:/…`를 명령으로 읽지 못한다. 설치본은 맨 `lophn`이라 lophn 터미널 밖의 PATH와 Git Bash(`.cmd`를 PATHEXT로 찾지 않는다)에서 못 찾는다. lophn 터미널 안은 `wiring/agent.ts` `cliPath`가 PATH 앞에 CLI 폴더를 넣는다.
- 우리 hook 알아보기: `install-common.ts` `ownedCommand`의 정규식이 `lophn`이나 `/`로 시작하는 경로만 받아 `C:/…` 경로의 hook을 우리 것으로 보지 않는다. 다시 깔기·지우기·dry_run 비교가 그 줄을 놓친다.
- foreground 판정: `packages/shell/terminal-host/foreground.ts` `foregroundOf`가 win32면 null이다. hook이 없는 harness는 탭이 알아보지 못한다.
- TUI 끄기: `packages/shell/terminal-host/main.ts`의 `signal` 요청은 Linux만이고 다른 OS는 거절한다. harness-gui(`extensions/bundled/harness-gui/index.ts`, `claude.ts`, `omp.ts`)가 TUI를 끄려고 부르는 `terminal.signal`은 `terminal/gui.ts`에서 실패를 log 한 줄로만 남긴다.

영향: Windows 사람이 hook을 cmd로 돌리는 harness를 쓰면 매 실행마다 hook 오류가 나고 탭이 turn 끝·권한 물음을 모른다. hook을 다시 깔면 dev 경로 줄이 겹쳐 쌓일 수 있다. GUI↔TUI toggle에서 TUI가 꺼지지 않는다.

고치려면:
- hook 명령을 cmd와 Git Bash 양쪽에서 도는 꼴로 쓰고(경로 따옴표, 설치본은 절대 경로), `ownedCommand`가 Windows 경로도 받게 한다. 작음. 추천, 먼저 한다.
- TUI 끄기는 signal 대신 ConPTY에 Ctrl+C를 쓰거나 그 process tree를 끈다. foreground 판정은 PTY shell pid 아래 process tree에서 harness를 찾는 근사로 한다. 중간. 그 전까지는 `architecture/platform.md` 불변 조건("반쯤 도는 채로 두지 않는다")대로 Windows에서 toggle이 없음을 보인다.

## Quit 중에 돌던 ensure가 끝난 뒤 core를 새로 띄울 수 있다

```yaml
kind: bug
modules: [packages/shell/main]
```

지금: shell의 crash 복구·판 교체 ensure(`packages/shell/main/desktop/core/connection.ts` `recover`, `packages/protocol/client/ensure.ts` `ensureCore`)는 취소할 길이 없다. 일반 Quit의 `detach()`나 `Stop lophn`의 `stopCore()`가 그 사이에 와도 ensure는 끝까지 돌아 core를 띄울 수 있다. 시작 중(ready 전)에 `Stop lophn`을 누르면 control stop이 `unavailable`로 돌아오고 성공으로 치여, 막 뜬 core가 남는다.

영향: 사람이 끄라고 했는데 core가 남는다. 켜진 job이 없으면 10분 뒤 idle-exit로 끝나므로 data는 잃지 않는다.

고치려면: ensure에 abort signal을 받아 spawn 전에 보고, `Stop lophn`은 starting core면 ready를 기다린 뒤 stop한다(작음). 추천.

## shell이 다른 client의 stop 뒤에는 새 core를 스스로 알아채지 못한다

```yaml
kind: bug
modules: [packages/shell/main]
```

지금: shell이 `closed(shutdown)`이나 identify `stopping`을 보면 그 process에서는 core를 다시 띄우지 않는다(`connection.ts`의 `shutdownSeen`). 새 core(CLI가 띄운 것)에 붙는 것은 renderer의 core 호출(file tree poll, Reconnect 단추)이 `join()`할 때뿐이고 판이 같아야 한다. 주기적 identify는 없다.

영향: `lophn core stop` 뒤 CLI가 core를 다시 띄워도 shell 화면은 Reconnect를 누르기 전까지 끊긴 채일 수 있다.

고치려면: `shutdownSeen` 동안 30초마다 identify만 묻고(띄우지 않는다) ready면 join한다(작음).

## 업데이트 뒤 첫 로그인 실행은 창을 한 번 연다

```yaml
kind: bug
modules: [packages/shell/main]
```

지금: 켜 둔 autostart의 옛 `--tray` 등록은 일반 실행에서 한 번 `--core`로 다시 쓴다(`packages/shell/main/desktop/autostart.ts`). 업데이트 뒤 첫 실행이 그 로그인 등록이면 `--tray`를 모르는 새 판이 일반 실행으로 창을 연다. 같은 실행에서 등록은 고쳐진다. macOS `wasOpenedAtLogin`과 core-only 실행의 userData 폴더는 실기로 확인하지 않았다.

영향: 한 번 창이 뜬다. 그 뒤로는 core만 뜬다.

고치려면: 그대로 둔다(`--tray` 호환 장치를 두지 않는 것이 결정이다). macOS·Windows 실기 확인은 사람이 한다.
