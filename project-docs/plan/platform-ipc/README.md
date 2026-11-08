# platform IPC

- 목표: Windows 터미널에서도 hook 상태·알림, `<harness> gui`, browser bridge가 돌게 하고 socket 자리 규칙을 하나로 모은다.
- 재료: `project-docs/products/roadmap/platform-ipc.md`의 정한 것, `project-docs/architecture/platform.md`, `project-docs/architecture/terminal-agent.md`, `project-docs/architecture/browser-tab.md`, `project-docs/architecture/harness-gui.md`.
- 범위 밖: Windows foreground·signal·TUI↔GUI toggle, cmd.exe 시작 층, WSL bridge, harness GUI adapter의 플랫폼 대응, standalone core.

## 정한 것

- key 64 hex 검사만 유지하고 SID·DACL 검사는 더하지 않는다 — 같은 사용자 process는 이미 터미널 env를 안다(roadmap).
- 경로 초과는 기능을 끄고 로그로 알리며 pointer file·TCP fallback은 만들지 않는다 — 짧은 runtime 경로면 충분하다(roadmap).
- foreground 판정은 그대로 둔다 — Windows의 harness 상태는 hook으로 받는다(roadmap).
- 공통 자리 규칙은 `packages/base/os/`의 순수 함수에 둔다 — shell→core import는 금지이고 OS 규칙의 기존 자리다. (agent)
- POSIX SHA-256 앞 12자와 기존 앱 socket 경로를 유지하고 hash 계산만 주입한다 — base는 Node를 import하지 않으며 저장 data를 바꿀 일이 없다. (agent)
- Windows file은 data root의 `run/shell-<pid>/`, socket은 별도 named pipe로 둔다 — file 정리와 pipe 수명을 섞지 않는다. (agent)
- hook 준비는 browser shim·listen 성공과 나눈다 — browser 준비 실패로 hook까지 잃을 이유가 없다. (agent)
- PowerShell 7·5.1은 기존 profile 뒤에 함수를 싣고 기존 wrapper 규칙을 그대로 쓴다 — 사용자 설정·alias를 덮거나 새 실행 정책을 만들지 않는다. (agent)
- wave마다 하나씩 끝내고 Windows gate는 마지막에 지운다 — wiring 소유가 겹치고 중간 변경도 check가 통과해야 한다. (agent)
- 새 subprocess·서버·E2E test는 만들지 않고 위험 unit test와 Windows 수동 확인으로 시작한다 — 비용이 큰 test와 실제 provider 호출은 사람에게 먼저 묻는다. (agent)

## task

| wave | id | 하는 일 |
|---|---|---|
| 1 | `pipc-socket-rule` | 순수 socket 자리 규칙을 base에 두고 core가 쓰게 한다 |
| 2 | `pipc-shell-ipc` | shell의 중복 규칙을 걷고 named pipe·OS별 shim·독립 hook 준비를 잇는다 |
| 3 | `pipc-powershell` | PowerShell 시작 층을 붙이고 Windows gate를 지운다 |

## lead가 할 일

- `project-docs/plan/tools/lead/lead.sh platform-ipc`로 연 lead worktree에서만 실행한다. wave마다 앞 task를 합치고 `npm run check`가 통과한 뒤 다음 task를 연다. public 계약 변경은 brief의 계약을 기준으로 lead가 관리한다.
- 기존 `context-cache`·`ui-overhaul`는 README에만 task·소유가 있고 `tasks/`가 없다. 이 계획의 소유와 겹치지 않는다. 다른 계획의 running 소유도 시작 전에 확인한다.
- merge마다 바뀐 동작과 함께 architecture를 고친다: `project-docs/architecture/platform.md`의 공통 socket 규칙과 **Windows에서 꺼진 기능** 표(hook·bridge 줄 삭제, foreground·signal 줄 유지), `project-docs/architecture/terminal-agent.md`의 socket·env·시작 층·Windows 설명, `project-docs/architecture/browser-tab.md`의 pipe·file 자리·shim·fallback·정리 설명.
- `project-docs/architecture/harness-gui.md`의 터미널 함수 설명에 PowerShell을 반영하되 Windows toggle·adapter까지 지원한다고 쓰지 않는다. boundary·module catalog는 새 경계 없이 기존 `base`·`apps`·`shell` 소유로 맞는지 본다.
- Windows의 **PowerShell 7·5.1** 각각에서 hook·알림·`claude gui` 진입·browser link와 실패 시 OS fallback을 수동 확인하고 Linux·macOS 회귀를 확인한다. 새 integration/E2E test나 실제 provider 호출·CI push가 필요하면 사람에게 묻고, 확인하지 못한 것은 통과로 쓰지 않는다.
- 다 끝나면 changelog 열린 판에 동작과 `(agent)` 결정을 남기고 roadmap을 정리한다. 이 계획 전체가 land한 뒤에만 `standalone-core`의 wave 1을 실행한다(외부 선행은 status 도구가 막아 주지 않는다). 계획 폴더를 닫는다.

## 구현·검증 상태

- 세 task는 순서대로 plan branch에 merge됐다. task마다 full check·core 두 번 기동·renderer build와 merge 뒤 `npm run check`가 통과했다. 네 architecture를 동작과 함께 고쳤다.
- Linux 실제 실행: 생성한 browser shim과 bridge socket의 ack, declined·접속 실패 때 URL/정리한 env를 받는 opener, bridge 종료 뒤 hook CLI의 hook·GUI ingress 수신, Electron의 shim 쓰기 실패·bridge listen 실패 뒤 hook endpoint 유지, CJS·ESM 아래 공통 browser JS, Bash의 인자·native 종료 상태·GUI JSON·사용자 함수 우선권을 확인했다. 실제 browser 화면·OS 알림은 이 smoke에 포함하지 않았다.
- Windows launch API의 경로 구분자·대소문자·작은따옴표와 UTF-8 BOM byte는 Linux에서 확인했다. 이것은 PowerShell·named pipe·`.cmd`의 Windows 실기 확인을 대신하지 않는다. macOS는 platform 인자/경로·byte 한도 unit만 확인했고 실기 실행하지 않았다.
- **남은 Windows 수동 확인:** PowerShell 7·5.1 각각에서 profile·alias 유지, native 인자·종료 상태·Kilo/Cline env 복원, 한글·공백 경로, synthetic hook의 turn 끝·권한 물음 상태와 알림, `claude gui` 진입, `$BROWSER` link가 lophn browser 탭으로 열리는지와 실패 시 OS browser fallback, URL query의 `& | % ^ !` 보존을 확인한다. execution policy가 시작 층을 막으면 우회하지 않고 결과를 알린다. 실제 provider 호출 없이 확인한다.
- Windows 수동 확인의 환경·항목별 결과·land gate는 저장소 루트의 [`WINDOWS-CHECKLIST.md`](../../../../WINDOWS-CHECKLIST.md)에 기록한다. PowerShell 7·5.1을 따로 확인하고 미확인을 통과로 쓰지 않는다.
- 사람이 Windows 미확인 상태의 land와 계획 닫기를 승인했다. Windows 실기 결과는 루트 checklist에 미확인으로 남기며, full check·기존 E2E·core 기동을 생략하지 않는다. `standalone-core` wave 1은 이 계획 land 뒤에만 연다.
