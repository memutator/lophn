---
type: domain-model
concerns: [shell/workspace]
---
# shell/workspace

프로젝트별 로컬 UI layout과 요청 창의 현재 보기 상태를 정의하며 entity·ledger 표·domain event를 만들지 않는다.

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
| `kind` | `document_editor \| document_viewer \| terminal \| app_panel` | 아니오 | tagged union | 종류 |
| `document` | `doc` ID | 조건부 | 문서 종류만 → documents/versions | 문서 |
| `version` | `ver` ID | 조건부 | viewer에서 고정 판; editor는 null | 읽는 판 |
| `read_position` | object | 예 | 문서만; section key와 0 이상 scroll offset | 읽던 위치 |
| `project_folder` | string | 조건부 | terminal만; Project의 등록 폴더 참조 | 시작 폴더 선택 |
| `app` | `app` ID | 조건부 | app_panel만 → apps/registration | 앱 |
| `surface` | string | 조건부 | app_panel만; blueprint의 panel surface key | 표시 화면 |
| `mode` | `live` | 조건부 | 지속 app_panel만; preview는 복원 파일에서 제외 | 운영 화면 |

다른 kind의 필드는 허용하지 않는다. 실제 PTY·view ID·generation·connection·release는 복원하지 않고 현재 contract로 다시 얻는다. 본문·초안·선택 본문·출력·credential·앱 context 값을 넣지 않는다.

## CurrentViewState (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `window_ref` | string | 아니오 | main registry의 실제 요청 창 | 수집 기준 |
| `generation` | integer | 아니오 | 창의 보기 변경마다 증가 | 늦은 응답 검사 |
| `project` | `prj` ID | 예 | 현재 범위 검사 후만 포함 | 프로젝트 |
| `observed_at` | UTC 시각 | 아니오 | 수집 때 고정 | 관측 시각 |
| `tabs` | object[] | 아니오 | 허용 종류·대상 참조·선택 여부; 페이지당 최대 20 | 열린 대상 |
| `focused_pane` | integer | 예 | 실제 focus 또는 null | focus |
| `selection` | object | 예 | doc·ver·section·줄 범위만; 본문 없음 | 문서 선택 |
| `app_view` | object | 예 | 실제 app·release·mode·surface·view generation 참조만 | → apps/agent-context |
| `availability` | `current \| disconnected \| unavailable` | 아니오 | 확인한 상태만 | 현재 여부 |
| `omissions` | object[] | 아니오 | 이유·잘림·다음 페이지 정보 | 제외 표시 |

## 정책

- **저장.** layout은 shell main이 소유한 `shell/layout.json` 안 프로젝트별 값이다. 0700 폴더·0600 파일 또는 동등 ACL, schema 검증·원자 교체를 쓰며 ledger 정본이 아니다.
- **복원.** 현재 project·문서·app·권한 검사를 거쳐 탭을 복원한다. 미지원 schema·손상 파일은 빈 layout과 안전 오류로 처리하고 domain 데이터는 바꾸지 않는다. 터미널은 종료된 placeholder이며 시작을 자동 실행하지 않는다.
- **폭과 focus.** 두 칸 각각 480px를 확보하지 못하면 저장된 panes·split_ratio·탭 소속을 바꾸지 않고 focus 칸 중심의 한 칸 보기로 표시하며 넓어지면 원래 배치로 돌아간다. 탭 이동은 각 칸의 순서·선택 탭과 단일 focus를 함께 검증한다.
- **정보 패널.** 사람의 공간별 열림·마지막 탭 선택만 저장한다. 대화가 패널을 임시 대체하거나 좁은 창에서 overlay가 되어도 저장 선택을 덮지 않고 닫힘·폭 복귀 뒤 같은 선택을 복원한다(→ shell/desktop#R2,R29, shell/design-system#R25).
- **현재 보기.** main 메모리에서만 보유하고 창·세션 요청 결합으로 신뢰 agent runtime에 넘긴다. 요약 최대 2048 UTF-8 bytes, 상세 탭 최대 20개씩, scope·redaction 뒤 반환한다. 앱 상세 context는 → apps/agent-context의 read command다.
- **권한.** UI 참조·선택·focus는 읽기 허락이나 write 승인 근거가 아니다. 다른 창·주기 run에 마지막 사람 창을 임의 결합하지 않는다.
