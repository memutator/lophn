# settings

lophn의 설정을 한 번 선언하면 Settings 화면, `lophn settings` 명령, home의 lophn agent가 같이 읽고 바꾸게 하는 메커니즘이다. 사람이 "글자 좀 키워 줘", "이런 색 theme 만들어서 적용해 줘"라고 말하면 agent가 설정을 바꾸고, 켜져 있는 창이 바로 따라 바뀐다. 터미널에서 명령으로 바꿔도 같다. 설정 하나를 더하는 일은 선언 하나와 그 값을 화면에 적용하는 한 곳이다.

## 문제

설정을 바꿀 수 있는 곳이 Settings 화면 하나였다. 값은 core에 저장됐지만 값이 맞는지 아는 규칙(있는 theme인가, 읽을 수 있는 단축키인가)은 shell에만 있었고, 값을 화면에 적용하는 길은 그 화면이 값을 직접 밀어 넣는 것이었다. 그래서 밖에서 설정을 바꾸면 틀려도 조용히 넘어가고, 켜진 창도 따라 바뀌지 않았다. theme file은 core를 거치지 않고 shell이 읽었다.

이 구조에서 agent가 설정을 바꾸게 하려면 설정 묶음마다 명령과 지침을 따로 지어야 한다. 설정이 늘 때마다 같은 일을 되풀이하게 되고, 화면과 명령이 다른 규칙으로 갈라진다.

## 목표와 비목표

- 목표: 설정의 값, 값이 맞는지 아는 규칙, 바꾸는 길이 core에 하나씩 있다. Settings 화면, 명령, agent가 같은 길을 쓴다.
- 목표: 틀린 값은 바꾼 쪽이 그 자리에서 이유를 받는다.
- 목표: 켜진 shell은 누가 바꿨든 설정을 따라 적용한다.
- 목표: 설정을 더해도 명령, route, agent 지침이 늘지 않는다.
- 비목표: 화면 동작(탭 열기, desk 배치)을 설정처럼 다루는 것. 그것은 값이 아니고 따로 명령이 있다.
- 비목표: agent가 자기 할 수 있는 일의 범위를 정하는 설정을 바꾸는 것. secret과 provider 연결.
- 비목표: 설정 변경을 rewind에 넣는 것. 바꾸는 명령이 바꾸기 전 값을 돌려준다.
- 비목표: 손으로 지은 Settings 화면을 선언에서 만드는 화면으로 바꾸는 것.

## 모델

설정은 선언이다. 선언 하나가 key, 값의 모양, 기본값, 설명(영어), 뜻 검사, 사람만 바꾸는지(locked)나 agent가 바꿀 때 사람의 허락이 드는지(`approval: "person"`와 바뀜을 쓰는 `describe`)를 갖는다.

```
선언 (key, 모양, 기본값, 설명, 뜻 검사, locked | approval+describe)
   │
   ▼
core ── 저장: <data root>/settings.json  (사람이 고른 값만)
   │        <data root>/<folder>/<id>.json  (항목마다 file 하나인 설정 묶음)
   │   읽기: settings/list   쓰기: settings/update   알림: StateChanged(settings, id = key)
   │
   ├── Settings 화면 ─┐
   ├── lophn settings get|set|unset ─┤ 같은 route
   └── home의 lophn agent (같은 명령) ─┘
   │
   ▼
shell ── core 설정의 사본을 두고 settings 변경마다 다시 읽어 화면에 적용한다
```

- **값과 검사.** 값의 모양(type, 범위, 고를 수 있는 값)과 뜻(있는 theme인가, 그 모드의 theme인가, 읽을 수 있는 단축키인가, 글꼴 이름으로 쓸 수 있는 글자인가)을 core가 본다. 뜻 검사는 이번 변경을 모두 얹은 뒤의 값을 본다. 그래서 theme을 만들고 그 theme을 고르는 것을 한 번에 보낼 수 있다. 뜻 검사는 바꿀 때만 돈다. 손으로 고친 file을 읽을 때는 모양만 보고, 뜻이 틀린 값(지운 theme의 id)은 shell이 기본값으로 그린다.
- **거절과 알림.** 하나라도 거절이면 아무것도 쓰지 않는다. 거절은 이유(영어 문장)를 싣는다. 쓰되 알릴 것(theme의 버린 색, 모자란 대비)은 notes로 돌려준다.
- **항목마다 file 하나인 설정 묶음.** 색 theme이 이것이다. 항목의 key는 `<묶음 key>.<id>`(`shell.themes.<id>`)이고 file은 `<data root>/themes/<id>.json`이다. 같은 route와 같은 명령으로 쓰고 지운다. 사람이 그 folder에 file을 직접 두어도 같은 항목이다. core가 folder를 만들고 지켜본다. 읽지 못한 file(이름이 id 규칙에 안 맞음, 256 KB 초과, JSON 아님, 모양 틀림)은 항목이 되지 않고 이유와 함께 목록에 남는다.
- **규칙의 자리.** 설정의 뜻을 아는 규칙은 core와 shell이 같이 쓰는 곳에 하나만 있다. 모양(theme, 글꼴 이름, 고를 수 있는 값)은 design의 순수 계산이고 단축키 표와 문법은 protocol이다. shell은 CSS를 만들 때 같은 규칙으로 한 번 더 본다(`appearance.md`의 지키는 것 3).
- **사람의 허락이 드는 설정.** `approval: "person"`인 선언은 `describe(before, after) → string[]`(바뀜을 사람의 말로 쓴 영어 줄. 값이 다르면 빈 목록이 아니다)이 있어야 하고 locked와 같이 둘 수 없다(core가 시작할 때 거절한다). 사람 자격은 그대로 바꾼다. agent가 그런 key를 바꾸거나 지우면 route가 값을 먼저 검사한 뒤 그 줄로 승인 카드를 열어 사람에게 묻고, 사람이 허락한 그 값 한 번만 쓴다(`approval.md`의 "사람의 허락이 드는 설정"). 지금은 sync 폴더 `folder.destinations`(`folder-sync.md`) 하나다.
- **명령.** `lophn settings get [key]`는 목록(값과 한 줄 설명)이나 설정 하나(설명 전체, 값, 기본값, JSON Schema)를 보인다. `settings set <key> <value>`와 `settings unset <key>`가 바꾼다. 설정마다 명령을 두지 않는다. 답은 바꾸기 전 값(`previous`)을 싣는다.
- **shell의 사본.** shell main은 core가 붙으면 설정 전체를 읽고, `settings` 변경(`StateChanged`)이 오거나 다시 붙으면 다시 읽는다. 설정을 적용하는 곳(모양 CSS, main이 먼저 받는 단축키)은 이 사본을 듣는다. 창은 같은 event로 자기가 그리는 설정(모드, 단축키, 빠른 실행, 읽기 폭, 열려 있는 Settings 화면)을 다시 읽는다. 값을 창에서 main으로 보내는 통로는 없다.
- **shell이 꺼져 있을 때.** 값은 저장되고 다음에 켤 때 적용된다. 설정을 바꾸려고 shell을 띄우지 않는다.
- **My computers (통합 Remote + Sync).** 이 컴퓨터의 Settings › My computers에 Hub 스위치(`remote.hub`, `locked: true` 사람 전용), `remote.port`, `remote.relay`, 터미널 OSC 52 스위치(`shell.terminal.osc52_clipboard`, 기본 `true`), 내 기기 명단의 기기 줄(이름, 종류와 OS, 설치된 lophn 버전, Hub 배지, "지금 바로" / "켜지면 도착" 상태 배지, 이 컴퓨터 제어 허락 스위치 "Allow controlling this computer", [Rename], [Remove], 엇갈림으로 빠진 기기의 "Disputed"), 초대장, [Join with an invite], 앱별 동기화 정책 덮어쓰기(`sync.app_policies`), 수신·송신 파일(`transfers/*`), 대기 중인 설정·workflow(`settings_export/*`)가 한곳에 모인다(`multi-computer.md`, `remote.md`, `folder-sync.md`).
- **5종 설정·workflow 내보내기(`settings_export/*`).** `agent`, `skill`, `project_command`, `permission_rules`, `workflow`는 자동 동기화하지 않고 `settings_export/send`로 대상 컴퓨터(오프라인이면 Hub 경유 보관)에 `stg_` 배치로 보낸다. 받는 쪽은 `<data root>/staged-settings/`에 `pending`으로 두고 사람 검토 후 `settings_export/apply`(사람 자격 전용)로 적용한다. `permission_rules`나 `locked_fields`가 포함된 항목은 `confirm_permissions: true` 사람 확인 없이는 적용하지 않는다.
- **다른 기계의 Settings.** Settings 왼쪽 목록 맨 위의 기계 고르기(다른 컴퓨터가 명단에 있을 때만 선다)가 이 컴퓨터나 연결된 다른 컴퓨터를 고른다. 다른 기계를 고르면 그 기계의 core에 걸린 항목(General, Remote, Providers, Agents, Tools and skills, Coding agents, Permissions, Diagnostics)만 서고 나머지 항목(이 컴퓨터의 shell main이나 OS에 붙은 것)은 이 컴퓨터의 설정이라는 한 줄과 이 컴퓨터로 돌아가는 단추다. 읽고 쓰는 것은 그 기계의 `settings/*` 같은 route이고 받는 기계가 이 컴퓨터를 기기로 보므로, 그 기계가 이 컴퓨터에 터미널 입력을 허락했을 때만 열린다(항목을 열 때마다 묻고, 허락이 없으면 본문 자리에 까닭과 그 기계의 Settings › Remote › My devices에서 켜라는 한 줄이다). Remote는 그 기계의 Keep running(`always_on/status|set`)과 Hub 스위치(`remote.hub`)만 그리고 연결 켜기·port·relay와 기기·pairing·터미널 입력 허락은 이 컴퓨터의 것이라 그리지 않는다(받는 기계가 사람 route로 연다. `approval.md`). 기기 자격의 `settings/update`는 `remote.*` 가운데 `remote.hub`만 바꾼다. 화면 없는 기계(VPS)는 가서 켤 곳이 없고, Hub를 켜고 꺼도 붙어 있는 기기가 끊기지 않는다. 나머지 `remote.*`는 `forbidden`이다(기기가 연결을 끄면 모든 기기가 끊기고 relay를 바꾸면 알림이 다른 곳으로 간다). provider key와 secret은 보호 secret 창이 그 기계의 link로만 보낸다. 빠른 실행 값은 이 컴퓨터의 것이라 다른 기계는 기본값을 메모리에만 둔다.

- **권한 체계 설정(`approvals.*`, 모두 `locked: true`, 사람만 쓰기).** 권한 규칙과 신뢰 목록은 저장소(project 폴더)에 두지 않고 core 소유 `<data root>/settings.json`에만 둔다(`approval.md`, `extension.md`, `workflow.md`).
  - `approvals.permission_rules`: 전역·project 통합 권한 규칙(`{ global, projects }`, 항목은 `{ id, category, pattern, action, reason?, source }`, `category`는 `shell | file | app_tool | mcp_tool | local_tool`). Settings › Permissions와 승인 카드의 `always`가 쓴다. 옛 `approvals.shell_rules`는 기동 시 data step `approvals.permission-rules-migrate`가 `category: "shell"` 규칙으로 보존 이전하고 옛 key를 지운다.
  - `approvals.default_mode`: agent 정의에 `permission_mode`가 없을 때 새 session이 따르는 전역 기본 권한 단계(`read_only | ask | workspace | full`, 초기 기본값 `workspace`). Settings › General에서 사람이 고른다.
  - `approvals.workflow_modes`: project·workflow·participant별 기억된 권한 단계(`workflow.yaml` 등 agent가 쓸 수 있는 파일이 아니라 data root 설정에만 둔다). StartBox의 "이 workflow 기본으로 기억"이 쓴다.
  - `approvals.local_tool_trust`: 로컬 tool 스크립트의 신뢰 목록(`(realpath, sha256, trusted_at)`). 승인 카드 `once`나 desktop `/permissions`의 신뢰 버튼이 쓴다.

## 지키는 것

1. 설정을 바꾸는 길은 `settings/update` 하나다. Settings 화면, 명령, agent가 같은 route를 부르고 같은 검사를 지난다.
2. 하나라도 거절이면 아무 file도 바뀌지 않는다. 거절과 오류에 입력한 값을 싣지 않는다.
3. locked인 설정은 사람이 Settings 화면에서만 바꾼다. agent가 보낸 변경에 locked인 key가 하나라도 있으면 route가 전체를 거절한다. `lophn settings set`은 누가 부르든 locked인 key를 거절한다. locked인 것은 agent가 할 수 있는 일의 범위를 정하거나 사람의 터미널에서 도는 명령을 담은 설정이다: 권한 규칙·기본 권한 단계·workflow 기억 권한 단계·로컬 tool 신뢰 목록(`approvals.permission_rules`, `approvals.default_mode`, `approvals.workflow_modes`, `approvals.local_tool_trust`), managed worktree 기본 루트(`projects.worktrees_folder`, 기본 `<data root>/worktrees`, 홈·상위·파일시스템 루트·project 저장소 내부 금지, `worktree.md`), call 정책, 팀 한도, turn 한도, MCP server, skill folder와 끈 skill, coding agent에게 준 앱, extension 켜기, coding agent 즐겨찾기와 실행 명령어, browser profile과 저장 login을 다른 컴퓨터와 나누기(`shell.browser.share_with_computers`. 사람의 login 값이 기계를 떠나는지 정한다. profile 목록 자체는 설정이 아니라 사람만 쓰는 route의 vault다).
4. `approval: "person"`인 설정은 agent가 사람의 그 한 번의 허락 없이 바꾸지 못한다. 묻지 못하는 agent(unattended turn, 팀 자식, lophn agent turn 밖의 harness)의 바꾸기는 `needs_approval`로 거절되고 아무것도 쓰지 않는다. 기다리는 사이 그 설정이 바뀌어 바뀜이 사람이 본 줄과 다르면 쓰지 않는다.
5. 설정을 쓰는 명령은 home workspace의 agent에게만 있다(home의 lophn과 그 밖의 home agent, workspace 없이 도는 harness session). project와 app workspace의 agent는 credential 상한에 `settings/update`가 없다.
6. 항목 file을 쓰고 지우는 것은 그 항목의 file 하나만이다. 사람이 둔 다른 file과 읽지 못한 file은 고치거나 지우지 않는다. 쓰려는 id의 file이 이미 있는데 읽지 못했거나(JSON이 깨졌다 등) 대소문자만 다른 이름의 file이 있으면 거절한다. folder를 읽지 못하면 쓰지 않는다. 쓰기는 임시 file에 쓰고 rename한다.
7. 한 번의 변경에서 쓰는 순서는 항목 쓰기, `settings.json`, 항목 지우기다. 중간에 file을 쓰지 못해 멈춰도 `settings.json`이 없는 항목을 가리키지 않는다. 거절은 아무것도 쓰지 않지만 file 쓰기 실패는 그 앞에 쓴 것이 남는다.
8. 켜진 shell은 `settings` 변경으로만 설정을 따른다. 누가 바꿨는지 가리지 않는다. Settings 화면이 바꾼 값도 같은 길로 적용된다.
9. 설정의 뜻을 아는 규칙은 한 곳에 있고 core와 shell이 같은 것을 쓴다.
10. 선언에는 설명이 있어야 한다. 설명이 없는 선언은 core가 시작할 때 거절한다. agent는 설명으로 설정을 찾는다.

## 경계와 계약

- route `settings/list`(user, agent, app, machine): `settings`(key, description, locked, type, default, chosen)와 `folders`(key, description, folder, type, entries, unreadable). `keys`를 주면 그 key의 것만 온다.
- route `settings/update`(user, agent): `changes`(set, unset). 답은 `changed`, `rejected`(key, reason, message), `notes`(key, message)다. reason은 `unknown_key`, `wrong_type`, `out_of_range`, `invalid_value`, `locked`, `needs_approval`(agent가 사람의 허락이 드는 설정을 바꾸려 했는데 허락받지 못했다. message가 까닭과 사람이 쓴 이유를 싣는다)이다. rejected가 비어 있지 않으면 아무것도 쓰지 않은 것이다. agent의 호출은 승인을 물을 그 tool call(`tool_call`)을 싣는다.
- event `StateChanged`의 `settings`: id가 값이 달라진 key다(key마다 하나, null이면 모든 key). 항목은 `<묶음 key>.<id>`이고, 읽지 못한 file 목록만 달라지면 묶음 key다. core가 쓴 것과 손으로 고친 file을 같이 알린다.
- 명령 `settings.get`(모든 workspace), `settings.set`·`settings.unset`(home). 오류 code는 `not_found`(없는 key), `forbidden`(locked, `needs_approval`), `invalid_input`(거절된 값, JSON이 아닌 값), `unavailable`이다.
- 저장: `<data root>/settings.json`(key 전체 이름을 쓰는 평평한 object, 사람이 고른 값만), `<data root>/themes/<id>.json`(theme 하나. 모양은 `appearance.md`).
- 설정 묶음: `shell.themes`(folder `themes`). 항목 id는 소문자·숫자·`-`로 1~64자다.
- boundary-catalog의 `config`, `shell`, `design-api`, `coding-agent-cli-interface`에 걸친다.

## 결정

- 설정을 쓰는 명령은 `settings set`·`unset` 하나로 둔다. 이유: 설정이 늘 때마다 명령과 지침을 더하지 않으려는 것이다. 버린 안: 묶음마다 명령(`theme set` 등). (사람, 2026-11-11: "하나 추가할 때마다 하나 추가하고 그런 게 아니라")
- agent는 설정을 묻지 않고 바로 바꾼다. 이유: 사람의 요청에서 시작하는 일이고 되돌리기 쉽고 위험이 낮다. (사람, 2026-11-11)
- 사람의 터미널에서 도는 명령을 담은 설정도 locked다(`shell.coding_agents`의 실행 명령어). 이유: agent가 그 글을 바꾸면 사람이 coding agent를 열 때 agent가 적은 명령이 돈다. review에서 찾았다. (agent, 2026-11-11)
- 화면 동작은 이 메커니즘에 넣지 않는다. 이유: 꼭 필요한 것은 이미 명령으로 있다. (사람, 2026-11-11)
- theme file도 설정이다(항목마다 file 하나인 묶음). 이유: theme을 위한 route, 명령, event, 지켜보기를 따로 두지 않는다. 버린 안: home agent에게 `themes/` 쓰기 권한을 주기(검사 결과가 agent에게 돌아오지 않는다). (agent, 2026-11-11)
- agent 범위를 정하는 설정은 선언의 locked로 막는다. 이유: CLI binary는 사람의 자격(user token)을 쓰므로 actor로는 터미널의 coding agent를 가릴 수 없다. `command-surface`의 "사람만 하는 일은 명령으로 두지 않는다"와 같은 원칙이다. (agent, 2026-11-11)
- 뜻 검사에 쓰는 규칙은 design과 protocol에 두고 core가 그것을 import한다. 선언 자체는 core에 둔다. 이유: theme 검사는 design의 token 목록이 있어야 하고, shell은 값을 설정 사본(key와 값)으로 읽어서 선언을 import할 일이 없다. 버린 안: 선언을 protocol로 옮기기(protocol은 design을 쓸 수 없어 theme 검사를 둘 수 없다). (agent, 2026-11-11)
- shell은 값을 창에서 main으로 밀지 않고 main이 core 설정의 사본을 따른다. 이유: 길이 둘이면 한쪽만 바뀐다. `appearance.md`의 옛 결정 "시작 때 값은 renderer가 core에서 읽어 main에 보낸다"를 뒤집었다. (agent, 2026-11-11)
- agent에게 주는 지침은 home prompt 몇 줄이고 내장 skill은 만들지 않는다. 이유: 무엇을 바꿀 수 있는지는 `settings get`의 설명이 말한다. (agent, 2026-11-11)

- agent가 바꾸되 사람이 그 한 번을 허락하는 설정을 선언의 칸(`approval: "person"`)으로 둔다. 이유: sync 폴더처럼 사람의 data가 data root를 떠나는 설정은 locked로 막으면 agent가 지침대로 바깥 도구를 붙이는 길이 막히고, 묻지 않으면 data가 사람 모르게 나간다. 바뀜의 글은 선언의 `describe`가 쓴다(카드가 값의 JSON이 아니라 "Add sync folder ..."를 보인다). (planner, 2026-11-16)

## 열린 것

- `settings.json` 쓰기에는 revision 비교가 없다. 두 쪽이 같은 key를 바꾸면 마지막 쓰기가 이긴다. 목록 전체를 한 key에 싣는 설정(단축키, MCP server)은 읽은 뒤 쓰기 사이에 다른 쪽이 바꾼 값을 지울 수 있다.
- 단축키의 겹침(같은 자리의 같은 키)은 core가 거절하지 않는다. Settings 화면만 겹침을 보이고 바꾸기를 준다.
- coding agent 즐겨찾기와 실행 명령어가 한 설정(`shell.coding_agents`)이라 즐겨찾기도 agent가 바꾸지 못한다. harness id는 core가 검사하지 않고 모르는 id는 shell이 건너뛴다.
- detached 편집기 창은 설정 event를 받지 않아 읽기 폭이 그 창을 다시 열 때 바뀐다.
- 설치된 글꼴인지는 core가 모른다(창만 안다). 설치되지 않은 이름은 기본 글꼴로 그려진다.
- extension 켜기, trace, browser link는 shell main이 설정 사본이 아니라 따로 읽는다(event나 요청 때마다). 동작은 같다.
