# project-command

project에서 되풀이해 돌리는 일회성 명령(`action`: build, test, lint)과 오래 도는 서비스(`service`: dev server, watcher)를 lophn이 관리하는 메커니즘이다. 정의와 project별 agent 정책은 core의 ledger가 소유하고, 실행 상태와 명령 전용 PTY는 core 메모리에 둔다. 사람 화면(네 진입점과 사이드바), CLI(`lophn command`), lophn agent, 연결된 다른 컴퓨터가 한 정본을 본다.

## 문제

- 기존 터미널 명령은 창(layout 파일)의 단순 문자열 북마크였다. 누를 때마다 새 터미널 탭이 생기고, 명령이 도는지·끝났는지·실패했는지 lophn이 몰랐다.
- 멈추기, 다시 시작, 끝난 뒤 로그 꼬리, dev server URL 감지와 프리뷰, 프로젝트 폴더 자동 감지가 없었고, CLI·agent·다른 컴퓨터·여러 창에서 같은 명령을 다루지 못했다.
- 저장소에 lophn 설정 파일을 쓰면 공유 저장소에 개인 도구 파일을 커밋하게 되는 원칙과 충돌하고, agent가 명령을 몰래 바꾸면 사람이 누를 때 agent가 적은 명령이 사람 터미널에서 도는 공격면이 생긴다.

## 목표와 비목표

- 목표:
  - 정의는 lophn 안에만 두고(저장소 파일 쓰기 없음), 빈 목록은 프로젝트 폴더의 기존 설정에서 읽기 전용 감지 후 사람이 골라 가져온다.
  - 명령 전용 PTY로 정확한 exit code, 프로세스 트리 단위 중지, 셸 history 무오염, 명령당 단일 터미널 탭 재사용을 보장한다.
  - agent는 사람이 미리 정한 project 기본값 + 명령별 덮어쓰기(쓸 수 있는 agent, 실행 전 승인, 정의 쓰기 승인) 안에서 명령을 만들고 고치고 실행한다.
  - 같은 `pri_` 정체성을 가진 연결된 다른 컴퓨터 가운데 터미널 입력이 허락된 컴퓨터의 명령을 원격으로 보고 실행·중지·재시작한다(사람만).
- 비목표:
  - 저장소 파일 쓰기·내보내기, repo 파일 직접 실행과 content-hash 신뢰 게이트.
  - 프로젝트 열기·core 시작 시 자동 실행(worktree setup/teardown 훅과 선택 `worktree_id` 실행은 `worktree.md`로 지원한다).
  - 헤더 실행 단추, 하단 Commands 패널, 탭 우클릭 메뉴.
  - 포트 할당, 역프록시, 커널 포트 스캔, 컴퓨터 사이 정의 동기화, OS별 명령 분기.
  - agent의 원격 명령 실행, 폰 전용 UI(route는 기기 목록에 포함).

## 모델

### 정의와 정책

```
ledger (project마다)
  project_commands          : ProjectCommand[] (최대 50개, order 순)
  project_command_settings  : { agents: "all" | agent_id[], ask_before_run, approve_agent_writes }
```

- `ProjectCommand`는 `id`(slug, project 내 유일), `name`, `command`(여러 줄 가능), `kind`(`action` | `service`), `description`, `folder_ref`(기준 등록 폴더), `cwd`(기준 폴더 기준 상대 경로), `env`(key-value, 최대 64개), `preview_url`, `auto_open_preview`(기본 꺼짐), `timeout_ms`(`action` 전용), `order`, 명령별 덮어쓰기 `agents?`, `ask_before_run?`을 갖는다. 목록·사이드바·설정에서 명령 아이콘은 모두 터미널 아이콘으로 통일한다.
- 새 project의 기본 agent 설정은 `agents: "all"`, `ask_before_run: false`, `approve_agent_writes: true`다.
- `env` 값은 비밀일 수 있으므로 로그·알림·승인 카드·CLI `list`·agent 응답·원격 응답에 원문으로 싣지 않는다(키 이름 `env_keys`만 보인다). 로컬 사람 자격의 설정 편집 읽기(`include_env: true`)에만 값을 싣는다.

### 명령 전용 PTY와 상태 기계

```
idle ─▶ starting ─▶ running ─┬─ exit 0           ─▶ succeeded  (ended_by: process)
                             ├─ exit != 0 / sig  ─▶ failed     (ended_by: process)
                             ├─ stop 요청        ─▶ stopped    (ended_by: user | agent | shutdown)
                             └─ timeout_ms 경과  ─▶ timed_out  (ended_by: timeout)
```

- 실행은 대화형 셸에 타이핑하지 않고 PTY host에서 명령 전용 PTY(`dedicated: true`)로 띄운다: POSIX는 로그인 셸(`bash`·`zsh`·`fish` `-lc`, `sh`·`dash` `-c`), Windows는 `pwsh`/`powershell` `-NoLogo -Command` 또는 `cmd.exe /d /s /c`.
- 실행 직전마다 `folderOfCwd`로 기준 등록 폴더 아래 realpath를 검사해 symlink 탈출을 막는다.
- 환경변수 조립 순서는 `PersonEnv` → `COLORTERM=truecolor`·`FORCE_COLOR=1`(`CI=1` 미설정) → `PROJECT_ROOT`·`PROJECT_CWD`·`COMMAND_ID`·`COMMAND_NAME`(선택 `worktree_id`로 실행 시 `WORKTREE_PATH`·`WORKTREE_ID`·`WORKTREE_BRANCH` 추가, `worktree.md`) → 정의의 `env`다.
- 이미 `starting`·`running` 중인 명령을 다시 `run`하면 `conflict`로 거절한다. 재시작은 `restart`(명령별 직렬 큐에서 중지 후 재기동)로 한다.
- 중지는 프로세스 트리 전체다(POSIX 프로세스 그룹 `SIGTERM` → 3초 → `SIGKILL`, Windows `taskkill /T /F`). 사람이 멈춘 것은 `stopped`이지 `failed`가 아니다.
- 실행 중에는 링버퍼(1,000줄)를 유지하고, 종료 후에는 마지막 결과와 출력 꼬리(최대 200줄 / 32 KiB)를 명령마다 메모리에 남긴다. core 정상 종료 시 도는 명령을 모두 멈추고(`ended_by: shutdown`), 재시작 뒤에는 유령 `running`을 만들지 않는다.
- 출력에서 ANSI를 벗겨 localhost URL(`http://localhost:<port>`, `127.0.0.1`, `[::1]`, `0.0.0.0` → `localhost`)을 최대 8개까지 감지한다. `preview_url`이 있으면 우선하며, `auto_open_preview`가 켜져 있으면 준비 시 내장 browser 탭을 연다.

### 감지(detect)

- 등록 폴더를 읽기만 하며 어떤 파일도 쓰지 않고 저절로 등록하지 않는다.
- 대상: `package.json`(lockfile로 `pnpm`/`yarn`/`bun`/`npm` 판별), `Makefile`, `justfile`, Claude의 `launch.json`, Codex의 `environment.toml`, `paseo.json`, `t3.json`, `.emdash.json`.
- 지원하지 않는 훅(worktree setup/archive 등)은 건너뛰고 `unsupported_notes`에 알리며, 이미 같은 명령으로 등록된 후보는 `already_registered: true`로 표시한다.

### 판정과 권한

- agent 설정(`project_commands/set_settings` 및 명령의 `agents`·`ask_before_run` 덮어쓰기)은 사람만 쓴다. agent가 넣으면 `forbidden`이다.
- agent 실행 시 명령별 덮어쓰기가 있으면 우선하고 없으면 project 기본값을 따른다: 허용 목록 밖 agent는 `deny`(`forbidden`), `ask_before_run`이 켜진 명령은 GateCall `project_command`로 승인 카드를 거친다(`approval.md`).
- agent 정의 추가·수정·삭제 시 project의 `approve_agent_writes`가 켜져 있으면 GateCall `project_command_definition`으로 변경 전후 이름·원문·cwd·env 키 이름만 담은 승인 카드를 거친다. 대기 중 정의가 바뀌면 쓰지 않는다(`conflict`).
- 알려진 한계: 사람 터미널에서 도는 coding agent는 user token으로 CLI를 부르므로 core가 사람과 구분하지 못한다.

### 원격 실행

- 다른 컴퓨터의 목록·실행·중지·재시작·로그는 `machines/call`로 받는 컴퓨터의 `project_commands/*`를 부르고, `ProjectCommandsChanged`·`ProjectCommandRunChanged`로 상태를 구독한다.
- 받는 컴퓨터는 `run`·`stop`·`restart`·`logs`마다 `remote_grants`의 터미널 입력 허락을 검사해 없으면 `forbidden`으로 거절한다. `list`는 `can_run`으로 허락 여부를 싣고, 화면은 같은 `pri_` 정체성을 가진 온라인 컴퓨터 가운데 `can_run === true`인 컴퓨터만 메뉴에 컴퓨터 이름으로 묶어 보인다.
- agent 자격의 원격 호출(`--on`)은 부르는 컴퓨터가 보내기 전에 `forbidden`으로 막는다.

### 화면 진입점

- 진입점은 네 곳이다: Ctrl+K palette(`Run: <이름>`, 도는 중 `Stop: <이름>`·`Restart: <이름>`), Terminal 빠른 실행 단추 hover의 Commands 묶음, 사이드바 project 줄의 `+` hover 아래 Commands 묶음, 탭 줄 `+` 메뉴의 `Terminal` 하위 메뉴.
- 메뉴 세 곳은 같은 공용 목록 component를 쓰며, 실행 중이거나 실패한 명령은 사이드바에서 project 줄 아래에 agent session과 같은 수준의 개별 줄로 보인다(클릭 시 터미널 열기, hover 시 preview·재시작·중지/지우기 단추).
- 명령마다 터미널 탭은 하나를 재사용하며, `action`이 0이 아닌 코드나 timeout으로 끝나면 "터미널 보기" 행동이 달린 toast를 띄운다. 전용 터미널 탭을 닫을 때 명령이 실행 중이면 확인 후 중지하고, 끝난·실패 상태면 실행 표시(`dismiss`)를 함께 지운다.

## 지키는 것

1. **정의는 lophn ledger에만 두고 프로젝트 폴더에 쓰지 않는다.** `detect`는 읽기 전용이며 자동 등록하지 않는다.
2. **`env` 값은 로컬 사람 설정 편집 외 어디에도 원문으로 노출하지 않는다.** 로그·알림·승인 카드·CLI `list`·agent·원격 응답에서는 키 이름만 보이고, 로그 출력은 정의의 `env` 값과 제품 redactor로 가린다.
3. **실행 직전마다 `folderOfCwd`로 cwd realpath를 검증한다.** 등록 폴더 밖이나 symlink 탈출은 실행하지 않고 `invalid_input`이다.
4. **agent는 자기 실행 범위나 승인 정책을 넓히지 못한다.** `set_settings`와 명령별 `agents`·`ask_before_run` 변경은 agent에게 `forbidden`이다.
5. **명령당 실행은 직렬이며 중복 기동은 `conflict`다.** 중지는 프로세스 트리 전체로 보내고, core 정상 종료 시 도는 명령을 모두 `shutdown`으로 정리한다.
6. **명령 전용 PTY는 일반 터미널 탭 복원 목록과 coding session 목록에 들지 않는다.**
7. **원격 실행은 사람만, 터미널 입력 허락이 켜진 컴퓨터에서만 가능하다.** 허락이 없으면 메뉴에 서지 않고 직접 호출도 `forbidden`이며, agent의 `--on`은 보내기 전에 막는다.
8. **기존 layout v13의 `commands`는 유실 없이 한 번만 옮긴다.** `project_commands/import`가 성공했을 때만 v14로 저장해 지우고, 실패하면 v13 파일을 유지해 다음에 다시 시도한다.

## 경계와 계약

- route:
  - 읽기: `project_commands/list`, `project_commands/detect`, `project_commands/logs`
  - 쓰기(memory): `project_commands/add`, `project_commands/update`, `project_commands/remove`, `project_commands/reorder`, `project_commands/import`, `project_commands/set_settings`, `project_commands/run`, `project_commands/stop`, `project_commands/restart`
  - 내부 writer command: `project_commands/store`(`machine:project-commands`)
- CLI: `lophn command list|run|stop|restart|logs|detect|add|update|remove` (`command`는 `RESERVED_APP_SLUGS`에 포함). agent 설정 쓰기 CLI는 두지 않는다.
- event(남지 않는다): `ProjectCommandsChanged { project }`, `ProjectCommandRunChanged { project, run }` (`REMOTE_ALLOWED_EVENTS` 포함).
- ledger: `project_commands`, `project_command_settings` (schema step `projects.commands`).
- 승인: GateCall `project_command`, `project_command_definition` (`approval.md`).
- 단축키: 동적 id `project-command.<id>.(run|stop|restart)` (`keybindings.md`, 기본 키 없음).
- layout 옮기기: shell main이 v13 파일의 `commands`를 `project_commands/import`(`kind: "action"`, `label` → `name`, 같은 id)로 옮긴 뒤 v14로 저장(`workspace-layout.md`).

## 결정

- 정의는 프로젝트 폴더가 아니라 lophn ledger에 둔다. 이유: 공유 저장소에 개인 도구 파일을 커밋하게 하지 않는 원칙(`project-identity.md`)과 맞추고, CLI·agent·다른 컴퓨터·여러 창이 같은 정본을 보게 한다. 버린 길: 저장소 설정 파일 쓰기, 창 layout에 보관. (사람, 2026-11-24)
- 진입점은 Ctrl+K palette, Terminal 빠른 실행 hover, 사이드바 project `+` hover, 탭 줄 `+` 메뉴 Terminal 하위 메뉴 네 곳과 사이드바 상태 표시로 한정한다. 버린 길: 헤더 실행 단추, 하단 Commands 패널, 탭 우클릭 메뉴. (사람, 2026-11-24)
- 대화형 셸 타이핑 대신 명령 전용 PTY를 쓴다. 이유: 정확한 exit code, 프로세스 트리 단위 중지, 셸 history 무오염, 기존 `terminals/*`·`terminal_view` 화면 사본 재사용을 동시에 얻는다. (agent)
- agent 기본값은 새 project마다 "모든 agent, 바로 실행, 정의 쓰기 승인 켬"이고 명령마다 덮어쓰기를 둔다. agent 설정 칸 자체는 사람만 쓴다. 이유: 기본 편의를 지키면서 agent가 승인 없이 명령을 바꾸거나 자기 권한을 넓히는 공격면을 닫는다. (사람: 정책, agent: locked 분리)
- 원격 실행은 같은 `pri_` 정체성 + 온라인 + 터미널 입력 허락이 있는 컴퓨터에 한해 사람만 한다. 정의는 컴퓨터마다 따로 두고 동기화하지 않는다. 이유: OS·경로·도구가 컴퓨터마다 달라 명령 정의를 옮기면 깨지기 쉽다. (사람, 2026-11-24)
- CLI group 이름은 `command`로 정하고 `RESERVED_APP_SLUGS`에 더한다. 기존 group·앱 slug와 겹치지 않는다. (agent)
