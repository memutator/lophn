# always-on: 사람이 표시한 기계에서 lophn이 로그인 때 뜨고 창 없이 계속 돌며, 예약 작업은 주인 기계를 갖는다

- 목표: 사람이 Settings › Remote에서 "Keep lophn running on this computer"를 켜면 그 기계의 core가 로그인 때 OS의 per-user 시작 항목으로 뜨고, 창을 닫아도 idle-exit하지 않는다. 등록이 정말 있는지 OS에 물어 그대로 보이고, 빠지거나 낡았으면 기동 때 다시 쓴다. 따로 켜는 "Keep this computer awake"는 그동안 기계가 스스로 잠들지 않게 한다. job은 만든 기계의 id를 싣고 그 기계에서만 돈다. 다른 기계의 job(지금은 복사된 data root에서 온 것)은 멈춘 채 보이고 사람이 가져온다.
- 재료: `/home/pyosechang/projects/lophn/reports/multi-machine/program.md`(경계, 정책 5~8. roadmap과 다르면 이것이 새것이다), `project-docs/products/roadmap/multi-machine.md`("모양" 1, "사람이 정할 것" 4), `project-docs/products/roadmap/standalone-core.md`(정한 것 2·8·9, 하지 않는 것), `project-docs/architecture/{platform,job}.md`, 코드 조사 `/home/pyosechang/projects/lophn/reports/multi-machine/code-survey.md`(H, G, 끝의 표), harness 비교 `/home/pyosechang/projects/harness-lab/_report/multi-device/comparison.md`(3, 11, 14절)와 같은 폴더 `others.md` §5.6(Antigravity), `hermes.md` §10.1·§10.4·distribution의 cron, `codex.md` §2.3, `project-docs/plan/machine-identity/README.md`("다른 계획이 기대는 계약").
- 열기 전에: `machine-identity`가 main에 있어야 한다(`ctx.machine`, `packages/core/machine`, Settings › Remote의 "This computer").
- 범위 밖(가는 곳):
  - 로그인 전 시작과 화면 없는 기계: 보류(roadmap "보류"). Linux linger(`loginctl enable-linger`)를 켜면 user manager가 부팅 때 뜨고 마지막 로그아웃 뒤에도 남아 같은 unit이 로그인 없이 돈다. macOS는 LaunchDaemon, Windows는 저장한 자격의 scheduled task가 같은 자리다. 화면 없는 첫 설정(provider key, pairing)과 같이 연다.
  - 표시를 다른 기계에 알리기: `app-folder-sync`(기계 기록을 폴더로 쓴다). 이 계획은 이 기계의 값만 둔다.
  - job을 기계 사이에 맞추거나 옮기기: 하지 않는다(program 8). 이 계획은 "주인이 다른 job은 멈춘다"까지다.
  - 폰 앱을 살려 두기: 이 계획이 아니다.
  - lophn 업데이트 뒤 service가 띄운 옛 core를 바로 갈아 띄우기: 하지 않는다. 앱을 열면 ensure가 판을 대조해 갈아 띄우고, 다음 로그인은 새 판으로 뜬다.
  - 앱·CLI가 띄운 core를 OS 감독 아래로 옮기기: 하지 않는다. 그 core는 다음 로그인까지 crash 뒤 다시 뜨지 않는다.
- 한계(첫 판): Windows는 crash 뒤 core를 다시 띄우지 않는다(`Run` 값은 로그인 때 한 번 띄울 뿐이다). 다음 로그인이나 앱·CLI가 띄운다. Linux·macOS는 OS가 다시 띄운다.

## 정한 것

- 표시는 기계마다 하나다. 켜면 그 기계에 로그인 시작을 등록하고 idle-exit를 끈다. 이유: 표시만 있고 수단이 없으면 거짓이다(조사 3.2, Emdash) (사람 roadmap Q4·program 5).
- **`platform.md` 지키는 것 14("OS service는 등록하지 않는다. 로그인 때 켜는 것은 core만 띄우는 autostart다")를 뒤집는다.** 사람이 표시한 기계에서만 OS의 per-user 시작 항목을 등록하고, 설치 때 하지 않고, 개발·test core는 하지 않는다. 이유: 지금 autostart는 Electron이 ensure만 하고 끝나 crash 뒤 아무도 다시 띄우지 않고, Linux XDG autostart는 화면 세션에서만 돈다. 늘 켜 둔 기계에서 core가 죽으면 job과 폰이 사람이 올 때까지 멈춘다 (planner).
- 첫 판은 로그인 뒤에 뜬다. linger·LaunchDaemon은 쓰지 않는다 (program 6).
- OS별 등록: Linux systemd user unit(`Restart=on-failure`), macOS `~/Library/LaunchAgents`의 plist(`KeepAlive` 실패 때만), Windows HKCU `Run` 값(`--core` 시작). Windows에 scheduled task를 쓰지 않는다: task는 env를 넘기지 못해 core를 바로 띄우려면 console 창이나 상주 Electron이 필요하고, 로그온 trigger task는 권한에 걸리는 경우가 있다. `Run` 값은 관리자 없이 되고 사람이 Startup apps에서 끌 수 있다. 잃는 것: Windows는 crash 뒤 다시 띄우지 않는다. 첫 판은 이것을 받아들인다(위 "한계") (planner).
- 등록, 상태 읽기, 고치기는 core가 한다. 화면, CLI, 나중의 agent 도구가 같은 사실을 보고, 창이 없어도 기동 때 고친다 (planner).
- 표시는 `<root>/always-on.json`에 이 기계 id와 같이 둔다. id가 다르면(복제) 꺼진 것으로 읽고, 그 data root의 등록이 이 기계 OS에 있으면 지운다. 원래 기계의 OS 등록은 그 기계 것이라 건드릴 길도 없다 (planner, program 규칙).
- "등록됨"은 OS가 답한 것만이다. 빠지거나 낡은 등록은 기동 때 다시 쓰고, OS나 사람이 OS 설정에서 끈 것은 다시 켜지 않고 화면에 알린다. 사람이 lophn에서 다시 켜면 그때는 켠다 (planner, 조사 3.3).
- 옛 autostart(tray "Start at login")는 표시로 바뀐다. tray 항목을 지우고, 켜져 있던 옛 등록은 새 판의 첫 실행이 표시 켜기로 옮긴 뒤 지운다. 같은 일을 하는 스위치 둘을 두지 않는다 (planner).
- 옮겨진 사람에게는 그 뒤 desktop 창이 처음 열릴 때 한 번 알림을 보인다: lophn이 이제 창을 닫은 뒤에도 이 컴퓨터에서 계속 돈다는 것과 설정을 여는 단추. 그들에게는 동작이 바뀐다(idle일 때 core가 멈추지 않는다). 사람이 우연히 알게 두지 않는다 (planner).
- `Stop lophn`은 표시한 기계에서도 core를 멈춘다. 정상 종료라 OS가 다시 띄우지 않고, 다음 로그인이나 앱·CLI가 띄울 때 다시 선다. 화면은 지금과 같고 스위치 설명이 그 뜻을 적는다 (planner).
- keep-awake는 따로 스위치이고 기본 꺼짐이며 표시가 켜져 있을 때만 켤 수 있다(program 7). 저절로 잠들기만 막고 덮개 닫기·Sleep 메뉴는 막지 않는다. core pid에 묶인 child(`systemd-inhibit`, `caffeinate -i -w`, PowerShell `SetThreadExecutionState`)가 쥐어 core가 죽으면 풀린다 (planner).
- service가 띄운 core에 넘기는 env는 표시를 켤 때 잡은 PATH(macOS는 TMPDIR도)뿐이다. 다른 env와 secret은 등록에 쓰지 않는다. lophn의 secret은 `secrets.json` file이라 로그인 시작 core가 그대로 읽는다. harness의 keyring·Keychain과 Linux 화면 세션 env는 화면 로그인 뒤에만 있고, 없으면 그 harness나 앱 띄우기가 지금처럼 실패를 낸다. 새 secret 저장소를 만들지 않는다 (planner, program 16).
- 등록은 설치 layout으로 뜬 core만 한다. core 입구(`main.ts`)가 저장소 layout(`packages/shell`이 있음)이면 OS port를 주지 않아 개발·test core는 표시를 켤 수도 없다 (planner).
- 설치 묶음은 아무것도 등록하지 않는다. Windows 제거는 lophn의 `Run` 값을 지우고(업데이트 때는 아님), deb·mac에 남은 항목은 실행 파일이 없으면 아무것도 하지 않고 끝난다 (planner).
- job은 만든 기계의 id를 싣고 그 기계에서만 돈다. 다른 기계의 job은 멈춘 것으로 보이고 사람이 "Run on this computer"로 가져온다 (program 8). 이미 있는 job은 새 판의 첫 claim이 그 기계 id를 찍는다(schema step은 id를 모른다) (planner).
- 다른 기계 job의 화면 글은 "another computer"다. 화면 source에 선택 함수 `machineName?(machine)`를 두어, 뒤에 `app-folder-sync`의 폴더로 그 id의 기계 기록을 알게 되면 그 이름을 보인다. 이 계획은 그 계획에 기대지 않고 함수를 채우지 않는다 (planner).
- worker는 `sonnet-high`, `always-mark`·`always-os`는 opus high다(brief 머리) (planner).

## 다른 계획이 기대는 계약

1. **표시.** `<root>/always-on.json`(0600, temp에 쓰고 rename): `{ "machine": "mch_…", "keep_running": boolean, "keep_awake": boolean, "service_env": { "PATH": string, "TMPDIR"?: string }, "updated_at": at }`. `packages/core/always-on`만 읽고 쓴다. `machine`이 지금 기계 id와 다르면 꺼진 것이다.
2. **상태.** core 안 `ctx.alwaysOn.status(): AlwaysOnStatus`(Late), route `always_on/status`·`always_on/set`(memory, actors `user`). `AlwaysOnStatus = { keep_running, keep_awake, start_at_login: "registered" | "not_registered" | "off_in_system" | "unavailable", login_reason: "development_build" | "no_service_manager" | "unverified_path" | "os_failed" | null, awake: "held" | "released" | "unavailable", awake_reason: "no_inhibitor" | "os_failed" | null, mechanism: "systemd" | "launchd" | "windows_run" | null }`. 모양은 `always-mark` brief.
3. **agent와 기계 기록이 읽는 칸(`app-folder-sync`에 넘긴다).** `always_on: { keep_running: boolean, starts_at_login: boolean, keep_awake: boolean }` = `{ status.keep_running, status.start_at_login === "registered", status.keep_awake && status.awake === "held" }`. 읽는 곳은 `ctx.alwaysOn.status()`. 이 계획은 그 도구를 고치지 않는다. `app-folder-sync`가 land되어 있으면 `always-mark`가 그 계획이 내는 확장 자리(읽기 명령의 선택 section, 기계 기록의 `alwaysOn(): boolean | null` = `keep_running && start_at_login === "registered"`)에 함수를 등록한다. 아직이면 lead에게 남긴다.
4. **job 주인.** `jobs.machine TEXT`(ledger step `jobs.machine`, 마지막 wiring의 `schemaStepsAfterTeams` 끝). job 기록(`jobRecordSchema`)에 `machine: mch_… | null`(찍기 전 null)과 `runs_here: boolean`. `runs_here`가 false인 job은 차례를 만들지 않고, event로 열리지 않고, 놓친 차례를 [Start now]로 돌리지 못하고(`conflict`), idle-exit의 일로 세지 않는다. 사람만 부르는 `job.take_over { job }`이 이 기계로 가져온다. 기계를 넘어 오는 job(뒤의 sync)도 같은 칸과 같은 멈춤을 쓴다.

## 계약 바꾸기 요청

- 없음. writer·reader Worker의 tx port가 쓰는 `readMachineIdSync(root)`는 `machine-identity`(`machine-id` task)가 `packages/core/machine/mod.ts`에서 낸다.

## task

| wave | id | 단위 | 한 줄 |
|---|---|---|---|
| 1 | `always-mark` | always-mark | `always-on.json`, `always_on/status·set`, `ctx.alwaysOn`, 기동 때 맞추기, idle-exit 규칙, `startCore`의 OS port 칸. OS는 port. 개발 core·복제·사실 보고 위험 test |
| 1 | `always-os` | always-os | OS port 구현: systemd unit, LaunchAgent plist, Windows `Run` 값의 쓰기·읽기·지우기와 OS 답 읽기, keep-awake child. secret이 등록에 안 실리는 위험 test |
| 1 | `always-jobs` | always-jobs | `jobs.machine` step과 찍기, 주인 아닌 job 멈추기, `job.take_over`, job 기록 칸, Jobs 화면의 "Belongs to another computer". migration·남의 job 위험 test |
| 2 | `always-boot` | always-boot | core 입구가 설치 layout일 때만 OS port를 잇고, service로 뜬 core의 기동 실패는 exit 0, Linux에서 앱을 띄울 화면 env, Windows 제거가 `Run` 값을 지움 |
| 2 | `always-desktop` | always-desktop | Settings › Remote의 "Keep running" section(스위치 둘과 사실 보고), tray "Start at login"과 `autostart.ts`를 지우고 옛 등록을 표시로 옮기기 |

## 어느 OS에서 확인하나

| task | 이 Linux 기계에서 | 사람의 Mac·Windows가 필요 |
|---|---|---|
| `always-mark` | 전부(fake OS port) | 없음 |
| `always-os` | 세 OS의 글 만들기와 OS 답 읽기 test(fake exec). 실제 `systemctl --user` 등록은 사람의 user systemd를 바꾸므로 사람에게 묻는다 | `launchctl`·plist, `reg.exe`·StartupApproved, `caffeinate`, PowerShell keep-awake |
| `always-jobs` | 전부 | 없음 |
| `always-boot` | 입구의 port 잇기, exit code, Linux 화면 env | NSIS 제거 macro |
| `always-desktop` | gallery(fake source의 모든 상태), 개발 앱에서 "development build" 상태 | macOS·Windows의 옛 login item 옮기기 |

## lead가 할 일

- 돌리기 전에: `machine-identity`가 main에 있는지 본다. 같은 때 `desktop-remote`가 Settings › Remote를, 다른 계획이 `wiring/remote.ts`·`schema-steps.lock.json`을 고치면 `status.py ready`가 막는다.
- 공유 줄(brief가 한 줄씩 허락하고 "넘길 줄"에 적는다): `wiring/context.ts`(`alwaysOn`), `assembly.ts`(wiring 한 줄), `packages/protocol/registry.ts`(route 둘), `wiring/remote.ts`의 `schemaStepsAfterTeams`(`jobs.machine`), `schema-steps.lock.json`(끝에 한 줄), `module-catalog.yaml`·`boundary-catalog.yaml`(`always-mark`와 `always-os`가 같은 `packages/core/always-on` 항목을 낼 수 있다. 하나만 남긴다), `allowlist.ts`(memory route 둘), i18n catalog. 다른 계획과 합칠 때 두 쪽을 다 남긴다. schema step 순서는 planner가 land 때 정한다.
- Settings › Remote(`settings/remote/remote-panel.tsx`)에는 `machine-identity`("This computer")와 `desktop-remote`도 section을 단다. `desktop-remote`는 `shell/main/desktop/wiring/desktop.ts`도 고친다. 계획마다 자기 section component file에만 쓰고 panel에는 한 줄로 단다. lead가 land 순서를 정하고 합칠 때 두 쪽을 다 남긴다.
- merge 때마다 `npm run check`. `always-jobs` 뒤에는 `check:full`(schema lock)과 `cd packages/mobile && npm ci && npm run typecheck && npm test`(폰 sample의 job 칸).
- wave 2 뒤: 개발 core(`boot.sh`)에서 `always_on/status`가 `unavailable`·`development_build`이고 `always_on/set { keep_running: true }`가 `unavailable`인지, `~/.config/systemd/user`에 아무것도 생기지 않았는지 본다.
- 사람만 확인할 수 있는 것(자동 check가 못 한다. land 뒤 사람에게 목록으로 준다): OS마다(Linux deb, macOS dmg, Windows NSIS) 설치본에서 스위치를 켜고 (1) 로그아웃·로그인 뒤 창 없이 core가 돌고(Settings가 "Starts when you log in", 앱을 열면 그 core에 붙는다), (2) 재부팅 뒤 앱을 열지 않아도 켜 둔 job이 제때 돌고, (3) `Stop lophn` 뒤 다시 뜨지 않다가 다음 로그인에 뜨고, (4) OS 설정(macOS Login Items, Windows Startup apps, `systemctl --user disable`)에서 끄면 Settings가 그렇게 알리고, (5) 스위치를 끄면 등록이 사라지고, (6) keep-awake를 켜면 저절로 잠들지 않는지(`systemd-inhibit --list`, `pmset -g assertions`, `powercfg /requests`), (7) Windows 제거 뒤 `Run` 값이 없고 업데이트 뒤에는 남는지, (8) 옛 판에서 tray "Start at login"을 켜 둔 기계가 새 판에서 표시 켜짐으로 옮겨졌는지. 실제 설치와 실제 기계의 user systemd·launchd·registry를 바꾸는 일이라 사람에게 묻는다.
- 끝에(문서는 lead의 일): `architecture/platform.md`(목표와 비목표에서 OS service를 빼고, "core 수명"에 늘 켜 둠 절, 지키는 것 14를 "사람이 표시한 기계에서만 per-user 로그인 시작을 등록한다. 설치 때와 개발·test core는 하지 않는다"로, 9에 표시, 결정에 위의 뒤집기와 OS별 수단·Windows Run의 이유), `architecture/job.md`(주인 기계, 멈춤, take over, 지키는 것), `products/roadmap/standalone-core.md`(정한 것 2와 하지 않는 것에 "2026-11 always-on이 표시한 기계에 한해 뒤집었다" 한 줄), `products/roadmap/multi-machine.md`(순서 4 끝남), `boundary-catalog.yaml`·`module-catalog.yaml` 다듬기, `project-docs/flows/`(`flows` skill로 마지막 대조, tray 항목 삭제와 `journeys/setup.yaml`), change-log `0.23/always-on.yaml`(Windows는 crash 뒤 다시 띄우지 않음, 앱·CLI가 띄운 core는 OS 감독 밖, 업데이트 뒤 옛 core, deb·mac 제거 뒤 남는 항목, 확인하지 못한 OS), `sdk-note`는 필요 없다. 이슈는 위 미완을 `issue` skill로 올린다. `app-folder-sync`가 `always-mark`보다 늦게 land되면 계약 3의 등록(확장 자리에 함수 하나)을 lead가 한다.
