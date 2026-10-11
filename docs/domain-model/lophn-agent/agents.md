---
type: domain-model
concerns: [lophn-agent/agents]
---
# lophn-agent/agents

AgentDefinition(agent 정의 파일), 설정 층, run마다 고정하는 ResolvedAgent, 역할별 tool 상한을 정의한다. 정의는 파일이라 ledger 표가 없고, agent의 실행 정체는 → lophn-agent/assignments다.

## AgentDefinition (파일)

agent 하나의 정의는 Markdown 파일 하나다. 앞부분(frontmatter)이 설정 칸이고 본문이 그 agent의 지침이다. 파일에는 사람이 바꾼 칸만 있고(sparse) 없는 칸은 아래 층을 따른다. 저장은 파일 전체를 덮어쓰는 것이며 판은 없다. 이 entity는 ID 접두사가 없다: Operator는 assignment ID가, built-in은 역할 이름이 정의를 가리킨다.

### 자리와 파일 이름

`<자리>`는 `<data root>/projects/<project-id>` 또는 `<data root>/apps/<app-id>`이고 정의는 그 아래 `agents/` 폴더에 둔다. project 폴더나 앱 폴더에는 쓰지 않는다.

| 정의 | 놓일 수 있는 자리 | 파일 이름 | assignment |
|---|---|---|---|
| lophn | project, 앱 | `lophn.md` | 전역 lophn assignment 하나(scope `all`) |
| Context Engineer | project | `context-engineer.md` | 전역 Context Engineer assignment 하나(scope `all`) |
| App Engineer | 앱 | `app-engineer.md` | 그 앱의 App Engineer assignment |
| Operator | project, 앱 | `<assignment id>.md` | 그 파일의 assignment ID가 가리키는 Operator assignment |
| 자리 설정 | project, 앱 | `settings.md` | 없음(PlaceAgentSettings) |

built-in 파일은 그 자리에서 사람이 바꾼 칸이 있을 때만 있고 없으면 제품 기본이다. Operator 파일 이름이 assignment ID이므로 정의와 실행 정체의 연결은 이름을 바꿔도 변하지 않는다(`name`은 칸이다). 파일이 없는 assignment, assignment가 없는 파일은 agent로 세지 않는다(목록의 정본은 assignment).

### 칸

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `name` | string | 아니오 | Operator에만 있음; trim 뒤 1자 이상; 같은 자리 Operator 사이 name_key(대소문자·앞뒤 공백 무시) unique; `lophn`·`Context Engineer`·`App Engineer` 불가 | 사람이 고르는 이름 |
| `profile` | Profile | 예 | null이면 기본 icon | avatar |
| `model` | ModelChoice | 예 | null이면 아래 층 | 이 agent의 model과 option |
| `contexts` | `ctx` ID 배열 | 아니오 | project Operator에만 있음; 기본 `[]`(0개 허용); 중복 없음; 존재하고 그 project의 context | 읽을 context |
| `app_reads` | AppRead 배열 | 아니오 | 앱 Operator에만 있음; 기본 `[]`; `(app, command)` unique | 읽을 앱 command |
| `skills_off` | string 배열 | 아니오 | 기본 `[]`; 끈 skill 이름; 중복 없음 | 끈 skill |
| `mcp_off` | `{server_name, original_tool?}` 배열 | 아니오 | 기본 `[]`; `original_tool` 생략은 그 서버 전체 | 끈 MCP |
| `safe_tools` | `{server_name, original_tool}` 배열 | 아니오 | 기본 `[]`; 되돌림을 모르는 외부 MCP tool 중 사람이 안전하다고 표시한 정확한 쌍 | 묻지 않을 tool |
| `permissions` | Permissions | 예 | null이면 아래 층 | 권한 |
| 본문 | Markdown | 아니오 | Operator는 trim 뒤 1자 이상; built-in은 비어도 됨 | 이 agent의 지침 |

built-in은 `name`·`contexts`·`app_reads`를 쓰지 않는다. 이름은 제품이 고정하고, context는 자리의 active context 전부이며, 앱 command 호출은 역할 상한이 정한다. 책임·관점·기대 결과는 본문 글이 정본이고 따로 기계 값을 두지 않는다. 서버 설정·인증·skill 본문은 → lophn-agent/extensions, 지침 파일(LOPHN.md)은 → lophn-agent/instructions다.

## Profile (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | `icon / image` | 아니오 | | 종류 |
| `icon` | design icon id | 조건부 | `icon`이면 필수 | 고른 icon |
| `image` | 파일 이름 | 조건부 | `image`이면 필수; png·jpg·webp만, 1048576 byte 이하, svg 불가 | 올린 이미지 |

이미지 파일은 `<자리>/agents/<파일 이름에서 .md를 뺀 것>/avatar.<ext>`에 둔다. built-in의 기본 icon은 제품이 정한다.

## ModelChoice (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `provider` | `pvd` ID | 아니오 | 존재하는 Provider → lophn-agent/harness/provider | 호출 연결 |
| `model_name` | string | 아니오 | nonempty; catalog와 사용 가능 검사 → lophn-agent/harness/model | model |
| `option_values` | map(축 id → 값) | 아니오 | 기본 `{}`; 그 model이 가진 축과 값만 → lophn-agent/harness/model | effort 같은 option 값 |

ModelChoice는 통째로 고른다. 층마다 option을 따로 합치지 않고 가장 높은 층의 ModelChoice 하나를 쓴다. credential 값·가격·한계는 넣지 않는다. 계정 선택과 이동은 → lophn-agent/harness/provider다.

## AppRead (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `app` | `app` ID | 아니오 | 존재하는 앱 → apps/registration | 읽을 앱 |
| `command` | string | 아니오 | 그 앱 blueprint의 command 이름 | 읽을 command |

고르는 것은 이름 쌍뿐이다. 호출할 때마다 그 앱의 현재 blueprint에서 effect가 `read`이고 confirm이 아닌지와 사람이 그 앱의 agent 사용을 허락했는지(→ apps/permissions)를 다시 검사한다. 이름만으로 허락된 것이 아니다.

## Permissions (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `tools` | string 배열 | 아니오 | 개별 동작 이름(→ lophn-agent/harness/tools); 묶음 이름·wildcard 없음; 중복 없음; 아래 층의 `tools`의 부분집합 | 제공할 tool 동작 |

실제 tool 목록은 RoleCaps(아래) ∩ 자리의 `tools` ∩ 정의의 `tools`다. 지속하는 allow 규칙과 이번 session 허락의 모양은 → platform/approvals와 lophn-agent/harness/tool-judgment다.

## PlaceAgentSettings (파일)

자리 층의 값이다. `<자리>/agents/settings.md`의 frontmatter만 쓰고 본문은 없다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `models` | map(역할 → ModelChoice) | 아니오 | 기본 `{}`; 키는 `lophn / context_engineer / app_engineer / operator` | 역할별 이 자리의 model과 option |
| `permissions` | Permissions | 예 | null이면 Workspace 기본; Workspace 기본의 부분집합 | 이 자리의 권한 규칙 |

자리의 skill·MCP 등록은 → lophn-agent/extensions, LOPHN.md는 → lophn-agent/instructions다. Workspace 층(역할별 기본 model·option, 기본 권한, 요약용 model, 즐겨찾기)의 값과 저장은 → platform/settings, lophn-agent/harness/model이다.

## 설정 층

낮은 층부터 위로 합치고 위 층이 이긴다. 층: 기본값 < Workspace < 자리 < agent 정의 < session.

| 칸 | 기본값 | Workspace | 자리 | agent 정의 | session |
|---|---|---|---|---|---|
| model·option | 없음(실행 전 필수) | 역할별 기본 | 역할별 `models` | `model` | composer에서 고른 model·option (그 session만) |
| 지침 | 제품 지침 | 전역 LOPHN.md | project·앱 LOPHN.md | 본문 | 없음 |
| skill·MCP 등록 | 동봉 | 등록 폴더·MCP registry | 자리의 skill·MCP | 없음 | 없음 |
| skill·MCP 고르기 | 전부 켬 | 없음 | 없음 | `skills_off`, `mcp_off` | 없음 |
| 권한 | RoleCaps | 기본 권한 | `permissions` | `permissions`(좁히기만) | 이번 session의 허락 |
| profile | 기본 icon | 없음 | 없음 | `profile` | 없음 |
| context·읽을 앱 command | 없음 | 없음 | 없음 | `contexts`, `app_reads` | 없음 |

합치는 규칙:

- model·option은 ModelChoice 통째로 가장 높은 층 하나를 쓴다. 값이 없으면 한 층 아래로 내려간다.
- 권한은 층마다 부분집합이어야 하고 합친 결과는 교집합이다. 정의의 `tools`가 자리의 `tools`에 없는 동작을 가지면 저장이 거절된다.
- 지침은 층을 이어 붙인다(전역 → project → 앱 → agent 본문). 순서·크기·읽는 시점은 → lophn-agent/instructions다.
- skill·MCP는 등록된 것 가운데 `skills_off`, `mcp_off`에 없는 것이 켜진다.
- 목록 칸(`skills_off`, `mcp_off`, `safe_tools`, `contexts`, `app_reads`)은 정의 층에만 있어 합치지 않는다.

## ResolvedAgent (값)

run을 준비할 때 한 번 만들어 run 기준(→ lophn-agent/harness/run-loop)에 고정하는 값이다. 같은 파일과 설정이면 같은 값과 `hash`가 나온다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `assignment` | `asg` ID | 아니오 | → lophn-agent/assignments | 누구 |
| `role` | enum | 아니오 | assignment의 역할 | 역할 |
| `place` | `{kind: project/app, id}` | 아니오 | Operator는 assignment의 scope; built-in은 session의 작업 자리 → lophn-agent/conversation | 어느 자리의 설정을 썼나 |
| `name`, `profile` | string, Profile | 아니오 | built-in은 제품 이름과 기본 icon | 표시 |
| `agent_instructions` | sha256 | 아니오 | 정의 본문의 sha256(blob); 제품 역할 지침은 prompt-assemble의 role 층이라 넣지 않음; LOPHN.md 층은 call마다 읽으므로 고정하지 않음 | agent 층 지침 |
| `model` | ModelChoice | 아니오 | 모든 층을 합친 결과; 없으면 run을 시작하지 않음 | model |
| `tools` | string 배열 | 아니오 | RoleCaps ∩ 자리 ∩ 정의 | 제공 tool |
| `skills` | 이름 배열 | 아니오 | 등록된 것 가운데 `skills_off`에 없는 것(등록 순서) | 켜진 skill |
| `mcp` | `{server_name, original_tool}` 배열 | 아니오 | 등록된 MCP tool 가운데 `mcp_off`에 없는 것(등록 순서) | 켜진 MCP tool |
| `contexts` | `ctx` ID 배열 | 아니오 | Operator는 고른 것 중 active; built-in은 자리 project의 active 전부(없으면 `[]`와 이유) | 읽을 context |
| `contexts_reason` | `no_project` | 예 | 비어 있는 이유; built-in이 앱 자리에서 열렸을 때만 `no_project`, 아니면 null | context 0개의 이유 |
| `app_reads` | AppRead 배열 | 아니오 | 앱 Operator만 | 읽을 앱 command |
| `safe_tools` | 배열 | 아니오 | | 묻지 않을 tool |
| `sources` | map(칸 → ValueSource) | 아니오 | 위 칸마다 하나 | 값의 출처 |
| `hash` | sha256 | 아니오 | 위 값의 canonical JSON | run 기준에 남길 식별 |

### ValueSource (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `layer` | `default / workspace / place / definition / session` | 아니오 | | 값을 준 층 |
| `place` | `{kind, id}` | 예 | `place`·`definition`이면 필수 | 그 층의 자리 |

전체 값은 blob(→ platform/blob-store)이고 run 기준에는 `hash`와 `sources`만 둔다. 이어 하기는 기준에 고정된 값을 그대로 쓴다. 정의 파일은 resolve할 때마다 읽으며 읽는 도중 바뀌면 한 번 읽은 내용을 쓴다.

## RoleCaps (값) — 역할별 tool 상한

제품이 고정하는 값이고 정의로 넓히지 못한다. 개별 동작 이름의 입력·결과·효과 계약은 → lophn-agent/harness/tools와 각 대상 concern이다. 이 상한도 실제 호출 때 → lophn-agent/harness/tool-judgment를 적용한다.

| 역할 | 자동 앱 command 상한 | 현재 scope·허락 | 시각 tool |
|---|---|---|---|
| `lophn` | read/write/external, confirm 포함 | 사람이 agent 사용을 허락한 앱; → apps/permissions | `visual.show`, `visual.read`, `visual.prepare_document` |
| `app_engineer` | read와 실제 undo 지원 write; confirm은 approval | 담당 앱 하나와 사람의 agent 사용 허락 | 위 세 tool; 담당 문서 범위 |
| `context_engineer` | 실행 0개; metadata 목록·설명만 | 현재 자료 scope | 위 세 tool; 요청 문서 범위 |
| `operator` | 정의의 `app_reads`에 있고 confirm=false인 read command만; confirm=true는 역할 상한 밖 | 정의의 `app_reads`와 현재 앱 허락의 교집합 | 사람 요청 session에서 정의 권한이 허락한 시각 tool만 |

`visual.show`는 session 출력이지 문서 write 범위의 확대가 아니다. 앱 카드가 보인다는 이유로 command를 선택하지 않는다. 현재 앱 허락이 없어지면 어떤 역할도 호출하지 않는다. 주석은 lophn 역할의 선언된 앱 write command이며 → lophn-agent/harness/tool-judgment를 적용한다.

고정 결과 상한: tool 결과 기본 24576 UTF-8 bytes 또는 300줄, 목록·검색 20개; lophn 앱 기획 무엇 200자·왜 500자, place 추천 run당 5개, 운영 해석 5줄; App Engineer 결정 질문 12개·가정 3개·가설 3개·흐름 8단계·ticket 요구 6개. 시각 블록은 → lophn-agent/visuals. 세부 책임과 결과 글은 roles requirements다.

### 공통 tool

| 묶음 | 개별 동작 | 대상 계약 |
|---|---|---|
| 문서 읽기 | `document.list`, `document.outline`, `document.search`, `document.read_version`, `document.read_section`, `document.read_range`, `document.history`, `document.diff` | documents/versions, documents/outline-and-search |
| context 읽기 | 선언한 검색마다 tool 하나(이름은 → lophn-agent/harness/tools), `context.read_entity`, `series.next_name` | documents/contexts, documents/series |
| format 읽기·검사 | `format.list`, `format.rules`, `format.examples`, `format.validate` | documents/formats |
| 사람에게 묻기 | `question.submit`, `question.read_decision`, `approval.read_decision` | lophn-agent/questions, platform/approvals |

### lophn

| 대상 | 읽기 범위 | 참조 |
|---|---|---|
| 프로젝트·문서 | 목적·목차·검색·필요한 고정 Version의 본문·절·이력·차이 | documents/projects, documents/versions, documents/outline-and-search |
| context | 자리의 context의 overview·용어집, 선언한 검색의 결과, 개체 하나 | documents/contexts, documents/terms |
| 앱·SDK | 목적·목록·blueprint·명령 metadata·release·정상 신호·invocation·SDK 계약·예시 | apps/registration, apps/blueprint, apps/releases, apps/invocations, apps/sdk |
| problem·ticket | 열린 problem·보고·snapshot·실제 test result·고친 기록·ticket 본문·현황·근거 | problems/grouping, problems/reporting, problems/snapshots, problems/tests, problems/repairs, coding-agent/tickets |
| assignment·run | 담당 범위·상태·확정 결과 | lophn-agent/assignments, lophn-agent/harness/run-loop |

전체 범위는 원본 디스크·소스·secret 읽기가 아니다. 공통 tool 전체에 더하는 동작:

| 묶음 | 추가 개별 동작 | 제약 |
|---|---|---|
| 프로젝트·앱·SDK 읽기 | `project.list`, `project.read`, `app.list`, `app.read`, `app.blueprint`, `app.commands`, `app.releases`, `app.health`, `app.invocations`, `sdk.list`, `sdk.contract`, `sdk.examples` | 조회와 현재 허락된 앱 자동 command; 실행 판정은 harness/tool-judgment |
| problem·ticket 읽기 | `problem.list`, `problem.read`, `report.read`, `snapshot.read`, `verification.read`, `repair.read`, `ticket.list`, `ticket.read` | 문제 해석 참조·상태·기존 ticket 변경 없음 |
| coding 요청 | `ticket.create` | 직접 요청·피드백을 ticket으로 생성; 부족한 근거는 확인 필요·준비 상태로 표시; claim·시작·완료 처리 없음; → coding-agent/tickets |
| 제품 안내·공개 설정 | `lophn.guide`, `setting.read` | secret 없는 동봉 안내·현재 공개 설정과 출처만 |
| 문서 결과 | `document.create`, `document.save_version` | Run 요청 범위; 기존 문서 저장은 기준 Version 필수 |
| assignment 읽기 | `assignment.list`, `assignment.read`, `run.read_result` | 변경 없음 |
| handoff | `handoff.submit`, `handoff.read_status`, `handoff.read_result` | 방향·계보는 → lophn-agent/handoff |

### app_engineer

| 대상 | 읽기 범위 | 참조 |
|---|---|---|
| 담당 앱 place 문서 | 목차·검색·Version·본문·절·이력·차이 | documents/versions, documents/outline-and-search |
| 담당 앱 | blueprint·release·정상 신호·invocation·problem·ticket 및 그 앱에 연결된 보고·snapshot·test result·고친 기록 | apps/blueprint, apps/releases, apps/invocations, problems/grouping, problems/reporting, problems/snapshots, problems/tests, problems/repairs, coding-agent/tickets |
| 관련 context | 담당 앱의 `effect = read` 명령을 app-data source로 쓰는 context의 overview·용어집 | documents/contexts, documents/terms |
| 이번 handoff 근거 | Run.source의 고정 Version와 지정 절만, 이 Run 동안만 | lophn-agent/harness/run-loop, lophn-agent/handoff |
| 제품 SDK | 제공한 계약·예시 | apps/sdk |
| 관련 assignment·run | 자기 담당 범위·handoff의 현황과 결과 | lophn-agent/assignments, lophn-agent/harness/run-loop |

관련 context의 다른 문서 본문, 다른 앱, handoff 근거의 최신 Version는 허용하지 않는다. 주소를 따라 범위를 넓히지 않는다. 담당 앱의 허락된 read와 undo 지원 write만 실행하며 external·undo 미지원 write는 제공하지 않는다. 공통 tool 가운데 위 담당 범위만 선택하고 전체 목록·검색에도 이 범위를 적용한다.

| 묶음 | 추가 개별 동작 | 제약 |
|---|---|---|
| 담당 앱·SDK 읽기 | `project.read`, `app.read`, `app.blueprint`, `app.commands`, `app.releases`, `app.health`, `app.invocations`, `sdk.contract`, `sdk.examples` | scope 안 조회만 |
| problem·ticket 읽기 | `problem.list`, `problem.read`, `report.read`, `snapshot.read`, `verification.read`, `repair.read`, `ticket.list`, `ticket.read` | 담당 앱만 |
| 문서 결과 | `document.create`, `document.save_version` | 담당 앱 place·Run 요청 범위; 기준 Version 필수 |
| 해석 연결 | `problem.set_interpretation` | 담당 problem에 문서 고정 Version·절 참조; 현재 problem seq·기존 참조 CAS; 이전 참조 보존; → problems/grouping |
| ticket | `ticket.create`, `ticket.make_ready` | 담당 앱 구현·repair 생성과 확인 필요 ticket의 실행 준비 전환만; → coding-agent/tickets |
| assignment 읽기 | `assignment.read`, `run.read_result` | 관련 범위만 |
| handoff | `handoff.submit`, `handoff.read_status`, `handoff.read_result` | → lophn-agent/handoff의 허용 방향만 |

### context_engineer

| 대상 | 읽기 범위 | 참조 |
|---|---|---|
| 문서·project | 목적·목차·검색·필요한 고정 Version·절·본문·이력·차이 | documents/versions, documents/outline-and-search, documents/projects |
| context | 계약·초안·적용된 판·검색·위반·용어집, 개체 | documents/contexts, documents/terms |
| 앱 | 목적·blueprint 명령 목록의 이름·설명·입력 schema·effect | apps/registration, apps/blueprint |
| assignment·run | 담당 범위·상태·확정 결과 | lophn-agent/assignments, lophn-agent/harness/run-loop |

앱 read command의 metadata는 읽지만 호출 결과·업무 DB를 읽는 권한은 없다. 공통 tool 전체에 더하는 동작:

| 묶음 | 추가 개별 동작 | 제약 |
|---|---|---|
| 프로젝트·앱 metadata | `project.list`, `project.read`, `app.list`, `app.read_purpose`, `app.commands` | 앱 명령 호출 없음 |
| context 설계 | `context.read_contract`, `context.draft`, `context.preview`, `context.submit`, `context.violations` | 초안 쓰기·제출은 write; 미리보기는 지금 파일로 추출·위반만 보이고 적용 없음; 제출한 판의 적용은 → documents/contexts |
| 용어집 | `context.glossary_read`, `context.glossary_write` | 뜻은 Context Engineer와 사람이 정함; → documents/terms |
| 문서 결과 | `document.create`, `document.save_version` | Run 요청 범위; 기준 Version 필수 |
| assignment 읽기 | `assignment.list`, `assignment.read`, `run.read_result` | 변경 없음 |
| handoff | `handoff.submit`, `handoff.read_status`, `handoff.read_result` | → lophn-agent/handoff의 허용 방향만 |

### operator

| 대상 | 읽기 범위 | 참조 |
|---|---|---|
| 고른 context | overview·용어집·선언한 검색의 결과·개체 하나 | documents/contexts, documents/terms |
| 고른 context가 가리키는 문서 | 현재 허용된 문서·절의 목차·고정 Version·본문·이력·차이·검색 | documents/contexts, documents/versions, documents/outline-and-search |
| 자리의 문서 | context를 0개 골라도 자리(project 또는 앱 place)의 문서(현재 허락 안) | documents/projects, documents/versions |
| 정의의 `app_reads` | 고른 `(app, command)` 쌍의 metadata와 결과 | apps/blueprint, apps/runtime |
| 자기 Question·approval 결정 | 자기 Run에 연결된 결정 | lophn-agent/questions, platform/approvals |

Operator의 자리는 project 또는 앱 하나이고 context는 자료 선택이다. 선택 밖 문서·전체 앱 metadata를 따라 읽지 않는다. 앱 read command가 앱 밖 상태 변경·쓰기 효과를 숨기면 제공하지 않는다. 허락된 read가 앱의 secret·network grant로 데이터를 가져오는 것은 read이며 호출 주체가 Operator라는 이유나 secret 사용만으로 거절하거나 추가 approval을 묻지 않는다. secret 값은 앱 코드·agent에 주지 않고 전송 경계에서 붙이며 대상 host는 앱 network grant를 따른다.

| 묶음 | 선택 가능한 개별 동작 | 제약 |
|---|---|---|
| context 읽기 | 고른 context의 선언 검색 tool, `context.read_entity`, `series.next_name` | 정의 `contexts`의 context만 |
| 문서 읽기 | `document.list`, `document.outline`, `document.search`, `document.read_version`, `document.read_section`, `document.read_range`, `document.history`, `document.diff` | 자리의 문서만 |
| format 읽기·검사 | `format.list`, `format.rules`, `format.examples`, `format.validate` | 필요한 문서 저장 계약 확인 |
| 문서 결과 | `document.save_version` | 읽은 Version CAS; 어느 문서에 쓸 수 있나는 → lophn-agent/roles/operator와 lophn-agent/harness/tool-judgment |
| 앱 read command | `app.command_metadata`, `app.call_read_command` | 정의 `app_reads`의 쌍만·현재 effect 확인 |
| 사람에게 묻기 | `question.submit`, `question.read_decision`, `approval.read_decision` | 판단에 필요한 의도·취향·결과 해석; 다른 tool 권한을 주지 않음 |

## 관계

| from | 관계 | to | 다중도 | 대상이 사라지면 |
|---|---|---|---|---|
| AgentDefinition | 실행 정체 | Assignment → lophn-agent/assignments | Operator 1:1(파일 이름 = ID); built-in은 역할·자리별 override가 전역 assignment 하나를 따름 | assignment 없는 Operator 파일은 agent가 아님 |
| Operator 정의 | 읽을 context | Context → documents/contexts | N:M, 0개 허용 | 보관·삭제된 context는 읽기에서 빠지고 정의에 표시; 정의는 유지 |
| 앱 Operator 정의 | 읽을 앱 command | App → apps/registration | N:M | 앱 보관·command 사라짐·허락 회수면 호출 차단; 정의는 유지 |
| AgentDefinition | 고른 skill·MCP | → lophn-agent/extensions | N:M(끈 것만 저장) | 사라진 항목은 표시; 정의는 유지 |
| ResolvedAgent | 시작 기준 | Run → lophn-agent/harness/run-loop | 1:N | 과거 run의 값은 blob으로 유지 |
| ModelChoice | 호출 연결 | Provider → lophn-agent/harness/provider | N:1 | 현재 회수 즉시 call 차단; 고정한 과거 값 유지 |

## ledger 표

없음. 정의와 자리 설정은 app data의 파일이다. Operator의 존재와 상태는 `assignments` 표(→ lophn-agent/assignments)가, 저장·삭제 기록은 아래 event가, resolve한 전체 값은 blob이 맡는다.

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `SaveAgent` | user | 자리, assignment(없으면 새 Operator), 바꾼 칸, 본문, 파일 hash(고칠 때) | 전체 검사(칸 형식·이름·참조·권한 상한); 고칠 때 파일 hash CAS; 새 Operator면 assignment를 먼저 만들고 파일을 씀; 파일을 쓴 뒤 저장한 profile이 가리키지 않는 `avatar.*`를 지운다(지우지 못한 것은 다음 저장이 다시 지운다) | `AgentSaved` (새 Operator면 assignment의 `AssignmentCreated` 먼저) | `invalid_input`, `not_found`, `conflict`, `forbidden` |
| `DeleteAgent` | user | assignment | Operator만(built-in은 `forbidden`); assignment를 거두고 파일을 지움 | `AgentDeleted` (`AssignmentWithdrawn` 먼저) | `not_found`, `conflict`, `forbidden` |
| `UploadAgentProfileImage` | user | assignment, 이미지 | png·jpg·webp, 1048576 byte 이하, svg 불가 | 없음(저장 때 `profile`로 연결). 새 파일을 원자적으로 쓰고 다른 확장자의 옛 `avatar.*`는 남긴다(저장이 지운다) | `invalid_input`, `not_found`, `unavailable` |
| `ChangePlaceAgentSettings` | user | 자리, 바꾼 칸 | 전체 검사; 파일 hash CAS; `permissions`는 Workspace 기본의 부분집합 | `PlaceAgentSettingsChanged` | `invalid_input`, `conflict`, `forbidden` |

읽기: `ListAgents(자리)`는 그 자리에서 부를 수 있는 agent의 행(assignment ID, 역할, built-in/Operator, 이름, profile, model 요약, 상태, 켜진 skill·MCP 수, Operator의 context 수)을, `ReadAgent(자리, assignment)`는 정의와 칸별 값·출처를 돌려준다. built-in 행은 context 수가 없고, 파일이 틀려 resolve하지 못한 행은 수를 셋 다 비운다. `ResolveAgent`는 run 준비 때 쓰는 machine 읽기다. `ReadPlaceAgentSettings(자리)`는 그 자리 `settings.md`의 칸과 파일 hash, 칸을 비운 role의 실제 model과 출처(자리, Workspace, 기본값)를 돌려준다. agent 쪽 tool은 정의를 쓰지 않는다.

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `AgentSaved` | Assignment | 자리, 역할, 전·후 파일 hash, actor | shell/desktop |
| `AgentDeleted` | Assignment | 자리, 역할, 지운 파일 hash | shell/desktop |
| `PlaceAgentSettingsChanged` | 자리(Project 또는 App) | 자리, 전·후 파일 hash | shell/desktop |

## 정책

- **쓰기.** 파일은 임시 파일에 쓴 뒤 바꿔 끼운다. 쓰기가 실패하면 이전 파일이 그대로다. 새 Operator의 파일 쓰기가 실패하면 방금 만든 assignment를 거둔다.
- **직접 고친 파일.** 사람이 파일을 직접 고쳐도 resolve와 목록이 읽을 때 같은 전체 검사를 한다. 틀린 파일의 agent는 시작하지 않고 어느 칸이 틀렸는지 목록에서 보인다. 다른 agent는 영향받지 않는다.
- **시작한 run.** 정의를 고쳐도 시작한 run은 기준에 고정한 ResolvedAgent를 쓴다. 현재 권한 회수·자리 보관은 즉시 적용한다.
- **built-in 자리.** built-in의 자리는 session의 작업 자리(→ lophn-agent/conversation)로 고르며 assignment는 자리마다 만들지 않는다.
- **비밀.** 정의·자리 설정·ResolvedAgent에 credential 값·token을 넣지 않는다.

## 정할 것

- Operator가 문서를 쓸 수 있는 범위(남길 문서를 없앤 뒤)는 추천안으로 진행한다: 정의의 권한 안에서 담당 자리의 문서에 쓰고 쓰기마다의 판정은 lophn-agent/harness/tool-judgment가 한다. lophn-agent/agents#Q1.

## 파일 모양

정의 파일과 `settings.md`는 같은 모양이다.

- 첫 줄이 `---`이면 다음 `---` 줄까지가 frontmatter(YAML map)이고 나머지가 본문이다. 닫는 줄이 없거나 YAML이 깨졌거나 map이 아니면 파일이 틀린 것이다. 첫 줄이 `---`가 아니면 파일 전체가 본문이다. 본문 안의 `---` 줄은 본문이다.
- 파일에는 바꾼 칸만 있다. 비운 칸과 빈 기본 목록(`contexts`, `app_reads`, `skills_off`, `mcp_off`, `safe_tools`)은 쓰지 않고, 칸이 하나도 없으면 frontmatter 없이 본문만 쓴다. 쓰는 칸 순서는 고정이다(표의 순서). 같은 값은 항상 같은 글이다.
- 본문은 앞쪽 빈 줄과 뒤쪽 공백을 뺀 글이고, 쓸 때 끝에 줄바꿈 하나를 붙인다. 크기는 지침 파일 상한(32768 UTF-8 bytes)을 따른다(→ lophn-agent/instructions).
- `settings.md`는 본문이 없고 칸은 `models`와 `permissions`뿐이다.
- 읽을 때와 쓸 때 같은 전체 검사를 하고, 틀린 칸마다 `field`(점 경로)와 이유 code(`malformed`, `unknown_field`, `invalid_value`, `required`, `not_allowed`, `reserved_name`, `duplicate`, `too_large`, `missing_reference`, `over_cap`)를 알린다.
