# platform

config, diagnostics, storage, server, supervision 같은 바닥 module과 OS마다 다른 것. architecture: `project-docs/architecture/platform.md`.

## Windows에서 터미널 탭이 harness를 알아보지 못해 GUI↔TUI 전환이 없다

```yaml
kind: bug
modules: [packages/shell/main, packages/shell/terminal-host, packages/coding-agent, packages/protocol]
```

지금: 터미널 탭이 "이 탭에서 harness가 돈다"를 아는 길 둘이 Windows에서 모두 꺼져 있다.
- hook socket: `packages/shell/main/desktop/wiring/bridge.ts` `createBridgeWiring`이 win32면 `off`를 돌려 run 폴더가 null이고, 그 폴더에 서는 터미널 hook socket(`LPN_TERMINAL_HOOK`)도 없다. 깔린 hook의 `lophn hook`은 env가 없어 조용히 끝난다.
- foreground 판정: `packages/shell/terminal-host/foreground.ts` `foregroundOf`가 win32면 null이다(Linux는 `/proc`의 tpgid, macOS는 `pty.process` 이름).
- GUI로 바꿀 때 TUI를 끄는 터미널 `signal` 요청은 Linux만이다(foreground process group).
- 깔린 hook 명령(dev는 `C:/…/lophn.cmd hook <harness> <event>`)은 Git Bash에서는 돌지만 cmd에서는 따옴표 없는 `C:/…` 경로를 명령으로 읽지 못한다. 설치본은 맨 `lophn`이라 lophn 터미널 밖의 PATH와 Git Bash(`.cmd`를 PATHEXT로 찾지 않는다)에서 못 찾는다.

영향: Windows 사람은 터미널에서 claude 등을 켜도 탭이 모르고 GUI 토글이 나오지 않는다. Settings에서 hook을 깔 수는 있지만 lophn에 아무것도 알리지 않는다. harness가 hook을 cmd로 돌리면 그 harness의 매 실행마다 hook 오류가 난다.

고치려면:
- 안 1(추천, 중간~큼): hook socket을 named pipe로 연다(`packages/base/os` `ipcPath`가 이미 win32 pipe 이름을 만든다, Node `net`은 같은 API). hook 명령을 cmd와 Git Bash 양쪽에서 도는 꼴로 쓴다(경로 따옴표, 설치본은 절대 경로). TUI 끄기는 signal 대신 ConPTY에 Ctrl+C를 쓰거나 그 process tree를 끈다. foreground 판정은 PTY shell pid 아래 process tree에서 harness를 찾는 근사로 마지막에 한다. hook만 되어도 hook을 쓰는 harness는 감지된다.
- 안 2(작음): Windows에서는 hook 설치 버튼과 GUI 토글을 숨기거나 지원하지 않음으로 보인다. `platform.md` 불변 조건("반쯤 도는 채로 두지 않는다")에 맞지만 기능을 포기한다.

정할 것: 안 1로 Windows 지원을 만들지, 안 2로 꺼진 것을 보일지. 안 1은 Linux session이 정한 설계(Windows에서 끈다)를 넓히는 일이라 계획으로 연다.

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
