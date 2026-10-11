---
type: domain-model
concerns: [shell/workspace]
---
# shell/workspace

프로젝트 화면의 탭 layout과 요청 창의 현재 보기 상태를 정의하며 entity·ledger 표·domain event를 만들지 않는다. Lophn Workspace는 칸·탭 구조가 아닌 따로인 페이지라 이 layout에 들어가지 않는다.

## WorkspaceLayout (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `schema_version` | integer | 아니오 | 첫 판 1; 미지원 판은 복원하지 않음 | 파일 계약 |
| `project` | `prj` ID | 아니오 | → documents/projects | 배치 대상 |
| `panes` | PaneLayout[] | 아니오 | 1~2개 | 좌우 순서 |
| `split_ratio` | number | 아니오 | 0보다 크고 1보다 작은 유한 비율; 기본 0.5; 실제 두 칸 배치는 각각 480px 이상 | 두 칸의 왼쪽 비율 |
| `focused_pane` | integer | 아니오 | panes의 유효 index | 마지막 입력 focus |
| `information_panel` | object | 아니오 | `open: boolean`, `tab: info \| versions \| contexts`; 첫 열기는 닫힘·info | shell/editor#R6의 공간별 패널 선택 |

## PaneLayout (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `tabs` | TabLayout[] | 아니오 | 순서 있는 목록 | 해당 칸의 탭 |
| `selected_tab` | string | 예 | 같은 tabs의 key; 빈 목록이면 null | 현재 선택 |

## TabLayout (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `key` | string | 아니오 | workspace 안 유일; 로컬 참조, credential 아님 | 탭 대응 |
| `kind` | `document_editor \| terminal \| app_panel \| agent \| agents \| contexts \| context \| search` | 아니오 | tagged union; kind 목록은 아래 TabKind registry가 정한다 | 종류 |
| `document` | `doc` ID | 조건부 | document_editor만 → documents/versions | 문서 |
| `read_position` | object | 예 | document_editor만; section key와 0 이상 scroll offset | 읽던 위치 |
| `project_folder` | string | 조건부 | terminal만; Project의 등록 폴더 참조 | 시작 폴더 선택 |
| `app` | `app` ID | 조건부 | app_panel만 → apps/registration | 앱 |
| `surface` | string | 조건부 | app_panel만; blueprint의 panel surface key | 표시 화면 |
| `mode` | `live` | 조건부 | 지속 app_panel만; preview는 복원 파일에서 제외 | 운영 화면 |
| `agent` | `asg` ID | 조건부 | agent는 필수이고 탭을 연 뒤 바꾸지 않는다(한 탭 = 한 agent) → lophn-agent/assignments; agents는 editor로 열어 둔 agent이고 비면 카드 목록이다. 새 Operator를 쓰는 중인 editor는 아직 assignment가 없어 복원하지 않는다 | 탭의 agent / 열어 둔 editor |
| `work_place` | WorkPlace | 조건부 | agent만; `kind`는 `project`이고 `id`는 이 layout의 project와 같다(앱 공간의 Agent component는 이 layout을 쓰지 않는다 → shell/app-frame). 탭을 연 뒤 바꾸지 않는다 → lophn-agent/conversation | session을 연 자리 |
| `session` | `ses` ID | 예 | agent만; 대화 하나를 가리키고 위 `agent`·`work_place`의 session이어야 한다. 비면 새 session(session은 첫 메시지를 보낼 때 생긴다); session 전환은 탭 머리에서 하며 같은 탭의 `session`만 바뀐다 → lophn-agent/conversation | 대화 |
| `context` | `ctx` ID | 조건부 | context·search만 → documents/contexts; 이 layout의 project에 속한 context만 | 보는 context |
| `sub_tab` | `overview \| search \| violations \| glossary \| contract` | 아니오 | context만; 기본 overview; drafting 중인 context도 같은 값을 쓴다 | Context 탭의 하위 탭 |
| `declared_search` | string | 예 | search만; context 계약이 선언한 검색의 key; 비면 검색을 아직 고르지 않음 | 선언된 검색 |
| `inputs` | object | 조건부 | search만; 선언된 입력 이름 → 값(문자열·숫자·문자열 목록·범위 `{from, to}`). 입력 16개 이하, 합쳐 4KiB 이하 | 채워 둔 입력 |
| `page` | integer | 조건부 | search만; 0부터. 기본 0 | 결과 page |
| `saved_view` | `viw` ID | 예 | search만; 저장한 보기로 열었으면 그 참조 → documents/outline-and-search | 연 저장 보기 |

`contexts` 탭은 project의 context 목록 자체를, `agents` 탭은 project의 agent 목록 자체를 보이므로 대상 필드가 없다(`agents`의 `agent`는 목록 대신 editor를 열어 둘 때만이다). 다른 kind의 필드는 허용하지 않는다. Agent 탭의 상태 점(답을 기다리는 session)은 현재 session 상태에서 매번 구하는 표시이며 필드로 저장하지 않는다. 실제 PTY·view ID·generation·connection·release는 복원하지 않고 현재 contract로 다시 얻는다. 본문·초안·선택 본문·출력·credential·앱 context 값·검색 결과 줄을 넣지 않는다. `inputs`는 사람이 채운 검색 조건일 뿐 결과가 아니며 복원 때 검색을 다시 계산한다.

## TabKind registry (값)

탭 kind는 registry로 늘린다. kind마다 선언 하나(파일 하나)가 아래를 모두 가지고, kind를 더해도 다른 kind의 선언이나 공통 탭 줄 코드를 고치지 않는다.

| 항목 | 뜻 |
|---|---|
| `kind` | TabLayout.kind에 쓰는 이름. registry 안 유일 |
| 필드 schema | 그 kind가 가질 수 있는 TabLayout 필드와 제약. 위 표의 조건부 필드가 여기서 온다 |
| 탭 이름 | 탭 줄에 쓰는 종류 표시와 대상 이름 |
| 대상 검사 | 복원·열기 때 대상(문서·앱·context·선언된 검색)이 있고 사람이 쓸 수 있는지. 실패하면 이유를 가진 자리표시 |
| 현재 보기 요약 | CurrentViewState.tabs에 넣을 허용 참조(아래 표). 비어 있으면 종류만 |
| 열기 진입 | 이 kind의 탭을 여는 길(탭 줄 `+`, 바로 가기 rail, 팔레트, 다른 탭의 링크 등)이 부르는 하나의 열기 함수 |

처음 등록하는 kind는 위 여덟이다. `agent` kind의 탭 이름은 "Agent"와 agent 이름이고 `agents` kind는 "Agents"(editor를 열어 둔 동안은 그 agent 이름을 붙인다)다. `agent`의 대상 검사는 agent(assignment)가 withdraw되지 않았고 session이 지워지지 않았는지이며, 실패하면 다른 agent나 새 session으로 바꾸지 않고 이유를 가진 자리표시가 된다. `agent` 진입(열기 함수)은 sidebar Agents 묶음의 agent 줄과 접힌 rail의 Agent 단추(lophn)와 toast의 [Ask …]가 부르는 하나이고 `agents`는 sidebar의 Manage다. 옛 `document_viewer`는 문서 판이 없어져 고정 판을 읽는 viewer가 필요 없으므로 등록하지 않는다. registry에 없는 kind(옛 `document_viewer` 포함)의 탭은 자리표시 없이 건너뛰고 나머지 탭의 순서·선택을 지킨다.

## CurrentViewState (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `window_ref` | string | 아니오 | main registry의 실제 요청 창 | 수집 기준 |
| `generation` | integer | 아니오 | 창의 보기 변경마다 증가 | 늦은 응답 검사 |
| `project` | `prj` ID | 예 | 현재 범위 검사 후만 포함 | 프로젝트 |
| `observed_at` | UTC 시각 | 아니오 | 수집 때 고정 | 관측 시각 |
| `tabs` | object[] | 아니오 | 허용 종류·대상 참조·선택 여부; 페이지당 최대 20. 참조는 문서·앱·context ID, context 하위 탭, 선언된 검색 key만이고 검색 입력 값·결과는 넣지 않는다. Agent·Agents 탭은 종류와 선택 여부만이고 session 내용·agent 지침·editor 입력은 넣지 않는다 | 열린 대상 |
| `focused_pane` | integer | 예 | 실제 focus 또는 null | focus |
| `selection` | object | 예 | doc·ver·section·줄 범위만; 본문 없음 | 문서 선택 |
| `app_view` | object | 예 | 실제 app·release·mode·surface·view generation 참조만 | → apps/agent-context |
| `availability` | `current \| disconnected \| unavailable` | 아니오 | 확인한 상태만 | 현재 여부 |
| `omissions` | object[] | 아니오 | 이유·잘림·다음 페이지 정보 | 제외 표시 |

## 정책

- **저장.** layout은 shell main이 소유한 `shell/layout.json` 안 프로젝트별 값이다. 0700 폴더·0600 파일 또는 동등 ACL, schema 검증·원자 교체를 쓰며 ledger 정본이 아니다.
- **복원.** 현재 project·문서·app·context·agent·session·권한 검사를 거쳐 탭을 복원한다. Agent 탭은 저장한 agent·work_place·session 그대로 열고 Agents 탭은 목록 또는 열어 둔 editor(저장된 정의만, 입력 중이던 값은 없음)로 돌아온다. context가 없어졌거나 보관됐거나, 선언된 검색이 계약에서 사라졌으면 그 탭은 이유를 가진 자리표시가 된다. 검색 탭은 채워 둔 입력으로 검색을 다시 계산한다. 미지원 schema·손상 파일은 빈 layout과 안전 오류로 처리하고 domain 데이터는 바꾸지 않는다. 터미널은 종료된 placeholder이며 시작을 자동 실행하지 않는다.
- **폭과 focus.** 두 칸 각각 480px를 확보하지 못하면 저장된 panes·split_ratio·탭 소속을 바꾸지 않고 focus 칸 중심의 한 칸 보기로 표시하며 넓어지면 원래 배치로 돌아간다. 탭 이동은 각 칸의 순서·선택 탭과 단일 focus를 함께 검증한다.
- **정보 패널.** 사람의 공간별 열림·마지막 탭 선택만 저장한다. 좁은 창에서 overlay가 되어도 저장 선택을 덮지 않고 닫힘·폭 복귀 뒤 같은 선택을 복원한다(→ shell/design-system#R25).
- **현재 보기.** main 메모리에서만 보유하고 창·세션 요청 결합으로 신뢰 agent runtime에 넘긴다. 요약 최대 2048 UTF-8 bytes, 상세 탭 최대 20개씩, scope·redaction 뒤 반환한다. 앱 상세 context는 → apps/agent-context의 read command다.
- **권한.** UI 참조·선택·focus는 읽기 허락이나 write 승인 근거가 아니다. 다른 창의 run에 마지막 사람 창을 임의 결합하지 않는다.
