---
type: domain-model
concerns: [lophn-agent/presets]
---
# lophn-agent/presets

Preset은 agent 구성의 재사용 단위다. 책임 글은 prompt이고 기계가 쓰는 선택만 필드로 둔다. 실제 담당 대상과 결과 문서·주기는 → lophn-agent/assignments다.

## Preset (`pst`)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `pst` ID | 아니오 | PK; 판이 바뀌어도 동일 | 구성 ID |
| `kind` | enum | 아니오 | `lophn / app_engineer / context_engineer / operator`; 불변 | 역할 종류 |
| `name` | string | 아니오 | trim 뒤 nonempty; 사람 preset의 name_key unique | 사람이 고르는 이름 |
| `origin` | `product / user` | 아니오 | 제품 기본 또는 사람이 만든 구성 | 출처 |
| `prompt` | sha256 | 아니오 | trim 뒤 nonempty UTF-8 Markdown blob; 책임·관점·기대 결과는 이 글만 정본 | 구성 지시 |
| `capability` | CapabilitySelection | 아니오 | 개별 tool 목록 판 고정; 제품 역할 상한 안 | tool 선택 |
| `context` | ContextSelection[] | 아니오 | 기본 preset 표의 선택; 중복 없음; `[]`은 자동 자료 0개 | 읽을 자료 |
| `mcp` | McpSelection | 아니오 | 서버와 정확한 개별 tool 쌍; → lophn-agent/extensions | 외부 tool 선택 |
| `skills` | string[] | 아니오 | 유효한 정확한 이름; 중복·wildcard 없음 | 절차 선택 |
| `model` | PresetModelSelection | 예 | 미준비면 null; 실행 전 필수 | 기본 판단 model·계정 |
| `organizing_model` | PresetModelSelection | 예 | null이면 같은 판의 model을 사용; 다른 계정 자동 선택 없음 | 제목·요약·압축용 선택 |
| `instructions` | InstructionAttachment[] | 아니오 | 기본 `[]`; 순서 유지; → lophn-agent/instructions | 사람 지침 연결 |
| `revision` | 양의 정수 | 아니오 | 초기 1; 전체 변경마다 증가 | 구성 판 |

Preset 판 전체는 immutable blob이다. product 기본 preset은 역할별 하나이며 설치 bundle에서 seed한다. 사람 편집은 같은 기본 preset의 배포 원문을 덮지 않고 user preset 새 판으로 만들고 사람이 assignment에 적용한다. 여러 user preset을 같은 역할로 만들 수 있으나 assignment 수는 늘지 않는다. 제품 갱신은 user 판과 사용 중 assignment를 덮어쓰지 않는다.

## CapabilitySelection (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `bundles` | `{name,revision}` 배열 | 아니오 | 저장 때 존재하는 묶음 판; 중복 없음 | 선택 근거 |
| `tools` | `{tool,app_command?}` 배열 | 아니오 | 묶음과 직접 선택을 펼친 정확한 목록; 쌍 unique | 실제 노출 목록 |

묶음에 새 tool이 생겨도 과거 판의 tools는 늘지 않는다. `app_command`는 앱 read command 이름이며 실제 앱별 호출 쌍은 → lophn-agent/assignments의 승인과 현재 앱 계약을 검사한다. 동적 앱 command는 고정 계약·현재 허락·역할별 상한 안에서만 제공한다. → lophn-agent/harness/tools.

## ContextSelection (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | `all / work_place / assignment_scope / project / app / context / document / sdk` | 아니오 | 아래 역할별 읽기 상한 안 | 자료 선택 종류 |
| `target` | 해당 ID 또는 제품 자산 이름 | 조건부 | 명시 project/app/context/document/sdk에 필수; all/work_place/assignment_scope는 null | 선택 자료 |
| `section` | section key | 예 | document에만; 실제 존재 | 좁힌 구간 |

`work_place`는 세션 작업 자리, `assignment_scope`는 담당 범위에서 resolve한다. 선택 자료가 다른 project/app의 것이면 읽기 상한을 넘을 수 없으며 context의 item·주소가 무제한 파일 접근을 만들지 않는다. 매 call 현재 membership·접근 허락을 검사한다. 담당 범위와 읽을 자료의 scope는 같은 필드가 아니다.

## McpSelection (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `servers` | 서버 이름 배열 | 아니오 | 등록된 서버만; 중복 없음 | 연결 후보 |
| `tools` | `{server_name,original_tool}` 배열 | 아니오 | 현재 유효한 정확한 쌍; 서버가 servers 안; wildcard 없음 | 선택 tool |

서버 설정·인증은 → lophn-agent/extensions다. 선택을 ExtensionSettings에 복제하지 않는다. 모든 역할이 skill·MCP를 선택할 수 있지만 역할 금지·scope·effect·approval 검사보다 우선하지 않는다. Run 제공 목록은 capability의 내장·앱 선택, mcp의 정확한 tool 쌍, 선택 skill을 읽는 skill.read/skill.read_supplemental의 검증된 합집합이며 RunBasis.tools에 고정한다. MCP·skill 동작을 capability에 중복 저장하지 않는다.

## PresetModelSelection (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `provider` | `pvd` ID | 아니오 | 존재하는 Provider; → lophn-agent/harness/provider | 호출 연결 |
| `credentials` | credential key 배열 | 아니오 | remote는 1개 이상; 사람 순서 고정; provider 안 존재; local 무인증만 `[]` | 선택한 계정과 허락한 이동 순서 |
| `model_name` | string | 아니오 | nonempty; catalog와 사용 가능 검사 → lophn-agent/harness/model | model |
| `reasoning_level` | ReasoningLevel | 아니오 | 기본 provider_default; 지원된 값만 | 추론 수준 |
| `options` | JSON object | 아니오 | 기본 {}; 검증된 protocol/model 옵션만 | 호출 옵션 |

계정 하나만 선택하면 다른 계정으로 이동하지 않는다. 여러 계정을 사람이 이 판에 고른 경우에만 그 목록 안 같은 provider·model의 뒤 usable credential로 이동한다. key/token은 보관하지 않는다. model 검증 정보·한계·당시 가격은 → lophn-agent/harness/model의 ResolvedModel과 RunBasis에 snapshot한다.

## 기본 preset

아래 구성은 product seed다. provider/model은 사람이 고른 기본값을 새 user preset에 명시 복사하며 비어 있으면 미준비다. organizing 선택이 없으면 같은 preset model을 쓴다. 각 행의 책임·관점·기대 결과 글은 → lophn-agent/roles/* requirements에서 prompt로 만든다.

| 역할 종류 | 이름 | 기본 context | 기본 capability | 기본 model | 기본 MCP·skill·지침 |
|---|---|---|---|---|---|
| lophn | lophn | all | 공통 읽기·문서 결과·제품 안내·공개 설정·앱·problem·ticket 읽기와 생성·preset/assignment 읽기·시각·handoff | judgment 기본값 복사; organizing 기본값은 선택 복사 | 모두 `[]` |
| app_engineer | App Engineer | assignment_scope, sdk | 담당 앱 읽기·문서 결과·problem 해석·ticket 생성·시각·handoff | 위와 같음 | 모두 `[]` |
| context_engineer | Context Engineer | all | 공통 읽기·context/term 변경·문서 결과·preset/assignment 읽기·승인 초안·시각·handoff | 위와 같음 | 모두 `[]` |
| operator | Operator | assignment_scope; outputs는 별도 허용 읽기 | 담당 자료·format·승인 앱 read·기존 outputs 새 Version·question | 위와 같음 | 모두 `[]` |

## 사람이 바꾸는 구성과 제품이 고정한 상한

| 항목 | 사람이 바꾸는 것 | 제품이 고정하는 것 |
|---|---|---|
| prompt·이름 | 글·표시 이름, 같은 역할 preset 복사·생성 | 역할 종류·역할의 책임 밖·공통 금지 |
| capability·MCP·skill | 상한 안 정확한 동작과 절차·서버 선택 | 코드·shell·임의 파일·웹·브라우저·subagent·secret 직접 읽기·자기 구성 적용·사람 대신 승인 tool 없음 |
| context | 자료 선택·순서·구간 | 아래 읽기 상한·현재 접근 허락·자료 주소로 범위 확대 불가 |
| provider·model | 계정·model·추론 옵션·organizing 선택 | 확인된 입력·출력 한계, incomplete 응답 tool 미실행, 자동 provider/model fallback 없음 |
| 지침 | 사람 파일 연결과 내용 | 지침으로 권한·approval·제품 금지 확대 불가 |
| 결과 | 기대 내용의 prompt 글 | tool 결과 기본 24576 UTF-8 bytes 또는 300줄, 목록·검색 20개; 시각 블록 → lophn-agent/visuals |

고정 결과 상한: lophn 앱 기획 무엇 200자·왜 500자, place 추천 run당 5개, 운영 해석 5줄; App Engineer 결정 질문 12개·가정 3개·가설 3개·흐름 8단계·ticket 요구 6개; Context Engineer 채택 term 30개·후보 근거 5개. Operator의 결과 수 자체는 제한하지 않고 승인한 outputs 수 안에서만 쓴다. 세부 책임과 결과 글은 roles requirements다. 제품 고정 값은 Preset의 편집 필드가 아니다.

### common 기본 preset의 읽기·tool 값

#### 공통 기본 tool 묶음

아래는 개별 계약 동작의 이름이다. 입력·결과·효과 계약은 → lophn-agent/harness/tools와 각 대상 concern이다. 각 역할의 기본 preset은 이 목록에서 자기 범위·실제 목록만 선택한다.

| 묶음 | 개별 동작 | 대상 계약 |
|---|---|---|
| 문서 읽기 | `document.list`, `document.outline`, `document.search`, `document.read_version`, `document.read_section`, `document.read_range`, `document.history`, `document.diff` | documents/versions, documents/outline-and-search |
| context·term 읽기 | `context.list`, `context.read`, `context.items`, `context.terms`, `context.document_membership`, `term.read` | documents/contexts, documents/terms |
| format 읽기·검사 | `format.list`, `format.rules`, `format.examples`, `format.validate` | documents/formats |
| 사람에게 묻기 | `question.submit`, `question.read_decision`, `approval.read_decision` | lophn-agent/questions, platform/approvals |

이 common 목록만의 독립 command·event·ledger 표는 없다. 공통 목록도 실제 호출 때 → lophn-agent/harness/tool-judgment를 적용한다.

#### 앱 command·시각 tool 선택 값

| 역할 | 자동 앱 command 상한 | 현재 scope·허락 | 시각 tool |
|---|---|---|---|
| `lophn` | read/write/external, confirm 포함 | 사람이 agent 사용을 허락한 앱; → apps/permissions | `visual.show`, `visual.read`, `visual.prepare_document` |
| `app_engineer` | read와 실제 undo 지원 write; confirm은 approval | 담당 앱 하나와 사람의 agent 사용 허락 | 위 세 tool; 담당 문서 범위 |
| `context_engineer` | 실행 0개; metadata 목록·설명만 | 현재 자료 scope | 위 세 tool; 요청 문서 범위 |
| `operator` | 승인된 confirm=false read command만; confirm=true는 역할 상한 밖 | Assignment.read_apps/read_commands 및 고정 Preset 선택 교집합 | 세션 있는 사람 요청에서 승인 목록에 선택한 시각 tool만; 문서는 승인 output만 |

`visual.show`는 세션 출력이지 Operator의 업무 문서 write 대상 확대가 아니다. 앱 카드가 보인다는 이유로 command를 선택하지 않는다. 현재 앱 허락이 없어지면 어떤 역할도 호출하지 않는다. 주석은 lophn 역할의 선언된 앱 write command이며 → lophn-agent/harness/tool-judgment를 적용한다.


### lophn 기본 preset의 읽기·tool 값

#### 읽기 범위 값

| 대상 | 허용 값 | 참조 |
|---|---|---|
| 프로젝트·문서·context·term | 목적·목차·검색·필요한 고정 Version의 본문·절·이력·차이·소속 | documents/projects, documents/versions, documents/contexts, documents/terms |
| 앱·SDK | 목적·목록·blueprint·명령 metadata·release·정상 신호·invocation·SDK 계약·예시 | apps/registration, apps/blueprint, apps/releases, apps/invocations, apps/sdk |
| problem·ticket | 열린 problem·보고·snapshot·실제 test result·고친 기록·ticket 본문·현황·근거 | problems/grouping, problems/reporting, problems/snapshots, problems/tests, problems/repairs, coding-agent/tickets |
| 역할·assignment·run | 정의·판·담당 범위·남길 문서·주기·상태·확정 결과 | lophn-agent/presets, lophn-agent/assignments, lophn-agent/harness/run-loop |

전체 범위는 원본 디스크·소스·secret 읽기가 아니다.

#### tool 선택 값

공통 읽기·format·question 동작은 → 이 문서 common 기본 preset의 개별 목록 전체를 선택한다.

| 묶음 | 추가 개별 동작 | 제약 |
|---|---|---|
| 프로젝트·앱·SDK 읽기 | `project.list`, `project.read`, `app.list`, `app.read`, `app.blueprint`, `app.commands`, `app.releases`, `app.health`, `app.invocations`, `sdk.list`, `sdk.contract`, `sdk.examples` | 조회와 현재 허락된 앱 자동 command; 실행 판정은 harness/tool-judgment |
| problem·ticket 읽기 | `problem.list`, `problem.read`, `report.read`, `snapshot.read`, `verification.read`, `repair.read`, `ticket.list`, `ticket.read` | 문제 해석 참조·상태·기존 ticket 변경 없음 |
| coding 요청 | `ticket.create` | 직접 요청·피드백을 ticket으로 생성; 부족한 근거는 준비 상태로 표시; claim·시작·완료 처리 없음; → coding-agent/tickets |
| 제품 안내·공개 설정 | `lophn.guide`, `setting.read` | secret 없는 동봉 안내·현재 공개 설정과 출처만 |
| 문서 결과 | `document.create`, `document.save_version` | Run 요청 범위; 기존 문서 저장은 기준 Version 필수 |
| 역할·assignment 읽기 | `preset.list`, `preset.read`, `assignment.list`, `assignment.read`, `run.read_result` | 변경 없음 |
| handoff | `handoff.submit`, `handoff.read_status`, `handoff.read_result` | 방향·계보는 → lophn-agent/handoff |


### app-engineer 기본 preset의 읽기·tool 값

#### 읽기 범위 값

| 대상 | 허용 값 | 참조 |
|---|---|---|
| 담당 앱 place 문서 | 목차·검색·Version·본문·절·이력·차이 | documents/versions, documents/outline-and-search |
| 담당 앱 | blueprint·release·정상 신호·invocation·problem·ticket 및 그 앱에 연결된 보고·snapshot·test result·고친 기록 | apps/blueprint, apps/releases, apps/invocations, problems/grouping, problems/reporting, problems/snapshots, problems/tests, problems/repairs, coding-agent/tickets |
| 관련 context | 담당 앱의 `effect = read` 명령을 item으로 가진 context의 목적·용어·item metadata | documents/contexts, documents/terms |
| 이번 handoff 근거 | Run.source의 고정 Version와 지정 절만, 이 Run 동안만 | lophn-agent/harness/run-loop, lophn-agent/handoff |
| 제품 SDK | 제공한 계약·예시 | apps/sdk |
| 관련 Preset·Assignment·Run | 자기 담당 범위·handoff의 현황과 결과 | lophn-agent/presets, lophn-agent/assignments, lophn-agent/harness/run-loop |

관련 context의 다른 문서 본문, 다른 앱, handoff 근거의 최신 Version는 허용하지 않는다. 주소를 따라 범위를 넓히지 않는다. 담당 앱의 허락된 read와 undo 지원 write만 실행하며 external·undo 미지원 write는 제공하지 않는다.

#### tool 선택 값

공통 문서·context·term·format 읽기와 question 동작은 → 이 문서 common 기본 preset의 목록에서 위 담당 범위만 선택한다. 전체 목록·검색에도 이 범위를 적용한다.

| 묶음 | 추가 개별 동작 | 제약 |
|---|---|---|
| 담당 앱·SDK 읽기 | `project.read`, `app.read`, `app.blueprint`, `app.commands`, `app.releases`, `app.health`, `app.invocations`, `sdk.contract`, `sdk.examples` | scope 안 조회만 |
| problem·ticket 읽기 | `problem.list`, `problem.read`, `report.read`, `snapshot.read`, `verification.read`, `repair.read`, `ticket.list`, `ticket.read` | 담당 앱만 |
| 문서 결과 | `document.create`, `document.save_version` | 담당 앱 place·Run 요청 범위; 기준 Version 필수 |
| 해석 연결 | `problem.set_interpretation` | 담당 problem에 문서 고정 Version·절 참조; 현재 problem seq·기존 참조 CAS; 이전 참조 보존; → problems/grouping |
| ticket | `ticket.create` | 담당 앱 구현·repair 생성만; → coding-agent/tickets |
| 역할·assignment 읽기 | `preset.read`, `assignment.read`, `run.read_result` | 관련 범위만 |
| handoff | `handoff.submit`, `handoff.read_status`, `handoff.read_result` | → lophn-agent/handoff의 허용 방향만 |

#### 앱 command·시각 선택 값

- 담당 앱 하나의 현재 agent 사용 허락과 Preset scope 교집합에서 자동 앱 command를 선택한다. `effect=read`와 `effect=write`이며 undo contract를 확인한 정의만 제공하고 confirm이면 approval를 거친다. 앱 archive·허락 회수·release 계약 변경은 실제 진입을 막는다. → apps/permissions, apps/blueprint, lophn-agent/harness/tool-judgment.
- `visual.show / visual.read / visual.prepare_document`를 담당 세션·자료 범위에서 선택한다. 문서 저장은 기존 담당 앱 place와 요청 범위다. 앱 코드·blueprint·DB 직접 접근은 추가하지 않는다.


### context-engineer 기본 preset의 읽기·tool 값

#### 읽기 범위 값

| 대상 | 허용 값 | 참조 |
|---|---|---|
| 전체 context·term·문서·project | 목적·item·term·소속·목차·검색·필요한 고정 Version·절·본문·이력·차이 | documents/contexts, documents/terms, documents/versions, documents/outline-and-search, documents/projects |
| 앱 | 목적·blueprint 명령 목록의 이름·설명·입력 schema·effect | apps/registration, apps/blueprint |
| Preset·Assignment·Run | 정의·판·scope·outputs·Schedule·상태·확정 결과 | lophn-agent/presets, lophn-agent/assignments, lophn-agent/harness/run-loop |
| 반복 판단 근거 | 사람이 제공한 수동 업무, 현재 context의 watch 변화·기준 자료 상태·기존 Operator 결과 | documents/contexts, lophn-agent/assignments |

앱 read command의 metadata는 읽지만 호출 결과·업무 DB를 읽는 권한은 없다.

#### tool 선택 값

공통 문서·context·term·format 읽기와 question 동작은 → 이 문서 common 기본 preset의 개별 목록 전체를 선택한다.

| 묶음 | 추가 개별 동작 | 제약 |
|---|---|---|
| 프로젝트·앱 metadata | `project.list`, `project.read`, `app.list`, `app.read_purpose`, `app.commands` | 앱 명령 호출 없음 |
| context 변경 | `context.create`, `context.rename`, `context.set_purpose`, `context.archive`, `context.add_item`, `context.update_item`, `context.remove_item` | → documents/contexts의 CAS·되돌림 계약 |
| term 후보·답 전달 | `term.propose_candidate`, `term.update_candidate`, `term.remove_candidate`, `term.submit_definition_answer` | 마지막 동작은 사람 Question 답 참조 전달만; 실제 정의 적용은 machine; → documents/terms |
| 문서 결과 | `document.create`, `document.save_version` | Run 요청 범위; 기준 Version 필수 |
| 역할·assignment 읽기 | `preset.list`, `preset.read`, `assignment.list`, `assignment.read`, `run.read_result` | 실제 Preset·Assignment 적용 없음 |
| 승인 초안 | `approval.submit_assignment` | OperatorApprovalBundle → lophn-agent/assignments; 승인 생성 → platform/approvals |
| handoff | `handoff.submit`, `handoff.read_status`, `handoff.read_result` | → lophn-agent/handoff의 허용 방향만 |


### operator 기본 preset의 읽기·tool 값

#### 읽기 범위 값

| 대상 | 허용 값 | 참조 |
|---|---|---|
| 선택한 context | 목적·term·item·관점 | documents/contexts, documents/terms |
| 담당 project/app 안 Preset.context로 선택한 문서·context의 문서 item | 현재 허용된 문서·절의 목차·고정 Version·본문·이력·차이·검색 | documents/contexts, documents/versions, documents/outline-and-search |
| 승인된 남길 문서 | 고정 document ID의 Version·이력·차이·본문 | lophn-agent/assignments, documents/versions |
| 승인된 앱 명령 | Assignment.read_commands의 정확한 `(app, command)` 쌍이며 app은 read_apps, command 이름은 Preset.capability.tools.app_command에 선택된 `effect = read` 명령의 metadata·결과 | apps/blueprint, apps/runtime |
| 자기 Question·approval 결정 | 자기 Run에 연결된 결정 | lophn-agent/questions, platform/approvals |

Operator 범위는 project 또는 app 하나이고 context는 자료 선택이다. 결과 문서가 가리킨 다른 자료·선택 자료 밖 문서·전체 앱 metadata를 따라 읽지 않는다. 앱 read command가 앱 밖 상태 변경·쓰기 효과를 숨기면 제공하지 않는다. 허락된 read가 앱의 secret·network grant로 데이터를 가져오는 것은 read이며 호출 주체가 Operator라는 이유나 secret 사용만으로 거절하거나 추가 approval을 묻지 않는다. secret 값은 앱 코드·agent에 주지 않고 전송 경계에서 붙이며 대상 host는 앱 network grant를 따른다.

#### tool 선택 상한

구체적 Preset은 아래 개별 동작 중 필요한 것만 승인받아 선택한다. 묶음이 바뀌어도 승인 목록은 늘지 않는다.

| 묶음 | 선택 가능한 개별 동작 | 제약 |
|---|---|---|
| context 읽기 | `context.read`, `context.items`, `context.terms`, `term.read` | Preset.context로 선택한 담당 project/app 자료만 |
| 문서 읽기 | `document.list`, `document.outline`, `document.search`, `document.read_version`, `document.read_section`, `document.read_range`, `document.history`, `document.diff` | Preset.context 자료·선언 문서만 |
| format 읽기·검사 | `format.list`, `format.rules`, `format.examples`, `format.validate` | 필요한 문서 저장 계약 확인 |
| 남길 문서 | `document.save_version` | 승인한 기존 document 새 Version만; 읽은 Version CAS |
| 앱 read command | `app.command_metadata`, `app.call_read_command` | 승인된 `(app, command)`·read_apps·현재 effect 확인 |
| 사람에게 묻기 | `question.submit`, `question.read_decision`, `approval.read_decision` | 판단에 필요한 의도·취향·결과 해석; 다른 tool 권한을 주지 않음 |


## 관계

| from | 관계 | to | 다중도 | 대상이 사라지면 |
|---|---|---|---|---|
| Preset 판 | 사용 | Assignment → lophn-agent/assignments | 1:N | 사용한 판 유지; 새 판 자동 적용 없음 |
| Preset 판 | 시작 기준 | Run → lophn-agent/harness/run-loop | 1:N | 과거 판 삭제 불가 |
| Preset 판 | 계정 선택 | Provider → lophn-agent/harness/provider | N:1..2; model/organizing 선택마다 하나 | 현재 회수 즉시 call 차단; 과거 선택 유지 |
| Preset 판 | 지침 연결 | Document → lophn-agent/instructions | N:M | 부재 표시; 과거 근거 유지 |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `presets` | kind, origin, name_key, 현재 revision | PK id | user name_key; product kind partial unique; user 이름과 product 표시 이름 충돌은 command 검사 | kind | (id,revision) → preset_revisions |
| `preset_revisions` | 전체 판 blob·prompt hash·결정 근거 | PK (preset_id,revision) | — | preset_id | preset → presets; blob → platform/blob-store |

같은 transaction에서 현재 판·새 immutable 판·event를 확정한다. 과거 판 수정·삭제는 없다. persona·관점·기대 결과 별도 표는 없다.

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `RegisterDefaultPreset` | machine | kind, 배포 판 blob | 같은 kind·배포 hash; 재전송은 기존 결과; user 판은 갱신 금지 | `PresetCreated` 또는 `PresetRevised` | invalid_input, conflict, forbidden |
| `CreatePreset` | user | 전체 구성, 복사할 판? | 참조·이름·역할 상한·model/확장 검증 | `PresetCreated` | invalid_input, not_found, conflict, forbidden |
| `RevisePreset` | user | ID, 이전 revision, 전체 새 판, 이유 | CAS·전체 검증; product 원문 개인화는 새 user preset | `PresetRevised` | invalid_input, not_found, conflict, forbidden |

agent는 직접 저장하지 않고 → lophn-agent/questions로 변경 제안만 한다. Operator preset 저장은 실행 승인이나 Assignment 생성이 아니다.

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `PresetCreated` | Preset | kind, origin, revision, 전체 판 hash | lophn-agent/assignments, shell/desktop |
| `PresetRevised` | Preset | 이전·새 revision와 hash, 사람 결정·이유 | lophn-agent/assignments, shell/desktop |

## 정책

- **판 고정.** Assignment는 preset 하나의 존재하는 revision을 쓴다. 새 판 적용은 Assignment 변경으로 명시하며 Operator는 전체 승인 묶음에 고정한다. 시작한 Run은 옛 기준을 유지하고 현재 권한 축소는 즉시 적용한다.
- **정본 하나.** model·context·skill·MCP·붙인 지침의 구성 선택은 Preset 판에만 둔다. 공급 catalog·서버 설정·credential 값·지침 파일은 각 owner의 정본이다.
- **복사.** 구성 참조만 복사한다. 계정 참조는 비밀 원문 복사가 아니며 현재 접근 여부를 다시 검사한다. 다른 Assignment의 범위·출력·주기·승인·이력은 복사하지 않는다.
