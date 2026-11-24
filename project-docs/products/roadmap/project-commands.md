# project commands: 프로젝트에서 되풀이해 돌리는 명령과 dev server를 lophn이 관리한다

상태: 로드맵. 2026-11-24 사람이 방향을 냈고 조사(`feature-cleanroom` workflow, harness-lab `_report/project-commands/`)를 바탕으로 planner가 정리했다. 제품 결정은 2026-11-24 사람이 내렸다("정한 것"). "(agent)"라고 적은 것은 planner의 기술 결정이다. 구현은 "구현 범위"를 따른다.
배경 문서: `project-docs/architecture/{workspace-layout,terminal-agent,settings,approval,browser-tab,keybindings,project-identity,remote}.md`, `project-docs/products/roadmap/{command-surface,harness-config}.md`, `project-docs/PRODUCT.md`.

## 사람의 말 (원문)

2026-11-24:

> Project Command 기능에 대해서 제대로 구현하고 싶어, 지금은 그냥 빈 껍데기만 있는 거 같아서

design에서 다섯 질문에 (2026-11-24):

> 1. lophn 안에 두기
> 2. Ctrl+K, Terminal Quick 실행에서 호버했을 때 아이템, 프로젝트 + 버튼 호버했을 때, 탭 스트립에서 Terminal 항목에 대한 이중 컨텍스트 메뉴
> 3. 생성, 실행 모두 근데 쓸 수 있는 agent라든가, ask before run, 승인 같은 설정을 미리할 수 있게끔
> 4. 오케이
> 5. 원격으로 실행 가능함, pri로 이제 같은 프로젝트의 신원이 확보된 커맨드들은 근데 이제 돌아가고 있어야하고 터미널 입력이 허락된 머신에 한해서 원격으로 실행 가능하게끔

이어 물은 것: 탭 줄의 "이중 메뉴"는 + 메뉴의 Terminal 옆 목록이다. agent 설정은 project 기본값 + 명령별 덮어쓰기, agent의 정의 쓰기 승인은 기본 켬(끌 수 있음), 새 project 기본값은 "모든 agent, 바로 실행", 도는 명령의 상태와 멈추기는 메뉴 안에서 하고 사이드바에도 표시한다.

## 왜

지금의 Project Command는 "터미널에 한 줄 타이핑해 주는 북마크 20개"다. 누르면 매번 새 터미널 탭이 생기고, 그 명령이 도는지·끝났는지·실패했는지 lophn은 모른다. 멈추기·다시 시작·로그 보기·dev server 프리뷰가 없고, 정의가 창(renderer)의 layout 파일에 있어서 core·CLI·agent·다른 컴퓨터·폰 어디서도 보이지 않는다. lophn은 "사람과 agent가 같은 명령을 쓰는 hub"(`command-surface.md`)인데 이 기능만 창 안에 갇혀 있다.

## 지금 코드 (main `f87c2f0de`)

- 저장: `<data>/shell/workspaces/<workspace>.json`(layout schema v13)의 선택 필드 `commands: {id, label, command}[]`, 최대 20개(`packages/shell/main/workspace/workspace-layout.ts:181-195`). core는 모른다.
- 편집: Project Settings 탭의 `Terminal commands`(이름·명령 2칸, `project-settings/quick-launch-editor.tsx`).
- 실행: New terminal 단추 hover 목록의 `Commands` 묶음 한 곳(`renderer/shell/quick-launch.tsx`). `openTerminalTab(host, {command, docked: true})`로 새 터미널 탭을 열고 `<cmd>\r`(여러 줄은 bracketed paste)를 친다.
- 상태·exit code·중복 방지·stop/restart·로그·포트/프리뷰·palette·단축키·CLI·agent·원격·폰: 모두 없음.

### 이미 있는 기반 (다시 쓴다)

1. core 소유 PTY host와 화면 사본(`terminals/*`, `terminal_view`): 창을 닫아도 살고, 다른 컴퓨터·폰이 보고 친다. 로그인 셸 env(`PersonEnv`)와 등록 폴더 실경로 검사(`packages/core/terminals/cwd.ts`의 `folderOfCwd`)도 core에 있다.
2. 내장 browser 탭(`browser-tab.md`, `tabs/open --url`)과 agent의 `lophn browser`.
3. 설정·승인 체계: `locked`, `approval: "person"` + `describe` 카드(`settings.md`, `approval.md`).
4. 단일 CLI 명령 표(`packages/cli/commands/`): 사람 터미널·coding agent·lophn agent가 같은 명령을 쓴다.
5. Command Palette와 keybinding service(`keybindings.md`): 동적 id 등록·사용자 재지정·충돌 검사.
6. 기기별 터미널 입력 허락(`remote_grants`, `terminal-agent.md`).

## 다른 제품은 (조사 요지)

핵심 6종(Paseo, T3 Code, Codex Desktop, Claude Desktop, Orca, Emdash)이 수렴한 모양:

- 명령은 **일회성 action**(build·test·lint)과 **오래 도는 service**(dev server·watcher)로 갈린다. action은 성공/실패와 빠른 재실행, service는 실행 중 유지·중복 기동 방지·멈추기·포트/프리뷰가 핵심이다.
- **헤더의 원클릭 실행 단추 + 드롭다운**(최근 실행한 것이 주 단추)이 표준 진입점이다. Codex·T3는 단축키·palette도 붙인다.
- 실행은 대화형 셸에 타이핑하는 것보다 **명령 전용 프로세스**가 정확하다(exit code, 프로세스 트리째 멈추기, 셸 history 무오염). Emdash·Claude Desktop이 이 방식이다.
- 끝난 뒤에도 **마지막 로그 꼬리를 남겨** 왜 죽었는지 볼 수 있다(Claude Desktop).
- dev server가 찍은 **localhost URL을 감지해 내장 browser로** 연다(5/6).
- 빈 화면을 **`package.json` 등에서 자동 감지·가져오기**로 채운다(5/6, AI 생성까지 하는 곳도 있다).
- 정의 위치는 갈린다: repo 파일(Paseo·Codex·Claude), 앱 설정 + repo는 가져오기만(T3), repo(팀) + 개인 2층(Orca·Emdash).
- agent 연동은 Claude Desktop·Paseo가 깊다(목록·실행·중지·로그를 agent tool로). 정의 쓰기는 실행과 권한을 나눈다(T3 scope 분리, Claude 승인).

## 표준을 그대로 가져올 수 없는 곳

1. **worktree 훅은 들이지 않는다.** 다른 제품의 setup/teardown/settle 훅은 worktree 수명에 붙는데 lophn은 worktree를 만들지 않는다(`project-identity.md`). lophn의 Project Command는 project 폴더 위의 action과 service가 중심이다.
2. **repo에 파일을 쓰는 것은 lophn 원칙과 부딪힌다.** 2026-11-21에 `.lophn-project.json`을 지우며 "public·공유 저장소에 개인 도구 파일을 커밋하게 하지 않는다"고 정했다(`project-identity.md`). 그래서 정의는 lophn 안에만 둔다(정한 것 1).
3. **정의가 창(layout) 소유라 core로 올려야 한다.** 그래야 CLI·agent·다른 컴퓨터·폰과 맞물린다.
4. **project는 폴더가 여럿이고 컴퓨터마다 경로·OS가 다르다.** 명령은 기준 폴더와 상대 cwd를 갖고, 다른 컴퓨터에서 치는 것은 기기별 터미널 입력 허락을 따른다.
5. **agent가 명령을 몰래 바꾸는 공격면.** `shell.coding_agents` 실행 명령어를 `locked`로 막은 이유(사람이 누를 때 agent가 적은 명령이 사람 터미널에서 돈다)가 Project Command에도 그대로다.

## 정한 것

### 제품 (사람)

1. **정의는 lophn 안에만 둔다.** 프로젝트 폴더(저장소)에 lophn 파일을 쓰지 않는다. 빈 목록은 프로젝트 폴더의 `package.json`·`Makefile`·`justfile`과 다른 도구 설정 파일에서 후보를 찾아 사람이 골라 가져오기로 채운다. (사람, 2026-11-24)
2. **진입점은 네 곳이다.** (사람, 2026-11-24)
   - Ctrl+K palette: 지금 project의 명령마다 `Run: <이름>`, 도는 명령은 `Stop: <이름>`·`Restart: <이름>`.
   - Terminal 빠른 실행 단추 hover 목록의 Commands 묶음(지금 있는 자리).
   - 사이드바 project 줄의 + hover 목록: agent 목록 아래에 그 project의 Commands 묶음.
   - 탭 줄 + 메뉴: Terminal 항목에 pointer를 올리면 옆에 명령 목록이 펼쳐진다(Agent·Browser처럼). (사람, 2026-11-24: "이중 컨텍스트 메뉴"는 이것)
   - 헤더 실행 단추와 하단 패널은 만들지 않는다.
3. **도는 명령의 상태와 제어는 그 메뉴들 안에서 한다.** 각 명령 줄에 상태(도는 중, 실패와 exit code)가 보이고, 도는 명령은 멈추기·다시 시작·터미널 보기·(URL이 있으면) 프리뷰 열기를 한다. 사이드바 project 줄에도 도는 명령이 있다는 표시(점과 수, 실패가 있으면 그 색)를 둔다. (사람, 2026-11-24)
4. **agent는 명령을 만들고 고치고 실행할 수 있다.** 단, 사람이 미리 정한 설정을 따른다. (사람, 2026-11-24)
   - 설정은 project 기본값 + 명령마다 덮어쓰기다: 쓸 수 있는 agent(모든 agent 또는 고른 agent), 실행 전에 사람에게 묻기(ask before run). (사람, 2026-11-24)
   - 새 project의 기본값은 "모든 agent, 바로 실행"이다. (사람, 2026-11-24)
   - agent가 명령을 만들거나 고치거나 지우면 기본으로 사람의 승인 카드(명령 원문)를 거친다. project 설정에서 끌 수 있다. (사람, 2026-11-24)
5. **자동 실행은 없다.** 프로젝트를 열 때 저절로 도는 명령을 두지 않는다. 늘 사람이 누르거나 CLI·agent가 부른다. (사람, 2026-11-24)
6. **정의는 컴퓨터마다 따로 둔다. 다른 컴퓨터의 명령은 원격으로 실행한다.** 같은 project(`pri_`로 묶인 project)가 다른 컴퓨터에 있고, 그 컴퓨터가 켜져 연결돼 있고, 그 컴퓨터가 이 컴퓨터에 터미널 입력을 허락했을 때만 그 컴퓨터의 명령을 보고 실행·멈추기·다시 시작한다. 정의는 옮기지 않는다. (사람, 2026-11-24)
7. **이번에 다른 컴퓨터의 명령을 원격 실행하는 것은 사람만이다.** agent는 자기가 일하는 컴퓨터의 명령만 실행한다. (사람, 2026-11-24)

### 기술 (agent)

1. **정의와 실행 상태는 core가 갖는다.** 정의는 ledger에 project(`prj_`)마다, 실행(`ProjectCommandRun`)은 core 메모리 표다. CLI·agent·다른 컴퓨터·여러 창이 한 곳을 본다. layout(renderer 소유)의 `commands`는 없앤다. (agent: `shell-as-client`, `terminal-agent.md`와 같은 방향)
2. **명령 전용 PTY.** 대화형 셸에 치지 않고 core PTY host에서 `<shell> -lc "<command>"`(sh·dash는 `-c`, Windows는 pwsh/powershell `-NoLogo -Command`, 없으면 `cmd.exe /d /s /c`)로 띄운다. 정확한 exit code, 셸 history 무오염, 터미널 화면 사본(다른 컴퓨터·폰) 재사용. 명령마다 터미널 하나를 다시 쓰고 누를 때마다 탭을 늘리지 않는다. (agent: spec 3.3.2)
3. **kind는 `action`(끝나는 것)과 `service`(오래 도는 것) 둘이다.** 도는 명령을 다시 실행하면 `conflict`, 다시 시작은 `restart`로 한다. (agent: spec 3.1)
4. **멈추기는 프로세스 트리째**(POSIX 그룹 SIGTERM → 3초 → SIGKILL, Windows `taskkill /T /F`). 멈춘 것은 `stopped`이지 `failed`가 아니다. core가 정상 종료하면 도는 명령을 모두 멈춘다(`ended_by: shutdown`). 창을 닫아도 core가 살면 계속 돈다. (agent: spec 3.3)
5. **끝난 뒤 마지막 실행 결과와 출력 꼬리(200줄/32 KiB)를 명령마다 메모리에 남긴다.** core 재시작 뒤에는 남지 않는다(유령 running을 만들지 않는다). (agent)
6. **URL 감지 → 내장 browser 탭.** PTY 출력에서 localhost URL을 찾고, 정의의 `preview_url`이 먼저다. `auto_open_preview`는 정의 칸(기본 꺼짐). 포트 할당·역프록시·커널 포트 스캔은 하지 않는다: lophn은 같은 저장소의 worktree 여럿을 띄우지 않는다. (agent: spec 3.4)
7. **agent 설정(쓸 수 있는 agent, ask before run, 정의 쓰기 승인)은 사람만 쓴다.** agent가 정의를 고칠 때 이 칸을 넣으면 `forbidden`이다. 승인을 꺼 둔 project에서도 agent가 자기 권한을 넓히지 못하게 하려는 것이다. (agent: `settings.md`의 "agent 범위를 정하는 설정은 locked")
8. **ask before run은 승인 판정에 새 GateCall 종류 `project_command`로 들어간다.** shell 규칙 `ask`와 같은 길이다: attended와 skip이면 카드(`once | reject`, `always` 없음), 팀 자식은 부모에게, unattended는 `deny no_person`. 쓸 수 없는 agent는 `deny`. 카드는 명령 이름, 원문, cwd, env key 이름만(값은 보이지 않는다). (agent: `approval.md`의 shell 규칙과 같은 판정 모양)
9. **정의 쓰기 승인은 같은 카드 길을 쓴다**(GateCall `project_command_definition`, 바뀌기 전과 뒤의 이름·원문·cwd·env key). 묻지 못하는 agent(unattended, 팀 자식)의 정의 쓰기는 승인이 켜져 있으면 `needs_approval`로 거절하고 쓰지 않는다. 기다리는 사이 정의가 바뀌면 쓰지 않는다. (agent: `approval.md`의 "사람의 허락이 드는 설정"과 같은 원칙)
10. **알려진 한계: 사람의 터미널에서 도는 coding agent는 user token으로 CLI를 부르므로 core에게 사람이다.** "쓸 수 있는 agent"와 ask before run은 lophn agent(harness runtime의 lophn agent 포함, turn 자격)에만 걸린다. `settings.md`의 같은 한계와 같다. agent가 `shell.run`으로 같은 명령을 직접 치는 것은 shell 규칙이 다룬다. (agent)
11. **원격.** 다른 컴퓨터의 목록·상태는 그 컴퓨터의 `project_commands/*` route를 `machines/call`로 읽는다(기기 route 목록에 넣는다). 실행·멈추기·다시 시작·로그는 받는 컴퓨터가 `remote_grants`의 터미널 입력 허락을 보고, 없으면 `forbidden`이다. agent 자격의 원격 호출(`--on`)은 부르는 컴퓨터가 보내기 전에 `forbidden`으로 막는다(정한 것 7). 화면은 같은 `pri_`의 project가 있는 컴퓨터 가운데 연결돼 있고 허락이 있는 컴퓨터만 메뉴에 컴퓨터 이름으로 묶어 보인다. (agent: `remote.md`, `app-call.md`의 `machines/call` 원칙)
12. **기존 layout `commands`는 한 번 옮긴다.** shell main이 layout을 읽다가 `commands`가 있으면 core에 사람 자격으로 가져오기를 부르고(`kind: action`, `label`→`name`, 같은 id), 성공하면 layout schema v14로 그 칸을 지운다. 실패하면 layout을 그대로 두고 다음에 다시 한다. (agent)

## 구현 범위

구현자는 이 파일과 `../harness-lab/_report/project-commands/spec.md`만 읽는다. 다른 제품의 source와 harness-lab의 다른 파일은 열지 않는다. 데이터 모양·상태 기계·검증·환경변수·멈추기·로그 보존·URL 감지·감지 소스는 spec 3절을 따르고, 이 파일이 spec과 다르면 이 파일이 이긴다.

### 만드는 것

1. **core 정의 저장과 명령**
   - ledger에 project마다 정의 목록(spec 3.2의 `ProjectCommand`, project당 50개)과 project의 agent 설정(`agents: "all" | <agent id>[]`, `ask_before_run: boolean`, `approve_agent_writes: boolean`; 기본 all/false/true), 명령마다 덮어쓰기(`agents?`, `ask_before_run?`)를 둔다.
   - core command: 목록, 더하기·고치기·지우기·순서, 가져오기(여러 개 한 번에), agent 설정 쓰기(사람만). 바뀌면 event(`ProjectCommandsChanged`).
   - `detect`: 등록 폴더를 읽기만 해서 후보를 돌려준다(spec 3.5, `unsupported_notes` 포함). 저절로 등록하지 않는다.
2. **core 실행 runtime**
   - spec 3.3의 상태 기계, 전용 PTY, 환경변수(PersonEnv 위에 `COLORTERM`·`FORCE_COLOR=1`, `PROJECT_ROOT`·`PROJECT_CWD`·`COMMAND_ID`·`COMMAND_NAME`, 정의의 `env`), `folderOfCwd`로 매번 cwd 실경로 검사, stop·restart(명령마다 직렬), `action`의 `timeout_ms`, 실행 중 링버퍼와 끝난 뒤 꼬리 보존, URL 감지, shutdown 때 모두 멈추기.
   - 상태가 바뀌면 event(`ProjectCommandRunChanged`). 실행의 터미널은 기존 `terminals/*`·`terminal_view`로 보이고, 일반 터미널 탭 복원 목록에는 들지 않는다.
3. **판정**
   - `approval.md`의 판정에 GateCall `project_command`(실행)와 `project_command_definition`(정의 쓰기)를 더한다(기술 결정 8·9). 쓸 수 있는 agent가 아니면 `deny`.
4. **CLI 명령 표** (사람 터미널, coding agent, lophn agent가 같이 쓴다)
   - group `command`(이미 있는 group·앱 slug와 겹치면 구현자가 겹치지 않는 이름을 고르고 이 파일에 적는다): `list`, `run <id|이름> [--wait]`, `stop <id|이름|--all>`, `restart`, `logs [--lines N]`, `detect`, `add`, `update`, `remove`. 다른 컴퓨터는 `--on <컴퓨터>`(사람만).
   - agent 설정 쓰기는 CLI 명령으로 두지 않는다(사람만 하는 일, `command-surface.md`). Project settings 화면만 쓴다.
   - `list`·`logs`의 출력에서 env 값은 보이지 않는다.
5. **화면 (shell renderer)**
   - Project settings › Commands: 지금의 `Terminal commands` 칸을 바꾼다. 이름, 명령(여러 줄), kind, icon, 기준 폴더와 cwd, env(key-value), `preview_url`·`auto_open_preview`, `timeout_ms`(action), 순서, 지우기, 명령마다 agent 덮어쓰기. 위에 project의 agent 설정 셋. 빈 목록이면 "Detect from project"와 "Add command"를 나란히 두고, 감지 결과는 원문을 보이고 골라 가져온다(이미 있는 것은 빼 둔다).
   - 진입점 네 곳(정한 것 2)이 같은 목록 component를 쓴다: 줄마다 icon, 이름, 상태(도는 중, 실패와 exit code), URL 칩, 도는 명령의 멈추기·다시 시작·터미널 보기·프리뷰 열기. 둘 이상 돌면 "Stop all". 맨 아래 "Manage commands…".
   - 다른 컴퓨터의 명령(기술 결정 11)은 같은 목록에 컴퓨터 이름 묶음으로 선다.
   - palette: 명령마다 동적 command `project-command.<id>.run`(그리고 도는 동안 stop·restart)을 등록한다. 기본 단축키는 없고, Settings › Keyboard에서 바인딩할 수 있다(`keybindings.md`의 동적 id).
   - 사이드바 project 줄: 도는 명령 수 점, 실패가 있으면 그 색. 누르면 같은 목록.
   - action이 0이 아닌 코드로 끝나면 toast에 "터미널 보기"를 단다.
6. **옮기기**: 기술 결정 12. layout schema v14.
7. **원격 route**: `project_commands/*`를 기기 route 목록에 넣고, 실행 쪽 route는 받는 컴퓨터가 터미널 입력 허락을 본다.

### 만들지 않는 것

- 저장소 파일 쓰기와 "저장소로 내보내기", repo 파일 직접 실행과 content-hash 신뢰 게이트.
- 자동 실행(프로젝트 열기·core 시작), worktree·archive 훅.
- 헤더 실행 단추, 하단 Commands 패널, 탭 우클릭 메뉴.
- 포트 할당, `*.localhost` 역프록시, 커널 포트 스캔.
- 컴퓨터 사이 정의 동기화, OS별 명령 분기.
- agent의 원격 실행.
- AI로 명령 만들기 버튼(agent는 CLI로 만들면 된다), 실패 자동 고치기.
- 폰 화면(route는 기기 목록에 있으나 폰 UI는 이번에 그리지 않는다).

### 바뀌는 architecture 문서

- 새 `project-docs/architecture/project-command.md`: 모델, 상태 기계, 판정, 원격, 지키는 것, 경계와 계약, 결정.
- `workspace-layout.md`: layout `commands` 삭제와 v14, Terminal hover·+ hover·탭 줄 + 메뉴의 Commands, 사이드바 표시.
- `terminal-agent.md`: 명령 전용 PTY와 탭 복원 제외.
- `approval.md`: GateCall `project_command`, `project_command_definition`.
- `keybindings.md`: `project-command.<id>.*` 동적 id.
- `remote.md`: 기기 route 목록과 터미널 입력 허락이 거는 route.
- change-log 항목.

### 나누기

단일 줄(`feat/project-commands`, Antigravity TUI handoff, 사람 요청, 2026-11-24). CLI group 이름은 `command`로 정한다(기존 group·앱 slug와 겹치지 않는다; `RESERVED_APP_SLUGS`에 더한다). 순서는 다음과 같다.

1. (a) `packages/protocol` 계약: `ProjectCommand`·`ProjectCommandRun`·agent 설정·detect type, `project_commands/*` route schema, `ProjectCommandsChanged`·`ProjectCommandRunChanged` event, GateCall `project_command`·`project_command_definition`, CLI group 이름(`command`, `RESERVED_APP_SLUGS`).
2. (b) `packages/core` + `packages/cli`: ledger 저장 step, 정의 command·agent 설정·승인, detect, 명령 전용 PTY runtime·로그·URL 감지·shutdown, gate 판정, 기기 route와 터미널 입력 허락, CLI `lophn command *`.
3. (c) `packages/shell`: Project settings › Commands, 네 진입점의 공용 목록(다른 컴퓨터 묶음 포함), palette 동적 command와 단축키 id, 사이드바 표시, 실패 toast, layout v14 옮기기.
4. (d) 로드맵의 architecture 문서(`project-command.md`, `workspace-layout.md`, `terminal-agent.md`, `approval.md`, `keybindings.md`, `remote.md`), `project-docs/flows/`, change-log 항목.

### 끝나면

- 기존에 등록한 명령이 그대로 Commands에 있고 layout 파일에 `commands`가 없다.
- `package.json`이 있는 project에서 Detect로 후보를 보고 골라 가져온다.
- service(예: `npm run dev`)를 네 진입점 어디서든 띄우고, 상태가 모든 진입점과 사이드바에 같이 보이고, 멈추면 자식 프로세스까지 사라지고, 감지한 URL을 browser 탭으로 연다. 같은 것을 다시 눌러도 탭이 늘지 않는다.
- action이 실패하면 exit code와 끝난 뒤 로그를 UI와 `lophn command logs`로 본다.
- lophn agent가 `lophn command run`으로 실행하고, ask before run을 켠 명령은 카드가 뜨고, 쓸 수 없는 agent는 거절된다. agent의 정의 쓰기는 기본으로 카드가 뜨고 끄면 바로 쓴다. agent가 agent 설정 칸을 바꾸려 하면 거절된다.
- 다른 컴퓨터(같은 `pri_`, 연결됨, 터미널 입력 허락)의 명령이 메뉴에 그 컴퓨터 이름으로 서고 실행·멈추기가 된다. 허락이 없으면 서지 않고, CLI `--on`은 `forbidden`이다. agent의 `--on`은 `forbidden`이다.
- `npm run check`가 통과한다.

## 조사 문서

- `../harness-lab/_report/project-commands/README.md`: 범위, 판정 표, 업계 표준과 갈리는 축
- `../harness-lab/_report/project-commands/lophn.md`: 지금 lophn과의 대조, "lophn에 들일 때"
- `../harness-lab/_report/project-commands/spec.md`: clean-room 명세(구현자가 읽는 유일한 조사 문서)
