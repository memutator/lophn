# approval

agent가 하는 동작마다 "해도 되나"를 정하는 장치다. 권한 4단계(`read_only` 보기만 / `ask` 다 묻기 / `workspace` 고치기는 알아서 / `full` 다 맡기기), 실행 맥락(`attended | unattended | team_child`), 그리고 순수 결정적 통합 판정 엔진(`evaluatePermission`)이 모든 tool 호출을 한 길로 판정한다. 기본 철학은 "앞에서 한 번 허락 + rewind로 복구"다: lophn이 rewind 기록을 남기는 등록 폴더 안 `file.*` 쓰기는 기본 ③(`workspace`)에서 묻지 않고, rewind 기록을 남기지 못하는 것(`shell.run` 비읽기 명령, 등록 폴더 밖 파일)과 민감·외부 동작(비신뢰 MCP 비읽기 tool, 미신뢰·변경된 로컬 tool, command별 묻기를 켠 앱 tool, 민감 workspace 파일, `approval: "person"` 설정)은 묻는다. 사람이 없는 실행(`unattended`)에서 `ask` 판정은 실행이 아니라 `deny`(`no_person`)다. 막힌 동작은 숨기지 않고 구조화된 `PermissionDenial`과 `PermissionDenied` event로 model과 사람 모두에게 이유·규칙·복구 길을 드러낸다. 이 문서는 통합 판정 엔진, 4단계와 실행 맥락, 통합 권한 규칙과 상태 기계 shell 스캐너, 안전한 `always`, `session` 선택지와 메모리 `SessionGrantStore`, 바깥 폴더와 민감·자기 보호 경로, 거부 언마스킹과 `/permissions`, 할당과 MCP·로컬 tool 신뢰, 팀 자식의 물음, 앱 공유 요청, 원격 기기 자격을 다룬다. 앱의 자원 허락(activation 동의)은 `architecture/activation.md`의 일이다.

## 문제

agent는 사람이 있을 때도 없을 때도 shell을 돌리고 file을 읽고 쓰며 앱·MCP·로컬 tool을 부른다. 2026-10-20 개편으로 옛 approval의 과한 마찰은 걷어 냈지만 두 가지가 거꾸로 놓였다.

1. **막힌 것을 숨긴다.** `forbidden` 오류를 `not_found`와 같은 공통 문장("tool target is not available")으로 덮어 model이 왜 막혔는지 모르고 우회를 시도했다. gate 거부는 짧은 꼬리표뿐이라 걸린 규칙 패턴을 버렸고, 거부 event나 타임라인 표시가 없어 사람도 왜 막혔는지 보지 못했다. `/permissions`는 앱 할당만 보였다.
2. **물어야 할 것을 묻지 않는다.** `shell.run`이 기본 `allow`였고 단순 정규식 자르기로 `sh -c "rm -rf ~"`, `env rm -rf ~`, flag 조합이 floor를 우회했다. `always`는 앞 두 낱말 + `*`를 만들어 `rm -rf *` 같은 넓은 영구 허락을 냈다. unattended turn은 `ask`를 `run`으로 바꿔 사람 없이 위험한 명령이 통과했고, `<workspace>/.lophn/tools/*` 로컬 스크립트와 비신뢰 외부 MCP tool도 확인 없이 실행됐다.

## 목표와 비목표

- 목표: 하나의 결정적 통합 판정 엔진(`evaluatePermission`)이 모든 범주를 판정한다. 4단계 권한 모드와 실행 맥락을 분리해, 사람이 있을 때만 묻고 사람이 없는 실행에서 `ask`는 거절한다. 막힌 호출은 이유·규칙·복구 길을 model과 사람 양쪽에 투명하게 드러낸다. agent는 자기 권한 단계·할당·규칙·신뢰 목록을 스스로 넓히지 못한다.
- 비목표:
  - OS sandbox는 이번 판에 두지 않는다. 판정 엔진 입력에 격리 슬롯(`IsolationBackend = "none"`)만 열어 둔다. 한 번 허락한 shell 스크립트 안에서 벌어지는 일은 OS 수준에서 막지 못하며 `shell.run`은 rewind 밖이다(이슈 `shell-run-bypasses-file-scope`).
  - 사용자 앱과 사람이 쓴 글은 공격자로 보지 않는다. 막는 것은 AI가 만든 코드와 agent의 실수(데이터 잃기, 폴더 밖 쓰기, 틀린 되돌리기)와 인터넷에서 온 것이다.
  - LLM 판정(guardian, smart)과 `PreToolUse` 훅 개입은 두지 않는다. 판정은 program이 표와 규칙으로 결정적으로 하고 결정은 사람이 한다.
  - timeout은 두지 않는다. attended에서는 대기 목록에 남고 unattended에서는 묻지 않고 `deny`(`no_person`)다.
  - native tree-sitter 같은 외부 parser 의존성은 쓰지 않는다. TypeScript 순수 상태 기계 shell 스캐너로 래퍼·정규화·`opaque` 검사를 한다.
  - 저장소(project 폴더) 안에 권한 설정 파일을 두지 않는다. 규칙·기본 단계·workflow 기억 단계·로컬 tool 신뢰 목록은 모두 core 소유 data root 설정(`settings.json`, `locked: true`)에만 둔다.
  - 결과 본문을 믿는 문제는 판정과 따로다. web 검색과 읽기 결과만 바깥 글로 감싸고, 앱 tool과 외부 MCP 결과는 감싸지 않는다.

## 모델

### 판정이 걸리는 곳과 통합 판정 엔진

```
 runtime이 tool을 실행하기 직전
   gate가 걸린 tool이 GateCall을 낸다:
     shell | file_read | file_write | app_tool | mcp_tool | local_tool
   shell extension tool은 호출 route(extension_tools/call)가 extension_tool로 판정한다
   설정 route(settings/update)가 approval: "person" 설정 바꾸기를 setting {key, lines}로 같은 판정에 묻는다
   project command route(project_commands/*)가 실행을 project_command로, 정의 쓰기를 project_command_definition으로 묻는다
        │ memory route tool_gate/check (그 turn의 agent 자격만)
        ▼
 core가 session의 permission_mode·agent·workspace·spawned_by, turn의 mode(attended|unattended),
        할당, 통합 권한 규칙 층, SessionGrantStore, MCP 신뢰, 로컬 tool 신뢰를 읽어 판정한다
   evaluatePermission(request, layers, sessionGrants, mode, context)   (순수 함수, IsolationBackend = "none")
     ├ run  ─▶ 실행 (바깥 폴더 file_* 허락은 그 호출 한 번의 scope에 반영)
     ├ deny ─▶ PermissionDenial 반환 + SessionGrantStore 최근 거부 기록 + PermissionDenied event 발행
     │         model에는 이유·규칙·복구 힌트 + 우회 금지 지침을 전달, 사람 화면 타임라인·/permissions에 복구 버튼 표시
     └ ask  ─▶ turn 안 request (메모리, allowed_choices·always_patterns·reason·outside_rewind 포함)
               TurnRequestOpened ─▶ 대기 목록, 알림(toast·OS), 대화 카드(300~500ms Enter 가드)
               사람: once | session | always | reject(+이유) (turn_requests/decide, 사람 자격만)
               TurnRequestClosed ─▶ turn이 이어 간다
```

판정 순서(고정, IO 없는 순수 함수):
1. **Floor / 자기 보호**: shell safety floor(정규화·래퍼 해제 뒤 대조)와 자기 보호 경로(`~/.ssh`, `~/.aws`, `~/.gnupg`, `<data root>/secrets*` 읽기·쓰기 및 `<data root>` 안 설정·권한·agent 정의·secret 쓰기). 어느 단계·규칙·`session` 허락으로도 풀리지 않는다(`reason_kind: "floor" | "scope"`).
2. **사용자 규칙 (`approvals.permission_rules`)**: 전역 + project 층에서 해당 범주 규칙을 모아 고정 우선순위 **`deny > ask > allow`**로 판정한다(이전의 `findLast`를 폐지해 `deny`가 뒤의 `allow`에 실수로 뚫리지 않게 했다). 단 `elevated`·`opaque` shell 명령은 사용자 `allow`로 통과하지 못한다.
3. **사람 전용 등급 (`personOnly`)**: `setting`(`approval: "person"`), `project_command_definition`(`approve_agent_writes` 켬), 미신뢰·내용이 바뀐 `local_tool`은 어느 단계(`full` 포함)에서도 사람에게 직접 `once | reject`로 묻고, unattended와 팀 자식에서는 `deny no_person`이다.
4. **민감 workspace 파일**: `.git/hooks/*`, `.git/config`, `.lophn/tools/*` 쓰기와 `.env*` 읽기(`.env.example`, `.env.sample` 제외)는 모든 단계에서 `once | reject`로 묻는다(`read_only`의 쓰기는 `mode` 거부).
5. **이번 대화 허락 (`SessionGrantStore`)**: core 메모리의 session grant에 맞으면 `run`(단 `read_only` 모드 거부, `elevated`/`opaque` shell, 민감 파일, 사람 전용 등급에는 적용되지 않는다).
6. **권한 단계 기본값 (`read_only | ask | workspace | full`)**: 단계 × 범주 표에 따라 `run`·`ask`·`deny(mode)`를 정한다.
7. **실행 맥락 (`attended | unattended | team_child`)**: 판정이 `ask`일 때 `attended`면 사람에게 묻고, `unattended`면 **`deny`(`no_person`)**로 바꾸며, `team_child`면 사람 전용 등급은 `deny`(`no_person`), 그 밖의 `ask`는 부모에게 `once | reject`로 올린다.

### 권한 4단계와 실행 맥락

권한 단계(`permission_mode`, session의 상태)와 실행 맥락(`attended | unattended | team_child`, turn·소속의 상태)을 분리한다.

| 단계(code) | 화면 이름 | 기본 동작 |
|---|---|---|
| `read_only` | ① 보기만 | 읽기·검색·내장 읽기 shell 명령만 허용. 모든 파일 쓰기, 비읽기 shell, 비읽기 앱/MCP tool, 로컬 tool, project command는 `mode` 거부 |
| `ask` | ② 다 묻기 | 등록 폴더 안 읽기와 내장 읽기 shell 명령만 묻지 않고, 파일 쓰기·비읽기 shell·바깥 폴더·외부 호출은 묻는다 |
| `workspace` | ③ 고치기는 알아서 | 초기 기본값. 등록 폴더 안 `file.*` 쓰기(rewind 기록 대상)와 내장 읽기 shell 명령은 묻지 않고, 비읽기 shell·폴더 밖 파일·비신뢰 MCP 비읽기 tool·`ask_tools` 앱 command는 묻는다 |
| `full` | ④ 다 맡기기 | floor·사용자 deny·자기 보호·민감 workspace 파일·사람 전용 등급·`elevated`/`opaque` shell 밖은 묻지 않고 실행한다 |

- **단계 정하기와 바꾸기**: 전역 기본 단계는 core 설정 `approvals.default_mode`(`locked: true`, 초기 값 `workspace`)다. agent 정의의 `permission_mode`(사람만 쓰기)가 있으면 그 값이 우선하고 비면 전역 기본을 따른다. 새 session은 이 값으로 시작하고, 대화 화면에서 사람이 `sessions/change-mode`로 바꾼다. 단계를 낮추면 다음 tool 호출부터 바로 적용된다. 폰·원격 기기는 단계를 **낮추기만(downgrade-only)** 할 수 있고 올리거나 `full`로 바꾸려 하면 `forbidden`이다. fork는 출처의 단계를 가져가지 않고 agent/전역 기본값으로 시작한다. 팀 자식은 `min(부모 단계, 정의/전역 기본값)`으로 상한을 두어 부모보다 넓어지지 않는다.
- **실행 맥락 (`turns.mode`)**: turn은 시작할 때 `attended` 또는 `unattended`를 정해 `turns.mode`에 남기고 그 turn 동안 바꾸지 않는다(옛 `skip` 값은 `attended`로 옮겨졌고, 옛 `sessions.skip = 1`은 `sessions.permission_mode = 'full'`로 옮겨졌다). 도는 turn에 사람이 steer한 메시지도 그 turn의 mode를 따른다.
  - `unattended`는 run 입력(`SendMessage` `unattended: true`), workflow non-human step, job이 연 turn이며 call 봉투에 실려 사슬을 따라간다. workflow의 사람 step(`human_turn: true`, `by: me`·`human()`)과 사람이 화면에서 보낸 메시지는 `attended`다.
  - `unattended` turn에서 판정이 `ask`면 **실행하지 않고 `deny`(`no_person`)**로 막고 `PermissionDenial`과 `PermissionDenied` event를 남긴다. 미리 둔 사용자 `allow` 규칙이나 해당 session·participant의 단계가 ④(`full`)인 것만 무인으로 통과한다(floor·deny·사람 전용 등급·민감 파일은 ④에서도 막힌다).
  - unattended turn의 `ask` tool은 기다리지 않고 `unattended`를 바로 돌려준다. 팀 자식의 `ask`는 맥락과 상관없이 부모에게 간다.

### 할당과 앱·MCP·로컬 tool 신뢰

- **앱 할당**: 정본은 agent 정의 파일(`<data root>/agents/<agent id>.md`)의 `apps`(앱 slug), `remote_apps`({machine, app, name, removed}), `permissions.deny`(`lophn(<app> <command>)`), 그리고 command별 묻기 목록 `permissions.ask`(`ask_tools`)다. 할당한 내 앱 command는 기본으로 묻지 않고, 사람이 특정 command에 `ask_tools`를 켜 두면 `full` 미만에서 묻는다(`once | session | reject`). `read_only`에서는 `effect !== "read"`인 앱 command가 `mode` 거부된다. 다른 기계의 앱도 같은 사람이 부르는 기계에서 할당하며 할당 없는 agent는 부르지 못한다.
- **MCP server 신뢰**: MCP server는 설정한 층(전역, workspace, agent 정의)이 곧 할당이고 끄기는 `mcp_off`다. 각 MCP server 설정에 사람만 쓰는 `trust: "trusted" | "untrusted"`(기본 `untrusted`) 칸을 둔다. 비신뢰 서버의 `readOnlyHint !== true` tool은 `full` 미만에서 묻고(`once | session | reject`), 신뢰된 서버이거나 `readOnlyHint === true`인 tool은 묻지 않는다. `read_only`에서는 비읽기 MCP tool이 `mode` 거부된다.
- **로컬 tool 신뢰**: `<data root>/tools/`, `<workspace>/.lophn/tools/`, `<workspace data>/tools/`의 스크립트는 `(realpath, sha256)`이 data root 설정 `approvals.local_tool_trust`에 있을 때만 실행한다(`architecture/extension.md`). 미신뢰이거나 내용이 바뀐 스크립트는 사람 전용 등급 `ask`(`once | reject`, `once` 허락이 곧 신뢰 기록)이며 신뢰 전에는 `inspect`도 실행하지 않는다.
- **shell extension tool**: 정의 칸 `extensions`가 할당이며 호출 route(`extension_tools/call`)가 `extension_tool`로 판정한다.
- **coding agent(harness)**: coding agent와 runtime이 harness인 lophn agent의 tool call은 harness 자신의 일이다. lophn은 대기 목록에 비추기만 하고(`subject.kind: "harness"`) 답은 터미널에서 한다(`architecture/coding-agent.md`).

### 통합 권한 규칙, 상태 기계 shell 스캐너, 안전한 `always`

- **규칙 데이터와 층**: 규칙은 `PermissionRule { id, category, pattern, action, reason?, source }`이며 `category`는 `shell | file | app_tool | mcp_tool | local_tool`, `action`은 `allow | ask | deny`다. 층은 제품 기본 floor, 전역, project 셋이다. 전역과 project 규칙은 data root 설정 `approvals.permission_rules`(`{ global, projects }`, `locked: true`)에만 두고 Settings › Permissions에서 관리한다. 옛 `approvals.shell_rules`는 기동 시 data step `approvals.permission-rules-migrate`가 `category: "shell"` 규칙으로 보존 이전한다.
- **상태 기계 shell 스캐너**: 단순 정규식 분리를 폐지하고 TypeScript 순수 구현 상태 기계 스캐너를 쓴다(native tree-sitter 없음).
  - 작은따옴표·큰따옴표·이스케이프·heredoc·제어 연산자(`&&`, `||`, `;`, `|`, 줄바꿈)·서브셸(`(...)`)·명령 치환(`$(...)`, `` `...` ``)·리다이렉션·선행 환경변수 할당을 파싱하고, 래퍼(`sh -c`, `bash -c`, `zsh -c`, `env`, `command`, `exec`, `nohup`, `timeout`, `xargs`, `sudo`, `doas`, `su` 등)를 최대 깊이 8까지 벗겨 안쪽 명령 조각까지 모두 검사한다.
  - `rm`의 묶인/긴 flag(`-rf`, `-fr`, `-r --force`, `--recursive -f` 등)와 경로(`~`, `$HOME`, `${HOME}`, 실제 home 경로, `/`, `/*`)를 정규화한 뒤 floor 표와 대조한다. `sh -c "rm -rf ~"`, `env rm -rf ~`, `rm -r --force ~`가 모두 floor에 잡힌다.
  - **비대칭 안전 규칙**: 닫히지 않은 따옴표, 동적 `eval`, 변수로 구성된 실행 명령, 입력 크기 상한 초과는 `opaque`로 표시하고, `sudo`/`doas`/`su`는 `elevated`로 표시한다. `opaque`와 `elevated` 명령은 사용자 `allow` 규칙, `SessionGrantStore`, 내장 읽기 목록으로 통과하지 못하며 `once | reject`로만 묻는다.
  - **내장 읽기 명령 allowlist**: 출력 리다이렉션·`opaque`·`elevated`가 없는 안전한 읽기 명령(`ls`, `cat`, `head`, `tail`, `wc`, `pwd`, `which`, `git status`, `git diff`, `git log` 등)과 읽기 파이프라인만 기본 허용한다. 그 밖의 shell 명령은 ③(`workspace`) 이하에서 기본 `ask`다.
- **안전한 `always` 패턴과 기존 넓은 규칙 경고**:
  - `always` 패턴은 CLI subcommand 길이 표(예: `git`, `npm`, `pnpm`, `cargo`, `docker`, `kubectl` 등)로 안전한 최소 접두사를 계산한다.
  - 금지 접두사(예: `rm *`, `rm -rf *`, `sudo *`, `sh *`, `bash *`, `eval *`, `curl *`, `chmod *` 등 광범위한 파괴·실행 접두사), `opaque`·`elevated` 명령, 여러 줄 명령, 민감 리다이렉션이 있는 명령에는 `always_patterns`를 비워 `always` 선택지를 제공하지 않는다. 카드는 저장될 패턴을 그대로 보인다.
  - `always`를 고르면 project workspace는 그 project 층, 앱·Home workspace는 전역 층의 `approvals.permission_rules`에 `category: "shell"`, `action: "allow"`로 더한다.
  - 이미 저장된 기존 규칙 중 지나치게 넓거나 위험한 패턴(예: `rm -rf *`)은 사람 데이터를 잃지 않도록 지우지 않고 Settings › Permissions에서 경고 표시를 단다.
- `shell.run`의 효과는 `external`이다.

### 바깥 폴더와 민감·자기 보호 경로

- 등록 폴더 밖 `file.read`·`file.write`·`file.edit`는 `forbidden`으로 조용히 거절하지 않고 `file_outside` 범주의 `ask`(`once | session | reject`)로 묻는다(`full` 모드는 묻지 않고 통과, `read_only`의 쓰기는 `mode` 거부).
- 사람이 `once`를 고르면 그 호출 한 번의 scope에만 해당 경로를 연다. `session`을 고르면 그 폴더를 `SessionGrantStore`에 등록해 같은 대화 동안 다시 묻지 않으며, 그 폴더 안 `file.write`·`file.edit`도 rewind 기록에 포함한다.
- 자기 보호 경로(`~/.ssh`, `~/.aws`, `~/.gnupg`, `<data root>/secrets*` 읽기·쓰기와 `<data root>` 안 `settings*`·`permissions*`·`agents/*`·`secrets*` 쓰기)는 floor와 같은 수준의 `scope` 거부이며 바깥 폴더 허락으로도 열리지 않는다.
- workspace 안 `.git/hooks/*`, `.git/config`, `.lophn/tools/*` 쓰기와 `.env*` 읽기(`.env.example`, `.env.sample` 제외)는 모든 단계에서 `once | reject`로 묻는다.

### 묻는 길, `session` 선택지, 거절 배치 처리

- 묻는 길은 core 메모리의 turn 안 request 하나다. 요청은 `allowed_choices`(`once | session | always | reject`의 부분집합), `always_patterns`, `reason`, `outside_rewind`를 싣는다. `allowed_choices`에 없는 선택지를 보내면 `invalid_input`이다.
- 승인 카드(desktop·폰)는 이유, 저장될 패턴, "되돌리기 밖" 여부를 보이고 마운트 후 300~500ms 동안 Enter 입력을 무시해 실수 승인을 막는다.
- **`SessionGrantStore`**: core 메모리에 session별로 "이 대화 동안"(`session`) 허락(shell 접두사, 바깥 폴더, 앱 tool, MCP 서버/tool)과 최근 거부 이력을 보관한다. session이 archive·삭제되거나 core가 재시작하면 사라지고 fork로 복사되지 않는다. `/permissions`에서 항목별로 즉시 해제(`permissions/revoke-grant`)할 수 있다.
- **이유 없는 거절 vs 이유 있는 거절**: 한 model 응답의 tool 호출 배치에서 사람이 이유 없이 거절하면 같은 응답에 남은 쓰기·외부 호출을 실행하지 않고 멈추며 읽기 호출만 계속한다. 이유를 적어 거절하면 그 이유를 model에 전달하고 남은 호출을 계속한다.

### 거부 계약(`PermissionDenial`), 언마스킹, `PermissionDenied` event, `/permissions`

- 권한·범위·모드·정책 거부는 `PermissionDenial { tool, category, target_summary, reason_kind, rule_pattern, message, recovery_hint, recovery_action }` 계약으로 통합한다. `reason_kind`는 `floor | user_deny | mode | scope | unassigned | removed | untrusted | no_person | locked | policy` 열 종류다.
- **model 쪽 언마스킹**:
  - gate 거부(`tool_gate/check`의 `denied { denial }`)는 `reason_kind`, 걸린 `rule_pattern`, `message`, `recovery_hint`를 빠뜨리지 않고 tool 결과로 전달한다.
  - handler의 `forbidden` 오류도 "tool target is not available"로 덮지 않고 handler의 고정 문장을 그대로 싣는다. 존재를 감춰야 하는 대상(다른 session의 탭, private workspace의 것)은 handler가 `not_found`로 돌려 기존 공통 문장을 유지한다.
  - 모든 권한·`forbidden` 거부 문장 끝에는 우회 금지 지침("다른 tool(shell.run 등)로 우회하지 말고 사람에게 설명하거나 안내된 길을 쓰라")을 붙인다.
  - workspace 상한 밖 operation의 agent credential 요청도 빈 값(`undefined`) 대신 이유 있는 `forbidden` 거부를 돌려준다. MCP 401·다시 로그인 필요는 `details.missing`으로 `lophn ask secret` 안내를 붙인다.
- **사람 쪽 가시성과 복구**:
  - 거부가 일어나면 core가 `SessionGrantStore`에 최근 거부를 기록하고 `PermissionDenied` event를 Bus(및 `REMOTE_ALLOWED_EVENTS`)로 발행한다.
  - 대화 타임라인은 일반 tool 실패와 구별되는 "막힘" 표시와 한 줄 이유, 걸린 규칙, 그리고 `recovery_action`에 따른 복구 버튼을 보인다: floor·`locked`는 버튼 없음, 사용자 deny 규칙은 "규칙 고치기"(Settings 이동), 미할당 앱은 "할당하기", 단계 제약은 "단계 바꾸기", 미신뢰 로컬 tool은 "신뢰하기", 비신뢰 MCP는 "신뢰하기" 또는 "로그인", 무인 실행에서 막힌 shell은 "항상 허락 규칙 더하기". 버튼은 상태만 바꾸고 다시 실행은 사람의 다음 메시지다.
  - `/permissions` 화면(`permissions/read`)은 다섯 칸으로 session의 권한 상태를 한눈에 보인다: ① 현재 권한 단계, ② 읽기·쓰기 폴더(이번 대화에 연 바깥 폴더 포함), ③ 규칙 요약(floor 수, 전역·project 규칙, 이번 대화 허락과 개별 해제), ④ 할당 앱·MCP 서버(신뢰 상태)·로컬 tool(신뢰 상태와 desktop 신뢰/해제), ⑤ 최근 거부 이력.

### 사람의 허락이 드는 설정

설정 선언이 `approval: "person"`과 바뀜을 사람의 말로 쓰는 `describe(before, after) → string[]`을 가지면(locked와 같이 둘 수 없다), 사람 자격(Settings 화면, 사람의 터미널의 `lophn settings`)은 그대로 바꾸고 agent의 바꾸기만 묻는다. 사람의 data가 data root를 떠나 바깥 도구가 올리는 폴더로 가기 시작하는 일처럼 pairing·연결과 같은 무게의 설정이다(`folder-sync.md`).

- agent의 `settings/update`에 그런 key가 있으면 route가 먼저 값의 모양과 뜻을 검사한다(사람이 허락한 뒤 거절되는 값을 보이지 않는다). 통과하면 key마다 `describe(지금 값, 바꾼 뒤 값)`의 줄을 만들어 그 agent의 `lophn settings` tool call로 `tool_gate/check`에 `{kind: "setting", key, lines}`를 묻는다.
- 판정은 사람 전용 등급(`personOnly`)이다: attended에서 어느 단계(`full` 포함)든 `ask`(`once | reject`), unattended와 팀 자식에서는 `deny no_person`이다. `full` 단계도 부모도 이 무게의 허락을 대신하지 못한다.
- 카드(대화의 승인 카드, 대기 목록, 폰)는 제목 "Change a lophn setting" 아래 `lines`를 줄이지 않고 그대로 보인다(예: `Add sync folder "personal": /home/me/Sync/lophn`, `Remove sync folder "work" (/mnt/nas/lophn)`). 선택지는 `once`와 `reject`뿐이다(`always_patterns`가 빈다).
- 허락은 기다리던 그 route 호출이 물은 그 값을 한 번 쓰는 것뿐이다. 기다리는 사이 그 설정이 바뀌어 지금 바뀜의 줄이 사람이 본 줄과 다르면 쓰지 않는다. 거절, 묻지 못함(lophn agent turn의 tool call 밖, 예: harness agent), deny는 `rejected`의 `needs_approval`(사람이 쓴 이유를 싣는다)이고 CLI는 `forbidden`으로 돌려준다.

### project command 실행과 정의 쓰기 승인

- project command의 agent 실행(`project_command`)과 정의 쓰기(`project_command_definition`)는 같은 `tool_gate/check` 판정 길을 탄다(`project-command.md`).
- `project_command`: 해당 명령(또는 project 기본값)의 `agents` 목록에 없는 agent는 어느 단계에서나 `deny`(`unassigned`)다. `read_only` 단계에서는 `mode` 거부다. 허용된 agent이고 `ask_before_run`이 켜져 있으면 attended에서 `ask`(`once | reject`), 팀 자식은 부모에게, unattended는 `deny no_person`이다. 카드에는 명령 이름, 원문, cwd, env 키 이름만 싣고 env 값은 싣지 않는다.
- `project_command_definition`: project의 `approve_agent_writes`가 켜져 있으면(기본 켬) 사람 전용 등급(`personOnly`)이라 attended에서 어느 단계(`full` 포함)든 `ask`(`once | reject`), unattended와 팀 자식은 `deny no_person`이다. 카드는 바뀌기 전과 뒤의 이름·원문·cwd·env 키 이름만 보이고, 기다리는 사이 정의가 바뀌었으면 쓰지 않는다(`conflict`). `approve_agent_writes`가 꺼져 있으면 `read_only`를 제외하고 통과한다.
- agent가 agent 정책 칸(`set_settings`, 명령별 `agents`·`ask_before_run`)을 바꾸려 하면 승인 여부와 상관없이 route가 `forbidden`으로 거절한다.

### 팀 자식의 물음

spawn된 session(`spawned_by` 있음)의 `ask` tool(질문)과 일반 `ask`(승인)는 사람이 아니라 부모에게 가는 result call이다(`architecture/agent-call.md`의 지키는 것, 팀의 ask call). 자식 turn은 turn 안 request(질문은 질문 대기)로 기다리고 부모의 답이 그것을 푼다. 부모가 판단할 수 없으면 자기 `ask`를 쓴다. 부모도 자식이면 그 위로 가고 root에서 사람에게 닿는다. 올리는 장치는 따로 없다. 다른 컴퓨터에서 도는 팀원(`agent-call.md` 29a)의 물음도 그 컴퓨터의 사람이 아니라 연 컴퓨터의 부모에게 mail로 간다.

- 팀 자식의 권한 단계는 `min(부모 단계, 정의/전역 기본값)`으로 상한을 둔다. 질문은 단계와 맥락에 상관없이 부모에게 간다. 사람 전용 등급(`approval: "person"` 설정, `project_command_definition`, 미신뢰·변경된 `local_tool`)은 부모가 대신 허락하지 못하며 `deny no_person`이다.
- unattended 여부는 core가 질문 입구에서 가른다. 자식이 아니고 turn이 unattended면 `unattended`를 바로 돌려준다. ask call은 자식 turn의 unattended 표시를 싣고 가므로, unattended 사슬의 root가 받은 물음에서는 root의 `ask`가 `unattended`를 돌려주고 root가 스스로 정한다.
- 부모의 답은 구조다: `lophn call reply <call> --allow | --reject [--body <이유>]`(`ReplyCall.decision`). `always`와 `session`은 없어서 부모가 규칙이나 session grant를 더하는 길이 없다. 부모의 허락은 `once`뿐이고, 자식의 request는 `allowed_choices`가 `["once", "reject"]`이며 `always_patterns`가 비어 있다. `deny`는 판정에서 끝나 request가 열리지 않으므로 부모에게 가지 않는다. 거절은 tool 결과 `the parent rejected this tool call: <이유>`다. 질문의 답 글은 `{outcome: "parent_reply", message}`로 가고 `human_message`처럼 그 글이 답인지는 model이 읽는다.
- 부모 call의 body는 program이 만든다. 승인은 카드 내용(명령 글이나 tool 이름)만 싣는다.
- request·질문과 event는 그대로 나오되 `to_parent: true` 표시를 단다. renderer 대기 목록, toast·OS 알림, acp projection은 그 표시로 걸러 카드를 만들지 않는다. 자식 탭의 session 상태는 그대로 `waiting`이다. 사람이 자식 session에 메시지를 보내면 질문이 풀리는 길은 그대로다.
- 한쪽이 먼저 끝나는 경우:
  - 자식의 request·질문이 부모 답 말고 다른 것(turn 끝, session 닫힘, 사람 메시지)으로 닫히면 core가 그 ask call을 자식 이름으로 취소한다. 부모의 늦은 답은 `closed: true`다.
  - 부모가 끝나 call이 `receiver_ended`로 닫히면 승인은 `the parent session ended without answering` 거절로, 질문은 `cancelled`로 풀린다. 처음부터 부모에게 닿지 않으면 승인은 `the request could not reach the parent session` 거절이다.
  - harness·custom 부모의 마지막 응답이 승인 call의 자동 답이 되면 거절로 친다. 명시하지 않은 허락은 없다.

### 앱 공유 요청

앱 workspace의 agent가 "이 앱을 agent A, B(와 coding agent)에게 할당"을 청한다(`lophn app share --agent <이름>... [--coding-agents] --reason <글>`, 앱 workspace 명령).

- 받을 agent도 coding agent도 없는 요청과 agent가 스무 명을 넘는 요청은 받지 않는다(`invalid_input`). 앱은 입력이 아니라 agent credential의 `conditions.app`이 고정하고, 앱 workspace가 아니면 `forbidden`이다. 이름은 명령이 `agent.list`로 id로 푼다.
- 요청은 `share_requests` 표에 앱마다 한 줄이다. 같은 앱의 열린 요청이 있으면 새 요청이 대신한다. 승인이나 거절이면 줄을 지운다. 그래서 turn이 끝나도, 재시작해도 남는다(메모리 request는 재시작하면 비는 것과 다르다).
- 결정은 사람 자격만 한다(`share_request.decide`). compare `requested_at`이 열린 요청과 다르거나 요청이 없으면 `conflict`다: 그 사이 새 요청이 대신했거나 이미 정해졌다. 거절은 이유를 싣지 않는다. 카드는 앱 이름, 받을 agent, agent가 쓴 이유(200자까지), 받게 되는 것(지금 active 선언의 public skill 수와 public command 수)을 보인다. 이유는 agent가 쓴 글이라 참고일 뿐이고 수는 program이 선언에서 센다.
- 승인은 같은 tx에서 받을 agent마다 할당 쓰기 길로 앱을 더한다. 이미 있는 줄과 그 줄에서 뺀 command는 건드리지 않는다. 정의 파일은 tx 밖이라 쓰기 전에 받을 agent 모두의 할당을 먼저 읽고, 뒤 agent의 쓰기가 실패하면 먼저 쓴 agent의 파일을 전 값으로 되돌린다. 되돌리기 쓰기마저 실패하면 그 agent에 앱이 남는다. 다시 승인하면 이미 있는 줄은 건너뛰어 같은 결과가 된다.
- coding agent를 골랐으면 commit 뒤에 core가 설정 `coding-agent.shared_apps`에 앱 slug를 더한다(이미 있으면 더하지 않는다). 설정 store가 writer Worker 밖이라 commit 뒤에 쓴다. 쓰기가 실패해도 승인은 이미 확정이라 log(`shared_apps_not_saved`)만 남는다. 이 설정은 사람이 승인할 때만 더하고, 듣는 쪽은 `architecture/coding-agent.md`다.
- 그 앱의 activation 동의가 대기 중이면 사람은 한 번만 승인한다. 대기 목록(renderer waiting store)이 그 앱의 공유 요청을 동의 항목에 붙여 보이고 따로 줄을 세우지 않는다(요청이 먼저 열렸든 동의가 먼저 열렸든 같다). 동의를 허락하면 `activation.consent`가 카드가 본 요청의 `requested_at`을 `share_requested_at`으로 실어, core가 같은 tx에서 공유를 승인한다. 효과는 `share_request.decide`의 approve와 같고(할당, commit 뒤 coding agent 설정), `ShareRequestClosed {approve}`도 낸다. 공유가 먼저 적용되고, 그 사이 새 요청이 대신했거나 이미 정해졌으면 동의째 `conflict`라 사람이 보지 못한 내용은 승인되지 않는다. 요청이 하나라도 실패하면 동의도 허락되지 않고 대기로 남는다. 동의를 거절하면 공유 요청은 그대로라 대기 목록에 제 줄로 다시 보인다. 동의 대기가 없으면 위의 따로 승인과 같다. apps는 approvals를 import하지 않아 core/apps의 port로 이 승인을 꽂는다.

## 지키는 것

판정
1. 판정(`evaluatePermission`)은 IO 없는 순수 함수다. 시각, 상태, 전역을 읽지 않고 같은 입력은 같은 결과다. 격리 슬롯(`IsolationBackend`)은 이번 판에 `"none"`만 둔다.
2. 할당하지 않은 앱의 tool은 `deny`(`unassigned`), 할당에서 뺀 tool은 `deny`(`removed`)다. 어느 단계에서나 막는다. tool 목록은 session 시작 때 고정하지만(`architecture/agent-definition.md`) 판정은 call 때 지금 할당을 읽어 session 도중 뺀 앱 tool도 바로 막는다. 사람이 `ask_tools`(`permissions.ask`)를 켠 앱 command는 `full` 미만에서 묻는다.
3. 외부 MCP server는 설정에 사람만 쓰는 `trust: "trusted" | "untrusted"`(기본 `untrusted`)를 둔다. 비신뢰 서버의 `readOnlyHint !== true` tool은 `full` 미만에서 묻고, 신뢰된 서버나 `readOnlyHint === true` tool은 묻지 않는다. 연결 쪽 call은 부를 때마다 전역·workspace 층 server 설정을 다시 읽어 꺼진 server(`mcp_off`)나 읽기 실패면 `unavailable`로 거절한다. 401·다시 로그인 필요는 `details.missing`으로 `lophn ask secret` 안내를 붙인다.
4. floor, 자기 보호 경로, 사용자 `deny` 규칙은 어느 단계(`full` 포함), 사용자 `allow` 규칙, `session` 허락으로도 풀리지 않는다. 사용자 규칙의 우선순위는 고정(`deny > ask > allow`)이다.
5. `ask`는 실행 맥락(`context`)에 따라 갈린다: `attended`에서는 사람에게 묻고, `unattended`에서는 **`deny`(`no_person`)**로 막아 실행하지 않는다. `team_child`에서는 사람 전용 등급(`setting`, `project_command_definition`, 미신뢰·변경된 `local_tool`)을 `deny`(`no_person`)로 막고, 그 밖의 `ask`는 부모에게 `once | reject`로 올린다.
6. 로컬 tool(`<data root>/tools/`, `<workspace>/.lophn/tools/`, `<workspace data>/tools/`)은 `(realpath, sha256)`이 data root의 `approvals.local_tool_trust`에 있을 때만 실행하며, 미신뢰·변경된 스크립트는 `inspect`도 실행하지 않고(fail-closed) 사람 전용 등급 `ask`(`once | reject`, `once`가 곧 신뢰 기록)로 묻는다(`architecture/extension.md`).
7. 사람의 결정은 사람 자격만 받는다(`turn_requests/decide`, `permissions/revoke-grant`, `permissions/trust-local-tool`, `permissions/untrust-local-tool`의 actors와 handler가 한 번 더 본다). 명단에 든 기기도 사람 자격(actor user, principal `device:<id>`)이지만, 로컬 tool 신뢰 부여·해제와 권한 단계 올리기는 desktop 사람 전용이다. agent, 앱, MCP server가 스스로 허락하면 판정이 의미 없다. 팀 자식의 request는 부모가 이번 한 번만 풀고, 사람의 결정 route는 그 request를 `not_found`로 거절한다.
8. agent는 자기 할당·권한 단계·규칙·신뢰 목록을 넓히지 못한다. 할당 쓰기(`assignment.set`)는 사람만 하고 읽기(`assignment.get`)는 사람과 machine뿐이다. agent 정의를 만들고 고치는 tool(`agent.create`, `agent.update`)은 `mcp_servers`, `permission_mode`, `apps`, `remote_apps`, `permissions`, `browser_profile`을 입력으로 받지 않는다. 앱 공유 요청도 agent가 여는 것은 요청뿐이고 `apps`를 더하는 것은 사람의 승인이다.
9. 판정이 읽는 할당은 call 때마다 정의 파일에서 읽는다. 앱 호출 경로와 사용 관계도 같은 읽기다. 없는 앱 slug와 active 선언에 없는 command는 읽을 때 빠진다.
10. 선언(앱 선언의 효과, MCP `readOnlyHint`)은 믿는다.
11. shell extension의 tool은 `extension_tool {extension, tool}`로 판정한다. 정의 칸 `extensions`에 없으면 `deny not_assigned`, 켜진 extension의 catalog에서 빠졌으면(꺼짐, tool 없어짐) `deny removed`, 아니면 `run`이다. 판정은 호출 route `extension_tools/call`이 한다.

묻는 길과 `SessionGrantStore`
12. 묻는 길은 turn 안 request 하나다. 메모리에 있고, 물은 turn이 기다린다. 재시작하면 비고 기다리던 turn은 cancelled를 받는다.
13. 침묵이나 카드 닫기는 결정이 아니고 기한도 없다. 원래 일이 끝나면(turn 끝, session 닫힘, 재시작) cancelled로 닫고 요청자는 거절과 구별해 받는다. 거절 이유는 agent에게 그대로 간다(tool 결과 `the person rejected this tool call: <이유>`). 이유 없는 거절은 같은 model 응답 배치의 남은 쓰기·외부 호출을 멈추고 읽기만 계속하며, 이유 있는 거절은 이유를 model에 전하고 계속한다.
14. 물은 입력을 그대로 실행한다. 허락은 메모리에서 기다리는 같은 호출을 풀 뿐이고 다시 판정하거나 입력을 비교하지 않는다. 바꿔치기할 틈이 없어 fingerprint를 두지 않는다.
15. 선택지는 `once`, `session`, `always`, `reject`다. 요청마다 `allowed_choices`를 싣고, `allowed_choices` 밖의 선택지를 보내면 `invalid_input`이다. `setting`·`project_command`·`project_command_definition`·`local_tool`·민감 파일·`elevated`/`opaque` shell·팀 자식 request는 `once`와 `reject`뿐이다.
16. `session` 선택지는 core 메모리의 `SessionGrantStore`에 이번 대화 허락을 기록한다. session이 닫히거나 core가 재시작하면 비워지고 fork로 복사되지 않으며 `/permissions`에서 개별 해제할 수 있다. 바깥 폴더에 `session`을 주면 그 폴더 안 파일 쓰기도 rewind 기록에 들어간다.
17. `always`는 request의 `always_patterns`를 `approvals.permission_rules`에 `category: "shell"`, `action: "allow"`로 더한다. 금지 접두사·`opaque`·`elevated`·여러 줄·민감 리다이렉션에는 `always_patterns`가 비어 `always`를 받지 않는다(`invalid_input`). 카드는 저장될 패턴을 그대로 보이고 마운트 뒤 300~500ms 동안 Enter를 받지 않는다.
18. 카드 내용은 program이 GateCall에서 만든다. agent가 쓴 설명은 싣지 않는다.

권한 단계와 실행 맥락
19. turn의 `turns.mode`(`attended | unattended`)는 시작 때 정해지고 그 turn 동안 바뀌지 않는다(저장소가 시작된 turn의 mode 변경을 막는다).
20. session의 `permission_mode`는 사람만 바꾼다(`sessions/change-mode`). 단계를 낮추면 다음 tool 호출부터 바로 적용된다. 원격 기기(`device:`)는 단계를 낮추기만 할 수 있고 올리거나 `full`로 바꾸면 `forbidden`이다. 정의의 `permission_mode`와 전역 기본 `approvals.default_mode`도 사람만 쓴다. fork는 단계를 가져가지 않고 agent/전역 기본값으로 시작한다. 팀 자식은 `min(부모 단계, 정의/전역 기본값)`으로 상한을 둔다. `unattended`는 call을 따라 가되 할당과 단계를 넓히지 않는다.

거부 언마스킹과 가시성
21. 모든 gate 거부와 handler `forbidden` 오류는 원문·규칙·복구 힌트를 숨기지 않고 model에 전달하며 끝에 우회 금지 지침을 붙인다. 존재를 감춰야 하는 대상은 handler가 `not_found`로 돌려 공통 문장을 유지한다.
22. 거부가 일어나면 `SessionGrantStore`에 최근 거부를 남기고 `PermissionDenied` event를 Bus로 발행해 타임라인과 `/permissions`에 보인다. 복구 버튼은 상태만 바꾸고 재시도는 사람의 다음 메시지로 한다.

팀 자식
23. 팀 자식의 물음에는 사람 카드가 뜨지 않는다. 부모의 답은 구조(`--allow | --reject`)이고 허락은 `once`뿐이다. 사람 전용 등급은 부모가 대신하지 못한다(`deny no_person`). 명시하지 않은 허락은 없다(자동 답은 거절).

할당 저장
24. 할당 저장은 revision을 비교한다. 다른 창이 먼저 저장했으면 `conflict`이고 화면이 다시 읽는다. revision은 정의 파일 값 `{apps, deny, ask}`의 hash(sha256 앞 48 bit)에서 정한 값이고 할당이 비면 0이다. 정의 파일의 다른 칸(지침 본문, model)을 고쳐도 바뀌지 않는다.
25. 쓰기는 정의 파일의 `apps`, `permissions.deny`, `permissions.ask`만 다시 쓴다. 다른 칸과 본문은 그대로다. 이 할당이 다루는 deny·ask 규칙은 옛 앱과 새 앱의 command 것뿐이고 그 밖의 규칙은 지킨다. 정의 파일이 없는 agent에는 쓰지 않는다(`not_found`).

앱 공유 요청
26. 요청은 사람이 승인하기 전에는 아무 할당도 바꾸지 않고, 결정은 사람 자격만 낸다. 카드가 본 요청(`requested_at`)이 아닌 것은 승인되지 않는다(`conflict`). 승인과 동의의 같이 승인은 할당과 coding agent 설정에서 같은 효과를 낸다.

## 경계와 계약

route와 command
- `tool_gate/check`(memory, 그 turn의 agent 자격만): 실행 전 판정. `run`, `denied { denial: PermissionDenial }`, `rejected { reason, by }`, `cancelled { cause }`를 돌려준다. 묻는 호출(승인 카드와 ACP 승인 subject)은 `shell`, `file_read`, `file_write`, `app_tool`, `mcp_tool`, `local_tool`, `setting {key, lines}`, `project_command`, `project_command_definition`이다.
- `turn_requests/decide`(memory, 사람 자격만): `once | session | always | reject`(+ 이유 한 줄). `allowed_choices` 밖 선택지는 `invalid_input`, 없거나 다른 session·팀 자식의 request는 `not_found`, 이미 닫혔으면 `conflict`, `always`를 저장하지 못하면 `internal`이고 request는 다시 열린다.
- `permissions/read`(memory, 사람 자격, `REMOTE_ALLOWED_ROUTES`): session의 `/permissions` 5칸 상태(현재 단계, workspace·열린 바깥 폴더, floor 수·전역·project 규칙·session grant, MCP 서버 신뢰·로컬 tool 신뢰, 최근 거부)를 돌려준다.
- `permissions/revoke-grant`(memory, 사람 자격, `REMOTE_ALLOWED_ROUTES`): session의 `SessionGrantStore` 항목 하나를 즉시 해제한다.
- `permissions/trust-local-tool`, `permissions/untrust-local-tool`(memory, desktop 사람 전용 — 원격 기기 제외): `approvals.local_tool_trust`에 `(realpath, sha256)`을 더하거나 뺀다.
- `sessions/change-mode`(command, 사람 자격, `REMOTE_ALLOWED_ROUTES`에 포함하되 원격 기기는 하향 전용): session의 `permission_mode`를 바꾼다.
- `extension_tools/call`: shell extension tool의 판정과 shell host로 넘기기.
- `assignment.get`(사람·machine), `assignment.set`(사람): `{agent, entries: [{app, removed_tools[], ask_tools[]}]}` 꼴과 revision compare.
- `share_request.open`(agent, 앱 workspace), `share_request.decide`(사람, `approve | reject`, compare `requested_at`), `share_requests.list`(대기 목록).
- `ask` 입구는 팀 자식 여부와 unattended 여부를 가른다. `ReplyCall.decision`이 부모의 승인 답이다.
- 설정(`locked: true`, 사람만 쓰기): `approvals.permission_rules`(`{global, projects}`), `approvals.default_mode`(기본 `workspace`), `approvals.workflow_modes`, `approvals.local_tool_trust`, `coding-agent.shared_apps`. 설정 선언의 `approval: "person"`과 `describe`(`settings.md`), 그 거절 reason `needs_approval`.

event (남지 않는다. commit 뒤 Bus)
- `TurnRequestOpened`(`to_parent` 표시, `allowed_choices`, `reason`, `outside_rewind`), `TurnRequestClosed {allow | reject | cancelled}`, `PermissionDenied { turn, tool_call, denial }` (`REMOTE_ALLOWED_EVENTS` 포함), `ShareRequestOpened`(새 요청이 대신해도 낸다), `ShareRequestClosed {outcome}`. 대기 목록은 snapshot의 `turn_requests`, `share_requests.list`를 읽고 이 event로 고친다. 대기 목록은 Inbox의 Now 탭 위쪽("답할 것")이다. 그 아래 휘발 알림과 따로 있는 History 탭(영구 기록)은 답할 것이 아니지만 안 읽은 영구 줄은 sidebar 배지에 센다(`architecture/app-notice.md`).

저장
- 할당의 정본은 agent 정의 파일의 `apps`와 `permissions.deny`·`permissions.ask`다. approvals는 정의 파일도 앱 표도 모르므로 읽고 쓰는 길은 조립이 꽂는 port다. 쓰기는 앱 id를 slug로, 뺀 command를 deny 규칙으로, 묻기 command를 ask 규칙으로 바꾼다.
- 옛 설정 `approvals.shell_rules`는 기동 시 data step `approvals.permission-rules-migrate`가 `approvals.permission_rules`(`category: "shell"`)로 보존 이전하고 옛 키를 지운다.
- 옛 agent 정의 `skip`은 data step `agents.permission-mode`가 `skip: true` → `permission_mode: full`, `skip: false` → 삭제(전역 기본 상속)로 옮긴다. 옛 `sessions.skip`과 `turns.mode = 'skip'`은 schema step `lophn-agent.session-permission-mode`가 `sessions.permission_mode`(`skip = 1` → `'full'`, 기본 `'workspace'`)와 `turns.mode = 'attended'`로 옮긴다.
- 옛 ledger 표 `agent_assignments`의 schema step(id `agent_assignments`)은 목록에 그대로 남는다. 이미 적용한 ledger가 id를 기록하고 있어 빼면 기동을 거절한다. 새 data root에는 data step이 돌지 않아 빈 표가 남고 쓰는 곳은 없다.
- 옛 표의 줄은 data step `approvals.assignment-file`이 옮긴다. 줄마다 그 agent 파일에 `apps`와 `permissions.deny`를 쓰고 표를 지운다. 앱이 없는 줄, active 선언에 없는 command, 정의 파일이 없거나 틀린 agent의 줄은 버린다(쓸 곳이 없다). 다시 돌아도 같은 결과다. 뒤의 data step `approvals.deny-rule-slug`가 `lophn(<domain> <낱말>)` 규칙을 앱 slug로 바꾼다.
- data step은 ledger schema step 뒤에 조립 목록 순서로 돈다. `agents.skills-off`(agent 파일의 `skills`를 `skills_off`로)가 `approvals.assignment-file`보다 먼저 돈다. 앞의 step이 옛 `skills`를 옮겨야 뒤의 step이 엄격한 schema로 agent 파일을 읽고 쓴다. 순서를 바꾸면 옛 `skills`가 남은 파일은 schema가 거절해 할당이 버려진다.
- 공유 요청은 `share_requests` 표(schema step `approvals.share_requests`)에 앱마다 한 줄이다.
- turn request, 질문 대기, `SessionGrantStore`(이번 대화 허락과 최근 거부)는 core main thread 메모리에 있고 ledger에 쓰지 않는다(durable queue가 되는 것을 막고 재시작·session 종료 시 자연히 비워진다).

폰(기기) 자격
- 기기 자격은 내 기기 명단에서 온다(`remote.md`의 "내 기기 명단"). 기기 id는 명단 전체에서 하나이고 모든 컴퓨터에서 같다. 터미널 입력 허락은 그렇지 않다: 명단은 누가 내 기기인지만 말하고, 무엇을 해도 되는지는 받는 컴퓨터가 정한다. 허락은 그 컴퓨터가 자기 ledger 표에 기기의 key로 두는 값이라 컴퓨터마다 따로이고(명단에 서명된 값이 아니므로 명단의 어떤 서명으로도 켜지지 않는다), 아래의 "허락"은 모두 받는 컴퓨터가 그 컴퓨터에서 켠 것을 뜻한다. 명단에 든 기기의 연결은 kind(`phone`, `computer`)와 상관없이 actor user, principal `device:<id>`, conditions `{process: "remote"}`인 자격 하나를 받는다. 다른 컴퓨터의 core가 link로 붙은 것도 같은 기기 자격이다. scope는 protocol의 두 remote route 목록, 모든 기기의 `REMOTE_ALLOWED_ROUTES`와 터미널 입력을 허락받은 기기에만 여는 `REMOTE_PERSON_ROUTES`의 합이다(writer가 command scope를 ledger의 자격 기록으로 보므로 사람 route도 자격에 있어야 한다). remote 연결의 `call`이 dispatch 전에 실제 route 이름으로 `authorize`해 목록 밖은 `forbidden`이고, 사람 route와 확인이 필요한 command는 그 principal의 터미널 입력 허락을 call마다 읽어 없으면 `forbidden`이다. upload body는 이 검사 뒤에야 읽는다(HTTP dispatch는 read·memory route에 scope를 보지 않아 이 검사가 경계다). `watch`로 받는 event도 종류 목록(`REMOTE_ALLOWED_EVENTS`)으로 좁힌다(`architecture/event.md`). route는 좁혔는데 event가 열려 있으면 목록에 없는 앱의 event 내용까지 폰에 간다.
- 목록은 폰의 session 목록, 대화, Inbox가 쓰는 것이다. 읽기: session·agent·project·앱 목록과 상세, turn·메시지 본문·검색, call, rewind 미리보기, provider 읽기, 입력 요청, 대화 이미지, Agents(명함, 프로필 그림, skill 읽기), Jobs 목록과 실행 기록, workflow 정의·instance 목록과 상세, project의 file 내용 검색과 file 목록·글 file 읽기(`project_files/list|read`, 등록 폴더 밖 path는 `invalid_input`), 앱 실행 기록과 release 기록, 앱이 선언한 위젯의 지금 값(`app_widgets/list`). 쓰기: `acp/snapshot|draft|send`와 그 안에서 부르는 대화 조작(보내기, 멈추기, 대기열 조작, model 바꾸기, 이름, fork, compact, rewind. 단, 기기가 coding session에 보내는 `acp/send`는 권한 설정을 바꾸는 `set_mode`를 `forbidden`으로 막고 shell 실행인 `run_shell`은 터미널 입력 허락이 켜진 기기만 받는다), session 열기와 archive, call 취소, 입력 요청 취소, 이미지 올리기, `ask/read|answer`, `turn_requests/decide`, notice 읽기·열기·읽음·치우기, activation 동의, job hold와 대기 job 승인, 공유 요청 목록과 결정, 사용자 앱의 폰 화면(`app_views/open|call|close|log_error`. `log_error`는 부른 기기가 연 live view에 묶인 앱의 log에만 쓴다), 앱 화면 annotation 보내기(`annotations/send`), 폰에서 도는 앱의 설치와 sync(`apps/phone_file`, `app_sync/push|pull|snapshot|snapshot_file`. push와 snapshot은 짝지은 기기 principal만 받고 아니면 `forbidden`이다), job 켜고 끄기(`jobs/update`는 `{job, enabled}`만 받는다. 이름·때·놓친 차례를 바꾸는 field가 하나라도 있으면 `forbidden`이고 call이 dispatch 전에 본다), workflow 시작과 멈춤, 컴퓨터의 coding agent 다루기(`coding_sessions/list|switch_plan|switch|open|wake`. `switch`는 `confirmed: true`가 있어야 하고 `open`·`wake`는 컴퓨터에서 창과 터미널 탭을 연다), coding session의 펼친 tool 본문 읽기와 그림 올리기·읽기(`acp/tool_body|image_upload|image_read`. 컴퓨터의 앱에 묻는다), coding session 터미널과 폰이 연 터미널 보기와 치기(`terminal_view/snapshot|watch|resize`로 보고 `terminals/open|input`으로 열고 친다. `resize`는 그 터미널의 lease를 쥔 기기만 잡고 `terminals/open`은 컴퓨터의 그 project 창에 터미널 탭을 연다. `terminals/input`은 목록에 있어도 그 기기의 터미널 입력 허락이 켜져 있을 때만 core가 받고 아니면 `forbidden`이다. 열면서 치는 것도 입력이라 `terminals/open`에 실은 `command`·`resume`도 같은 허락을 보고, 허락이 없는 기기는 빈 터미널만 연다. 허락은 받는 컴퓨터의 표에 있어 그 컴퓨터가 정한다. 사람이 그 컴퓨터에서 켜거나(My devices의 스위치, 화면 없는 컴퓨터는 `lophn remote terminal-input`), 그 컴퓨터가 낸 초대장으로 든 기기는 초대장에 적은 값(기본 켬)으로, 그 컴퓨터가 초대장으로 들며 초대한 컴퓨터는 합류 때의 스위치(기본 켬)로 켜진다. 다른 컴퓨터에서 바꾸는 길은 없다), 컴퓨터의 browser page 보기(`page_view/list|snapshot|watch|input|control|open`. `input`·`control`·`open`은 터미널 입력 허락이 켜진 기기만 core가 받고 아니면 `forbidden`이다. 로그인된 browser를 다루는 것은 터미널에 치는 것만큼 센 권한이다. `browser-tab.md` "멀리서 보기"), 자기를 명단에서 빼기(`roster/leave`). `acp/send`는 안의 route를 기기 자격으로 부르므로 대화 조작 route가 목록에 따로 있어야 한다.
- 사람 route 목록(`REMOTE_PERSON_ROUTES`): 터미널에 칠 수 있는 기기는 이미 그 기계를 온전히 다루므로 허락을 하나 더 만들지 않고 그 허락이 있는 기기에 사람의 처음 설정을 연다. 터미널 닫기·다시 띄우기·이름 바꾸기(`terminals/close|restart|name|rename_saved`), coding agent 감지·전역 hook 관리(`coding_agents/list|refresh|hook_status|install_hooks|uninstall_hooks`), secret 넣기·지우기·상태(`secrets/put|delete|status`, key로 provider 잇기 `providers/connect-key`, agent 요청의 답 `input_request/answer_secret`), provider(목록, 정의, 잇기와 끊기, key 없는 잇기, 구독 로그인 시작·상태·callback 전달·그만두기 `providers/sign-in|sign-in-state|sign-in-callback`, model 목록 새로 읽기와 기록), model(보일 model, 사용자 model 정보, catalog, 기본 model, workspace model), 설정 읽기·쓰기, diagnostics 상태, workspace extension 설정 읽기·쓰기와 extension tool 목록, MCP OAuth 로그인(`agent-mcp-auth/begin|callback|cancel|state`), 앱 OAuth 로그인(`apps/oauth_begin|oauth_callback|oauth_cancel|oauth_sign_out`, 상태 읽기 `apps/oauth_state`는 `REMOTE_ALLOWED_ROUTES`), agent 만들기·고치기·지우기와 프로필 그림, 전역 지침 읽기·쓰기(`instructions/read_global|write_global`), project 등록(`projects/add`, `projects/create`)·고치기·폴더 옮기기·보관과 id file, 그 기계의 폴더 목록(`projects/browse`, 사람의 home 아래만), project 등록 폴더 안 file 쓰기·만들기·이름 바꾸기·지우기(`project_files/write|create|rename|remove`, 등록 폴더 밖과 symlink 쓰기는 `invalid_input`이고 1 MiB 상한·원자 교체다. 읽기 `project_files/list|read`는 `REMOTE_ALLOWED_ROUTES`). 기기가 loopback 로그인을 시작하면 대상 core는 port를 잡지 않고 PKCE·state만 만들어 `callback_mode: "remote_handoff"`와 `redirect_uri`를 내주고, 기기가 사람이 돌아온 주소를 `*/callback`으로 건네면 대상 core가 state·PKCE 검증과 token 교환·저장을 직접 한다(`agent`·`terminal` 요청은 `REMOTE_PERSON_ROUTES`를 받지 못한다). 늘 켜 두기 읽기·바꾸기(`always_on/status|set`, 화면 없는 기계는 가서 켤 곳이 없다). 허락이 있어도 넣지 않는 것: 기기·명단 관리, 터미널 입력 허락 바꾸기, `machine/rename`, site login vault(`logins/*`), `sessions/delete`, `permissions/trust-local-tool`, `permissions/untrust-local-tool`(로컬 스크립트 신뢰는 desktop 전용), `tabs/*`, `host/*`, `apps/call_tool`, `app_grants/*`, 할당 쓰기, `agent-mcp-auth/complete`(장기 대기 호출이라 기기는 `callback`만 쓴다), `apps/oauth_client_set`. 목록에 있는 route로도 열지 않는 저장소 이름이 있다: `secrets/put|delete`는 site login vault(`login.`) 이름을 기기 자격에 `forbidden`으로 돌려주고(`put`은 body를 읽지 않는다), `settings/update`는 `remote.`로 시작하는 key가 하나라도 있으면 아무것도 바꾸지 않고 `forbidden`이다(기기의 연결 설정은 기기·명단 관리와 같은 종류다).
- 목록에 없는 것(허락 없는 기기): 앱이 폰에 묻는 `app_phone.request`(앱 자격의 route이고 폰이 부르지 않는다. 폰은 core의 `request`에 답하는 쪽이다. `remote.md`), secret, provider·설정 쓰기, 기기와 명단(자기를 빼는 `roster/leave` 하나만 있다. 초대, 들어가기, 빼기, 이름, 터미널 입력을 정하는 `roster/*`는 사람이 컴퓨터에서만), 다른 기계를 부르는 `machines/*`, agent·job·앱·project·workflow 정의의 만들기·고치기·지우기, `tabs/*`, `sessions/delete`(되돌릴 수 없다), `permissions/trust-local-tool`·`permissions/untrust-local-tool`(로컬 스크립트 신뢰는 desktop에서만). `sessions/change-mode`와 `permissions/read`·`permissions/revoke-grant`는 `REMOTE_ALLOWED_ROUTES`에 포함되나, `sessions/change-mode`는 원격 기기(`device:`)에서 단계를 낮추는 것만 허용하고 올리거나 `full`로 설정하면 `forbidden`이다. `PermissionDenied` event도 `REMOTE_ALLOWED_EVENTS`에 포함된다. 관리는 desktop에서만 한다.
- frame은 JSON뿐이라 file route의 답은 `{content_type, base64}`(한 file 8 MiB까지), upload route의 body는 `{input, base64}`이고 크기 한도는 그 route의 것이다. 기기가 부른 memory·upload route도 HTTP와 같이 성공 뒤 `StateChanged`를 내서 desktop 화면이 따라온다.
- 다른 기계로 넘긴 call. 이 컴퓨터가 다른 기계의 route를 부르는 길은 셋이고 모두 core가 link로 넘긴다: 사람의 화면과 터미널이 쓰는 `machines/call`(받는 기계의 기기 route 하나), agent와 앱이 쓰는 `apps/call_tool`의 `remote` target(받는 기계의 앱 command 하나. `app-call.md`), agent의 다른 컴퓨터 agent 목록과 mail(`machines/sessions|agents`가 부르는 `a2a/sessions|agents`, outbox drain이 부르는 `a2a/mail`. `machine-a2a.md`). 넘기는 call에는 요청한 쪽(`by`)이 실린다. 요청한 쪽은 core가 부른 자격에서 정하고 입력의 다른 칸으로 싣는 길이 없다: 살아 있는 shell capability를 실은 `machines/call`이 `screen`(그 기계의 shell이 그린 사람의 화면), capability 없이 부른 사람의 CLI token의 `machines/call`이 `terminal`(이 컴퓨터의 CLI token을 쥔 쪽이다. lophn 터미널 탭에서 치는 coding agent도 같은 token을 쓰므로 사람의 터미널과 같지 않다. capability가 있는데 살아 있지 않으면 `forbidden`이다), agent 자격의 앱 호출, core가 그 agent 대신 하는 `machines/app_tools`·`machines/sessions|agents`, mail을 쓴 agent의 이름으로 보내는 drain이 `agent`, 앱 자격의 앱 호출이 `app`이다. agent와 앱 자격은 `machines/call`의 actor가 아니다. capability는 그 기계로 넘기지 않는다. 폰은 `by`를 싣지 않는다. 받는 기계는 그 컴퓨터가 명단의 컴퓨터(principal `device:<id>`)인지 보고 요청한 쪽마다 아래 표로 대한다. 사람의 화면이 아닌 요청은 사람의 route와 자동 확인을 받지 못한다. 컴퓨터의 core가 자기 일로 보내는 call(폴더로 나르는 file의 pull과 push, `carry/*`)은 사람이 시킨 것이 아니라 `by`가 없고, 받는 기계는 그 call에 `REMOTE_CORE_ROUTES`만 연다. 받은 call은 다른 기계로 다시 넘기지 않는다(A가 B를 거쳐 C로 닿는 길이 없다): `machines/*`가 기기 route 목록 밖이고, 받는 기계의 앱 호출이 낳은 호출은 호출 사슬에 `remote`가 있어 이 기계가 다시 넘기지 않는다. 기기의 call이 실패하면 오류의 `details`도 그대로 싣는다.

받는 기계가 요청한 쪽마다 하는 일("허락"은 그 컴퓨터에 대해 받는 컴퓨터가 자기 ledger에서 켠 터미널 입력 허락이다. 앱에 시키는 것은 그 기계를 다루는 것이다. 어느 요청이든 먼저 부른 기기가 명단의 컴퓨터인지와 `by`가 그 kind와 맞는지를 본다):

| 요청한 쪽 | 기기 목록(`REMOTE_ALLOWED_ROUTES`) | 사람 목록(`REMOTE_PERSON_ROUTES`)과 확인이 필요한 command | 앱 command 입구 `apps/remote_call` |
|---|---|---|---|
| 폰(`by` 없음) | 된다 | 허락이 있으면 | 안 된다(컴퓨터만) |
| 컴퓨터의 core(`by` 없음) | `REMOTE_CORE_ROUTES`(`carry/*`)와 `REMOTE_COMPUTER_CORE_ROUTES`(`browser_vault/exchange`)만. 허락과 상관없고 그 밖은 `invalid_input`이다 | 안 된다 | 안 된다 |
| 컴퓨터의 `screen` | 된다 | 허락이 있으면(지금처럼 handle을 붙인다) | 허락이 있으면 |
| 컴퓨터의 `terminal` | `REMOTE_TERMINAL_DENIED`를 뺀 것 | 안 된다 | 허락이 있으면(private인 앱도 된다) |
| 컴퓨터의 `agent`, `app` | `REMOTE_AGENT_ROUTES`의 앱 읽기 셋(`apps/list|get|tools`)과 agent 사이의 `a2a/mail|sessions|agents`만. private인 workspace의 앱은 목록에서 빠지고 읽으면 `not_found`다. `a2a/*`는 허락과 상관없이 `agent` 요청을 받고 private인 workspace를 없는 것처럼 답한다 | 안 된다 | 허락이 있고 대상 앱의 workspace가 private이 아니면 |

- `REMOTE_TERMINAL_DENIED`는 터미널과 browser page를 움직이는 route(`terminals/input|open`, `page_view/input|control|open`)와 사람이 agent의 물음에 결정을 남기는 route(turn request, 질문 답, job 승인과 hold, 늦게 온 mail의 결정 `mail/decide_hold`, activation 동의, 공유 요청 결정, 그 입구인 `acp/send`)다. `terminal`은 사람이 친 것인지 그 사람의 CLI token을 쥔 coding agent가 친 것인지 가를 수 없고, 허락은 그 컴퓨터의 화면에 준 것이지 그 컴퓨터의 shell에서 도는 것에 준 것이 아니기 때문이다. 폰(`by` 없음)과 `screen`은 이 목록을 보지 않는다. 터미널 입력과 page 조작은 그 route의 handler가 principal의 허락을 한 번 더 보고(허락이 없으면 `forbidden`), 결정 route는 허락과 상관없이 연다(사람이 그 기기의 화면에서 답하는 것이다).
- 앱 command 입구는 `apps/remote_call`이다. 명단의 컴퓨터인 `device:` principal이 아니면 `forbidden`이고, 같은 앱이 다른 컴퓨터에서 자기 자신 command를 부르는 경우를 빼면 `public` command만 받는다. 요청한 쪽은 call frame의 `by` 하나로만 오고 route 입력에는 칸이 없다(body에 `by`를 실으면 strict라 `invalid_input`이다). 받는 기계의 remote call 처리만 frame의 `by`를 handler에 넘기고 body로 대신하지 않는다. 폰이 `by`를 실으면, 명단의 컴퓨터가 `by` 없이 부르면 `invalid_input`이다(그 컴퓨터의 core 자신의 일인 `carry/*`만 예외다). 호출 기록의 caller는 `{kind: remote, machine, device, requester}`라 어느 컴퓨터의 누가 불렀는지 남는다. `requester`의 이름과 agent는 부른 컴퓨터가 쓴 값이라 받는 기계는 그 값으로 아무것도 정하지 않고 기록에도 부른 컴퓨터가 주장한 값으로 남긴다.
- 부른 기계의 할당은 받는 기계가 다시 따지지 않는다. 명단의 컴퓨터는 대등하고 그 사람의 것이라 받는 기계는 요청한 컴퓨터가 명단에 있는지, 터미널 입력 허락이 있는지, 대상 앱의 workspace가 private이 아닌지, command가 밖에 내놓은 것(`public`, 또는 같은 앱의 자기 자신 호출)인지만 본다. 이 값들은 모두 받는 기계가 자기 data로 보고 frame에 실린 값으로 정하지 않는다.
- `apps/call_tool`은 이 입구로 대신하지 않는다. 기기 자격이 `person` caller가 되어 Gate를 건너고 operation까지 닿고, `runs/start`는 run 기록이 사람 caller라 agent run까지 연다. 그래서 다른 기계의 앱을 부르는 입구는 새 route 하나다.
- 요청한 쪽은 보내는 컴퓨터의 core가 정직하게 싣는다는 것에 기댄다. 받는 기계가 확인할 수 있는 것은 Noise로 인증된 명단의 컴퓨터가 보냈다는 것뿐이다. 뚫린 컴퓨터는 `screen`을 주장할 수 있고 허락이 있으면 사람의 route와 자동 확인까지 받는다. 그것을 한정하는 것은 받는 컴퓨터가 그 컴퓨터에 준 허락(켜고 끄는 스위치 하나)이다.
- 다른 컴퓨터의 agent가 보낸 mail이 여는 session은 받는 컴퓨터가 그 컴퓨터에 터미널 입력 허락을 켜 두었을 때만 agent 정의의 `permission_mode`를 따르고 아니면 최대 `workspace` 이하로 상한을 둔다. 허락은 mail을 받을지에는 쓰지 않는다(명단의 컴퓨터는 mail을 받는다). 늦게 온 mail의 [Start now]는 정하는 때의 허락으로 본다(`machine-a2a.md`).
- private은 기계 사이에도 선다. 자리가 둘이고 각자 자기 workspace의 설정(call 정책의 `private` 목록)으로 본다. 부르는 기계가 막는다: private인 workspace의 agent와 앱은 다른 기계를 부르지 못한다. 받는 기계가 막는다: 대상 앱의 workspace가 private이면 그 앱은 다른 기계에서 불리지 않고 그 앱의 목록·읽기도 `agent`·`app` 요청에는 보이지 않는다. 기계 사이에는 call 정책의 workspace 쌍 규칙을 보지 않는다(그 key는 기계마다의 id다). private 목록만 본다. 사람의 화면과 터미널은 private이어도 된다. agent가 같은 기계의 앱을 부를 때는 지금처럼 할당만 본다.
- 앱 화면의 앱 session·call route(`app_sessions/list|status|stop|open|end`, `app_calls/send|read|cancel|list`, `app_agents/list`)는 기기가 다른 컴퓨터에 띄운 이 기계의 앱 화면을 대신해 부른다. 이 route들은 사람 자격이면 입력의 앱을 그대로 쓰므로, 기기(principal `device:<id>`)는 자기가 연 앱 화면의 view(`view`)를 줘야 하고 앱은 core의 view 표에서 그 (기기, view)의 앱이다. view가 없으면 `forbidden`, 그 기기가 연 view가 아니면(없는 view, 다른 owner의 view) `not_found`, live가 아니거나 묶음을 잃은 view와 다른 앱을 적은 입력은 `forbidden`이다. 이 컴퓨터의 shell(principal `user`)과 앱 자격은 view 없이 그대로다. 기기가 보낸 메시지의 앱 이름표(`acp/send`의 `via_app`)는 그 기기가 그 앱의 live view를 열어 두었을 때만 붙고 아니면 이름표 없이 간다.
- agent 자격은 `roster/*`와 `machines/list|call|watch`를 부르지 못한다(agent가 부르는 `machines/sessions|agents`는 그 session 대신 core가 정한 요청한 쪽 `agent`로 받는 컴퓨터의 `a2a/*`만 부른다). 사람의 route는 actor user만 받고(agent의 shell에서 부른 `lophn remote …`도 여기서 막힌다), 명단을 저장하는 `roster/statements|store|forget_all`은 core 안 machine 자격만 받는다.
- 기기를 빼면(`roster/remove`, 어느 컴퓨터에서나 사람만. 기기는 `roster/leave`로 자기만) 그 컴퓨터가 서명한 빼기가 명단을 따라 모든 기계에 퍼진다. 빼기를 안 기계마다 그 기기의 자격을 거두고 연결을 `closed(credential_revoked)`로 닫으며 폰의 기기 행과 push token을 지운다. 연결과 자격은 id만이 아니라 key로도 찾는다(뺀 key의 연결은 id가 무엇이든 닫는다). 뺀 key는 다시 붙지 못하고 `join`이 그 빼기를 실어 거절한다. 붙는 중(key를 찾은 뒤 자격을 받기 전)에 빼면 빼기가 그 연결을 아직 모르므로, 연결이 자격을 받은 뒤 key를 다시 찾아 없으면 자격을 거두고 닫는다.
- 확인이 필요한 command(지금 `providers/disconnect` 하나)를 허락받은 기기가 보내면 사람이 확인한 것으로 본다(기기 자격은 handshake한 기기 key로만 생기고 agent가 얻을 수 없다). `call`이 기기가 보낸 `confirmation`을 버리고 `confirmationBinding(route, input)`의 대상과 내용에 묶은 handle을 core 확인 registry에서 바로 받아 싣는다(`window_id`는 `device:<id>`, 허용 결정은 그 route 이름 하나, 기한은 지금부터 120초). 허락이 없거나 actor user인 `device:` principal이 아니면 `forbidden`이다. 화면은 보내기 전에 Dialog로 한 번 묻는다. 기기 자격으로 handle을 등록하는 route는 없다(shell capability가 없다).

사람 결정 handle
- 보호 입력 창(secret 입력 등)에서 사람이 고른 결정을 core에 묶는 1회용 참조다. 창, 대상, 내용 기준, 허용 결정, 기한(발급 뒤 120초와 대상 기한 중 이른 것)에 묶인다. 원문은 core 메모리에만 있고 ledger·event·log에 쓰지 않는다.
- shell capability로만 등록한다. capability는 control `connect {client: shell}`의 응답에만 실리고 shell main 메모리에만 있다(argv, env, file, renderer, log로 내지 않는다). shell main은 Gateway handshake의 `x-lophn-shell-capability`로 자기 수명을 묶고, core는 그 Gateway가 끝나면 capability와 소비하지 않은 handle을 버린다. HTTP user token, agent·worker credential, route, CLI(`client: cli`)에는 등록 길이 없다. 예외는 허락받은 기기의 `call`이 core 안에서 바로 받는 handle 하나다(위 "폰(기기) 자격").

## 결정

- **권한 4단계(`read_only` 보기만 / `ask` 다 묻기 / `workspace` 고치기는 알아서 / `full` 다 맡기기)와 설정 가능한 전역 기본 단계(초기 기본값 ③ `workspace`)** (사람, 2026-11-25 — 2026-10-20의 "할당이 허락, shell 기본 allow, `session` 허락 폐지" 및 2026-10-21의 "할당 tool external 미질문" 결정을 대체): `shell.run` 기본 allow와 단순 2단계(`ask | skip`)는 물어야 할 것을 놓치고 중간 자율 단계를 표현하지 못했다. 기본 ③(`workspace`)은 lophn이 rewind 기록을 남기는 등록 폴더 안 `file.*` 쓰기와 내장 읽기 shell 명령만 묻지 않고, 그 밖의 shell·바깥 폴더·비신뢰 MCP·미신뢰 로컬 tool은 묻는다. 전역 기본은 `approvals.default_mode`로 사람이 고르고, `session`("이 대화 동안") 선택지를 되살려 반복 마찰을 줄인다.
- **사람이 없는 실행(`unattended`)에서 `ask`는 `deny`(`no_person`)** (사람, 2026-11-25 — 2026-10-20의 "unattended는 묻지 않고 실행" 결정을 뒤집음): 무인 실행에서 `ask`를 통과시키면 안전장치가 무력화된다. 미리 둔 allow 규칙과 명시적 ④(`full`) 모드(사람이 agent 정의 또는 workflow participant 모드로 opt-in)만 무인으로 통과한다.
- **등록 폴더 밖 파일은 `ask`(`once | session | reject`)로 열고 민감·자기 보호 경로는 계속 차단** (사람, 2026-11-25): 바깥 폴더를 일괄 `forbidden`으로 막으면 정당한 작업이 막히고, `session`으로 연 폴더 안 쓰기도 rewind 기록에 넣어 복구할 수 있게 한다. `~/.ssh`, `~/.aws`, `~/.gnupg`와 `<data root>` 설정·권한·agent 정의·secret은 계속 차단한다.
- **내 앱 command별 `ask_tools`, 외부 MCP `trust`, 로컬 tool `(realpath, sha256)` 신뢰** (사람, 2026-11-25 — 2026-10-21의 "할당 tool 무조건 실행" 보완): 할당한 내 앱은 기본 통과하되 command별로 사람이 묻기를 켤 수 있게 하고(`ASK_EXTERNAL_WHEN_ATTENDED` 상수 제거), 외부 MCP는 `trust: trusted | untrusted`(기본 `untrusted`)로 비읽기 tool을 물으며, 로컬 tool은 처음과 내용이 바뀌었을 때 사람 전용 등급으로 한 번 묻는다.
- **workflow participant별 권한 단계는 `workflow.yaml`이 아니라 사람 전용 설정(`approvals.workflow_modes`)과 `StartWorkflow.participant_modes`에 둔다** (사람 2026-11-25 방향, 기술 결정 agent): workflow 파일은 agent가 쓰므로 거기에 단계를 두면 agent가 자기 권한을 올린다. job 승인 카드가 쓰일 단계를 보이고 승인 후 기억된 단계가 `full`로 오르면 자동 일시정지(`mode_escalated`)한다.
- **통합 결정적 판정 엔진(`evaluatePermission`)과 고정 우선순위 `deny > ask > allow`, 격리 슬롯 `IsolationBackend = "none"`** (agent, 2026-11-25): `findLast`의 실수 구멍을 없애고 모든 범주(`shell`, `file_*`, `app_tool`, `mcp_tool`, `local_tool`, `setting`, `project_command*`)를 한 순수 함수로 통합한다. OS sandbox와 LLM 판정(guardian)은 넣지 않고 `IsolationBackend = "none"` 슬롯만 둔다.
- **TypeScript 순수 상태 기계 shell 스캐너와 안전한 `always` 패턴** (agent, 2026-11-25 — 2026-10-21의 "문자열 정규화·파서 미사용" 및 "앞 두 낱말 + `*`" 결정을 뒤집음): `sh -c "rm -rf ~"`, `env rm -rf ~`, `rm -r --force ~`가 floor를 통과하는 데이터 손실 버그와 `rm -rf *` 같은 넓은 영구 허락 버그를 막는다. native tree-sitter 없이 순수 TypeScript 상태 기계로 래퍼(깊이 8)·flag·home 경로 정규화와 `opaque`/`elevated` 비대칭 검사를 구현한다. 이미 저장된 넓은 규칙은 지우지 않고 Settings에서 경고 표시만 단다.
- **거부 언마스킹(`PermissionDenial`), 우회 금지 지침, `PermissionDenied` event, 5칸 `/permissions`, 복구 버튼** (agent, 2026-11-25): model이 이유 없는 "tool target is not available"을 받으면 헛돌고 `shell.run`으로 우회한다. 권한·범위·모드·정책 거부와 handler `forbidden`을 그대로 알리고 우회 금지 지침을 붙이며(존재 숨김만 `not_found`), 사람 화면에도 타임라인 "막힘" 표시와 복구 버튼을 둔다. 이유 없는 거절은 배치의 남은 쓰기·외부 호출을 멈추고, 이유 있는 거절은 계속한다.
- **원격 기기의 `sessions/change-mode`는 하향 전용(downgrade-only), 로컬 tool 신뢰는 desktop 전용** (agent, 2026-11-25): 2026-11-15의 "폰에서 권한 넓히기 금지" 원칙을 4단계 모델에 맞춰 유지한다. 폰에서 급히 단계를 낮추어 제동을 거는 것은 허용하되 올리거나 `full`로 설정하는 것은 `forbidden`이다.
- (이전 기록, 2026-10-20/21) "시킨 것이 승낙이고 할당이 허락이다", "할당 tool의 external도 묻지 않음", "이 session 동안 허락 폐지", "unattended는 묻지 않음", "문자열 floor와 앞 두 낱말 `always`" 결정은 위의 2026-11-25 사람·기술 결정으로 대체되었다.
- unattended에서 activation을 저절로 동의하는 장치를 두지 않는다. (사람, 2026-10-20)
- 앱을 지은 agent가 공유를 제안하고 사람이 한 번 승인하면 앱의 command(부르기)와 public skill(알기)이 한 할당으로 같이 간다. 공유 요청은 turn 안 request가 아니다. 이유: 요청한 agent의 turn이 끝난 뒤에도 사람이 승인할 수 있어야 하고(activation 동의, job 승인과 같은 꼴), agent가 할당을 직접 쓰는 길은 두지 않는다. (사람, 2026-11-02)
- 앱의 activation 동의가 대기 중이면 공유 요청을 그 동의와 한 번에 승인한다. 이유: builder가 만들고 grant까지 알아서 해 주기를 바랐다. 사람의 승인은 남기되 한 번으로 줄였다. (사람, 2026-11-07)
- 설정과 secret을 넣는 기기는 터미널 입력을 허락받은 기기다. 허락을 하나 더 만들지 않는다. 이유: 터미널에 칠 수 있는 기기는 이미 그 기계를 온전히 다룬다. 허락받은 기기의 확인이 필요한 command는 받는 core가 handle을 붙인다. (사람 "기존의 approval이랑 크게 다를 게 없다", 2026-11-18)
- 동의 카드가 본 공유 요청의 `requested_at`을 싣고 그 사이 요청이 바뀌었으면 동의째 `conflict`다. 공유를 먼저 적용하고 실패하면 tx가 되돌아가 동의는 대기로 남는다. 이유: 사람이 보지 못한 요청을 승인하지 않는다. (agent)
- 팀 자식의 질문과 승인은 사람이 아니라 부모가 먼저 답한다. 이유: 자식의 물음이 모두 사람에게 오면 coordinator가 할 일을 사람이 한다. 부모가 판단할 수 없으면 자기 `ask`로 위로 올린다. (사람, 2026-11-08)
  - 올리는 장치를 따로 두지 않는다. 부모가 자기 `ask`를 쓰면 같은 규칙이 사슬을 만든다. (agent)
  - 부모의 승인 답은 글이 아니라 `call reply`의 구조 칸이다. 새 명령을 두지 않았다. 부모는 이미 `call reply`를 안다. (agent)
  - 팀 자식의 event는 그대로 내고 `to_parent` 표시로 거른다. `TurnResumed`, snapshot의 `waiting`, acp가 그 event에 기댄다. (agent)
  - 팀 자식의 권한 단계는 `min(부모 단계, 정의/전역 기본값)`으로 상한을 두고, 사람 전용 등급은 부모가 대신하지 못한다. (agent, 2026-11-25)
- job은 사람이 등록을 한 번 승인해야 돈다. job의 허락은 만든 agent의 할당이 아니라 그 등록 승인이다. 이유: job은 agent가 만들고 정해진 때 사람 없이 돈다. agent가 혼자 정한 일이 사람 없이 되풀이되지 않게 하고 허락의 범위를 그 job의 할 일 하나로 맞춘다. 할당으로 허락하면 job 하나를 위해 그 agent에게 앱 전체를 열어 줘야 한다. 승인 뒤 할 일은 바뀌지 않는다. job이 부르는 agent run과 instance는 unattended이고 받은 agent의 할당과 권한 단계로 일한다. 앱 tool 호출은 승인이 허락이다. 버린 안: 앱 place에서 만든 job만 할당 검사를 건너뛰기, 만들 때 할당을 검사해 거절하기. (사람)
- flow는 project workspace의 agent가 쓴 code라 그 agent의 할당이 허락이다. code에 credential을 주지 않으므로 다른 자격을 빌릴 길도 없다. (agent)
- 묻는 길은 기다리는 turn 하나, fingerprint 없음, agent call은 묻지도 막지도 않음, `LOPHN.md` 쓰기는 묻지 않음, reaction은 `off | on`이고 새 일 handler는 approvals를 거치지 않는다. 이유: 개념이 많고 같은 판정을 여러 번 했다. agent call은 받은 agent가 자기 할당으로만 일하므로 부르는 쪽에서 판정할 이유가 없다(`products/AGENT.md` T5, T6). 누구를 부르는지는 지침과 workflow의 일이다. (agent)
- 보류 request 길(저장 표와 applier)을 지웠다. 쓰던 둘 가운데 reaction의 `ask`는 지웠고(그 reaction 설정이 없어졌다), activation 동의는 activation module이 자기 상태로 갖는다. (agent)
- MCP server는 설정한 층이 곧 할당이라 할당 줄은 앱만 둔다. (agent)
- LLM 판정을 넣지 않았고 OS sandbox와 timeout도 두지 않았다(비목표).
- CLI의 `--dangerously-skip-permissions`는 두지 않는다. 무인 실행 권한은 agent 정의의 `permission_mode`나 허용 규칙으로 사람이 명시적으로 정한다. (agent)
- 사람 결정 handle은 shell capability로만 등록한다. 이유: HTTP token은 renderer와 앱 view, CLI를 쓰는 terminal agent까지 같은 값이 퍼지고 agent·worker credential은 agent의 것이라 그 자격으로 등록하면 agent가 사람의 결정을 흉내 낼 수 있다. 그래서 사람만 쓰는 창을 가진 shell main에만 주는 다른 자격을 둔다. 경계는 control socket 자리(같은 사용자, 0700 폴더, named pipe)이고 OS peer 신원은 보지 않는다. 같은 사용자의 process는 이미 `secrets.json`을 읽을 수 있어(`architecture/agent-definition.md`의 secret 저장소, `architecture/platform.md`의 data root) peer 검증이 더 막는 것이 없고 세 OS native addon이 든다. (agent)
- 판정이 읽는 할당을 call 때마다 읽는 것과 MCP 연결 call이 server 설정을 다시 읽는 것은 사람이 거둔 권한이 바로 거둬지게 하려는 것이다. 버린 안: server를 끄는 바뀜마다 연결을 끊기(바뀜을 알리는 길을 새로 둬야 한다). (agent)
- 폰의 자격은 사람과 같은 actor user이되 route를 목록으로 좁힌다. principal을 기기마다 두어 입장 한도와 command 결과를 shell과 나누지 않는다. 이유: 폰은 일하는 창이고(보기, 말하기, 답하기) 관리는 desktop에 남긴다. 신원은 bearer token이 아니라 handshake로 받은 공개 key다. 버린 안: 폰용 actor 종류를 새로 두기(사람의 결정 route가 모두 그 종류를 받아야 하고 뜻이 같은 사람이다). (agent, 사람이 추천을 받음 2026-11-14)
- 기기 자격은 내 기기 명단에서 온다. 기기 id는 명단 전체에서 하나이고 모든 컴퓨터에서 같지만 터미널 입력 허락은 받는 컴퓨터가 정해 컴퓨터마다 따로다. 부를 수 있는 route 목록은 kind와 상관없이 하나다. 이유: 한 번 들인 기기가 모든 컴퓨터에서 같은 기기여야 어느 컴퓨터에서나 빼고 알아본다. 허락은 명단에 서명된 값이면 명단의 컴퓨터 누구나 다시 서명해 켤 수 있어(컴퓨터가 자기 허락을 스스로 켜는 구멍이 실제로 있었다) 경계가 못 된다. 그래서 허락은 받는 컴퓨터의 ledger 표에 두고 그 컴퓨터 앞의 사람이 켠 것만 인정한다. 잃는 것: 한 번 켜면 모든 컴퓨터에 서던 것이 없어져 컴퓨터마다 한 번씩 켠다(초대장의 허락과 합류 때의 스위치가 그 한 번을 줄이고, 첫 기동은 켜져 있던 허락을 옮긴다). 버린 안: 컴퓨터마다 기기 표와 그 컴퓨터 안에서만 뜻이 있는 `dev_`, 명단 항목에 둔 모든 기계에 같은 허락(앞의 판). (agent, 사람: "기존의 approval이랑 크게 다를 게 없다"로 한 번 정했다가 허락은 받는 컴퓨터가 정하는 것으로 고쳤다, 2026-11-19)
- 다른 기계로 넘기는 call에 요청한 쪽을 싣고 받는 기계가 종류마다 다르게 대한다. 이유: 받는 기계가 모두를 "그 컴퓨터의 사람"으로 보면 agent와 앱이 보낸 call이 사람의 route와 자동 확인을 받는다(`core-setup` review의 지적). 사람의 터미널은 새 route 없이 `machines/call`을 같이 쓰고 요청한 쪽만 자격으로 가른다. 넘기는 길이 하나라야 막는 자리가 하나다. 버린 안: 입력에 요청한 쪽 칸을 두는 것(agent가 `screen`을 주장한다), 터미널 전용 route. (agent)
- 허락은 부르는 기계에서 할당으로 보고 받는 기계는 자기 규칙을 본다. 이유: 명단의 컴퓨터는 대등하고 그 사람의 것이다. 부른 기계의 할당을 다시 따지면 두 기계의 설정이 어긋나 안 되는 이유를 찾을 수 없다. 대신 받는 기계가 자기 것(명단, 터미널 입력 허락, private, `public`)은 늘 본다. (사람 "기존의 approval이랑 크게 다를 게 없을 거 같은데", agent)
- 앱 command의 허락(터미널 입력 허락)과 사람의 route의 허락은 같은 스위치 하나다. 이유: 앱에 시키는 것은 그 기계를 다루는 것이고 터미널에 칠 수 있는 컴퓨터는 이미 그 기계를 온전히 다룬다. 허락을 하나 더 만들지 않는다. 잃는 것: "터미널은 되지만 agent와 앱은 안 된다"를 고를 수 없다. (agent)
- private은 기계 사이에도 서고 두 자리에서 본다. 부르는 기계는 부른 쪽 workspace(private이면 보내지 않는다)를, 받는 기계는 대상 앱의 workspace를 각자 자기 call 정책의 `private` 목록으로 본다. 쌍 규칙은 기계 사이에 보지 않는다. 이유: 쌍 규칙의 key가 기계마다의 id이고 상대의 설정을 읽을 길이 없다. 사람의 화면과 터미널은 private이어도 된다. (사람, 2026-11-17)
- `terminal`은 사람의 터미널이 아니라 그 컴퓨터의 CLI token을 쥔 쪽이다. 이유: lophn 터미널 탭의 shell은 사람 token을 받고 거기서 도는 coding agent와 사람을 가를 수 없다(`cli`가 명단을 바꾸는 명령을 막는 것도 지나가는 실수 막기다). 그래서 받는 기계는 `terminal`에 사람의 route, 자동 확인, 터미널·page를 움직이는 route, 사람의 결정 route를 주지 않고 앱 command와 기기 목록의 읽기만 연다. 잃는 것: 그 컴퓨터를 허락한 상태에서 CLI token을 쥔 coding agent는 `lophn … --on`으로 앱의 public command를 부를 수 있다. 그 범위는 받는 컴퓨터가 그 컴퓨터에 준 허락 하나로 정해진다. (agent)
- 컴퓨터의 core가 스스로 하는 call(나르기)은 요청한 쪽 없이 보내고 받는 기계가 `REMOTE_CORE_ROUTES`와 `REMOTE_COMPUTER_CORE_ROUTES`만 연다. 뒤의 목록(login 값이 실리는 `browser_vault/exchange`)은 그 길만 받고 폰과 요청한 쪽이 있는 call은 `forbidden`이다(`browser-tab.md` "기계 사이"). 이유: 시킨 사람이 없는 일을 `screen`이나 `terminal`로 꾸미면 그 종류의 권한이 샌다. 다섯째 종류를 만들어 `by`에 싣는 것보다 `by` 없음을 core 자신으로 두는 것이 받는 쪽의 검사를 하나로 둔다. 버린 안: 나르기를 `terminal`로 보내기. (agent)
- agent가 sync 폴더(destination)를 바꾸는 것은 사람이 그 한 번을 허락할 때만이다. 지금 있는 승인 카드에 이름과 전체 local 경로가 보인다. unattended turn과 팀 자식은 요청하지 못한다. 이유: 사람의 data가 data root를 떠나 바깥 도구가 올리는 폴더로 가기 시작하는 일이라 pairing·연결과 같다. 버린 안: locked(agent가 지침대로 바깥 도구를 붙이는 길이 막힌다), 묻지 않고 바꾸기. (planner, 2026-11-16 뒤집음)
- 설정의 승인은 새 묻는 길을 두지 않고 그 agent의 `lophn settings` tool call로 같은 turn 안 request를 연다. route가 묻고 기다리며, 허락은 그 호출이 물은 값 한 번이다. 이유: request id를 실어 나중 쓰기에 맞추는 길보다 바꿔치기할 틈이 없고(지키는 것 14), 카드·대기 목록·폰이 그대로 쓴다. 사람 전용 등급이라 `full` 단계에서도 묻는다. (agent)
- turn request, 질문 대기, `SessionGrantStore`를 메모리에 두는 것은 의도다. ledger 표로 옮기면 durable queue가 되고, 재시작이 기다리던 turn을 끊고 이번 대화 허락을 비우는 것은 의도다. (agent)

## 열린 것

- 허락은 컴퓨터마다 스위치 하나다. 허락한 컴퓨터의 agent와 앱은 받는 기계의 private이 아닌 앱의 public command를 모두 부를 수 있고, 받는 기계의 사람이 "터미널은 되지만 agent는 안 된다"를 고를 길은 없다.
- 요청한 쪽은 보내는 컴퓨터의 core를 믿는다. 허락한 컴퓨터가 뚫리면 `screen`을 주장해 사람의 route와 자동 확인까지 받는다. 허락을 끄거나 그 컴퓨터를 명단에서 빼야 끝난다. `terminal`도 CLI token을 쥔 coding agent와 사람을 가르지 못한다.
- agent나 앱이 다른 컴퓨터의 앱을 부른 기록이 부른 컴퓨터에는 없다(대화의 tool 호출과 받는 기계의 `remote` 행뿐). 받는 기계는 requester의 이름을 부른 컴퓨터가 쓴 대로 남긴다.
- 초대 없이 명단에 든 컴퓨터는 어느 쪽에도 허락이 없어 서로 켜야 한다. 초대한 컴퓨터의 스위치는 다른 컴퓨터가 그 초대로 든 기기를 먼저 받아들이고 그 항목이 초대 서명보다 먼저 닿으면 쓰이지 않고 사람이 My devices에서 켠다.
- 받은 호출이 낳은 event로 도는 job과 그 job이 부르는 agent는 받은 호출로 표시되지 않아 그 agent가 자기 할당으로 세 번째 컴퓨터를 부를 수 있다(`event.md`, `job.md`).
- harness agent(lophn agent turn 밖에서 `lophn settings`를 부르는 coding agent)는 설정의 승인을 묻지 못해 `approval: "person"` 설정을 늘 바꾸지 못한다(`needs_approval`). sync 폴더를 바꿀 Settings 화면도 아직 없어 사람은 자기 터미널의 `lophn settings set`을 쓴다.
- unattended coding agent의 물음에 lophn이 hook으로 받아 권한 규칙으로 답하기(deny와 floor면 거절, 나머지는 허락)는 아직 만들지 않았다. 앱 문제를 coding agent에게 맡기는 흐름이 다시 열릴 때 만든다(`project-docs/products/roadmap/approval.md`).
- reaction이 연 turn의 mode는 지금 attended다. 지금 session을 여는 reaction이 coding session 끝 알림 하나뿐이고 그 흐름이 막혀 있어 열 일이 없다.
- OS sandbox는 아직 없다(`IsolationBackend = "none"`). `shell.run`은 내장 읽기 명령 외 기본 묻기와 상태 기계 스캐너로 가드하지만, 한 번 허락한 명령이나 스크립트 안에서 일어나는 일은 OS 경계로 막지 못하며 rewind 밖이다(이슈 `shell-run-bypasses-file-scope`).
- 한 session에 turn 하나가 도는 전제에 기대어, turn이 끝나면 그 session의 request를 모두 닫는다.
- 사람이 `always`를 저장하는 사이 turn이 끝나 request가 cancelled로 먼저 닫히면 규칙은 이미 저장되고 응답은 `conflict`다. 이 규칙을 남길지는 정하지 못했다.
