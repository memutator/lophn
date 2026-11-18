# platform

lophn이 Linux x64, macOS arm64, Windows x64에서 무엇을 다르게 하는가, 그리고 core가 shell과 따로 어떻게 살고 죽는가. OS마다 다른 규칙이 어디에 모이는지, 어느 기능이 어느 OS에서 꺼져 있는지, 다른 OS를 어떻게 확인하는지, core의 수명(띄우기, 붙기, 끄기, idle-exit, 사람이 표시한 기계의 로그인 시작과 늘 켜 둠)을 정한다.

## 문제

- 처음에는 Linux에서만 짜고 돌렸다. 그대로 두면 다른 OS의 사람은 core가 child를 하나도 못 띄우거나(process group 강제 종료를 Linux에서만 보장했다), data root 검사(uid·0700)에 기동을 거절당하거나, 봉인 판정(폴더의 쓰기 bit)이 틀어지거나, 앱 IPC(unix socket)가 열리지 않았다.
- OS를 가르는 코드가 여러 곳에 흩어지면 한 OS를 고칠 때 다른 OS가 조용히 깨진다. 그리고 기능이 반쯤 도는 채로 남으면 사람이 무엇이 안 되는지 알 수 없다.
- core가 shell(Electron)의 child이던 때는 앱을 끄면 켜진 job도 멈췄고, 화면 없는 머신에서 CLI만으로 core를 켤 길이 없었다. 새 판으로 바꿀 때 앱과 core의 수명이 엉키면 "끄고 바로 켜면 lophn이 안 뜬다"는 경쟁이 생긴다.
- 사람이 늘 켜 두려는 기계(미니 PC, 집의 desktop)에서 옛 autostart는 Electron이 ensure만 하고 끝나 core가 crash하면 아무도 다시 띄우지 않았고, Linux XDG autostart는 화면 세션에서만 돌았다. core가 죽으면 job과 폰이 사람이 올 때까지 멈춘다. 그리고 idle-exit가 일 없는 core를 끄면 폰이 붙을 core가 없다.

## 목표와 비목표

- 목표: OS마다 다른 규칙을 순수 규칙 한 곳에 모으고, 그 밖 module은 OS 전역을 읽지 않는다. 세 OS에서 core를 띄우고 child tree를 끄고 data root를 열 수 있다. Windows에서 꺼진 기능은 꺼진 것이 드러난다. core는 shell과 수명이 따로이고 shell·CLI 어느 쪽에서나 띄우고 붙고 끌 수 있다. 사람이 표시한 기계에서는 core가 로그인 때 OS의 per-user 시작 항목으로 뜨고 창을 닫아도 idle-exit하지 않으며, 등록이 정말 있는지는 OS에 물은 그대로 보인다.
- 비목표: 서명한 설치 묶음, 자동 업데이트 channel. 앱 실행 sandbox의 OS별 대체(sandbox는 `architecture/layers.md`와 앱 문서가 맡는다). 로그인 전 시작과 화면 없는 기계(Linux linger, macOS LaunchDaemon, 저장한 자격의 Windows scheduled task). 설치할 때나 표시하지 않은 기계의 OS 등록. Windows keychain·DPAPI 같은 OS 비밀 저장소. core가 crash했을 때 core 쪽에서 다시 띄우는 감독(표시한 기계에서 다시 띄우는 것은 OS다). 다른 컴퓨터나 다른 OS 사용자가 core에 붙는 길. 한 사람이 pairing한 자기 폰이 붙는 길은 있다(아래 "폰이 붙는 listener"와 "relay").

## 모델

### OS로 가르는 규칙의 자리

OS마다 다른 순수 규칙은 base의 OS 층 한 곳에 있다. base는 node 내장을 읽지 않으므로 필요한 것(hash, spawn)은 인자로 받는다.

- **home.** POSIX는 `HOME`, win32는 `USERPROFILE`, 없으면 `HOMEDRIVE`+`HOMEPATH`.
- **socket 자리.** 한 규칙이 정한다. POSIX는 `<XDG_RUNTIME_DIR>/lophn/<key>` 또는 `<tempParent>/lophn-<uid>/<key>`이고 key는 data root의 SHA-256 hex 앞 12자다(hash는 호출자가 넣는다). 폴더는 0700이다. win32는 폴더를 만들지 않고 data root를 pipe 이름 공간의 입력으로 쓴다. 이때 구분자를 `\`로 맞추고 끝 구분자를 빼고 소문자로 바꾼다. 같은 폴더를 core는 `C:\a\b`로, dev 도구는 `C:\a/b`로 받아 서로 다른 pipe를 찾은 일이 있다.
- **IPC endpoint.** 폴더와 이름에서 endpoint를 만든다. POSIX는 `<dir>/<name>.sock`이고 길이 한도는 sun_path에서 Linux 107·macOS 103 byte, win32는 `\\.\pipe\lophn-<dir의 FNV-1a 64>-<name>`이고 한도 256이다. pipe 이름 공간은 하나뿐이라 data root마다 hash로 가른다.
- **process tree 신호.** 보내기와 없어졌는지 보기. spawn은 인자로 받는다.
- **PATH 앞에 폴더 더하기.** Windows는 `Path` 이름을 대소문자 없이 찾고 `;`로 잇는다.
- OS로 가르는 함수는 platform을 인자로 받는다. 기본값이 실제 platform이고 test는 다른 값을 넘긴다. protocol은 runtime 전역을 읽지 않는다. 앱 socket 경로 schema는 가장 큰 한도(256)만 보고 OS별 길이는 core가 경로를 만드는 곳에서 본다.
- path는 `node:path`·`node:url`로 다룬다. module 위치는 URL을 `fileURLToPath`로 바꿔 얻는다(`URL.pathname`은 Windows에서 `/C:/…`가 되고 공백·한글 path는 `%20`으로 깨져서 source check가 막는다). 절대 경로 판정과 PATH 잇기·나누기도 platform 규칙을 쓴다. 앱 안의 상대 path(bundle 목록, data area)만 `/` 꼴이다.

### process와 IPC

- **child tree 끄기.** POSIX(linux, darwin)는 child를 `detached`로 띄워 group leader로 두고 group 전체에 신호를 보낸다(`ESRCH`가 "없다"). Windows는 `detached`가 새 console을 열어 쓰지 않고(`windowsHide`) `taskkill /PID <pid> /T /F`로 tree를 끈다. 없어졌는지는 POSIX는 group 대상 `kill(-pid, 0)`, Windows는 root pid만 `kill(pid, 0)`으로 본다. supervisor는 group이 없어졌음을 확인한 뒤에 자원을 푼다.
- **앱 IPC.** POSIX는 unix socket, Windows는 named pipe다. Node `net`·`http`가 같은 API로 받아 transport는 경로 문자열만 다르다. Windows는 socket 폴더가 없고 낡은 pipe를 지울 일도 없다.
- **child env.** child에는 필요한 이름만 넘긴다. Windows는 OS가 요구하는 이름(`SystemRoot`, `ComSpec`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `TEMP`, `TMP`)과 agent shell tool이 Git Bash를 찾는 이름(`ProgramFiles`, `ProgramFiles(x86)`, `LOPHN_GIT_BASH`)을 더 넘기고, env 이름은 대소문자를 가리지 않고 읽는다. 임시 폴더는 `os.tmpdir()`다.
- **node shim.** 앱과 agent shell이 부르는 `node`·`npm`은 per-run `bin/`의 shim이 Electron의 Node(`ELECTRON_RUN_AS_NODE=1`)로 돌린다. POSIX는 sh script, Windows는 `node.cmd`·`npm.cmd`(cmd·CreateProcess용)와 확장자 없는 sh script(Git Bash용)를 같이 쓴다. shim은 기동마다 설치본과 byte를 맞춰 다시 쓴다.
- **agent shell tool.** POSIX는 `/bin/sh -c`, Windows는 Git for Windows의 `bash.exe`다(`LOPHN_GIT_BASH`, `%ProgramFiles%\Git\bin\bash.exe`, `%ProgramFiles(x86)%\…`, `%LOCALAPPDATA%\Programs\Git\bin\bash.exe` 차례). 못 찾으면 tool이 `unavailable`과 설치 안내를 내고 아무것도 띄우지 않는다. shell 규칙(`architecture/approval.md`)은 bash 기준이라 OS와 상관없이 같다.
- **SIGUSR2 snapshot**은 Windows에서 걸지 않는다. core는 control `stop`으로, apps supervisor와 agent runtime은 stdin EOF와 stop 메시지로 끝나서 Windows에 SIGTERM이 안 와도 끝난다.

### core 수명

```
 shell(앱 실행·--core) ─┐                    identify 답 있음 ─▶ 판 대조 ─▶ connect {client}
 CLI 사람 명령 ─────────┼─▶ ensureCore ─ control socket ─┤                     판 다름 ─▶ stop → identify 사라짐 → 새로 띄우기(한 번)
                        ┘                                └ 답 없음 ─▶ detached spawn ─▶ stdout 첫 줄 ready | start_failed
 OS 로그인 시작(표시한 기계) ─ Linux systemd·macOS launchd: core 입구를 바로(LOPHN_SERVICE=1) │ Windows Run: `--core` ─▶ ensureCore
 core: instance lock ─▶ control listen(starting) ─▶ migration·기계·data step·API·wiring·afterReady ─▶ ready ─▶ … ─▶ stop | idle-exit | signal ─▶ 같은 shutdown barrier
```

- **core는 shell의 child가 아니다.** shell과 CLI는 같은 `ensureCore`로 붙거나 띄우는 client다. IO(dial, detached spawn, Clock, timer)는 인자로 받는다. 띄운 core는 POSIX 새 session, win32 detached+`windowsHide`이고 launcher는 stdout 첫 JSON 줄(`ready` 또는 `start_failed {reason}`)만 읽고 놓는다. 그 줄에 token은 없다.
- **control socket.** data root마다 공통 socket 자리 아래 이름 `core`로 연다. POSIX는 0700 폴더의 unix socket, win32는 data root 이름 공간의 named pipe다. 한 연결에 JSON 한 줄 요청 하나와 Result 답 하나다(계약 `core-control-protocol`). verb는 `identify`(제품 판, protocol 판, `core_epoch`, `api_url`, `starting|ready|stopping`, credential 없음), `connect {client: cli|shell}`(user token을 주고, shell이면 shell capability도), `stop`, `diagnostic`, 사람 결정 handle 등록과 창 닫기(shell capability만, `architecture/approval.md`)다. 경계는 socket 자리의 권한이고 OS peer 신원은 보지 않는다. 데이터(API)는 그대로 loopback HTTP·WebSocket이다. core의 user token은 file로 쓰지 않고 `connect`로만 준다. 같은 core에 shell과 CLI가 각자 connect하므로 core마다 user credential이 하나라는 제한은 없다.
- **기동 순서.** 팀 조립과 route 등록을 확인한 뒤 ledger schema step을 적용하고, 그다음 기계 단계가 이 설치의 기계 신분(`machine.json`)을 정한다(`machine.md`: 처음이면 만들고, 복사된 data root면 새 기계로 바꾸고, 못 읽으면 덮지 않고 기동을 거절한다). 그 뒤에 data step, ledger 식별, 재시작 점검, wiring 조립이 온다. 기계 단계가 data step과 wiring보다 앞이라 data step(`remote.host-key.machine`)과 wiring이 지금 기계 id를 읽는다. 앱 supervisor는 이 기동이 만든 file을 읽고, 없으면 뜨지 않는다.
- **동시 시작은 data root의 `run/instance.lock`이 가른다.** lock을 잡은 core만 socket 잔여물을 치우고 listen한다. 진 core는 살아 있는 core의 socket과 runtime file을 건드리지 않고 끝나며, ensure는 identify를 다시 물어 이긴 core에 붙는다. liveness는 "identify가 답한다"이고 pid file이나 HTTP health probe를 쓰지 않는다. 끝나는 중(`stopping`)인 core를 만나면 ready나 사라짐을 기다린다.
- **판 대조.** identify의 제품 판이나 protocol 판이 ensure 쪽과 다르면 ensure가 `stop`을 보내 끝나기를 기다린 뒤 새로 띄운다(한 번). 돌던 run·job 차례는 종료와 같이 `interrupted`가 된다.
- **끝나는 길은 셋이고 barrier는 하나다.** control `stop`(`lophn core stop`, tray의 `Stop lophn`, 판 교체), idle-exit, SIGINT·SIGTERM. 앱의 Quit(Cmd+Q, `--quit`, will-quit, tray의 `Quit lophn`)는 shell 자원과 연결만 정리하고 core는 남긴다. 터미널과 coding agent는 core의 것이라 Quit 뒤에도 돈다. 도는 터미널이 있으면 Quit이 "그대로 두기"(기본)와 "다 닫기"를 묻는다(어느 쪽이든 core는 남는다). `Stop lophn`은 core를 멈추므로 도는 터미널이 있으면 그래도 끌지 묻는다. PTY host와 extension host는 core의 자식이라 core가 끝나면 터미널과 extension의 CLI도 끝난다. 명시 stop 뒤에는 shell이 core를 저절로 다시 띄우지 않는다(`closed(shutdown)`이나 identify `stopping`을 본 shell은 죽은 연결을 비우고, 30초마다 identify를 물어 이미 도는 같은 판 core에만 다시 붙는다. 다른 client가 stop하고 새 core를 띄워도 shell이 스스로 붙고 Reconnect도 그 core에 붙는다). 반대 방향은 하나 있다: 앱을 Quit한 뒤에도 core가 browser가 필요하면 shell을 띄운다(아래 "core가 shell을 띄운다"). core가 crash하면 core 쪽에서 다시 띄우는 감독은 없고 다음 ensure(shell 재연결, CLI 호출)가 띄운다. 표시한 기계의 Linux·macOS에서 OS가 띄운 core는 OS가 다시 띄운다(아래 "늘 켜 둠"). shell의 재연결에는 상한이 있다(아래 "core가 죽었을 때"). core가 SIGKILL돼도 PTY host는 stdin EOF로 스스로 끝난다. extension이 띄운 CLI는 자기 process group이라 남는다(이슈 `extension-cli-outlives-core-crash`). `lophn core stop`은 core를 띄우지 않는다.
- **끝 code.** 정상 종료(stop, idle-exit, 신호)는 0이다. ready 전 기동 실패는 1이지만 OS service가 띄운 core(환경 `LOPHN_SERVICE=1`)는 0이다: OS는 0이 아닌 끝을 crash로 보고 다시 띄우는데, ready 전 실패는 다시 띄워도 같고 lock을 잃은 것(`conflict`)은 이미 core가 있다는 뜻이다. ready 뒤의 비정상 끝(writer 죽음, 종료 기한 넘김)은 어느 쪽이든 0이 아니라 OS가 다시 띄운다. stdout의 `start_failed` 줄은 둘 다 같다.
- **idle-exit.** ready 뒤부터 30초마다 일과 client를 다시 본다. 일은 module마다의 machine 전용 read로 센다: 켜진 job(승인 대기 중인 켜진 job도 일), 열린 job run, running run, 모든 project의 running workflow instance. 도는 lophn agent turn과 화면 없이 도는 harness turn(시작했고 아직 끝나지 않은 것)도 일이다(대기 중인 입력과 harness queue는 세지 않는다). 열린 터미널도 일이다(GUI coding session은 터미널 위에 있어 같이 덮인다). 설정 `remote.enabled`가 켜져 있거나 이 기계의 늘 켜 둠 표시가 켜져 있으면 늘 일이 있는 것으로 본다(폰은 꺼진 core를 띄우지 못하고, 표시는 창을 닫아도 계속 돌라는 사람의 말이다. 끄는 것은 `Stop lophn`이다). 표시는 OS 등록이 실패했어도 켜져 있는 것이다. client는 진행 중 HTTP 요청, Gateway 구독, 열린 `/host-link` 연결(desktop 앱이나 page host)이다. 앱 process와 control 요청은 세지 않는다. 일도 client도 없는 상태가 10분 이어져야 끝난다. 읽기가 실패하면 일이 있는 것으로 보고, 읽는 동안 새 요청이 들어왔으면 그 판정을 버린다.
- **`--core`는 core만 띄운다.** 이 intent를 쓰는 것은 Windows의 로그인 시작 `Run` 값뿐이다(`--core --home <data root>`, 아래 "늘 켜 둠"). 그 Electron은 창·tray를 조립하지 않고 ensure만 한 뒤 끝난다. shell single-instance lock은 창 하나를 지키는 것이라 core의 instance lock과 따로이고, core-only 실행은 그 lock을 잡지 않는다. 옛 tray "Start at login"과 그 등록(`--tray`, macOS `wasOpenedAtLogin`)은 없다. 켜져 있던 옛 등록은 늘 켜 둠 표시로 옮긴다(아래).
- **core가 shell을 띄운다(browser가 필요할 때만).** agent가 `lophn tab open --url`로 browser 탭을 열려는데 shell이 붙어 있지 않으면 core가 앱을 띄운다. 터미널과 coding session은 core가 가져 앱 없이 열리므로 그 때문에 띄우지 않는다. 앱 창이 있어야 page가 있고(`<webview>`는 보이는 창에서만 그린다) job과 workflow는 사람이 앱을 Quit한 뒤에도 돌기 때문이다. display가 없는 Linux에서는 앱 대신 창 없는 page host를 띄운다(아래 "명령", `browser-tab.md` "화면 없는 기계의 page"). 이 방향(core → shell)은 새로 생겼고 사람이 Quit한 뒤에도 적용된다. Quit은 화면을 끈다는 뜻이고 등록을 승인한 job은 계속 돈다(모두 멈추는 길은 `Stop lophn`이고, 그때는 띄울 core가 없다).
  - **조건.** browser 탭 열기에만 띄운다. extension tool 호출, preview·artifact 탭 열기, 이미 연 탭의 browser 호출은 shell이 없어도 띄우지 않는다(앞의 둘은 기다리고, 마지막은 실패한다). 그리고 그 core를 띄운 쪽이 켰을 때만이다. 사람이 쓰는 core를 띄우는 곳(shell의 core 감독, CLI의 detached 시작, Linux·macOS 로그인 시작 등록의 글)이 환경 `LOPHN_LAUNCH_SHELL=1`을 준다. test, boot, E2E가 띄운 core는 이 값이 없어 앱을 띄우지 않고 shell 없음으로 실패한다. 띄울 길을 모를 때(build하지 않은 개발 저장소)도 같다.
  - **명령.** core는 자기 platform 배치에서 명령을 정한다. 설치본은 core를 띄운 Electron 실행 file 하나이고, 개발은 build한 shell entry를 같이 넘긴다. 어느 쪽이든 `--home <data root>`와 launch intent를 붙이고, core가 Node로 도는 표시(`ELECTRON_RUN_AS_NODE`)는 뺀다. detached로 띄우고 놓아 core가 끝나도 앱은 남는다. Linux에서 systemd가 띄운 core(`LOPHN_SERVICE=1`이고 `DISPLAY`·`WAYLAND_DISPLAY`가 없음)는 화면 세션의 env를 물려받지 못해, 앱을 띄울 때 `systemctl --user show-environment`(2초 한도)에서 `DISPLAY`, `WAYLAND_DISPLAY`, `XAUTHORITY`, `XDG_SESSION_TYPE`, `XDG_CURRENT_DESKTOP`, `DBUS_SESSION_BUS_ADDRESS`만 가져와 더한다. 못 가져오면 그 값 없이 띄운다. 그렇게 다 만든 env에 `DISPLAY`도 `WAYLAND_DISPLAY`도 없는 Linux면 intent는 `--page-host`이고 `--ozone-platform=headless --disable-gpu`를 같이 붙인다. 그 밖(display가 있거나 Linux가 아님)은 `--agent-window`다.
  - **한 번에 하나, 실패하면 쉰다.** 같은 시도를 동시에 온 열기가 함께 기다린다(앱을 여럿 띄우지 않는다). 시작을 30초 안에 확인하지 못하거나 spawn이 실패하면 시도가 끝나고 5분 동안은 다시 띄우지 않고 열기를 바로 실패시킨다. shell이 붙으면 풀린다.
  - **launch intent `--agent-window`.** 앱은 평소처럼 서고 첫 창을 focus 없이 연다. 이미 떠 있는 앱이 받으면 일반 창이 하나도 없을 때만 같은 창을 연다. core만 띄우는 `--core`와 달리 창을 만든다.
  - **launch intent `--page-host`.** 같은 Electron binary가 창, tray, renderer 없이 page host로 선다. desktop 앱처럼 core에 붙어 `/host-link`의 host가 되고 탭마다 offscreen page를 든다(`browser-tab.md` 62~66). desktop 앱과 같은 single-instance lock을 잡아 한 기계에서 둘이 같이 돌지 않는다. 이미 떠 있는 desktop 앱이 이 intent를 받으면 `--agent-window`로 읽는다(그 앱이 host다). page host가 떠 있는데 사람이 display가 있는 env에서 desktop 앱을 켜면 page host가 desktop 앱을 다시 띄우고 끝난다(한 번 눌러 앱이 선다). 다시 띄우는 인자와 env는 page host가 자기 쪽에서 만든다: data root는 page host 자신의 것이고 누른 시작에서는 display 값만 가져온다(누른 시작의 인자를 그대로 쓰면 `--home`을 잃어 사람의 data root로 갔다). page host가 든 page는 이때 닫힌다. `--quit`이면 끝나고 `--core`는 그대로 둔다.
  - **page host의 수명.** core에 묶인다. page host는 desktop 앱과 같은 core 연결을 써서 core가 죽으면 desktop 앱처럼 다시 띄운다(선 지 60초 안에 죽는 일이 5번 이어지면 그만 띄운다). core가 내려간다고 알리면(`lophn core stop`) 다시 띄우지 않고, `/host-link`가 60초 넘게 닫혀 있으면 끝난다. 마지막 page를 닫아도 남는다. 열린 `/host-link` 연결은 desktop 앱의 것처럼 idle-exit의 client로 세므로, page host가 붙은 core는 stop 전에는 idle-exit하지 않는다(화면 없는 기계는 대개 `remote.enabled`가 켜져 있어 어차피 끝나지 않는다).

### 늘 켜 둠(Keep running)

core 수명의 한 갈래다. 사람이 Settings › Remote의 "Keep running" 묶음("This computer" 아래, 폰 연결이 꺼져 있어도 보인다)에서 "Keep lophn running on this computer"를 켜면 그 기계의 core가 로그인 때 OS의 per-user 시작 항목으로 뜨고 창을 닫아도 idle-exit하지 않는다. 따로 켜는 "Keep this computer awake"는 그동안 기계가 저절로 잠들지 않게 한다.

```
 Settings › Remote · (뒤의 CLI·agent 도구)
   always_on/status ─▶ 표시 + OS에 다시 물은 사실
   always_on/set    ─▶ always-on.json 쓰기 ─▶ OS 등록 쓰기·지우기 ─▶ keep-awake 쥐기·놓기 ─▶ 사실
 core 기동(ready 뒤, 기다리지 않음) ─▶ 맞추기: 표시 켜짐 → 빠지거나 낡은 등록을 다시 쓴다 | 표시 꺼짐·다른 기계 → 남은 등록을 지운다
 OS port: core 입구가 설치 layout일 때만 준다. 없으면(개발·test core) OS를 부르지 않는다
```

- **표시.** `<data root>/always-on.json`(0600, temp에 쓰고 sync한 뒤 rename) 하나다: 이 기계 id, `keep_running`, `keep_awake`, 등록에 쓸 env(`service_env`), `updated_at`. core의 always-on module만 읽고 쓴다. 기계 id가 지금 기계와 다르면(다른 기계에서 복사한 data root) 꺼진 것으로 읽는다. 깨진 file도 꺼짐이고 덮지 않는다(사람이 다시 켤 때 새로 쓴다). file이 없으면 한 번도 켠 적 없는 root라 기동 때 OS를 부르지 않는다.
- **상태.** route `always_on/status`·`always_on/set`(memory, 사람만). status는 표시(`keep_running`, `keep_awake`)와 OS의 사실을 같이 낸다: `start_at_login`(`registered` | `not_registered` | `off_in_system` | `unavailable`과 `login_reason`: `development_build` | `no_service_manager` | `unverified_path` | `os_failed`), `awake`(`held` | `released` | `unavailable`과 `awake_reason`: `no_inhibitor` | `os_failed`), `mechanism`(`systemd` | `launchd` | `windows_run`, 개발 core는 null). `registered`는 OS가 그렇게 답했을 때뿐이다. status를 부를 때마다 OS에 다시 묻는다. core 안의 다른 module(idle-exit, 뒤의 기계 기록)은 마지막으로 안 값을 읽는다. set·맞추기·status는 한 줄로 서서 등록과 지우기가 엇갈리지 않는다.
- **켜기와 끄기.** `keep_running: true`는(이미 켜져 있어도. 화면의 Try again이 같은 값을 보낸다) 지금 env를 다시 잡아 표시를 쓴 뒤 등록을 쓴다. 등록이 실패해도 표시는 남고(사람의 선언이다) 결과는 `start_at_login`에 사실로 보인다. `keep_running: false`는 `keep_awake`도 끄고 등록을 지운다. 등록을 쓰거나 지우는 일은 도는 core를 멈추지도 지금 띄우지도 않는다(도는 core가 lock을 쥐고 있다). `keep_awake: true`는 표시가 켜져 있을 때만 받는다(`invalid_input`).
- **기동 때 맞추기.** 표시가 켜져 있으면 켤 때 잡은 env로 등록을 읽고, 빠졌거나 낡았으면(실행 경로, core 입구, data root, env가 다름) 다시 쓴다. OS나 사람이 OS 설정에서 끈 것(`off_in_system`)은 다시 켜지 않고 화면이 알린다. 사람이 lophn에서 다시 켜면 그때 OS 설정의 끔도 풀고 켠다. 표시가 꺼져 있거나 깨졌거나 다른 기계의 것인데 이 data root의 등록이 이 기계 OS에 있으면 지운다. 원래 기계의 등록은 그 기계의 것이라 건드릴 길이 없다.
- **`Stop lophn`.** 표시한 기계에서도 core를 멈춘다. 정상 종료라 OS가 다시 띄우지 않고, 다음 로그인이나 앱·CLI가 띄울 때 다시 선다.
- **OS별 수단.** 항목 이름의 key는 socket 자리와 같은 data root key(SHA-256 앞 12자, win32는 구분자·끝 구분자·대소문자를 맞춘 뒤)라 data root마다 항목이 하나다.

| | Linux | macOS | Windows |
|---|---|---|---|
| 항목 | systemd user unit `lophn-core-<key>.service`(`$XDG_CONFIG_HOME/systemd/user`, 없으면 `~/.config/systemd/user`) | LaunchAgent `~/Library/LaunchAgents/dev.lophn.core.<key>.plist` | HKCU `…\CurrentVersion\Run`의 값 `lophn-core-<key>` |
| 띄우는 것 | 설치본 Electron 실행 file + core 입구 `--port=0`, env `ELECTRON_RUN_AS_NODE=1`, `LOPHN_HOME`, `LOPHN_LAUNCH_SHELL=1`, `LOPHN_SERVICE=1`, `PATH` | 같다. `/bin/sh -c`가 실행 file이 없으면 0으로 끝나고 있으면 exec한다. `TMPDIR`도 싣는다 | `"<실행 file>" --core --home "<data root>"`. Electron이 ensure만 하고 끝난다. env는 Explorer의 것이고 등록에 싣지 않는다 |
| 다시 띄우기 | `Restart=on-failure`(5초 쉼, 300초에 5번까지) | `KeepAlive`의 `SuccessfulExit=false`(실패 때만) | 없다. 로그인 때 한 번 띄울 뿐이다 |
| 쓰기 | file을 쓰고 `daemon-reload`, `enable`(`--now` 없이) | file을 쓰고 `launchctl enable gui/<uid>/<label>`(bootstrap하지 않는다. 다음 로그인에 launchd가 읽는다) | `reg add`(REG_SZ) 뒤 StartupApproved 값을 지운다 |
| 읽기 | file 글이 지금 쓸 글과 같은가, `systemctl --user is-enabled`(enabled → 등록됨, disabled·masked → `off_in_system`) | file 글, `launchctl print-disabled gui/<uid>` | 값 글, StartupApproved 값의 첫 byte가 홀수면 `off_in_system` |
| 쓸 수 없음 | user bus에 못 붙음(systemd 없는 배포판, WSL, user manager 없는 session) → `no_service_manager` | | |

  - Linux unit은 `ConditionPathExists=<실행 file>`로 앱을 지운 뒤 남은 unit이 아무것도 하지 않게 하고, `TimeoutStopSec=120`(core 종료 기한 90초보다 길다), `KillMode=mixed`, `WantedBy=default.target`이다. macOS plist는 `RunAtLoad`, `LimitLoadToSessionType=Aqua`, `ProcessType=Interactive`(agent turn과 앱 build가 Background 취급으로 느려지지 않게)다.
  - 실행 file, core 입구, data root가 절대 경로가 아니거나 제어 문자·따옴표(Linux는 systemd quoting·specifier에 걸리는 `` ` `` `$` `\` `%`도)를 담으면 escape에 기대지 않고 등록을 거절한다(`unverified_path`). `PATH`에서는 그런 글자를 담은 항목과 빈 항목(현재 폴더)만 뺀다.
  - OS 명령은 shell 없이 5초 한도로 부른다. 실패하면 명령 이름과 exit code만 log에 남기고 경로와 env 값은 싣지 않는다.
- **설치 layout만.** core 입구는 자기 platform root에 shell 소스 폴더가 없을 때(설치 묶음의 `platform/`)만 core에 OS port를 준다. 이 판정은 core가 앱을 띄울 명령을 고르는 판정(위 "명령")과 같은 하나다. 저장소 layout(개발, test, boot, eval)의 core는 OS port가 없어 status가 `unavailable`·`development_build`이고, `keep_running: true`나 `keep_awake: true`는 `unavailable`("This is a development build.")로 아무것도 쓰지 않는다. 그래서 개발·test가 사람의 OS에 아무것도 등록하지 않는다.
- **설치 묶음은 아무것도 등록하지 않는다.** 등록은 사람이 켤 때 core가 한다. Windows NSIS 제거는 이름이 `lophn-core-`로 시작하는 HKCU `Run` 값과 그 StartupApproved 값을 지운다(업데이트는 옛 판의 uninstaller를 부르므로 그때는 남긴다). deb와 mac 앱을 지운 뒤 남은 unit·plist는 실행 file이 없으면 아무것도 하지 않고 끝난다. data root는 건드리지 않는다.
- **env와 secret.** 등록에 싣는 env는 표시를 켤 때 잡은 `PATH`(macOS는 `TMPDIR`도. core control socket 자리가 임시 폴더에서 나와 앱이 찾는 자리와 같아야 한다)뿐이다. 다른 env와 secret은 싣지 않는다. lophn의 secret은 `secrets.json` file이라 로그인 시작 core가 그대로 읽는다. harness의 keyring·Keychain과 Linux 화면 세션 env는 화면 로그인 뒤에만 있고, 없으면 그 harness나 앱 띄우기가 지금처럼 실패를 낸다(Linux의 앱 띄우기는 위 "명령"대로 화면 env를 가져온다).
- **keep-awake.** 표시가 켜져 있을 때만 켤 수 있는 따로 스위치이고 기본 꺼짐이다. core pid에 묶인 child가 쥐어 core가 죽으면(SIGKILL이어도) 풀린다: Linux `systemd-inhibit --what=sleep --mode=block`(`tail --pid=<core>`), macOS `caffeinate -i -w <core>`, Windows PowerShell이 `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)`를 걸고 core pid를 기다린다(`-ExecutionPolicy`를 주지 않는다. `-Command` 글은 script file 정책에 걸리지 않는다). 저절로 잠들기만 막고 덮개 닫기·Sleep 메뉴·화면 끄기는 막지 않는다. 놓을 때는 child tree를 끈다(POSIX group, Windows `taskkill /T`). 쥔 child가 스스로 끝나면 `awake`가 `unavailable`과 이유가 된다. 종료 때 놓는다.
- **옛 "Start at login".** tray 항목은 없다. 설치본 shell이 core에 붙은 뒤 옛 등록(Linux `autostart/lophn.desktop`의 `--core`·`--tray` Exec, macOS·Windows의 Electron login item)을 찾으면 `always_on/set { keep_running: true }`를 부르고, OS 등록이 `registered`로 답했을 때만 옛 등록을 지운다. 아니면 옛 등록을 남겨 로그인 시작을 잃지 않고 다음 실행이 다시 한다. OS 등록이 서지 않으면(systemd user session이 없는 Linux 등) 이 옮기기가 켠 표시를 되돌린다(사람이 전에 켠 표시는 둔다). 옮긴 사람에게는 표지(shell data의 `keep-running-notice.json`)를 남겨 desktop 창이 있을 때 native message box로 한 번 알린다: 창을 닫아도 이 컴퓨터에서 계속 돈다는 것과 Settings › Remote를 여는 단추. 옮기기가 끝날 때 창이 없으면 이 컴퓨터의 창이 load될 때 알린다.
- **업데이트와 OS 감독 밖.** service가 띄운 옛 판 core는 바로 갈아 띄우지 않는다. 앱이나 CLI를 열면 ensure가 판을 대조해 갈아 띄우고, 다음 로그인은 새 판으로 뜬다. 앱·CLI가 띄운 core는 OS 감독 밖이라 다음 로그인까지 crash 뒤 다시 뜨지 않는다.

### shell main과 core의 연결(`/host-link`)

host(desktop 앱의 shell main, display가 없는 Linux에서는 page host)와 core는 loopback API listener에 Gateway 옆으로 열린 WebSocket 하나로 이어진다. core가 page를 드는 쪽이 있어야 하는 일(탭 열기·닫기·보이기, browser 호출, 멀리서 보는 page의 frame 켜기·입력·take control)을 밀고, host는 답과 보고와 page frame을 올린다. 터미널, coding agent, extension은 core의 것이라 이 연결로 오가지 않는다(화면이 core route로 붙는다). 전에는 shell이 `host/take`로 요청을 5초 long-poll로 가져가고 답과 보고를 route로 올렸는데, GUI 상태 snapshot이 route body 한도(256 KiB, 4096 item)에 들지 않고 shell이 core로 상태를 계속 올려야 해서 한 방향 long-poll로는 안 된다. 옛 route는 지웠다.

- **연결.** `GET /host-link`, subprotocol `lophn.host-link.1`. Host·Origin·Bearer 검사는 Gateway와 같고 사람 자격(actor user)만 받는다(agent와 앱 자격은 `forbidden`). event 연결 한도(32·principal당 4)에 들지 않는다. 연결은 한 번에 하나라 새 연결이 오면 옛 연결을 닫는다(한 기계에 host는 하나다). JSON 글 frame이고 한 frame 16 MiB까지, 받는 쪽이 1 MiB 넘게 밀리면 닫는다. 첫 frame은 `hello`이고 모양이 틀린 frame은 1008로 닫는다. `page_frame`만은 틀려도(그림 상한을 넘음, 크기 0) 그 frame을 버리고 연결을 둔다(그림 한 장 때문에 진행 중인 browser 호출이 끝나지 않게). host는 그런 frame을 보내지 않는다. 끊기면 shell이 1초에서 30초 backoff로 다시 붙고 `hello`부터 보낸다. core가 다시 떠 주소와 token이 바뀌면 새 값으로 바로 붙는다.
- **host → core.** `hello`·`visible`(지금 그리는 workspace. page host는 빈 목록), `response`(요청의 답, `done` 또는 창이 못 받은 `retry`), `report`(host 탭의 browser 상태나 닫힘), `page_frame`·`page_state`(보는 쪽이 있는 page의 JPEG frame과 그리는가·take control 상태. queue가 아니라 멀리서 보기가 받는다).
- **core → host.** `request` frame 하나에 요청 하나다. 종류는 `tab_open`·`tab_close`·`tab_show`(터미널 탭은 target `{terminal: {terminal_ref}}`로 core가 연 터미널에 붙는다)와 `browser_call`, 연결 요청 `page_stream`·`page_read`·`page_input`·`page_control`이다. 연결 요청은 연결이 열려 있을 때만 넣고 대기하지 않는다: 연결이 없으면 바로, 연결이 닫히면 빌려 가지 않은 것까지 `unavailable`로 끝나고 다음 연결로 다시 가지 않는다(늦은 입력이 다음 host의 page에 들어가지 않게). queue는 닿는 요청을 바로 밀고(`visible`의 workspace가 닿는 탭 요청), 창이 `retry`한 요청과 빌려 간 지 10초가 지난 탭 요청은 1초마다 다시 민다. 연결이 닫히면 그 연결로 보낸 `browser_call`은 실행됐는지 모르거나 받을 host가 없어 `unavailable`로 끝나고 탭 요청은 다시 대기한다. browser 탭은 core 표에서 빠진다(그 page는 host가 들어 host가 끝나면 닫혔다고 알릴 길이 없다).
- **attached.** queue가 shell이 붙어 있다고 보는 것은 연결이 열려 있는 동안이다(전에는 기다리는 take가 있거나 마지막 take가 끝난 지 3초 안이었다). TUI hold는 이 연결과 상관없이 터미널을 가진 core가 잇는다(`coding-agent.md`).
- **끊긴 뒤.** 연결이 닫혀도 터미널과 coding agent는 그대로다. 답을 기다리던 hook 설치 물음은 거절로 센다(`coding-agent.md`). 다시 붙은 shell은 `hello`부터 보낸다.

### shell 창과 IPC 둘레

- **창의 기계.** shell main의 IPC는 영역의 handler보다 먼저 한 둘레를 지난다: 보낸 webContents가 다른 기계의 창이면(창을 열 때 main이 그 기계에 묶는다) `shell:core-call|core-watch|core-state-get`은 그 기계의 연결로 가고, 허락한 channel(`shell:machines-list|open|this-window|visible`, 창 단추, 외부 링크) 밖은 handler를 부르지 않고 `forbidden`이다(`ipcMain.on`은 듣지 않는다). 이 컴퓨터의 창은 그대로 자기 handler로 간다. 영역이 sender 검사(`checkCaller`)를 따로 하는 것은 그대로다.
- **preload.** 이 컴퓨터의 창은 `preload-shell`, 다른 기계의 창은 `preload-remote`(core, 기계 목록, overlay, 창 단추, 단축키, 외부 링크만)를 받는다. 다른 기계의 창이 없는 bridge의 기능은 renderer가 bridge가 없을 때의 길로 감춘다(`remote.md`).
- **창이 없을 때 여는 창.** 시작, tray Open, 두 번째 실행은 창이 하나도 없으면 시작 기계의 창을 연다. 시작 기계는 core를 기다리지 않고 shell data의 기계 목록 file에서 고르고, 못 읽거나 이 컴퓨터면 이 컴퓨터의 창이다. agent와 이 컴퓨터의 core가 쓰는 창(browser, 탭, 알림, 전역 키, agent 창)은 늘 이 컴퓨터의 창이다.

### 폰이 붙는 listener

- 설정 `remote.enabled`(기본 꺼짐, 사람만 바꾼다)가 켜져 있는 동안만 core가 따로 WebSocket listener를 연다. port는 설정 `remote.port`(기본 7432), 모든 interface, path `/remote`, binary message만 받는다. 설정이 바뀌면 열고 닫는다. 꺼져 있으면 loopback 밖 listener가 없다. API listener(loopback, `Host`·`Origin` 검사)는 그대로다.
- TLS 대신 연결 안에서 암호화한다(`Noise_IK_25519_ChaChaPoly_SHA256`, prologue `lophn-remote/1`). core의 host key는 `<data root>/remote/host-key.json`(0600)에 서명 key(`signing-key.json`)와 같이 remote를 처음 켤 때 만든다. 붙는 쪽(폰, 다른 컴퓨터의 core)은 초대장이나 명단으로 core의 공개 key를 받아 그 key만 믿고, core는 handshake에서 붙는 쪽의 공개 key를 받는다. 이 key가 기기 신원이고 bearer token은 없다. handshake와 hello가 10초 안에 끝나지 않은 연결은 닫는다. 기기로 붙지 않은 연결(handshake 중과 `join` 전)은 동시에 8개까지이고 넘는 socket은 받자마자 닫는다. 명단에 없는 key는 60초 안에 붙어야 하고, 붙기 전 frame은 16 KiB, statement는 8개까지이며 틀린 `join`은 연결마다 5번이다. 같은 network의 누구든 연결을 붙잡아 core의 메모리와 자리를 쓰지 못하게 하려는 것이다.
- 붙는 쪽의 첫 frame은 `join`이다. 받은 key가 내 기기 명단에 있으면(내민 statement를 합친 뒤) 그 기기로 붙고, 명단에 있는 key는 첫 frame이 `join`이 아니어도 붙는다. 명단에 없는 key는 `join`만 받는다. 빠진 key는 거절하고 그 빼기를 싣는다. 명단, 초대장, 들이기와 빼기는 `architecture/remote.md`의 "내 기기 명단", 자격과 route 목록은 `architecture/approval.md`, frame은 계약 `remote-protocol`이다.

### relay

- 폰과 core가 다른 network에 있으면 lophn relay로 만난다. 설정 `remote.relay`(relay 주소, 기본 빈 값, 사람만 바꾼다)가 있고 `remote.enabled`가 켜져 있으면 core가 relay에 control socket 하나를 밖으로 건다. listener와 따로 돌아 listener port를 못 열어도 relay는 돈다. 끊기면 1초에서 30초 backoff로 다시 걸고, 20초마다 ping하고 60초 받은 것이 없으면 끊는다.
- core는 relay에 자기 static key를 증명한다: relay가 임시 X25519 key와 nonce를 보내면 core가 두 key의 DH로 만든 HMAC을 돌려준다. relay는 증명된 control socket에만 그 key의 자리를 주고, 같은 key가 다시 증명하면 옛 자리와 그 폰 연결을 닫는다.
- 폰이 relay에 그 core key로 붙으면 relay가 무작위 128-bit 연결 id를 control로 알리고, core가 그 id로 data socket을 열어 listener의 연결과 같이 remote host에 넘긴다. 그 뒤는 listener로 붙은 폰과 같다(Noise handshake, 기기 자격, route 목록). relay는 binary message를 그대로 넘기고 내용을 보지 못한다.
- relay는 저장소의 relay package이고 Fly.io에서 돈다. 한도: core마다 폰 연결 16, data socket이 붙기 전 든 message 16, 증명과 data socket을 기다리는 10초, 받는 쪽이 1 MiB 넘게 밀리면 그 짝을 닫는다. client IP마다 socket 32개와 control socket 4개까지 받고, 폰 연결마다 초당 1 MiB(한 번에 17 MiB까지 몰아 쓴다)를 넘겨 보내면 그 연결을 닫는다. IP는 Fly가 붙이는 header로 읽는다. 1분마다 연결 수와 넘긴 bytes를 한 줄 log로 남기고 IP와 key는 남기지 않는다. `roster/invite`의 초대장(QR·CLI 글)에 relay 주소가 실리고, 상태는 `remote_relay/status`(사람만)로 본다.

### core가 죽었을 때

- **ledger writer Worker가 ready 뒤에 죽으면 core가 로그(`writer_dead`)를 남기고 graceful shutdown 없이 exit 1한다.** Worker가 error 없이 끝나거나, error 이벤트가 나거나, 연결이 fault돼도 같다. shell이 core를 다시 띄운다(graceful shutdown은 shell이 다시 띄우지 않으므로 쓰지 않는다). ready 전에 죽으면 기동 실패(`start_failed`)로 돌려줘 시작 실패 화면이 바로 뜬다. writer만 다시 띄우지 않는 이유는 writer 안의 기억(준비한 blob, confirmation handle)을 잃기 때문이다.
- **shell의 core 재시작 상한.** ready 뒤 60초를 살지 못하고 끝난 core를 crash로 세고, 5번째에서 멈춰 시작 실패 화면에 둔다. 그 전의 재시작은 1·2·4·8초 쉰다. 60초 넘게 산 core가 끝나면 센 수를 0으로 돌린다. Retry는 센 수를 비우지 않는다.
- **종료의 전체 기한은 90초다.** 단계별 기한의 합(65초)보다 길어 정상 종료를 자르지 않는다. 넘으면 `shutdown_deadline`을 남기고 exit 1한다(자식은 stdin EOF로 끝나고 lock은 OS가 푼다). HTTP server는 받은 요청을 10초까지 기다리고 그 뒤 남은 connection을 끊는다.
- **실행 중 표지.** core가 사는 동안 `run/running.marker`(pid, started_at)가 있고 정상 종료가 지운다. 다음 기동이 남은 것을 보면 `previous_unclean_exit`를 로그로 남긴다. liveness에는 쓰지 않는다.
- **agent runtime.** runtime process가 끝나면 그 안의 `shell.run` 자식 group을 죽인다(SIGKILL·OOM은 못 덮는다). 감독이 재시작 한도를 넘어 포기하면 core가 로그를 남기고 60초 뒤 한 번 다시 띄운다(core process당 한 번). 사람에게 알림은 띄우지 않는다.
- **두 번째 shell process.** single-instance lock을 shell context를 만들거나 core를 건드리기 전에 잡는다. 못 잡으면 곧 끝나므로 core를 띄우거나 갈아 띄우지 않는다. Quit과 `Stop lophn`은 돌던 ensure를 끊는다(spawn 전, 판 교체 stop 전에 확인한다). `Stop lophn`은 돌던 ensure가 끝나기를 기다린 뒤 core를 멈춘다.
- **저장소 오류는 원인을 글에 싣는다**(disk full, locked, corrupt, io). corrupt면 writer 연결을 fault로 만들어 위 규칙대로 core가 끝나고, 다음 기동은 시작 실패 화면으로 간다.
- **blob 정지 maintenance.** 목적 기록과 미참조 표지는 본문을 지웠거나 본문이 없다고 확인된(ENOENT) 것만 지운다. 정지마다 고아 기록을 최대 2,000개까지 쓸어 낸다(남은 것은 다음 정지로 미룬다).
- **git이 없으면** 앱 source·release 경로가 "git was not found" 오류로 끝난다(commit이 없다는 말로 바꾸지 않는다).

### file

- **data root.** 기본은 home 아래 `.lophn`(Windows `%USERPROFILE%\.lophn`)이다. POSIX는 소유 uid와 mode(group·other 권한 없음)를 보고 아니면 기동을 거절한다. Windows는 mode·uid가 없어 보지 않고 user profile ACL을 믿는다. `secrets.json`도 같은 file이고 Windows는 0600 검사를 하지 않는다. data root는 한 기계의 것이다. 공유 저장소(동기 폴더, network disk) 위의 data root를 두 기계가 번갈아 띄우면 기동마다 상대 기계의 기록을 복제로 판정해 새 기계 id를 만들고 기기 등록을 버린다(`machine.md`). 동기 폴더에서는 instance lock이 다른 기계의 core를 막지 못한다. 공유 저장소인지 검사하는 길은 아직 없다.
- **봉인.** 앱 bundle 사본(`apps/<app>/bundles/<hash>/`)은 file 0444·폴더 0555로 좁힌 뒤 옆에 빈 표지 `<사본>.sealed`를 쓴다. 봉인 판정은 표지가 있는가 하나다(Windows 폴더에는 쓰기 bit가 없다). 표지 없는 사본은 끊긴 준비가 남긴 것이라 쓰기 권한을 돌려준 뒤 지우고 다시 쓰고, 못 지우면 준비가 실패한다. 옛 data root는 data step `apps.sealed-marker`가 쓰기 bit 없는 사본에 표지를 써서 옮긴다.
- **bundle file 나눠 쓰기.** 봉인은 좁히기 전에 사본의 file을 내용 sha256으로 `<data>/bundle-files/<sha256>`과 hardlink로 잇는다. release마다 `node_modules`를 통째로 담아도 같은 byte는 디스크에 한 번만 있고, 앱 사이에도 나눠 쓴다. 0444 file이라 한 사본이 다른 사본을 바꾸지 못한다. 나눠 쓰지 못한 file(다른 fs, link 수 한도)은 사본 그대로 둔다. 표지 없는 사본을 지울 때 hardlink인 file의 mode는 건드리지 않는다(mode가 inode에 붙어 다른 사본까지 풀린다). Windows는 읽기 전용 속성이 link끼리 같이 붙어, 읽기 전용 file을 지울 때 Node가 속성을 풀면 다른 사본의 것도 풀린다. 그래서 store 쓸기가 아무도 안 쓰는 file을 지우면서 남은 file이 풀려 있으면 다시 0444로 잠그고, 사본이 지워질 수 있는 일(봉인, 앱 지우기, data step) 뒤마다 돈다. 지우기부터 다음 쓸기까지 그 file은 쓸 수 있는 채다. NTFS의 link 수 한도(1023)에 닿은 file은 사본 그대로 둔다. 옛 data root는 data step `apps.bundle-file-sharing`(POSIX)·`apps.bundle-file-sharing-win32`(Windows)가 봉인된 사본의 폴더를 잠시 열어 옮긴다.
- **연결.** bundle과 flow host의 directory 연결은 Windows에서 junction(권한이 필요 없다), 그 밖은 symlink다. file 연결은 모든 OS에서 symlink다.
- **권한 path 비교.** `relative`로 보고, Windows와 macOS는 대소문자를 가리지 않는다(file system 기본이 그렇다).

### shell과 터미널

- **macOS PATH.** Finder·Dock으로 켠 앱은 PATH가 짧아서 shell main이 시작할 때 login shell(`$SHELL -ilc`)의 PATH를 한 번(5초 한도) 읽어 둔다. core는 따로 사람의 login shell env 전체를 한 번(5초 한도) 읽어 터미널과 extension이 띄우는 CLI에 준다(OS 서비스나 CLI가 띄운 core도 같다. Windows는 login shell이 없어 core의 env다). harness 찾기 fallback에 `/opt/homebrew/bin`, `/usr/local/bin`이 있다.
- **macOS Dock.** 창이 없을 때 Dock을 누르면(`activate`) 창을 다시 연다.
- **harness 찾기.** Windows는 이름마다 `PATHEXT` 확장자로 찾고 실행 bit 대신 확장자로 판정한다. `.cmd`·`.bat`은 Node가 shell 없이 못 띄우므로 shell로 띄운다.
- **터미널 끄기.** POSIX는 `SIGHUP` 뒤 process group, Windows는 pty를 죽인 뒤 `taskkill /T`다.
- **hook·browser bridge도 공통 socket 자리를 쓴다.** 터미널을 가진 core가 연다. POSIX file은 공통 폴더의 `core-<pid>/`(0700), endpoint는 `b`(browser)·`h`(hook) 이름의 IPC endpoint(0600)다. Windows file은 `<data root>/run/core-<pid>/`, endpoint는 data root 이름 공간의 `core-<pid>-b`·`core-<pid>-h` named pipe다. 두 endpoint가 OS별 길이 한도를 넘으면 file 정리 전에 기능을 끄고 로그 한 줄만 남긴다(pointer file이나 TCP로 우회하지 않는다). file 폴더 준비는 hook·browser 각자의 listen과 분리돼, shim 쓰기나 bridge listen이 실패해도 hook은 준비된다. 공통 폴더는 core·앱 socket과 `core-<pid>/`가 같이 쓰므로 app supervisor는 정지할 때 아무것도 지우지 않는다(낡은 앱 socket은 그 자리에 새 자식을 띄우기 전에 지운다). 판이 바뀌어 shell이 옛 core를 멈추면 옛 supervisor가 새 shell보다 늦게 끝나기 때문이다. 터미널 host는 bash·zsh init file이 없으면 시작 층 없이 원래 login shell로 띄운다. win32 전체를 끄는 gate는 없다.
- **browser shim.** POSIX sh shim과 Windows `browser.exe`(OS의 .NET Framework 4 `csc.exe`로 data root `run\browser-<hash>\`에 build, `architecture/browser-tab.md` 28)가 공통 `browser.js`를 Electron Node로 돌려 bridge에 URL을 넘긴다. Windows가 `.cmd`가 아닌 것은 cmd.exe가 URL의 `&`를 명령으로 해석하고 한글 경로를 코드페이지로 깨서다. 실패·declined·timeout이면 OS opener로 넘기고(Windows는 `cmd.exe start`) bridge env와 `ELECTRON_RUN_AS_NODE`를 지운다.
- **PowerShell 시작 층.** PowerShell 7·5.1은 기존 profile 뒤 `-NoExit -Command ". '<init.ps1>'"`로 per-run 함수를 읽는다. 5.1용 file은 UTF-8 BOM을 포함한다. 사용자 alias·function·profile·execution policy는 고치지 않는다. 정책이 `.ps1` 읽기를 막으면 시작 층은 켜지지 않으며 우회하지 않는다. 감싼 명령의 실제 경로는 `$global:`에 둔다(`$script:`는 사용자 script 안에서 부르면 비었다). 터미널 shell은 PATH의 `pwsh.exe`, `C:\Program Files\PowerShell\7\pwsh.exe`, 5.1 순서로 고른다. winget·Store의 MSIX 판은 PATH의 `WindowsApps\pwsh.exe` 앱 실행 alias로만 보이고 `stat`이 EACCES라 있는지는 `lstat`으로 본다.

### Windows에서 꺼진 기능

그 기능이 기대는 OS 장치가 없어서 끈 채다. 코드가 win32에서 일부러 건너뛴다.

| 기능 | 왜 | 그 대신 |
|---|---|---|
| 터미널 foreground 판정 | `/proc`가 없다 | harness TUI를 process로 알아보지 못한다(hook이 알리는 상태만 있다) |
| 터미널 `signal` 요청(harness GUI toggle의 TUI 끄기) | foreground process group이 없다 | toggle이 없다 |
| 앱 RSS 감시(설정한 한도의 85%) | RSS를 읽는 길이 없다(macOS는 `ps`) | 감시가 꺼져 있다 |

macOS는 foreground 판정이 pty의 process 이름뿐이고(`/proc`가 없다) 터미널 `signal` 요청이 Linux만이다.

### 설치 묶음

공통 단계는 shell·renderer build → 따로 둔 app 폴더에서 electron-builder `dir` → `platform/`(core·cli와 그 의존의 production `node_modules`), `extensions/`, `desktop/`, `skills/`를 넣기 → OS 묶음이다. `--dir`은 풀린 앱까지만 한다. 서명하지 않는다.

| | Linux | macOS | Windows |
|---|---|---|---|
| 묶음 | `.deb`(`/opt/lophn`) | dmg(`lophn-desktop.app`) | NSIS |
| 설치 root | 설치 폴더(resources의 부모) | `Contents/Resources` | 설치 폴더(resources의 부모) |
| CLI | `/usr/bin/lophn`(sh) | `<root>/bin/lophn`(sh) | `<root>\bin\lophn.cmd` |
| node-pty | source compile | N-API prebuild | N-API prebuild |

macOS·Windows는 CLI를 시스템 PATH에 깔지 않는다. core가 launcher의 절대 경로(설치본은 앱 안 launcher, 저장소 실행은 `<저장소>/.cache/dev-cli/lophn`이 있을 때만. 물려받은 `LOPHN_CLI`는 보지 않는다)를 쓰고, lophn 터미널과 extension이 띄우는 CLI(harness agent 포함)의 env에 그 폴더를 PATH 앞에 둔다. Windows의 `platform/node_modules/@lophn/*`는 npm이 만드는 절대 경로 junction 대신 copy다. node-pty는 Linux만 rebuild한다.

### 다른 OS 확인

GitHub Actions workflow 하나가 ubuntu·macos·windows에서 `npm ci` → `check:full` → core를 새 data root로 두 번 띄우기(두 번째는 재시작) → `--dir` 묶음을 돈다. 손으로 실행하거나 `ci/**` branch push에서만 돈다(private repo에서 macOS minute은 10배). push와 실행은 사람에게 묻는다.

- **symlink 권한.** Windows는 개발자 모드나 관리자 권한이 없으면 symlink를 만들지 못한다(junction은 된다). test의 폴더 연결은 `"junction"` type으로 만들고(POSIX는 type을 무시한다), file symlink가 꼭 필요한 test는 이유를 달고 건너뛴다. electron-builder가 받는 `winCodeSign` 묶음에 macOS symlink가 있어 그런 PC에서는 `package`가 풀기에서 실패한다. cache에 `darwin`만 빼고 미리 풀면 지나간다. GitHub runner는 관리자라 상관없다.
- **npm script.** `e2e`·`e2e:deps`는 Electron의 Node로 띄우는 wrapper를 거친다. env 앞붙임 꼴(`ELECTRON_RUN_AS_NODE=1 …`)은 npm이 Windows에서 쓰는 cmd.exe에서 돌지 않는다.
- **e2e 지원 코드.** Windows에는 `/proc`이 없어 띄운 core의 pid에서 `ParentProcessId`를 따라가 같은 home의 process를 찾는다. e2e core의 `USERPROFILE`은 `HOME`과 같은 빈 폴더다.
- **개발 실행의 `lophn`.** Windows의 개발 실행은 sh launcher와 `lophn.cmd`를 같이 쓰고 core는 `.cmd` 경로를 쓴다. harness 감지 child는 `.cmd`·`.bat`을 shell로 띄운다.

## 지키는 것

1. POSIX data root 검사는 Windows를 위해 느슨해지지 않는다. platform이 win32일 때만 건너뛴다.
2. 봉인된 사본은 표지가 있는 한 다시 쓰지 않는다. 표지 없는 사본은 지우지 못하면 준비가 실패한다(조용히 넘어가지 않는다). 나눠 쓰는 file을 사본 하나 때문에 쓸 수 있게 바꾸지 않는다.
3. base와 protocol은 OS를 runtime 전역으로 읽지 않는다. OS로 가르는 함수는 platform을 인자로 받는다.
4. Windows에서 꺼진 기능은 조용히 다른 길로 가거나 꺼진 것을 보인다. 반쯤 도는 채로 두지 않는다.
5. supervisor는 child group이 없어졌음을 확인한 뒤에 자원을 푼다. 세 OS가 같다.
6. 한 data root에 core는 하나다. 동시 시작은 instance lock이 가르고, 진 core는 이긴 core의 socket과 runtime file을 건드리지 않는다.
7. core의 liveness는 identify가 답하는가 하나다. 판이 다르면 stop → 사라짐 확인 → 새로 띄우기를 한 번만 한다.
8. 앱을 끄는 것(Quit)은 core를 끄지 않는다. core는 stop, idle-exit, 신호로만 끝난다. 명시 stop 뒤 shell이 core를 저절로 다시 띄우지 않는다. core가 shell(display가 없는 Linux에서는 page host)을 띄우는 것은 browser 탭 열기가 shell 없이 왔고 그 core를 띄운 쪽이 켰을 때뿐이다. 터미널과 coding agent는 Quit 뒤에도 돌고 core가 끝날 때 함께 끝난다(PTY와 CLI가 남지 않는다. core가 crash하면 CLI가 남는 것은 열린 이슈다).
9. idle-exit는 일도 client도 없는 10분이 이어져야 하고, 읽기 실패는 일로 친다. 켜진 job이 있는 core, 도는 lophn agent turn이나 harness turn이 있는 core, 열린 터미널이 있는 core, `remote.enabled`가 켜진 core, 이 기계의 늘 켜 둠 표시가 켜진 core는 끝나지 않는다. 다른 기계의 표시(복사된 data root)는 꺼짐이다.
10. core 기동 launcher는 stdout 첫 줄만 읽고 놓으며 그 줄에 credential이 없다. user token은 file에도 stdout에도 쓰지 않는다.
11. hook 준비는 browser shim·bridge listen의 성공과 분리한다. endpoint가 길이 한도를 넘으면 그 기능만 끄고 우회 길을 만들지 않는다.
12. app supervisor는 정지할 때 공통 socket 폴더에서 아무것도 지우지 않는다.
13. 사용자의 PowerShell profile·alias·function·execution policy를 고치거나 우회하지 않는다.
14. 사람이 표시한 기계에서만 per-user 로그인 시작을 등록한다. 설치 때와 개발·test core는 하지 않는다(core 입구가 설치 layout일 때만 OS port가 있다). 로그인 전 시작(linger, LaunchDaemon)은 하지 않는다.
15. ready 뒤 ledger writer가 죽은 core는 살아 있지 않는다(exit 1). 조용히 끝난 Worker 때문에 모든 command가 `unavailable`로만 끝나는 core를 남기지 않는다.
16. 종료는 90초 안에 끝난다. 멈춘 단계 하나가 instance lock을 쥔 채 끝없이 기다리지 않는다.
17. shell의 core 재시작은 상한(60초 안에 5번)이 있고, 넘으면 시작 실패 화면에 멈춘다. Retry가 상한을 풀지 않는다.
18. 곧 끝날 두 번째 shell process는 core를 건드리지 않는다. Quit·`Stop lophn` 뒤에는 돌던 ensure가 core를 새로 띄우지 않는다.
19. blob의 목적 기록과 미참조 표지는 본문이 없다고 확인된 것만 지운다.
20. 기계 단계는 data step과 wiring 조립보다 먼저 돌고, 실패하면 기동이 실패한다. 기계 id를 모르는 채 뜬 core가 없다.
21. "등록됨"은 OS가 답한 것만이다. 빠지거나 낡은 등록은 기동 때 다시 쓰고, OS나 사람이 OS 설정에서 끈 것은 사람이 lophn에서 다시 켜기 전까지 켜지 않는다. 등록이 실패해도 표시는 지우지 않고 사실을 보인다.
22. 로그인 시작 등록에는 표시를 켤 때 잡은 `PATH`(macOS는 `TMPDIR`도)와 lophn의 고정 env만 싣는다. 다른 env와 secret은 싣지 않는다. escape해야 하는 글자를 담은 경로는 등록하지 않는다.
23. OS service가 띄운 core(`LOPHN_SERVICE=1`)의 ready 전 실패는 exit 0이고 ready 뒤의 비정상 끝은 0이 아니다. 다시 띄워도 같은 기동 실패를 OS가 되풀이하지 않게 하고, ready 뒤 crash는 OS가 다시 띄우게 한다.
24. keep-awake는 core pid에 묶인 child가 쥔다. core가 어떻게 끝나든 풀리고, 저절로 잠들기 밖의 잠(덮개, Sleep 메뉴)은 막지 않는다.
25. 다른 기계의 창이 보낸 IPC는 허락한 channel 말고 어느 영역의 handler에도 닿지 않는다. 그 창의 core 통로는 그 기계의 연결로만 가고 이 컴퓨터의 core에 닿지 않는다.

## 경계와 계약

- **core-control-protocol** (control socket). `identify`, `connect {client: cli|shell}`, `stop`, `diagnostic`, 사람 결정 handle 등록·창 닫기(shell capability만). 한 연결에 JSON 한 줄 요청과 Result 답 하나. 공통 오류 코드 일곱만 쓴다. 클라이언트 쪽은 `ensureCore` 하나(shell과 CLI 공유)다.
- **core 기동 알림.** 띄운 core의 stdout 첫 줄: `ready` 또는 `start_failed {reason}`.
- **runtime file.** `run/instance.lock`(동시 시작을 가른다), 공통 socket 자리의 `core` endpoint, `core-<pid>/`와 `core-<pid>-b`·`core-<pid>-h`. 이전에 있던 `run/user-token`·`run/location.json`은 없고 lock을 잡은 core가 남은 것을 지운다.
- **CLI.** 사람 명령은 core를 띄워서라도 붙는다. 주소는 `LOPHN_DAEMON_URL` 또는 identify다. agent 자격(`LOPHN_AGENT_CREDENTIAL`)이 있으면 그것만 쓰고 user 자격으로 바꾸지 않는다. `lophn core stop`은 core를 띄우지 않는다.
- **launch intent.** `--core`(core만 띄우고 Electron은 끝난다. Windows 로그인 시작 `Run` 값만 쓴다). `--quit`은 Quit와 같다. `--agent-window`는 core가 browser를 쓰려고 앱을 띄울 때 쓴다(focus 없는 창 하나). `--page-host`는 display가 없는 Linux에서 core가 앱 대신 띄우는 창 없는 page host다(`--ozone-platform=headless --disable-gpu`와 같이).
- **환경 이름.** `LOPHN_GIT_BASH`(Windows Git Bash 경로), `LOPHN_CLI`(개발 실행의 CLI launcher), `LOPHN_DAEMON_URL`, `LOPHN_LAUNCH_SHELL`(`1`이면 그 core가 browser가 필요할 때 앱을 띄울 수 있다. shell과 CLI의 core 시작과 로그인 시작 등록 글이 준다), `LOPHN_SERVICE`(`1`이면 OS service가 그 core를 띄웠다. Linux·macOS 로그인 시작 등록 글이 준다. ready 전 실패의 끝 code와 Linux 화면 env 가져오기가 본다).
- **늘 켜 둠.** route `always_on/status`·`always_on/set`(memory, 사람만, 오류 `invalid_input`·`forbidden`·`unavailable`). 표시 file `<data root>/always-on.json`(`{machine, keep_running, keep_awake, service_env: {PATH, TMPDIR?}, updated_at}`, 0600). core 안의 다른 module은 wiring context의 `alwaysOn`(마지막으로 안 status)으로만 읽는다. OS 항목 이름 `lophn-core-<key>.service`(systemd user), `dev.lophn.core.<key>`(launchd label), HKCU `Run` 값 `lophn-core-<key>`. Windows 제거는 `lophn-core-` 접두사로 값을 찾는다.
- **install 계약.** 설치 root 아래 `platform/`, `extensions/`, `desktop/`, `skills/`, 그리고 `bin/`의 CLI launcher.
- **기계 기록** `<data root>/machine.json`(`machine.md`). 앱 process 시작 줄에 기계 id `machine`이 실린다.
- **data step** `apps.sealed-marker`: 옛 data root의 봉인 사본에 표지를 쓴다. 두 번 돌아도 같고 새 data root는 처음부터 적용한 것으로 친다.
- **data step** `apps.bundle-file-sharing`·`apps.bundle-file-sharing-win32`: 옛 data root의 봉인 사본 file을 store와 hardlink로 잇는다. 이미 이어진 file은 건너뛰어 두 번 돌아도 같다. 앞의 것은 win32가 아닐 때만, 뒤의 것은 win32일 때만 돈다. 앞의 것을 Windows를 빼고 먼저 내서, 그 판을 거친 Windows data root도 옮기려고 둘로 나눴다.

## 결정

- 대상은 Linux x64, macOS arm64, Windows x64이고 서명하지 않는다. 이유: 사람이 Linux에서만 개발해 다른 OS 지원이 없었고, 다른 OS에서 build하고 기동하는 체계가 필요했다. (agent)
- 다른 OS 확인은 GitHub Actions matrix 하나이고 손으로 실행하거나 `ci/**`에 push할 때만 돈다. 이유: private repo에서 macOS minute이 10배다. (agent)
- process group은 POSIX `kill(-pid)`, Windows `taskkill /T`다. 버린 안: Job Object. native addon이라서. (agent)
- Windows data root는 user profile ACL을 믿는다. keychain·DPAPI는 하지 않는다. 이유: Claude Code·Codex가 같은 식이다. (agent)
- 봉인은 mode bit 대신 표지 file로 판정한다. 이유: Windows 폴더에 쓰기 bit가 없다. (agent)
- 앱 bundle은 release마다 통째로 두고, 같은 file을 내용 hash store와 hardlink로 나눠 쓴다. 이유: 이전 release로 돌아가기가 network 없이 되어야 해서 지난 bundle을 지울 수 없는데, release 하나의 99%가 같은 `node_modules`라 release 80여 개가 9.5GB였다(나눠 쓴 뒤 1GB 아래). 버린 길: 지난 bundle을 N개만 남기기(돌아가기 범위가 줄어든다), 준비에서 devDependencies 빼기(나눠 쓰면 아끼는 것이 거의 없고 런타임에 dev 의존을 쓰는 앱이 깨진다), reflink(ext4에 없다). (agent)
- Windows도 나눠 쓰고, 읽기 전용이 풀리는 것은 store 쓸기가 다시 잠가 메운다. 이유: Windows의 봉인은 원래 표지 file로 판정하고 폴더에 쓰기 bit가 없어, 읽기 전용 속성은 같은 사용자의 실수를 막는 정도다. 지우기와 다음 쓸기 사이의 틈이 그 보호를 크게 줄이지 않고, 빼 두면 Windows 사람의 data root만 release마다 100MB 넘게 쌓인다. 버린 길: `node_modules` 폴더를 junction으로 나눠 쓰기(의존 하나만 바뀌어도 폴더째 새로 써서 덜 아끼고, Node가 실제 경로로 module을 풀어 sandbox 경로 규칙을 고쳐야 한다), ReFS block clone(일반 NTFS에 없다). (agent)
- Windows agent shell tool은 Git Bash이고 shell 규칙은 POSIX 그대로다. 이유: Claude Code가 Windows에서 Git Bash를 요구한다. (agent)
- Windows 첫 land는 CI를 돌리지 않고 했다(Windows·macOS 처음 실행은 깨질 것으로 보았다). (사람, 2026-11-06)
- 공통 socket 자리 규칙은 base의 순수 함수 한 곳이다. hash는 호출자가 넣고 POSIX key(SHA-256 앞 12자)는 바꾸지 않는다. 이유: base는 Node를 import하지 않고, 기존 앱 socket 경로와 slot 수를 지켜야 migration이 없다. (agent)
- Windows 인증은 기존 64 hex key만 쓰고 SID·DACL 검사는 더하지 않는다. 경로가 한도를 넘으면 기능을 끄고 로그 한 줄만 남기며 pointer file·TCP로 우회하지 않는다. (agent)
- hook 준비는 browser shim·listen과 분리한다. PowerShell은 사람의 실행 정책을 우회하지 않는다. (agent)
- Windows foreground·signal·TUI toggle·GUI adapter 전체 대응은 platform-ipc 범위에 넣지 않았다. (agent)
- Windows 실기 미확인을 기록한 채 land하고 계획을 닫았다. full check·기존 E2E·core 기동은 유지하고 Windows 통과로 적지 않는다. (사람)
- core는 shell의 child가 아니다. shell과 CLI는 ensure로 붙거나 띄우는 client다. 이유: job을 shell(Electron) 수명에서 떼는 것이 첫째 이유고, 화면 없는 머신에서 CLI만으로 core를 켤 수 있어야 한다. (사람, 2026-11-08)
- 앱의 Quit는 shell만 끄고 core는 idle-exit로 끝난다(열린 터미널이 있으면 일이 있는 것이라 idle-exit하지 않는다). 모두 끄는 `Stop lophn`을 따로 둔다. (사람이 추천을 받음, 2026-11-08)
- 터미널과 coding agent(PTY host, extension host)는 core의 자식이고 앱을 Quit해도 돈다. 도는 터미널이 있으면 Quit이 "그대로 두기"(기본)와 "다 닫기"를 묻는다. 열린 터미널과 도는 harness turn은 idle-exit의 일이라 core가 저절로 끝나지 않는다. 모두 끄는 길은 `Stop lophn`이다. 이유: 일은 core가 하고 shell은 화면 가운데 하나다. 폰과 agent가 연 터미널이 앱에 묶이지 않는다. 버린 안: Quit이 터미널을 끝낸다(앞의 판). (사람, 2026-11-17)
- CLI도 ensure로 core를 띄운다. 끄는 것은 idle-exit와 `lophn core stop`이다. (사람이 추천을 받음, 2026-11-08)
- idle-exit는 일도 client도 없이 10분이다. 앱 process와 control 요청은 세지 않는다(앱은 쓰일 때 core가 띄우고, client도 job도 없으면 쓰는 쪽이 없다). 승인 대기 중인 켜진 job도 일로 치고, 30초마다 다시 보며 읽기 실패는 일로 친다. (agent)
- (2026-11-16 아래에서 뒤집음) OS service로 등록하지 않는다. 이유: 로그인 autostart가 core만 띄우는 것으로 충분하다. (agent)
- 사람이 표시한 기계에서만 OS의 per-user 로그인 시작 항목을 등록한다. 위 "OS service로 등록하지 않는다"와 옛 지키는 것 14("OS service는 등록하지 않는다. 로그인 때 켜는 것은 core만 띄우는 autostart다")를 뒤집었다. 설치 때와 개발·test core는 하지 않는다. 이유: 옛 autostart는 Electron이 ensure만 하고 끝나 crash 뒤 아무도 다시 띄우지 않고, Linux XDG autostart는 화면 세션에서만 돈다. 늘 켜 둔 기계에서 core가 죽으면 job과 폰이 사람이 올 때까지 멈춘다. 표시만 있고 수단이 없으면 표시가 거짓이다. 표시는 기계마다 하나이고 켜면 등록하고 idle-exit를 끈다. (사람: 표시가 그 기계를 늘 켜 둔다, 2026-11-16. agent: 등록 수단과 뒤집기)
- 첫 판은 로그인 뒤에 뜬다. linger·LaunchDaemon·저장한 자격의 scheduled task는 쓰지 않는다. 화면 없는 첫 설정(provider key, pairing)과 같이 연다. (agent, 사람이 맡긴 multi-machine 정책)
- OS별 수단은 Linux systemd user unit(`Restart=on-failure`), macOS `~/Library/LaunchAgents`의 plist(`KeepAlive`는 실패 때만), Windows HKCU `Run` 값(`--core` 시작)이다. Windows에 scheduled task를 쓰지 않는 이유: task는 env를 넘기지 못해 core를 바로 띄우려면 console 창이나 상주 Electron이 필요하고, 로그온 trigger task는 권한에 걸리는 경우가 있다. `Run` 값은 관리자 없이 되고 사람이 Startup apps에서 끌 수 있다. 잃는 것: Windows는 crash 뒤 다시 띄우지 않는다(다음 로그인이나 앱·CLI가 띄운다). 첫 판은 이것을 받아들인다. (agent)
- 등록, 상태 읽기, 고치기는 core가 한다. 이유: 화면, CLI, 뒤의 agent 도구가 같은 사실을 보고, 창이 없어도 기동 때 고친다. (agent)
- "등록됨"은 OS가 답한 것만이다. 빠지거나 낡은 등록은 기동 때 다시 쓰고, OS나 사람이 OS 설정에서 끈 것은 다시 켜지 않고 화면에 알린다. 이유: 사람이 OS에서 끈 것을 lophn이 몰래 되돌리지 않는다. (agent)
- 표시는 이 기계 id와 같이 data root의 file에 둔다. id가 다르면(복제) 꺼짐으로 읽고 그 data root의 등록이 이 기계 OS에 있으면 지운다. 원래 기계의 등록은 건드릴 길이 없다. (agent)
- 옛 tray "Start at login"은 표시로 바꾼다. tray 항목을 지우고, 켜져 있던 옛 등록은 새 판이 표시를 켜고 OS 등록이 선 뒤에 지운다. 옮긴 사람에게는 한 번 알린다(그들에게는 idle일 때 core가 멈추지 않는 것으로 동작이 바뀐다). 이유: 같은 일을 하는 스위치 둘을 두지 않고, 바뀐 동작을 사람이 우연히 알게 두지 않는다. (agent)
- `Stop lophn`은 표시한 기계에서도 core를 멈춘다. 정상 종료라 OS가 다시 띄우지 않는다. 화면은 그대로이고 스위치 설명이 그 뜻을 적는다. (agent)
- keep-awake는 따로 스위치이고 기본 꺼짐이며 표시가 켜져 있을 때만 켠다. 저절로 잠들기만 막고, core pid에 묶인 child가 쥔다. (agent, 사람이 맡긴 multi-machine 정책)
- service로 뜬 core에 넘기는 env는 켤 때 잡은 `PATH`(macOS는 `TMPDIR`)뿐이고 새 secret 저장소를 만들지 않는다. 이유: lophn의 secret은 file이라 로그인 시작 core가 그대로 읽고, harness의 keyring과 화면 env는 화면 로그인 뒤에만 있어 등록에 실어도 소용이 없다. (agent)
- 등록은 설치 layout으로 뜬 core만 한다. 설치 묶음은 아무것도 등록하지 않고, Windows 제거만 `Run` 값을 지운다. 이유: 개발·test가 사람의 OS를 바꾸지 않고, 사람이 켜지 않은 기계에 등록이 생기지 않는다. (agent)
- OS service로 뜬 core의 ready 전 실패는 exit 0이다. 이유: OS는 0이 아닌 끝을 crash로 보고 다시 띄우는데 ready 전 실패(schema, lock 충돌)는 다시 띄워도 같다. (agent)
- control socket은 TCP가 아니다. 이유: socket 폴더 권한(POSIX 0700)과 Windows named pipe가 경계다. 버린 안: API를 unix socket으로도 여는 것(Codex sandbox에 core socket 하나만 여는 길)은 이 설계에 넣지 않았다. (agent)
- 1회용 ticket을 만들지 않고 `connect`가 user credential을 준다. 이유: 예전에 `run/user-token`(0600 file)이 같은 경계에서 같은 것을 주던 것이라 더 약해지지 않는다. (agent)
- 사람 결정 handle은 control `connect {client: shell}`의 shell capability로만 등록한다. HTTP token, agent·worker credential, route, CLI에는 길이 없다. OS peer 신원 검증은 하지 않는다. (agent)
- 동시 시작은 instance lock이 가르고 liveness는 identify다. 버린 안: pid file, HTTP health probe. 판이 다르면 stop → 종료 확인 → 새로 띄우기를 한 번 한다. (agent)
- shell의 single-instance lock은 남긴다. 이유: 창 하나·탭 하나를 지키는 것이라 core lock과 따로다. (agent)
- core가 crash해도 core 쪽에서 다시 띄우는 감독은 두지 않는다. 다음 ensure가 띄운다. 놓친 job 차례는 놓친 차례 정책(`run`, `hold`)이 받는다. (agent)
- ledger writer가 죽으면 writer만 다시 띄우지 않고 core가 exit 1한다. 이유: writer 안 기억(준비한 blob, confirmation handle)을 잃고 새 core 상태와 화면이 필요하다. shell 재시작 상한이 되풀이를 시작 실패 화면으로 보낸다. (agent)
- 종료 기한은 90초, 재시작 상한은 ready 뒤 60초 안에 5번이다. 이유: 단계 기한의 합(65초)보다 길어야 정상 종료를 자르지 않는다. 사람에게 알림은 띄우지 않는다(agent runtime 포기 뒤 60초 한 번 재시도도 같다. 맞는 알림 종류가 없고 새로 만들면 protocol이 바뀐다). (agent)
- 저장소 오류는 원인을 오류 글에 싣고 새 화면은 만들지 않는다. blob 부속 기록은 본문이 없다고 확인된 것만 지운다. 지우는 곳은 멈출 때 도는 maintenance뿐이다(주기 GC는 관찰만 한다). (agent)
- 명시 stop 뒤 shell은 core를 저절로 다시 띄우지 않는다. (agent)
- browser 탭 열기에 한해 core가 shell을 띄운다. 앱을 Quit한 뒤에도 띄운다. 이유: 로그인한 browser page를 쓰려면 앱 창이 있어야 하고 job은 사람 없이 browser를 쓴다. 승인한 job은 Quit 뒤에도 도는 것이 이미 제품 규칙이다. 그 core를 띄운 쪽이 켰을 때만, 한 번에 하나, 실패 뒤 5분 쉰다는 제한으로 test나 개발 환경이 앱을 띄우지 않게 한다. 버린 길: 사람에게 따로 묻기(등록 승인이 이미 그 일을 포함한다), 앱 없이 core에서 browser 엔진 돌리기(Chromium profile은 한 process만 열고 사람의 로그인과 갈린다). (사람, 2026-11-10: 방향, agent: 조건과 제한)
- 폰의 깨우기(`coding_sessions/wake`)는 없앴다. 처음에는 coding session이 앱이 있어야 열려 폰이 core에게 앱을 띄우게 했다. 터미널과 coding agent가 core의 것이 되며 앱 없이 열리므로 깨울 까닭이 없어졌다. (agent)
- display가 없는 Linux에서는 앱 대신 같은 binary를 창 없는 page host(`--page-host`)로 띄운다. 이유: 화면 없는 기계(server, VM)의 job도 browser를 쓰고, 같은 binary·driver·profile이면 core 쪽에 browser 엔진을 따로 두지 않는다. 어느 쪽인지는 core가 앱을 띄울 env의 `DISPLAY`·`WAYLAND_DISPLAY`로 고른다. 화면 있는 기계에서 SSH로 띄운 core는 page host를 띄울 수 있고, 사람이 앱을 켜면 page host가 그 시작을 다시 띄우고 물러난다. page host의 수명은 core에 묶는다(연결이 60초 닫히면 끝난다). (사람: "core에서 headless로 브라우저를 열 수 있게하는 길 하나만", agent: 고르는 조건과 수명. 계획 `core-browser`)
- shell main과 core는 한 방향 long-poll(`host/take`)이 아니라 양방향 연결 `/host-link`로 잇는다. 이유: 그때는 shell이 GUI 상태와 터미널 화면을 core로 계속 올려야 했고 그 snapshot이 route body 한도에 들지 않았다(터미널과 coding agent가 core로 오며 올리던 상태는 없어지고 창이 있어야 하는 요청만 남았다). 폰도 같은 frame 모양으로 둘째 host가 될 수 있다. 버린 안: desktop은 `host/take`를 두고 폰과 coding만 새 길(같은 일에 전송이 둘 남는다). 옛 route는 이 변경에서 지웠고 호환 길이 없다. event 연결 한도(사람 token의 Gateway와 CLI watch가 같이 쓰는 몫)에는 넣지 않았다: 연결이 하나뿐이라 새 연결이 옛 연결을 닫는다. (agent)
- `Stop lophn`에서 control stop이 답하지 않으면 shell은 그래도 끝나되 먼저 native message box로 core가 남아 있을 수 있다고 알린다. 이유: 끝난 뒤에는 알릴 화면이 없어 사람이 앱과 job이 계속 돈다는 것을 모른다. 버린 안: 끝내지 않고 재시도(답이 없는 core를 두고 shell만 붙들게 된다). (agent)
- core를 shell과 떼어 "끄고 바로 켜면 lophn이 안 뜬다"는 경쟁(shell이 먼저 끝나고 옛 core가 lock을 쥔 채 조금 더 살아 새 core가 `start_failed`로 멈춤)이 사라졌다. 새 shell은 identify에 답하는 core에 붙거나, 끝나는 중이면 기다린다. (해결된 이슈)

- 폰과 core가 다른 network에 있으면 lophn이 띄운 relay로 만난다. relay는 상태 없는 전달자이고 core가 밖으로 건다(Paseo의 꼴). core는 relay에 key를 증명한다. 이유: 다른 network에서 붙지 못하면 remote의 의미가 없고, 폰에서 혼자 도는 sync 앱도 같은 연결 위에 선다. 증명이 없으면 인터넷의 누구든 그 core의 자리를 잡아 폰을 끊는다. 버린 안: direct만(LAN과 Tailscale), core마다 tunnel 서비스. (사람, 2026-11-15)
- 폰은 API listener가 아니라 따로 연 listener로 붙고 TLS 대신 Noise로 암호화한다. 이유: loopback 검사를 그대로 두면 지금 화면과 CLI의 경계가 바뀌지 않는다. self-signed TLS는 폰에서 계속 걸리고, 연결 안 암호화는 뒤에 relay를 더해도 protocol이 같다. `remote.enabled`가 켜져 있으면 idle-exit하지 않는다. 폰은 꺼진 core를 띄우지 못하기 때문이다. 조건을 "등록된 기기가 있음"으로 두지 않는다(한 번 pairing하면 idle-exit가 사실상 없어진다). (agent, 사람이 추천을 받음 2026-11-14)

## 열린 것

- Windows hook 명령이 cmd에서 돌지 않는다. 따옴표 없는 `C:/…` 경로는 cmd가 명령으로 읽지 못하고, 설치본의 맨 `lophn`은 lophn 터미널 밖의 PATH와 Git Bash에서 못 찾는다. 다시 깔기·지우기·dry_run이 `C:/…` 경로 hook을 우리 것으로 알아보지 못한다. 추천은 hook 명령을 cmd와 Git Bash 양쪽에서 도는 꼴로 쓰는 것이다. (이슈 "Windows에서 깔린 hook 명령이 cmd에서 돌지 않고 GUI↔TUI toggle이 없다")
- Windows에서 foreground 판정과 TUI 끄기가 없다. 후보는 ConPTY에 Ctrl+C를 쓰거나 process tree를 끄는 것, foreground는 PTY shell pid 아래 process tree 근사다. 그 전까지는 toggle이 없음이 드러나야 한다(지키는 것 4). (같은 이슈)

- 업데이트 뒤 첫 로그인 실행이 옛 등록(Linux·Windows의 `--tray`, macOS의 login item)이면 새 판이 일반 실행으로 창을 한 번 연다. 그 실행이 옛 등록을 표시로 옮긴다. (이슈 "업데이트 뒤 첫 로그인 실행은 창을 한 번 연다")
- 늘 켜 둠의 OS 쪽(systemd unit, LaunchAgent, Windows `Run` 값, keep-awake child, child tree 끄기, NSIS 제거 macro)은 어느 실제 기계에서도 돌려 보지 않았다. 글 만들기와 OS 답 읽기는 fake exec로만 확인했다. 사람이 설치본에서 change-log `always-on`의 checklist로 본다.
- Windows의 로그인 시작은 core 입구가 아니라 Electron `--core`를 거쳐 `LOPHN_SERVICE=1`과 기동 실패 exit 0 규칙이 걸리지 않는다. (이슈 `windows-login-start-not-service`)
- relay의 IP마다 한도는 배포하지 않았고 실제 Fly에서 보지 않았다. Fly 밖에서 돌리면 client가 IP header를 꾸밀 수 있고, NAT 뒤에서 한 IP를 같이 쓰는 폰이 많으면 32개 한도에 걸린다. 받는 쪽 밀림 한도(1 MiB)가 느린 폰 연결에서 16 MiB 답을 닫을 수 있다.
- shell이 stop 뒤 새 core에 다시 붙는 것과 옛 등록을 옮기지 못했을 때 표시를 되돌리는 것은 Electron에서 돌려 보지 않았다.
- 이 workflow는 어느 OS에서도 CI로 돌려 보지 않았다. Windows는 실제 PC(Windows 11 x64, 개발자 모드 꺼짐)에서 같은 네 단계를 손으로 돌려 통과했다. macOS는 코드와 platform 인자를 넘긴 unit test로만 확인했다. Windows PowerShell 7·5.1에서 hook named pipe, 시작 층, `claude gui`, 알림, `$BROWSER` 중계와 fallback, bridge 실패 격리는 `npm run dev`로 실기 확인했다(저장소 root의 Windows checklist). Dock 다시 열기, login PATH, NSIS 설치 뒤 `lophn.cmd`, 터미널을 닫을 때 Windows에서 shell 아래 process가 남지 않는지는 미확인이다.
- 서명하지 않은 `lophn-desktop.exe`는 Smart App Control이 켜진 Windows 11에서 실행이 막힌다. (이슈 "Smart App Control이 켜진 Windows 11에서 서명 안 한 `lophn-desktop.exe`가 실행되지 않는다")
- core가 앱을 띄우는 길(`--agent-window`)은 Linux에서만 돌려 봤다. macOS와 Windows는 돌려 보지 않았고, Wayland에서는 focus 없이 연 창이 focus를 가져갈 수 있다. 화면이 없는 Linux의 page host(`--page-host`)는 display를 뺀 개발 기계에서만 돌렸다. 실제 화면 없는 VM과 최소 server image, 설치본이 `--no-sandbox` 없이 뜨는지는 보지 못했다(`browser-tab.md` "열린 것").
- 앱 Quit 뒤 켜진 job이 돌고 10분 뒤 core가 끝나는 것, 다시 켜면 돌던 core에 붙는 것, macOS와 Windows(named pipe)에서 core를 찾는 것은 사람 확인이 남았다.
- 앱 Quit 뒤 터미널이 돌고 다시 켠 앱의 탭이 그 터미널에 붙는 것은 개발 앱에서만 보았다. 설치본에서 사람이 확인한다. macOS 설치본에서 node-pty의 `spawn-helper`에 실행 bit가 남는지 확인하지 않았다(없으면 core가 터미널을 띄우지 못한다).
- 연결마다 user credential을 새로 발급하고 끝내는 길이 없다(폐기는 core epoch이 바뀔 때뿐). 의도인지 확인이 필요하다. 같은 사용자의 아무 process나 control socket으로 진단 한 줄을 보낼 수 있는 것도 마찬가지다(쓰기 자리는 core가 고정한다).
- 알려진 한계: macOS는 node로 도는 CLI를 hook이 올 때까지 foreground로 알아보지 못한다.
