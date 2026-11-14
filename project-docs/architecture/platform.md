# platform

lophn이 Linux x64, macOS arm64, Windows x64에서 무엇을 다르게 하는가, 그리고 core가 shell과 따로 어떻게 살고 죽는가. OS마다 다른 규칙이 어디에 모이는지, 어느 기능이 어느 OS에서 꺼져 있는지, 다른 OS를 어떻게 확인하는지, core의 수명(띄우기, 붙기, 끄기, idle-exit, autostart)을 정한다.

## 문제

- 처음에는 Linux에서만 짜고 돌렸다. 그대로 두면 다른 OS의 사람은 core가 child를 하나도 못 띄우거나(process group 강제 종료를 Linux에서만 보장했다), data root 검사(uid·0700)에 기동을 거절당하거나, 봉인 판정(폴더의 쓰기 bit)이 틀어지거나, 앱 IPC(unix socket)가 열리지 않았다.
- OS를 가르는 코드가 여러 곳에 흩어지면 한 OS를 고칠 때 다른 OS가 조용히 깨진다. 그리고 기능이 반쯤 도는 채로 남으면 사람이 무엇이 안 되는지 알 수 없다.
- core가 shell(Electron)의 child이던 때는 앱을 끄면 켜진 job도 멈췄고, 화면 없는 머신에서 CLI만으로 core를 켤 길이 없었다. 새 판으로 바꿀 때 앱과 core의 수명이 엉키면 "끄고 바로 켜면 lophn이 안 뜬다"는 경쟁이 생긴다.

## 목표와 비목표

- 목표: OS마다 다른 규칙을 순수 규칙 한 곳에 모으고, 그 밖 module은 OS 전역을 읽지 않는다. 세 OS에서 core를 띄우고 child tree를 끄고 data root를 열 수 있다. Windows에서 꺼진 기능은 꺼진 것이 드러난다. core는 shell과 수명이 따로이고 shell·CLI 어느 쪽에서나 띄우고 붙고 끌 수 있다.
- 비목표: 서명한 설치 묶음, 자동 업데이트 channel. 앱 실행 sandbox의 OS별 대체(sandbox는 `architecture/layers.md`와 앱 문서가 맡는다). OS service(systemd, launchd agent, Windows service·scheduled task) 등록. Windows keychain·DPAPI 같은 OS 비밀 저장소. core가 crash했을 때 core 쪽에서 다시 띄우는 감독. 다른 컴퓨터나 다른 OS 사용자가 core에 붙는 길. 한 사람이 pairing한 자기 폰이 붙는 길은 있다(아래 "폰이 붙는 listener").

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
 core: instance lock ─▶ control listen(starting) ─▶ migration·API·wiring·afterReady ─▶ ready ─▶ … ─▶ stop | idle-exit | signal ─▶ 같은 shutdown barrier
```

- **core는 shell의 child가 아니다.** shell과 CLI는 같은 `ensureCore`로 붙거나 띄우는 client다. IO(dial, detached spawn, Clock, timer)는 인자로 받는다. 띄운 core는 POSIX 새 session, win32 detached+`windowsHide`이고 launcher는 stdout 첫 JSON 줄(`ready` 또는 `start_failed {reason}`)만 읽고 놓는다. 그 줄에 token은 없다.
- **control socket.** data root마다 공통 socket 자리 아래 이름 `core`로 연다. POSIX는 0700 폴더의 unix socket, win32는 data root 이름 공간의 named pipe다. 한 연결에 JSON 한 줄 요청 하나와 Result 답 하나다(계약 `core-control-protocol`). verb는 `identify`(제품 판, protocol 판, `core_epoch`, `api_url`, `starting|ready|stopping`, credential 없음), `connect {client: cli|shell}`(user token을 주고, shell이면 shell capability도), `stop`, `diagnostic`, 사람 결정 handle 등록과 창 닫기(shell capability만, `architecture/approval.md`)다. 경계는 socket 자리의 권한이고 OS peer 신원은 보지 않는다. 데이터(API)는 그대로 loopback HTTP·WebSocket이다. core의 user token은 file로 쓰지 않고 `connect`로만 준다. 같은 core에 shell과 CLI가 각자 connect하므로 core마다 user credential이 하나라는 제한은 없다.
- **동시 시작은 data root의 `run/instance.lock`이 가른다.** lock을 잡은 core만 socket 잔여물을 치우고 listen한다. 진 core는 살아 있는 core의 socket과 runtime file을 건드리지 않고 끝나며, ensure는 identify를 다시 물어 이긴 core에 붙는다. liveness는 "identify가 답한다"이고 pid file이나 HTTP health probe를 쓰지 않는다. 끝나는 중(`stopping`)인 core를 만나면 ready나 사라짐을 기다린다.
- **판 대조.** identify의 제품 판이나 protocol 판이 ensure 쪽과 다르면 ensure가 `stop`을 보내 끝나기를 기다린 뒤 새로 띄운다(한 번). 돌던 run·job 차례는 종료와 같이 `interrupted`가 된다.
- **끝나는 길은 셋이고 barrier는 하나다.** control `stop`(`lophn core stop`, tray의 `Stop lophn`, 판 교체), idle-exit, SIGINT·SIGTERM. 앱의 Quit(Cmd+Q, `--quit`, will-quit, tray의 `Quit lophn`)는 shell 자원과 연결만 정리하고 core는 남긴다. 명시 stop 뒤에는 shell이 core를 저절로 다시 띄우지 않는다(`closed(shutdown)`이나 identify `stopping`을 본 shell은 이미 도는 같은 판 core에만 다시 붙는다). 반대 방향은 하나 있다: 앱을 Quit한 뒤에도 core가 browser가 필요하면 shell을 띄운다(아래 "core가 shell을 띄운다"). core가 crash하면 core 쪽에서 다시 띄우는 감독은 없고 다음 ensure(shell 재연결, CLI 호출, autostart)가 띄운다. shell의 재연결에는 상한이 있다(아래 "core가 죽었을 때"). core가 SIGKILL돼도 child는 stdin EOF로 스스로 끝난다. `lophn core stop`은 core를 띄우지 않는다.
- **idle-exit.** ready 뒤부터 30초마다 일과 client를 다시 본다. 일은 module마다의 machine 전용 read로 센다: 켜진 job(승인 대기 중인 켜진 job도 일), 열린 job run, running run, 모든 project의 running workflow instance. 도는 lophn agent turn도 일이다(대기 중인 입력과 harness queue는 세지 않는다). 설정 `remote.enabled`가 켜져 있으면 늘 일이 있는 것으로 본다(폰은 꺼진 core를 띄우지 못한다. 끄는 것은 `Stop lophn`이다). client는 진행 중 HTTP 요청과 Gateway 구독이다. 앱 process와 control 요청은 세지 않는다. 일도 client도 없는 상태가 10분 이어져야 끝난다. 읽기가 실패하면 일이 있는 것으로 보고, 읽는 동안 새 요청이 들어왔으면 그 판정을 버린다.
- **autostart는 core만 띄운다.** packaged일 때만 로그인 항목이 `--core`(macOS는 `wasOpenedAtLogin`)로 lophn을 연다. 그 Electron은 창·tray·terminal-host·extension을 조립하지 않고 ensure만 한 뒤 끝난다. 업데이트 전의 `--tray` 등록은 다음 일반 실행에서 한 번 `--core`로 다시 쓴다. shell single-instance lock은 창 하나를 지키는 것이라 core의 instance lock과 따로이고, core-only 실행은 그 lock을 잡지 않는다.
- **core가 shell을 띄운다(browser가 필요할 때만).** agent가 `lophn tab open --url`로 browser 탭을 열려는데 shell이 붙어 있지 않으면 core가 앱을 띄운다. 앱 창이 있어야 page가 있고(`<webview>`는 보이는 창에서만 그린다) job과 workflow는 사람이 앱을 Quit한 뒤에도 돌기 때문이다. 이 방향(core → shell)은 새로 생겼고 사람이 Quit한 뒤에도 적용된다. Quit은 화면을 끈다는 뜻이고 등록을 승인한 job은 계속 돈다(모두 멈추는 길은 `Stop lophn`이고, 그때는 띄울 core가 없다).
  - **조건.** browser 탭 열기에만 띄운다. extension tool 호출, preview·artifact 탭 열기, 이미 연 탭의 browser 호출은 shell이 없어도 띄우지 않는다(앞의 둘은 기다리고, 마지막은 실패한다). 그리고 그 core를 띄운 쪽이 켰을 때만이다. 사람이 쓰는 core를 띄우는 두 곳(shell의 core 감독, CLI의 detached 시작)이 환경 `LOPHN_LAUNCH_SHELL=1`을 준다. test, boot, E2E가 띄운 core는 이 값이 없어 앱을 띄우지 않고 shell 없음으로 실패한다. 띄울 길을 모를 때(build하지 않은 개발 저장소)도 같다.
  - **명령.** core는 자기 platform 배치에서 명령을 정한다. 설치본은 core를 띄운 Electron 실행 file 하나이고, 개발은 build한 shell entry를 같이 넘긴다. 어느 쪽이든 `--home <data root>`와 launch intent `--agent-window`를 붙이고, core가 Node로 도는 표시(`ELECTRON_RUN_AS_NODE`)는 뺀다. detached로 띄우고 놓아 core가 끝나도 앱은 남는다.
  - **한 번에 하나, 실패하면 쉰다.** 같은 시도를 동시에 온 열기가 함께 기다린다(앱을 여럿 띄우지 않는다). 시작을 30초 안에 확인하지 못하거나 spawn이 실패하면 시도가 끝나고 5분 동안은 다시 띄우지 않고 열기를 바로 실패시킨다. shell이 붙으면 풀린다.
  - **launch intent `--agent-window`.** 앱은 평소처럼 서고 첫 창을 focus 없이 연다. 이미 떠 있는 앱이 받으면 일반 창이 하나도 없을 때만 같은 창을 연다. core만 띄우는 `--core`와 달리 창을 만든다.

### 폰이 붙는 listener

- 설정 `remote.enabled`(기본 꺼짐, 사람만 바꾼다)가 켜져 있는 동안만 core가 따로 WebSocket listener를 연다. port는 설정 `remote.port`(기본 7432), 모든 interface, path `/remote`, binary message만 받는다. 설정이 바뀌면 열고 닫는다. 꺼져 있으면 loopback 밖 listener가 없다. API listener(loopback, `Host`·`Origin` 검사)는 그대로다.
- TLS 대신 연결 안에서 암호화한다(`Noise_IK_25519_ChaChaPoly_SHA256`, prologue `lophn-remote/1`). core의 key 쌍은 `<data root>/remote/host-key.json`(0600)에 listener를 처음 열 때 만든다. 폰은 QR로 core의 공개 key를 받아 그 key만 믿고, core는 handshake에서 폰의 공개 key를 받는다. 이 key가 기기 신원이고 bearer token은 없다. handshake와 hello가 10초 안에 끝나지 않은 연결은 닫는다.
- 받은 key가 ledger의 기기 표에 있으면 그 기기로 붙고, 없으면 `pair` frame만 받는다. pairing code는 `pairing/start`가 만들고 메모리에만 둔다(128-bit, 300초, 한 번, 새 code가 옛 code를 무효로 한다). 틀린 code는 연결마다 5번이다. 자격과 route 목록은 `architecture/approval.md`, frame은 계약 `remote-protocol`이다.

### core가 죽었을 때

- **ledger writer Worker가 ready 뒤에 죽으면 core가 로그(`writer_dead`)를 남기고 graceful shutdown 없이 exit 1한다.** Worker가 error 없이 끝나거나, error 이벤트가 나거나, 연결이 fault돼도 같다. shell이 core를 다시 띄운다(graceful shutdown은 shell이 다시 띄우지 않으므로 쓰지 않는다). ready 전에 죽으면 기동 실패(`start_failed`)로 돌려줘 시작 실패 화면이 바로 뜬다. writer만 다시 띄우지 않는 이유는 writer 안의 기억(준비한 blob, confirmation handle)을 잃기 때문이다.
- **shell의 core 재시작 상한.** ready 뒤 60초를 살지 못하고 끝난 core를 crash로 세고, 5번째에서 멈춰 시작 실패 화면에 둔다. 그 전의 재시작은 1·2·4·8초 쉰다. 60초 넘게 산 core가 끝나면 센 수를 0으로 돌린다. Retry는 센 수를 비우지 않는다.
- **종료의 전체 기한은 90초다.** 단계별 기한의 합(65초)보다 길어 정상 종료를 자르지 않는다. 넘으면 `shutdown_deadline`을 남기고 exit 1한다(자식은 stdin EOF로 끝나고 lock은 OS가 푼다). HTTP server는 받은 요청을 10초까지 기다리고 그 뒤 남은 connection을 끊는다.
- **실행 중 표지.** core가 사는 동안 `run/running.marker`(pid, started_at)가 있고 정상 종료가 지운다. 다음 기동이 남은 것을 보면 `previous_unclean_exit`를 로그로 남긴다. liveness에는 쓰지 않는다.
- **agent runtime.** runtime process가 끝나면 그 안의 `shell.run` 자식 group을 죽인다(SIGKILL·OOM은 못 덮는다). 감독이 재시작 한도를 넘어 포기하면 core가 로그를 남기고 60초 뒤 한 번 다시 띄운다(core process당 한 번). 사람에게 알림은 띄우지 않는다.
- **두 번째 shell process.** single-instance lock을 shell context를 만들거나 core를 건드리기 전에 잡는다. 못 잡으면 곧 끝나므로 core를 띄우거나 갈아 띄우지 않는다. Quit과 `Stop lophn`은 돌던 ensure를 끊는다(spawn 전, 판 교체 stop 전에 확인한다). `Stop lophn`은 돌던 ensure가 끝나기를 기다린 뒤 core를 멈춘다.
- **저장소 오류는 원인을 글에 싣는다**(disk full, locked, corrupt, io). corrupt면 writer 연결을 fault로 만들어 위 규칙대로 core가 끝나고, 다음 기동은 시작 실패 화면으로 간다.
- **blob 정지 maintenance.** 목적 기록과 미참조 표지는 본문을 지웠거나 본문이 없다고 확인된(ENOENT) 것만 지운다. 정지마다 고아 기록을 최대 2,000개까지 쓸어 낸다(남은 것은 다음 정지로 미룬다).
- **git이 없으면** 앱 source·release 경로가 "git was not found" 오류로 끝난다(commit이 없다는 말로 바꾸지 않는다). **extension tool 호출은 5분 기한이 있다.** 넘으면 거두고 `unavailable`로 끝난다.

### file

- **data root.** 기본은 home 아래 `.lophn`(Windows `%USERPROFILE%\.lophn`)이다. POSIX는 소유 uid와 mode(group·other 권한 없음)를 보고 아니면 기동을 거절한다. Windows는 mode·uid가 없어 보지 않고 user profile ACL을 믿는다. `secrets.json`도 같은 file이고 Windows는 0600 검사를 하지 않는다.
- **봉인.** 앱 bundle 사본(`apps/<app>/bundles/<hash>/`)은 file 0444·폴더 0555로 좁힌 뒤 옆에 빈 표지 `<사본>.sealed`를 쓴다. 봉인 판정은 표지가 있는가 하나다(Windows 폴더에는 쓰기 bit가 없다). 표지 없는 사본은 끊긴 준비가 남긴 것이라 쓰기 권한을 돌려준 뒤 지우고 다시 쓰고, 못 지우면 준비가 실패한다. 옛 data root는 data step `apps.sealed-marker`가 쓰기 bit 없는 사본에 표지를 써서 옮긴다.
- **bundle file 나눠 쓰기.** 봉인은 좁히기 전에 사본의 file을 내용 sha256으로 `<data>/bundle-files/<sha256>`과 hardlink로 잇는다. release마다 `node_modules`를 통째로 담아도 같은 byte는 디스크에 한 번만 있고, 앱 사이에도 나눠 쓴다. 0444 file이라 한 사본이 다른 사본을 바꾸지 못한다. 나눠 쓰지 못한 file(다른 fs, link 수 한도)은 사본 그대로 둔다. 표지 없는 사본을 지울 때 hardlink인 file의 mode는 건드리지 않는다(mode가 inode에 붙어 다른 사본까지 풀린다). Windows는 읽기 전용 속성이 link끼리 같이 붙어, 읽기 전용 file을 지울 때 Node가 속성을 풀면 다른 사본의 것도 풀린다. 그래서 store 쓸기가 아무도 안 쓰는 file을 지우면서 남은 file이 풀려 있으면 다시 0444로 잠그고, 사본이 지워질 수 있는 일(봉인, 앱 지우기, data step) 뒤마다 돈다. 지우기부터 다음 쓸기까지 그 file은 쓸 수 있는 채다. NTFS의 link 수 한도(1023)에 닿은 file은 사본 그대로 둔다. 옛 data root는 data step `apps.bundle-file-sharing`(POSIX)·`apps.bundle-file-sharing-win32`(Windows)가 봉인된 사본의 폴더를 잠시 열어 옮긴다.
- **연결.** bundle과 flow host의 directory 연결은 Windows에서 junction(권한이 필요 없다), 그 밖은 symlink다. file 연결은 모든 OS에서 symlink다.
- **권한 path 비교.** `relative`로 보고, Windows와 macOS는 대소문자를 가리지 않는다(file system 기본이 그렇다).

### shell과 터미널

- **macOS PATH.** Finder·Dock으로 켠 앱은 PATH가 짧아서 shell main이 시작할 때 login shell(`$SHELL -ilc`)의 PATH를 한 번(5초 한도) 읽어 둔다. core·terminal-host·extension이 그 env를 물려받는다. harness 찾기 fallback에 `/opt/homebrew/bin`, `/usr/local/bin`이 있다.
- **macOS Dock.** 창이 없을 때 Dock을 누르면(`activate`) 창을 다시 연다.
- **harness 찾기.** Windows는 이름마다 `PATHEXT` 확장자로 찾고 실행 bit 대신 확장자로 판정한다. `.cmd`·`.bat`은 Node가 shell 없이 못 띄우므로 shell로 띄운다.
- **터미널 끄기.** POSIX는 `SIGHUP` 뒤 process group, Windows는 pty를 죽인 뒤 `taskkill /T`다.
- **hook·browser bridge도 공통 socket 자리를 쓴다.** POSIX file은 공통 폴더의 `shell-<pid>/`(0700), endpoint는 `b`(browser)·`h`(hook) 이름의 IPC endpoint(0600)다. Windows file은 `<data root>/run/shell-<pid>/`, endpoint는 data root 이름 공간의 `shell-<pid>-b`·`shell-<pid>-h` named pipe다. 두 endpoint가 OS별 길이 한도를 넘으면 file 정리 전에 기능을 끄고 로그 한 줄만 남긴다(pointer file이나 TCP로 우회하지 않는다). file 폴더 준비는 hook·browser 각자의 listen과 분리돼, shim 쓰기나 bridge listen이 실패해도 hook은 준비된다. 공통 폴더는 core·앱 socket과 `shell-<pid>/`가 같이 쓰므로 app supervisor는 정지할 때 아무것도 지우지 않는다(낡은 앱 socket은 그 자리에 새 자식을 띄우기 전에 지운다). 판이 바뀌어 shell이 옛 core를 멈추면 옛 supervisor가 새 shell보다 늦게 끝나기 때문이다. 터미널 host는 bash·zsh init file이 없으면 시작 층 없이 원래 login shell로 띄운다. win32 전체를 끄는 gate는 없다.
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

macOS·Windows는 CLI를 시스템 PATH에 깔지 않는다. shell이 앱 안 launcher의 절대 경로(설치본이 먼저이고 개발은 `LOPHN_CLI`)를 쓰고, lophn 터미널과 harness agent의 env에 그 폴더를 PATH 앞에 둔다. Windows의 `platform/node_modules/@lophn/*`는 npm이 만드는 절대 경로 junction 대신 copy다. node-pty는 Linux만 rebuild한다.

### 다른 OS 확인

GitHub Actions workflow 하나가 ubuntu·macos·windows에서 `npm ci` → `check:full` → core를 새 data root로 두 번 띄우기(두 번째는 재시작) → `--dir` 묶음을 돈다. 손으로 실행하거나 `ci/**` branch push에서만 돈다(private repo에서 macOS minute은 10배). push와 실행은 사람에게 묻는다.

- **symlink 권한.** Windows는 개발자 모드나 관리자 권한이 없으면 symlink를 만들지 못한다(junction은 된다). test의 폴더 연결은 `"junction"` type으로 만들고(POSIX는 type을 무시한다), file symlink가 꼭 필요한 test는 이유를 달고 건너뛴다. electron-builder가 받는 `winCodeSign` 묶음에 macOS symlink가 있어 그런 PC에서는 `package`가 풀기에서 실패한다. cache에 `darwin`만 빼고 미리 풀면 지나간다. GitHub runner는 관리자라 상관없다.
- **npm script.** `e2e`·`e2e:deps`는 Electron의 Node로 띄우는 wrapper를 거친다. env 앞붙임 꼴(`ELECTRON_RUN_AS_NODE=1 …`)은 npm이 Windows에서 쓰는 cmd.exe에서 돌지 않는다.
- **e2e 지원 코드.** Windows에는 `/proc`이 없어 띄운 core의 pid에서 `ParentProcessId`를 따라가 같은 home의 process를 찾는다. e2e core의 `USERPROFILE`은 `HOME`과 같은 빈 폴더다.
- **개발 실행의 `lophn`.** Windows의 개발 실행은 sh launcher와 `lophn.cmd`를 같이 쓰고 shell main에 `.cmd` 경로를 준다. harness 감지 child는 `.cmd`·`.bat`을 shell로 띄운다.

## 지키는 것

1. POSIX data root 검사는 Windows를 위해 느슨해지지 않는다. platform이 win32일 때만 건너뛴다.
2. 봉인된 사본은 표지가 있는 한 다시 쓰지 않는다. 표지 없는 사본은 지우지 못하면 준비가 실패한다(조용히 넘어가지 않는다). 나눠 쓰는 file을 사본 하나 때문에 쓸 수 있게 바꾸지 않는다.
3. base와 protocol은 OS를 runtime 전역으로 읽지 않는다. OS로 가르는 함수는 platform을 인자로 받는다.
4. Windows에서 꺼진 기능은 조용히 다른 길로 가거나 꺼진 것을 보인다. 반쯤 도는 채로 두지 않는다.
5. supervisor는 child group이 없어졌음을 확인한 뒤에 자원을 푼다. 세 OS가 같다.
6. 한 data root에 core는 하나다. 동시 시작은 instance lock이 가르고, 진 core는 이긴 core의 socket과 runtime file을 건드리지 않는다.
7. core의 liveness는 identify가 답하는가 하나다. 판이 다르면 stop → 사라짐 확인 → 새로 띄우기를 한 번만 한다.
8. 앱을 끄는 것(Quit)은 core를 끄지 않는다. core는 stop, idle-exit, 신호로만 끝난다. 명시 stop 뒤 shell이 core를 저절로 다시 띄우지 않는다. core가 shell을 띄우는 것은 browser 탭 열기가 shell 없이 왔고 그 core를 띄운 쪽이 켰을 때뿐이다.
9. idle-exit는 일도 client도 없는 10분이 이어져야 하고, 읽기 실패는 일로 친다. 켜진 job이 있는 core, 도는 lophn agent turn이 있는 core, `remote.enabled`가 켜진 core는 끝나지 않는다.
10. core 기동 launcher는 stdout 첫 줄만 읽고 놓으며 그 줄에 credential이 없다. user token은 file에도 stdout에도 쓰지 않는다.
11. hook 준비는 browser shim·bridge listen의 성공과 분리한다. endpoint가 길이 한도를 넘으면 그 기능만 끄고 우회 길을 만들지 않는다.
12. app supervisor는 정지할 때 공통 socket 폴더에서 아무것도 지우지 않는다.
13. 사용자의 PowerShell profile·alias·function·execution policy를 고치거나 우회하지 않는다.
14. OS service는 등록하지 않는다. 로그인 때 켜는 것은 core만 띄우는 autostart다.
15. ready 뒤 ledger writer가 죽은 core는 살아 있지 않는다(exit 1). 조용히 끝난 Worker 때문에 모든 command가 `unavailable`로만 끝나는 core를 남기지 않는다.
16. 종료는 90초 안에 끝난다. 멈춘 단계 하나가 instance lock을 쥔 채 끝없이 기다리지 않는다.
17. shell의 core 재시작은 상한(60초 안에 5번)이 있고, 넘으면 시작 실패 화면에 멈춘다. Retry가 상한을 풀지 않는다.
18. 곧 끝날 두 번째 shell process는 core를 건드리지 않는다. Quit·`Stop lophn` 뒤에는 돌던 ensure가 core를 새로 띄우지 않는다.
19. blob의 목적 기록과 미참조 표지는 본문이 없다고 확인된 것만 지운다.

## 경계와 계약

- **core-control-protocol** (control socket). `identify`, `connect {client: cli|shell}`, `stop`, `diagnostic`, 사람 결정 handle 등록·창 닫기(shell capability만). 한 연결에 JSON 한 줄 요청과 Result 답 하나. 공통 오류 코드 일곱만 쓴다. 클라이언트 쪽은 `ensureCore` 하나(shell과 CLI 공유)다.
- **core 기동 알림.** 띄운 core의 stdout 첫 줄: `ready` 또는 `start_failed {reason}`.
- **runtime file.** `run/instance.lock`(동시 시작을 가른다), 공통 socket 자리의 `core` endpoint, `shell-<pid>/`와 `shell-<pid>-b`·`shell-<pid>-h`. 이전에 있던 `run/user-token`·`run/location.json`은 없고 lock을 잡은 core가 남은 것을 지운다.
- **CLI.** 사람 명령은 core를 띄워서라도 붙는다. 주소는 `LOPHN_DAEMON_URL` 또는 identify다. agent 자격(`LOPHN_AGENT_CREDENTIAL`)이 있으면 그것만 쓰고 user 자격으로 바꾸지 않는다. `lophn core stop`은 core를 띄우지 않는다.
- **launch intent.** `--core`(core만 띄우고 Electron은 끝난다), macOS는 `wasOpenedAtLogin`. `--quit`은 Quit와 같다. `--agent-window`는 core가 browser를 쓰려고 앱을 띄울 때 쓴다(focus 없는 창 하나).
- **환경 이름.** `LOPHN_GIT_BASH`(Windows Git Bash 경로), `LOPHN_CLI`(개발 실행의 CLI launcher), `LOPHN_DAEMON_URL`, `LOPHN_LAUNCH_SHELL`(`1`이면 그 core가 browser가 필요할 때 앱을 띄울 수 있다. shell과 CLI의 core 시작이 준다).
- **install 계약.** 설치 root 아래 `platform/`, `extensions/`, `desktop/`, `skills/`, 그리고 `bin/`의 CLI launcher.
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
- 앱의 Quit는 shell만 끄고 core는 idle-exit로 끝난다. 모두 끄는 `Stop lophn`을 따로 둔다. (사람이 추천을 받음, 2026-11-08)
- CLI도 ensure로 core를 띄운다. 끄는 것은 idle-exit와 `lophn core stop`이다. (사람이 추천을 받음, 2026-11-08)
- idle-exit는 일도 client도 없이 10분이다. 앱 process와 control 요청은 세지 않는다(앱은 쓰일 때 core가 띄우고, client도 job도 없으면 쓰는 쪽이 없다). 승인 대기 중인 켜진 job도 일로 치고, 30초마다 다시 보며 읽기 실패는 일로 친다. (agent)
- OS service로 등록하지 않는다. 이유: 로그인 autostart가 core만 띄우는 것으로 충분하다. (agent)
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
- `Stop lophn`에서 control stop이 답하지 않으면 shell은 그래도 끝나되 먼저 native message box로 core가 남아 있을 수 있다고 알린다. 이유: 끝난 뒤에는 알릴 화면이 없어 사람이 앱과 job이 계속 돈다는 것을 모른다. 버린 안: 끝내지 않고 재시도(답이 없는 core를 두고 shell만 붙들게 된다). (agent)
- core를 shell과 떼어 "끄고 바로 켜면 lophn이 안 뜬다"는 경쟁(shell이 먼저 끝나고 옛 core가 lock을 쥔 채 조금 더 살아 새 core가 `start_failed`로 멈춤)이 사라졌다. 새 shell은 identify에 답하는 core에 붙거나, 끝나는 중이면 기다린다. (해결된 이슈)

- 폰은 API listener가 아니라 따로 연 listener로 붙고 TLS 대신 Noise로 암호화한다. 이유: loopback 검사를 그대로 두면 지금 화면과 CLI의 경계가 바뀌지 않는다. self-signed TLS는 폰에서 계속 걸리고, 연결 안 암호화는 뒤에 relay를 더해도 protocol이 같다. `remote.enabled`가 켜져 있으면 idle-exit하지 않는다. 폰은 꺼진 core를 띄우지 못하기 때문이다. 조건을 "등록된 기기가 있음"으로 두지 않는다(한 번 pairing하면 idle-exit가 사실상 없어진다). (agent, 사람이 추천을 받음 2026-11-14)

## 열린 것

- Windows hook 명령이 cmd에서 돌지 않는다. 따옴표 없는 `C:/…` 경로는 cmd가 명령으로 읽지 못하고, 설치본의 맨 `lophn`은 lophn 터미널 밖의 PATH와 Git Bash에서 못 찾는다. 다시 깔기·지우기·dry_run이 `C:/…` 경로 hook을 우리 것으로 알아보지 못한다. 추천은 hook 명령을 cmd와 Git Bash 양쪽에서 도는 꼴로 쓰는 것이다. (이슈 "Windows에서 깔린 hook 명령이 cmd에서 돌지 않고 GUI↔TUI toggle이 없다")
- Windows에서 foreground 판정과 TUI 끄기가 없다. 후보는 ConPTY에 Ctrl+C를 쓰거나 process tree를 끄는 것, foreground는 PTY shell pid 아래 process tree 근사다. 그 전까지는 toggle이 없음이 드러나야 한다(지키는 것 4). (같은 이슈)
- 다른 client(CLI)가 stop한 뒤 shell은 주기적으로 identify를 묻지 않아 새 core에 스스로 붙지 못한다. Reconnect를 눌러야 한다. (이슈 "shell이 다른 client의 stop 뒤에는 새 core를 스스로 알아채지 못한다")
- 업데이트 뒤 첫 로그인 실행이 옛 `--tray` 등록이면 창이 한 번 뜬다. macOS `wasOpenedAtLogin`과 core-only 실행의 userData 폴더는 실기로 확인하지 않았다. (이슈 "업데이트 뒤 첫 로그인 실행은 창을 한 번 연다")
- 이 workflow는 어느 OS에서도 CI로 돌려 보지 않았다. Windows는 실제 PC(Windows 11 x64, 개발자 모드 꺼짐)에서 같은 네 단계를 손으로 돌려 통과했다. macOS는 코드와 platform 인자를 넘긴 unit test로만 확인했다. Windows PowerShell 7·5.1에서 hook named pipe, 시작 층, `claude gui`, 알림, `$BROWSER` 중계와 fallback, bridge 실패 격리는 `npm run dev`로 실기 확인했다(저장소 root의 Windows checklist). Dock 다시 열기, login PATH, NSIS 설치 뒤 `lophn.cmd`, 터미널을 닫을 때 Windows에서 shell 아래 process가 남지 않는지는 미확인이다.
- 서명하지 않은 `lophn-desktop.exe`는 Smart App Control이 켜진 Windows 11에서 실행이 막힌다. (이슈 "Smart App Control이 켜진 Windows 11에서 서명 안 한 `lophn-desktop.exe`가 실행되지 않는다")
- core가 앱을 띄우는 길(`--agent-window`)은 Linux에서만 돌려 봤다. macOS와 Windows는 돌려 보지 않았고, Wayland에서는 focus 없이 연 창이 focus를 가져갈 수 있다. 화면이 없는 Linux는 창을 열 수 없어 browser 탭이 실패한다.
- 앱 Quit 뒤 켜진 job이 돌고 10분 뒤 core가 끝나는 것, 다시 켜면 돌던 core에 붙는 것, macOS(`wasOpenedAtLogin`)와 Windows(named pipe)에서 core를 찾는 것은 사람 확인이 남았다.
- 연결마다 user credential을 새로 발급하고 끝내는 길이 없다(폐기는 core epoch이 바뀔 때뿐). 의도인지 확인이 필요하다. 같은 사용자의 아무 process나 control socket으로 진단 한 줄을 보낼 수 있는 것도 마찬가지다(쓰기 자리는 core가 고정한다).
- 알려진 한계: macOS는 node로 도는 CLI를 hook이 올 때까지 foreground로 알아보지 못한다.
