---
type: domain-model
concerns: [apps/registration]
---
# apps/registration

App의 등록 정보, source 연결과 보관 상태를 정의한다.

## App (`app`)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `app` ID | 아니오 | PK, 불변 | 앱 ID |
| `slug` | 문자열 | 아니오 | → documents/addressing의 place 문법; Project와 같은 이름 공간에서 unique | 문서 주소의 place |
| `name` | 문자열 | 아니오 | 빈 문자열 금지 | 화면 이름 |
| `description` | 문자열 | 아니오 | 빈 문자열·줄바꿈 금지 | 한 줄 목적 |
| `planning_version` | `ver` ID | 예 | → documents/versions | 등록 근거의 고정 판 |
| `source_path` | 절대 경로 문자열 | 예 | git 폴더의 정규화한 실제 경로 | 구현 source |
| `active_release` | `rel` ID | 예 | → apps/releases; 같은 앱의 `active` release | 채택한 release |
| `run_enabled` | boolean | 아니오 | 최초 `false`; 보관 중 `false` | 프로세스를 시작해도 되는가; 변경 규칙 → apps/runtime |
| `status` | `active` / `archived` | 아니오 | 최초 `active` | 보관 상태 |

### 상태

| 상태 | 뜻 |
|---|---|
| `active` | 보관하지 않음; runtime의 `running`과 다름 |
| `archived` | 보관됨 |

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| 없음 | `active` | user / coding_agent | user 또는 전체 scope connection; 이름 공간 검사 | `AppCreated` |
| `active` | `archived` | user | 비교 기준 일치; `run_enabled=false`를 함께 저장 | `AppArchived` |
| `archived` | `active` | user | 비교 기준 일치; `run_enabled=false` 유지 | `AppUnarchived` |

### 불변 조건

- 등록에는 release·source·기획 판이 필요하지 않다. 앱 하나 scope connection과 agent는 등록하지 못한다.
- 질문의 고정 등록 동작을 적용한 경우 event actor는 user이며 결정 근거는 → lophn-agent/questions.
- activation 성공 때 `name`, `description`은 채택한 blueprint의 값으로 갱신된다(→ apps/releases).
- archive는 새 호출과 automation을 닫는다. 실제 종료 완료 판정은 → apps/runtime. unarchive는 실행을 허용하지 않는다.
- AppCreated의 App Engineer assignment 생성은 → lophn-agent/assignments. 등록 transaction에 assignment를 정의하지 않는다.

## 관계

| from | 관계 | to | 다중도 | 대상이 사라지면 |
|---|---|---|---|---|
| App | 등록 근거 | → documents/versions | 0..1 | 고정 판 참조를 유지; 삭제 거절 |
| App | 채택한 release | → apps/releases | 0..1 | 참조 중 삭제 거절 |
| App | 문서 place | → documents/addressing | 1 | 이름 변경·옛 address는 addressing 규칙 |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `apps` | App 필드 | PK `id` | `slug` 및 Project와의 교차 unique → documents/addressing | `(status, id)` | `planning_version` → versions; `(id, active_release)` → releases의 `(app, id)`; 순환 참조는 transaction 끝에 검사 |

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `app.create` | user / coding_agent | `slug,name,description,planning_version?` | place 이름 공간; idempotency key | `AppCreated` | `forbidden`, `invalid_input`, `conflict` |
| `app.connect_source` | user / coding_agent | `app,source_path` | App 최신 seq; connection 앱 scope | `AppSourceConnected` | `forbidden`, `invalid_input`, `conflict`, `not_found` |
| `app.archive` | user | `app` | App 최신 seq | `AppArchived` | `conflict`, `not_found` |
| `app.unarchive` | user | `app` | App 최신 seq | `AppUnarchived` | `conflict`, `not_found` |

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `AppCreated` | App | `slug,name,description,planning_version?` | lophn-agent/assignments, documents/addressing, coding-agent/connection |
| `AppSourceConnected` | App | `source_path` | coding-agent/connection |
| `AppArchived` | App | `run_enabled:false` | apps/runtime, lophn-agent/assignments, documents/addressing |
| `AppUnarchived` | App | `run_enabled:false` | apps/runtime, lophn-agent/assignments, documents/addressing |

## 정책

- **source 분리.** source 연결은 운영 묶음·active release·앱 DB를 변경하지 않는다.
- **영구 참조.** App은 archive만 하며 release·문서 place를 cascade delete하지 않는다.
