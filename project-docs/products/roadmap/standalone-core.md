# standalone core: core가 shell 밖에서 스스로 선다

상태: 계획 `standalone-core`로 열림. 2026-11-08 사람이 방향을 냈고 planner가 정리했다. `platform-ipc.md` 뒤에 한다(control socket이 그 socket 자리 규칙을 쓴다).
배경 문서: `project-docs/architecture/job.md`, `coding-agent.md`, `platform.md`, `event.md`, `app-notice.md`. 비교 대상: `../harness-lab/hermes/hermes-desktopapp`(공식 Hermes Desktop), `../harness-lab/hermes/hermes-cli`(`hermes_cli/gateway_runtime.py`, `gateway/control_socket.py`), `../harness-lab/hermes/hermes-desktopapp-fathah`.

## 사람의 말 (원문)

2026-11-08:

> 그리고 난 뭔가 core가 상주하고 막 shell이 코어를 키는 게 탐탁치 않은데
> 플랫폼 별 대응, 그리고 shell<-->core 이런 아키텍쳐에 대해서
> ../harness-lab/hermes 가서 조사해봐

> core가 스스로 서게 하는 게 우리가 job을 생각해서라도 더 낫겠지?

## 왜

- core는 shell main(Electron)의 child이고 pipe EOF로 죽는다. 그래서 job은 Electron이 떠 있을 때만 돈다(`job.md:66`). tray로 남겨도 Electron 전체가 떠 있다. shell이 crash하거나 업데이트로 꺼지면 돌던 run과 job 차례가 `interrupted`로 끊긴다.
- 화면 없는 머신(서버)에서 CLI만으로 core를 켜고 job을 돌릴 길이 없다.
- CLI는 core를 켜지 못한다. core가 꺼져 있으면 `unavailable`(exit 5)로 끝난다.
- `npm run dev:core`처럼 parent pipe 없이 띄운 core는 `run/user-token`을 쓰지 않아 CLI가 붙지 못한다(`tools/doctor/checks.ts:169`).
- 2026-10-20 `headless-schedule.md`가 "상주 daemon이나 OS service. tray와 autostart로 충분하다"를 하지 않는 것으로 두었다. 이 roadmap이 그 결정을 뒤집는다. OS service는 여전히 하지 않는다(아래).

## 비교: Hermes

- 공식 Hermes Desktop은 gateway(core)를 child로 들지 않는다. 짧게 끝나는 `hermes gateway ensure --json`이 per-home control socket에 `identify`를 물어 있으면 붙고, 없으면 detached로 띄운다(POSIX `start_new_session`, Windows job object breakaway, macOS launchd 일회성 job). 동시에 띄우려는 쪽은 gateway 자신의 lock file이 가른다. CLI·TUI·Desktop이 같은 ensure를 쓴다. Desktop을 꺼도 gateway는 남고 `hermes gateway stop`으로만 끈다. CLI가 띄운 gateway만 `--idle-exit`(일 없이 600초)로 끝난다.
- control socket은 "Never a TCP port: filesystem/pipe ACLs are the auth boundary"(`gateway/control_socket.py`). 한 연결에 JSON 한 줄 verb(`identify`, `session-ticket`) 하나다. 데이터는 loopback HTTP·WebSocket(ephemeral port, `identify`가 알려 준다)이고 30초 1회용 ticket으로 연다.
- ensure가 `runtime_protocol`, capability, `code_sha`를 대조해 다르면 graceful restart를 한 번 한다. 업데이트 중에는 fence로 띄우지 않는다.
- 대가: Electron main이 18k줄, Windows breakaway·MSIX, 문서가 옛 owned-child 모델을 아직 적는다.
- fathah판은 상주를 없애고 pid file과 `/health`로 그때그때 붙는다. 고아 process(#967), 낡은 pid(#594, #628), 판 차이(#797, #799) bug가 ledger에 쌓였다. 따라 하지 않는다.

## 지금 코드

core 기동 (`packages/core/main/daemon/`)
- `main.ts`는 `--port=<n>`만 받고, stdin이 TTY가 아니면 parent pipe를 연다.
- `core.ts` `startCore`: data root 확인 → `acquireInstanceLock`(`packages/core/install-and-update/instance-lock.ts`, `run/instance.lock`에 SQLite EXCLUSIVE lock, process가 죽으면 풀린다) → `removeUserToken` → migration·runtime·wiring → `startApiServer`(기본 7431, shell은 `--port=0`, `127.0.0.1`과 `::1`) → `writeRunMetadata`(`run/location.json`: `api_port`, `core_epoch`, `started_at`) → wiring `start` → `afterReady` → parent가 있으면 `greet`.
- data root마다 instance가 하나라는 보장은 이미 core에 있다.
- `parent.ts` `greet`: user credential을 `conditions: {process: "electron-main"}`(`parent.ts:61`)로 발급해 `run/user-token`(0600)에 쓰고 hello frame(`user_token`, `api_port`, `core_epoch`)을 stdout으로 보낸다. parent가 없으면 token file이 없다(`core.ts:442`).
- 끝나는 길: SIGINT·SIGTERM, stdin EOF, `stop` frame(`grace_ms`는 core가 무시하고 shell이 kill timer로 지킨다). 끝날 때 `location.json`, `user-token`을 지우고 lock을 푼다(`core.ts:293-308`).
- `packages/core/server/serve.ts`가 이미 `{transport: "unix", path}`를 받는다.

감독 pipe (`packages/protocol/supervision/supervision.ts`, main↔core 부분)
- main→core: `stop`, `diagnostic`(core가 받는 kind는 `shell_view_lifetime` → `logs/shell-view.jsonl`, `lophn_internal` → shell main crash 진단), `confirmation_handle_register`(사람 결정 handle, secret 입력이 쓴다, TTL 120초).
- core→main: hello(`type` 없음), `start_failed`(`newer_schema`, `history_mismatch`, `damaged_original`, `other`), `confirmation_handle_registered`. union의 `ready`는 이 길에서 보내지 않는다.
- `confirmation_handle_register`는 일부러 이 pipe에만 둔다("renderer HTTP token and worker context are not trusted", `supervision.ts:433`).

shell (`packages/shell/main/desktop/`)
- `core/supervise.ts` `spawnCore`: Electron binary + `ELECTRON_RUN_AS_NODE=1`, `LOPHN_HOME`, `--port=0`, stdio pipe. hello 30초. core가 죽어도 다시 띄우지 않는다. `core/connection.ts`는 core가 `stopped`면 Gateway 재연결을 멈추고 화면 상태를 바꾸지 않는다(추정).
- 창을 다 닫아도 아무 일이 없다(`desktop.ts:297`). 종료(`quit.ts` `createQuitFlow`, tray `quit`, `will-quit`)는 `ctx.stopAll()`로 core에 `stop`을 보낸다.
- single-instance lock은 shell에도 있다(`single-instance.ts:34`, `--quit`, `--open-app <id>` intent).
- autostart(`autostart.ts`): packaged일 때만, Linux XDG autostart, macOS·Windows login item. `--tray`로 창 없이 Electron과 core를 띄운다.

CLI와 그 밖의 launcher
- CLI(`packages/cli/main.ts:112-119`)는 `LOPHN_AGENT_CREDENTIAL`, 없으면 `run/user-token`을 쓰고, 주소는 `--option` → `LOPHN_DAEMON_URL` → `run/location.json` → `127.0.0.1:7431`(`cli/connection/client/daemon.ts:157-193`). token이 없으면 exit 5.
- core를 띄우는 곳: shell `spawnCore`, `tools/dev.ts`(`dev`는 shell이 띄우고, `dev:core`는 TTY로 바로), `tests/support/core/process.ts:136`(stdin을 닫아 끄고 SIGKILL로 crash를 흉내 낸다), eval(`bootCore`), `tools/ci/boot-core.ts`, `tools/verify-linux-install.ts:165`.

일이 있는지 읽는 길
- `job.list`(`enabled`), `job_run.open`, `ListRuns`(state), `ListWorkflowInstances`(project 필요), `app.runtime`. "바쁨"을 한 번에 답하는 read와 붙은 client 수는 없다. Gateway 구독과 진행 중 request는 `serve.ts` 안에만 있다.

core가 소유한 child
- writer·reader Worker, `platform/io` child, apps supervisor child(앱 process), agent runtime child, flow host process, maintenance·release·data job child. 모두 core 종료 순서(`core.ts:252-311`)로 끄고, core가 SIGKILL되면 stdin EOF로 스스로 끝난다(추정).

## 무엇을 만드나

1. **control socket.** core가 data root의 socket 자리(`platform-ipc.md`의 규칙, win32 named pipe)에 `core` socket을 연다. 한 연결에 JSON 한 줄 요청 하나, 답 하나. verb는 `identify`(제품 판, protocol 판, `core_epoch`, API 주소, 상태 `starting|ready|stopping`), `connect`(user credential 발급), `stop`, `diagnostic`. 경로는 data root에서 계산되므로 따로 알리지 않는다.
2. **ensure.** shell과 CLI가 같이 쓰는 함수 하나. `identify`가 답하면 판을 대조하고 붙는다. 답이 없으면 core를 detached로 띄운다(POSIX 새 session, win32 detached + `windowsHide`). 띄운 core의 stdout을 첫 줄(`ready` 또는 `start_failed {reason}`)까지만 읽고 놓는다. 동시에 띄운 둘 중 진 쪽은 `instance.lock`이 `conflict`로 끝내고 ensure는 다시 `identify`한다.
3. **parent pipe와 token file을 지운다.** hello frame, `watchParent`, `run/user-token`, `run/location.json`을 지운다. shell과 CLI는 `connect`로 credential을 받는다. stdin EOF는 더 이상 끝나는 신호가 아니다. CLI의 주소 찾기는 `--option`·`LOPHN_DAEMON_URL`·`identify`만 남는다.
4. **idle-exit.** 할 일도 붙은 client도 없이 10분이 지나면 core가 스스로 끝난다. 할 일은 켜진 job, 열린 job run, running run, running workflow instance다. client는 Gateway WebSocket 구독과 진행 중 request다.
5. **판 대조.** `identify`의 제품 판(root `package.json` `version`)이나 protocol 판이 ensure 쪽과 다르면 ensure가 `stop`을 보내고 끝나기를 기다린 뒤 새로 띄운다. 돌던 run·job 차례는 지금 종료와 같이 `interrupted`가 된다.
6. **autostart가 core만 띄운다.** login item은 lophn 실행 파일을 `--core` intent로 연다. Electron은 ensure만 하고 창 없이 바로 끝난다. `--tray`는 지운다(tray는 Electron이 떠 있을 때의 것이다).
7. **shell 쪽 정리.** shell의 core 감독(`supervise.ts`)이 ensure와 control socket client가 된다. core가 사라지면(identify 실패) Gateway 재연결 대신 ensure를 다시 한다. `job.md:66`, `coding-agent.md:23`, `headless-schedule.md` "하지 않는 것"을 고친다.

## 정한 것

1. core는 shell의 child가 아니다. shell과 CLI는 ensure로 붙거나 띄우는 client다. job을 shell 수명에서 떼는 것이 첫째 이유다. (사람, 2026-11-08)
2. OS service(systemd, launchd agent, Windows service·scheduled task)로 등록하지 않는다. 로그인 때 켜는 것은 지금 autostart 설정이 core만 띄우는 것으로 충분하다. Hermes도 이미 있는 service를 켜기만 하고 설치하지 않는다. (agent)
3. control socket은 TCP가 아니다. socket file 권한(POSIX 0700 폴더)과 Windows named pipe가 경계다. 데이터(API)는 지금처럼 loopback HTTP·WebSocket이다. API를 unix socket에도 여는 것(Codex `workspace-write` sandbox에 core socket 하나만 여는 길, `coding-agent.md:65`)은 이 roadmap에 넣지 않는다. (agent)
4. 1회용 ticket을 만들지 않는다. `connect`가 지금 hello가 주는 것과 같은 user credential을 준다. 지금 `run/user-token`(0600 file)과 같은 경계에서 같은 것을 주는 것이라 더 약해지지 않는다. (agent)
5. 동시 시작은 이미 있는 `run/instance.lock`이 가른다. pid file을 만들지 않는다. liveness는 "`identify`가 답한다"다. (agent)
6. shell의 single-instance lock은 남긴다. 그것은 창 하나·탭 하나를 지키는 것이고 core와 따로다. (agent)
7. 앱 process는 idle-exit의 "할 일"이 아니다. 앱은 쓰일 때 core가 띄우고, client도 job도 없으면 쓰는 쪽이 없다. (agent)
8. core가 crash해도 core 쪽에서 다시 띄우는 감독은 두지 않는다. 다음 ensure(shell 재연결, CLI 호출, autostart)가 띄운다. 놓친 job 차례는 지금 놓친 차례 정책(`run`, `hold`)이 받는다. (agent)
9. 앱 Quit는 shell만 끈다. core는 남고 idle-exit 규칙대로 끝나며, 켜진 job이 있으면 산다. 모두 끄는 "Stop lophn"을 따로 둔다. (사람이 추천을 받음, 2026-11-08)
10. CLI도 ensure로 core를 띄운다. 끄는 것은 idle-exit와 `lophn core stop`이다. (사람이 추천을 받음, 2026-11-08)

## 정할 것 (계획 `standalone-core` README의 정한 것에서 정했다)

1. **사람 결정 handle(`confirmation_handle_register`)을 어디로 옮기나.** 지금은 shell main만 가진 pipe라 renderer나 agent가 흉내 낼 수 없다. control socket은 같은 사용자의 아무 process(터미널 안 agent 포함)나 붙는다. 계획을 열 때 이 handle이 무엇을 막는지(`approval.md`, `wiring/secret-input.ts`)를 다시 읽고 정한다. 후보: control socket에서 `LOPHN_AGENT_CREDENTIAL` 없이 붙은 연결만 받기, shell이 `connect` 때 받는 shell 전용 credential. (계획에서 agent)
2. **credential 조건 `process: "electron-main"`.** CLI가 `connect`로 받으면 이 조건이 거짓이 된다. 조건이 어디서 읽히는지 보고 지우거나 값을 나눈다. (계획에서 agent)
3. **test 띄우기.** `tests/support/core`는 stdin을 닫아 끄고 SIGKILL로 crash를 흉내 낸다. parent pipe가 없어지면 control `stop`과 SIGKILL로 바꾼다. 남은 child를 확인하는 helper(`tests/support/core/mod.ts`)도 detached core에 맞춘다. (계획에서 agent)

## 하지 않는 것

- OS service 등록.
- core를 쓰는 사람과 다른 사용자나 원격 머신에서 붙기. `identify` 모양은 나중에 원격 연결에 쓸 수 있게 두지만 만들지 않는다.
- core 쪽 crash 재시작 감독.
- API를 unix socket으로 옮기기(위 정한 것 3).
- shell이 없을 때의 알림. shell이 없는 사이 job 실패나 `hold` card는 ledger에 남고, shell이 다시 붙으면 Inbox와 대기 목록에 보인다. toast는 shell의 것이라 다시 띄우지 않는다(`event.md`).

## 끝남 기준

- 앱을 Quit해도 켜진 job이 정해진 때 돈다. 켜진 job이 없으면 10분 뒤 core가 끝난다.
- 앱을 다시 켜면 돌던 core에 붙는다. 판이 다른 core면 그 core를 끄고 새로 띄운다.
- shell 없이 `lophn` CLI 명령 하나가 core를 띄우고 답한다.
- `npm run dev:core`로 띄운 core에 CLI가 붙는다.
- Linux·macOS·Windows에서 shell과 CLI가 같은 control socket(Windows는 named pipe)으로 core를 찾는다.
- `run/user-token`, `run/location.json`, hello frame, `watchParent`가 코드에 없다.
