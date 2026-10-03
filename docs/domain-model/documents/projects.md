---
type: domain-model
concerns: [documents/projects]
---
# documents/projects

Project의 폴더 등록, 메타데이터, tracking 규칙과 보관 상태를 정의한다.

## Project (`prj`)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `prj` ID | 아니오 | PK, 불변 | |
| `name` | Slug | 아니오 | → documents/addressing; 앱과 공유하는 이름 공간 | 주소의 place 칸 |
| `title` | string | 아니오 | 빈 문자열 금지 | 화면 이름 |
| `purpose` | string | 아니오 | 문자열 | 프로젝트 목적 |
| `folders` | Folder[] | 아니오 | 빈 목록 허용; 정규화 경로 중복 금지 | 등록 폴더 |
| `tracking` | TrackingRuleSet | 아니오 | 생성 기본값은 `enabled = false` | |
| `revision` | event seq | 아니오 | 양의 정수; 마지막 구성 변경 event seq | CAS 기준 |
| `status` | `active \| archived` | 아니오 | 생성은 `active` | |

### 상태

| 상태 | 뜻 |
|---|---|
| `active` | tracking 규칙에 따라 관측 가능 |
| `archived` | 자동 파일 관측 중단 |

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| 없음 | `active` | `user` | 이름 예약 가능, 폴더·규칙 유효 | `ProjectCreated` |
| `active` | `archived` | `user` | `revision` 일치 | `ProjectArchived` |
| `archived` | `active` | `user` | `revision` 일치; 켜진 루트 겹침 없음 | `ProjectUnarchived` |

### 불변 조건

- 폴더가 없는 Project도 유효하다. 기본 Project를 자동 생성하지 않는다.
- 폴더 제거, tracking 해제, Project 보관은 → documents/versions의 Document·Version을 삭제하거나 일괄 보관하지 않는다.
- 이름 변경은 ID를 바꾸지 않는다. 현재 이름과 과거 이름 예약은 → documents/addressing을 따른다.
- `revision`은 이름·제목·목적·폴더·tracking·보관 상태 변경마다 해당 event seq로 갱신한다.
- 활성 Project의 켜진 tracking 루트는 정규화된 실제 경로 기준으로 서로 겹치지 않는다. 같은 루트와 조상·자손 루트 모두 겹침이다.
- 폴더 경로 변경은 명시적 재연결이다. 사라진 파일과 새 파일의 내용으로 이동을 추정하지 않는다.

## Folder (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `path` | string | 아니오 | 정규화된 절대 경로; Project 안에서 유일 | 등록 루트 |
| `description` | string | 아니오 | 빈 문자열 허용 | 사람이 붙인 설명 |

별도 ID가 없으며 저장 순서를 유지한다. 관측·파일 접근의 안전한 실제 경로 판정은 → documents/file-tracking이다.

## TrackingRuleSet (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `enabled` | boolean | 아니오 | 기본 `false`; 패턴 행 유무와 독립 | |
| `patterns` | TrackingPattern[] | 아니오 | 순서 보존; 빈 목록이면 선택 파일 없음 | |
| `use_gitignore` | boolean | 아니오 | 추적을 처음 켤 때 기본 제안 `true` | 등록 루트의 `.gitignore` 적용 |

## TrackingPattern (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `effect` | `include \| exclude` | 아니오 | enum | |
| `glob` | string | 아니오 | 빈 문자열·절대 경로·`..` 경로 성분 금지; 루트 상대 `/` 경로 대상 | |

### 불변 조건

- 패턴은 목록 순서대로 적용하며 마지막 일치가 이긴다. 일치가 없으면 추적하지 않는다.
- `.gitignore` 사용 시 ignore 대상은 제외한다. `.git` 내부, lophn 데이터 폴더, 등록 루트 밖으로 나가는 symlink는 포함 패턴으로도 다시 포함할 수 없다.
- 생성에는 `enabled = false`만 허용한다. 최초 켜기의 기본 제안은 `include **/*.md`, `use_gitignore = true`이며 미리보기 뒤 사람의 적용 명령으로만 켠다.
- tracking을 켜거나 폴더·규칙을 바꾸는 모든 command는 같은 TrackingPreview의 정확한 folders·tracking·base_revision을 검사한다. `project.update`의 folders 변경도 이 검사를 우회하지 않는다.
- 자동 tracking은 Project 폴더에만 적용한다. 앱 source 관리·문서 출력은 → apps/registration, apps/blueprint이다.

## TrackingPreview (값)

ledger 밖에서 계산하는 미리보기다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `project` | `prj` ID | 아니오 | 이 파일의 Project 참조 | |
| `base_revision` | event seq | 아니오 | 미리보기에 읽은 Project revision | |
| `folders` | Folder[] | 아니오 | 적용하려는 정확한 폴더 목록 | |
| `tracking` | TrackingRuleSet | 아니오 | 적용하려는 정확한 규칙 | |
| `observed_at` | UTC 시각 | 아니오 | 공통 시각 형식 | |
| `entries` | `{folder_path: string, path: string, included: boolean, reason: string}[]` | 아니오 | folder_path는 folders의 등록 루트; path는 그 루트 상대 경로 | 여러 루트의 같은 상대 경로도 구별한 포함·제외 결과 |
| `complete` | boolean | 아니오 | 잘린 목록은 `false` | |
| `next_cursor` | string | 예 | `complete = true`이면 null | |

규칙 적용은 미리보기의 폴더·규칙과 `base_revision`을 사용한다. 미리보기의 파일 목록은 디스크 snapshot이나 적용 뒤의 고정 목록이 아니다.

## 관계

| from | 관계 | to | 다중도 | 대상이 사라지면 |
|---|---|---|---|---|
| Project | 현재 자리 | Document → documents/versions | 1:N | 문서의 place를 명시적으로 변경; Project 영구 삭제 없음 |
| Project | 원본 연결의 소속 | FileSource → documents/versions | 1:N | 폴더 해제만으로 연결·version 삭제 없음 |
| Project | 이름 예약 | PlaceName → documents/addressing | 1:N | 보관 뒤에도 예약 유지 |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `projects` | `id, name, title, purpose, tracking_enabled, use_gitignore, revision, status` | PK `id` | `name`; 공유 이름 예약도 검사 | `(status, id)` | `revision` → platform/ledger event seq; name → documents/addressing |
| `project_folders` | Folder와 순서 `position` | PK `(project, position)` | `(project, path)` | `(path)` | `project` → `projects.id`; 삭제는 명시적 구성 변경만 |
| `project_tracking_patterns` | TrackingPattern과 순서 `position` | PK `(project, position)` | 없음 | PK로 순서 읽기 | `project` → `projects.id` |

`position`은 0부터 연속인 정수다. 폴더·패턴은 Project 안의 값이며 ID를 발급하지 않는다. 행 교체와 `revision`·event 갱신은 한 transaction이다.

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `project.create` | `user` | `id, name, title, purpose, folders, tracking`, idempotency key | 대상 ID·이름 미존재; tracking.enabled=false | `ProjectCreated` | `invalid_input`, `conflict`, `forbidden` |
| `project.update` | `user` | `project, name?, title?, purpose?, folders?` | `base_revision`; 새 이름 예약; folders 변경은 같은 TrackingPreview의 folders·tracking·기준 검사 | `ProjectUpdated` | `invalid_input`, `not_found`, `conflict`, `forbidden` |
| `project.set_tracking` | `user` | `project, folders, tracking`와 미리보기의 기준 | `base_revision`; 활성 켜진 루트 겹침 검사 | `ProjectTrackingChanged` | `invalid_input`, `not_found`, `conflict`, `forbidden` |
| `project.archive` | `user` | `project` | `base_revision`, 현재 `active` | `ProjectArchived` | `not_found`, `conflict`, `forbidden` |
| `project.unarchive` | `user` | `project` | `base_revision`, 현재 `archived`, 루트 겹침 없음 | `ProjectUnarchived` | `not_found`, `conflict`, `forbidden` |

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `ProjectCreated` | `prj` | `name, title, purpose, folders, tracking` | documents/file-tracking, documents/outline-and-search |
| `ProjectUpdated` | `prj` | 변경 필드의 `before, after`; 큰 값은 blob 참조 | documents/file-tracking, documents/addressing, documents/outline-and-search |
| `ProjectTrackingChanged` | `prj` | `before, after` 폴더·tracking 값 또는 blob 참조 | documents/file-tracking |
| `ProjectArchived` | `prj` | `before_revision` | documents/file-tracking, documents/outline-and-search |
| `ProjectUnarchived` | `prj` | `before_revision` | documents/file-tracking, documents/outline-and-search |

## 정책

- **등록과 권한.** Folder 등록은 디스크·coding agent 접근 권한을 주지 않는다. agent의 Project 읽기에는 실제 절대 경로를 포함하지 않는다(→ platform/identity).
- **폴더 해석.** 주어진 위치는 가장 깊은 등록 루트로 해석한다. 꺼진 tracking의 중첩 루트도 같은 기준이며 내용 유사도로 재연결하지 않는다.
- **보관 해제.** 활성으로 돌아오면 관측을 다시 시작하되 파일의 모든 중간 편집 복원을 보장하지 않는다(→ documents/file-tracking).

## 정할 것

- 켜진 tracking 루트 겹침 금지를 유지할지, 파일별 tracking Project 선택을 추가할지.
- glob 문법의 라이브러리·case 규칙과 중첩 `.gitignore`의 정확한 처리. 정규화·최종 경계 제외 규칙은 유지한다.
