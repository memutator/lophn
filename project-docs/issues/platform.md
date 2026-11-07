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

## lophn을 끄고 바로 켜면 "lophn didn't start"로 멈춘다

```yaml
kind: bug
modules: [packages/shell/main, packages/core/install-and-update]
```

- 지금: 끄기는 `app.once("will-quit", () => ctx.stopAll())`(`packages/shell/main/desktop/main.ts`)이고 `stopAll`(`packages/shell/main/desktop/wiring/context.ts`)은 영역마다 `stop()`을 부르기만 하고 core process가 끝나기를 기다리지 않는다. 그래서 shell이 먼저 끝나고 core는 data root lock을 쥔 채 조금 더 산다. 그 사이 새 lophn을 켜면 새 core가 `packages/core/install-and-update/instance-lock.ts`에서 lock을 못 얻어 `start_failed`("이 데이터 폴더에는 이미 실행 중인 instance가 있다")를 내고, shell(`packages/shell/main/desktop/core/supervise.ts`의 `StartFailedError`)은 다시 시도하지 않고 "lophn didn't start" 화면에 머문다. core 없이 shell만 떠 있다.
  - 실제 사례(user journal): 새 core `start_failed` 19:54:05.605, 이전 core `stopped` 19:54:06.483. 이전 shell scope는 그보다 먼저 끝났다.
- 영향: 사람이 lophn을 다시 켰는데 쓸 수 없다. 원인이 보이지 않아(화면은 "didn't start"뿐, 이유는 journal에만 있다) 한 번 더 끄고 켜야 하는 줄 모른다. data는 잃지 않는다.
- 고치려면:
  - 새 shell이 기동 실패 이유가 lock(이미 실행 중)이면 몇 초(예: 5초) 동안 짧은 간격으로 core를 다시 띄운다(작음). 이전 core가 진짜로 계속 돌고 있으면 시간이 지나 지금처럼 실패한다. 추천.
  - 끌 때 shell이 core가 끝나기를 기다린 뒤 끝난다(`will-quit`에서 `preventDefault` 후 core exit를 기다리고 다시 quit, 시간 상한)(중간). OS 종료와 강제 종료에서는 여전히 겹칠 수 있어 위 안이 같이 필요하다.
