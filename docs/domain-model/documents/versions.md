---
type: domain-model
concerns: [documents/versions]
---
# documents/versions

Document의 현재 메타데이터와 불변 Version, 파일·출처 값, 저장과 restore 규칙을 정의한다.

## Document (`doc`)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `doc` ID | 아니오 | PK, 불변 | |
| `place` | PlaceRef | 예 | → documents/addressing | 현재 자리 |
| `name` | Slug | 예 | → documents/addressing; place가 있으면 필수 | 문서 주소의 이름 |
| `title` | string | 아니오 | 빈 문자열 금지 | |
| `file_source` | FileSource | 예 | 현재 정규화 `path` 전역 유일 | 관측 원본 연결 |
| `latest_version` | `ver` ID | 아니오 | 같은 Document의 Version | |
| `revision` | event seq | 아니오 | 마지막 메타데이터·연결·보관 변경 seq | 저장 판 비교와 별개 |
| `status` | `active \| archived` | 아니오 | 생성은 `active` | |

### 상태

| 상태 | 뜻 |
|---|---|
| `active` | 범위가 허용하는 저장 대상 |
| `archived` | 기본 목록·검색에서 제외; 자동 파일 version 확정 중단 |

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| 없음 | `active` | `user`, 허용된 `coding_agent`, `agent`, `app`, 파일 관측 `machine` | 첫 Version과 같은 transaction | `DocumentCreated`, `DocumentSaved` |
| `active` | `archived` | `user`, 요청된 revert의 `machine` | `base_revision` 일치; revert는 생성 문서 보상만 | `DocumentArchived` |
| `archived` | `active` | `user` | `base_revision` 일치 | `DocumentUnarchived` |

### 불변 조건

- 첫 Version 없는 Document는 존재하지 않는다. 준비 단계에서 발급한 ID는 ledger 행이 아니다.
- `latest_version`은 가장 큰 `number`의 Version이다. 저장은 `latest_version`을 갱신하며 메타데이터 CAS는 `revision`으로 분리한다.
- 자리 있는 문서의 현재 이름과 옛 address는 → documents/addressing의 예약을 따른다. 이동은 디스크 파일을 움직이지 않는다.
- 원본 연결은 사람이 명시적으로 해제·재연결한다. 파일 삭제·tracking 해제·폴더 해제만으로 연결과 Version을 삭제하지 않는다.
- 원본 연결 문서에는 현재 파일 관측의 준비 결과로만 새 Version을 확정한다. 직접 내용 저장은 `conflict`다.
- lophn agent는 archive·unarchive·move 도구를 갖지 않는다. move·rename과 옛 address 예약은 → documents/addressing이다.
- 첫 판에는 Document·Version 영구 삭제가 없다. 보관해도 고정 Version은 읽을 수 있다.

## Version (`ver`)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `ver` ID | 아니오 | PK, 불변 | |
| `document` | `doc` ID | 아니오 | Document 참조 | |
| `number` | integer | 아니오 | `>= 1`; `(document, number)` 유일 | |
| `files` | ContentFile[] 또는 파일 목록 blob 참조 | 아니오 | 1개 이상; 경로 유일; 대표 파일 정확히 1개 | 정규화 목록 |
| `content_hash` | sha256 | 아니오 | 소문자 64 hex; 경로순 정규화 파일 목록의 해시 | |
| `format` | FormatRef | 아니오 | → documents/formats | 정확한 검사·추출 계약 |
| `saved_by` | actor | 아니오 | 인증된 원래 actor → platform/identity | |
| `saved_at` | UTC 시각 | 아니오 | 커밋 시각 | 순서는 seq로 판단 |
| `run` | `run` ID | 예 | agent 저장이면 필수 → lophn-agent/harness/run-loop | |
| `source` | VersionSource | 예 | 파일 관측·앱 저장이면 필수 | |

### 상태

Version에는 보관 상태나 수정 전이가 없다.

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| 없음 | 확정된 불변 Version | 허용된 저장 actor | 준비 결과·현재 scope·CAS 통과 | `DocumentSaved` |

### 불변 조건

- 번호는 Document마다 1부터 연속 증가하며 재사용하지 않는다. 확정한 파일·형식·출처·저장 주체는 바뀌지 않는다.
- 새 저장은 기존 Document의 `base_version`을 반드시 받는다. 새 Document는 `base_version = null`, 준비 때 정한 `doc` ID를 받는다.
- 최신 판과 `content_hash`, `format.name`, `format.module_hash`, `format.explicit`가 모두 같으면 `unchanged`와 기존 Version을 반환한다. `unchanged`에는 변경 event가 없다.
- idempotency key와 새 `doc` ID를 재사용한 동일 재전달은 → platform/ledger의 결과를 따른다. 최신 판이 다른 내용으로 바뀌었으면 낡은 요청으로 덮지 않는다.
- 형식 변경을 명시하지 않은 저장은 `base_version`의 FormatRef를 사용하고 그 판이 최신인지 확정 때 검사한다(→ documents/formats).
- blob 내구 설치·큰 파일 목록 검사·hash·format 실행은 command 밖에서 끝낸다. 신뢰한 준비 처리의 증명만 받는다.
- restore는 선택한 Version의 내용과 정확한 FormatRef로 새 Version을 만든다. 사람의 명시 restore는 과거 FormatRef를 선택하는 허용된 형식 변경이며 준비도 선택 판의 정확한 module로 한다. 같은 내용·형식이면 `unchanged`이고 변경 event가 없다. 이전 Version과 event는 남는다.
- 기획·설계 채택은 Version 상태가 아니다(→ lophn-agent/questions). 새 Version이 이전 판의 채택을 자동 이전하지 않는다.

## FileSource (값)

project_file과 instruction_file의 tagged union이다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | `project_file / instruction_file` | 아니오 | 기존 source는 project_file | 원본 종류 |
| `instruction_target` | InstructionLocation/Attachment 등록 참조 | 조건부 | instruction_file만 필수 → lophn-agent/instructions | exact 지침 목표 |
| `project` | `prj` ID | 전역 지침만 예 | project_file은 필수 → documents/projects | 원본 관측 Project |
| `path` | string | 아니오 | 정규화 절대 경로; 실제 경계 → documents/file-tracking | |

현재 place와 FileSource는 독립이다. 처음 tracking하는 파일만 그 Project place로 생성한다. 앱 place로 옮겨도 연결은 그대로다.

## ContentFile (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `path` | string | 아니오 | 상대 `/` 경로; 절대 경로·빈 성분·`.`·`..`·제어 문자 금지; 목록 안 유일 | |
| `blob_hash` | sha256 | 아니오 | 내구 설치 완료 → platform/blob-store | 원문 바이트 |
| `bytes` | integer | 아니오 | `>= 0`; blob 실제 크기와 같음 | |
| `media_type` | string | 아니오 | MIME media type | |
| `primary` | boolean | 아니오 | 목록에서 정확히 하나 `true` | 대표 파일 |

자동 tracking Version은 대표 파일 하나만 가진다. 여러 파일 묶음은 HTML과 이미지처럼 같이 읽는 내용에 허용한다. 원문을 텍스트 정규화한 바이트로 대체하지 않는다.

## VersionSource (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | `file \| app \| instruction_file` | 아니오 | tagged union | |
| `instruction_target` | InstructionLocation/Attachment 등록 참조 | 조건부 | instruction_file에 필수 | 당시 지침 목표 |
| `project` | `prj` ID | 조건부 | file은 필수; instruction_file 전역만 null → documents/projects | |
| `path` | string | 조건부 | file/instruction_file에 필수; 당시 정규화 원본 경로 | |
| `original_hash` | sha256 | 조건부 | file/instruction_file에 필수; 실제 관측 원문 바이트 해시 | |
| `observed_at` | UTC 시각 | 조건부 | file/instruction_file에 필수 | |
| `app` | `app` ID | 조건부 | `app`에 필수 → apps/registration | |
| `release` | `rel` ID | 조건부 | `app`에 필수; 서버가 확인 → apps/releases | |

다른 kind의 필드는 허용하지 않는다. machine 준비 자격으로 원래 actor의 저장 scope를 바꾸지 않는다. MCP의 cwd만으로 FileSource를 만들지 않는다.

## SaveResult (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `status` | `saved \| unchanged` | 아니오 | enum | |
| `document` | `doc` ID | 아니오 | 확정된 Document | |
| `version` | `ver` ID | 아니오 | 반환 Document의 확정 판 | |
| `reference` | Address 또는 DocumentRef | 아니오 | → documents/addressing; 항상 고정 판 | |
| `event_seq` | event seq | 조건부 | `saved`에 필수; `unchanged`는 null | 이번 커밋 seq |
| `warnings` | FormatDiagnostic[] | 아니오 | → documents/formats; 빈 목록 허용 | |

## BundledGuide (값)

사용자 Document가 아닌 설치 묶음의 읽기 전용 안내다(→ documents/versions#R17,R18). ledger 표·entity ID·사용자 place·tracking·Version 번호는 없다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `lophn_version` | string | 아니오 | 설치 묶음의 정확한 version | |
| `title` | string | 아니오 | 안내 제목 | |
| `content_hash` | sha256 | 아니오 | 설치 manifest가 고정한 실제 내용 hash | 고정 안내 판 참조 |
| `files` | 읽기 전용 파일 목록 | 아니오 | manifest 안의 상대 경로만; 대표 파일 하나 | |

목록·목차·section·본문은 설치한 같은 묶음에서 offline으로 읽는다. 복사하여 남기는 요청만 일반 Document 저장으로 처리하며 설치 update가 복사본을 바꾸지 않는다.

## 관계

| from | 관계 | to | 다중도 | 대상이 사라지면 |
|---|---|---|---|---|
| Document | 현재 자리 | Project → documents/projects 또는 App → apps/registration | N:0..1 | 보관은 참조 유지; 영구 삭제 없음 |
| Document | 판 | Version | 1:1..N | 삭제 없음 |
| Document | 최신 판 | Version | 1:1 | 삭제·보관 없음 |
| Version | 원문·목록·정확한 module | blob → platform/blob-store, FormatRef → documents/formats | N:N | 참조가 있으면 보존; 누락은 `unavailable` |
| Version | 저장 run | Run → lophn-agent/harness/run-loop | N:0..1 | 고정 참조 유지 |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `documents` | 모든 Document 필드; place는 `place_kind, place_id`, source는 `source_kind, source_instruction_target, source_project, source_path` | PK `id` | `(place_kind, place_id, name)` where place non-null; `source_path` where source non-null | `(status, place_kind, place_id, id)`, `(latest_version)` | place → documents/projects 또는 apps/registration; source_project → documents/projects; `(id, latest_version)` → `versions(document, id)`; revision → platform/ledger |
| `versions` | `id, document, number, files_hash, primary_path, file_count, content_hash, format_name, module_hash, format_explicit, saved_by, saved_at, run, source` | PK `id` | `(document, number)`, `(document, id)` | `(document, number DESC)`, `(run, document)` | document → `documents.id`; files_hash·module_hash·원문 해시 → platform/blob-store; run → lophn-agent/harness/run-loop |

파일 목록은 `files_hash`가 가리키는 정규화 목록 blob이다. `primary_path`, `file_count`는 준비 결과의 작은 검증된 요약이며 각각 목록과 일치한다. source·place의 nullable 필드는 가지 전체가 null이거나 가지의 모든 필수 필드가 있어야 한다. instruction_file의 global source는 아래 지침 contract의 project=null 예외를 따른다. 첫 행과 첫 판의 순환 참조는 transaction 끝에서 검사한다.

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `document.save` | 범위 내 `user`, `coding_agent`, `agent`, `app`; 파일 관측 `machine` | 준비 결과 → documents/file-tracking; `doc`, idempotency key | `base_version`; 새 문서는 미존재; 관측은 Project revision·source·Document revision·status도 일치 | 새 문서면 `DocumentCreated`; 새 판이면 `DocumentSaved` | `invalid_input`, `conflict`, `unauthorized`, `forbidden`, `unavailable` |
| `document.update` | 범위 내 `user`, `coding_agent`, `agent` | `document, title` | `base_revision`; 종료 run 금지 | `DocumentUpdated` | `invalid_input`, `not_found`, `conflict`, `forbidden` |
| `document.set_source` | `user` | `document, file_source` 또는 null | `base_revision`, 현재 source, 새 source 유일 | `DocumentSourceChanged` | `invalid_input`, `not_found`, `conflict`, `forbidden` |
| `document.archive` | `user`, 요청된 revert의 `machine` | `document`; revert는 결정 근거 | `base_revision`; revert는 이후 변경 없음 | `DocumentArchived` | `not_found`, `conflict`, `forbidden` |
| `document.unarchive` | `user` | `document` | `base_revision`, 현재 `archived` | `DocumentUnarchived` | `not_found`, `conflict`, `forbidden` |
| `document.restore` | `user`, 요청된 revert의 `machine` | `document, restore_version`, 준비 결과; revert는 제목 보상 값 | `base_version`, `base_revision`; 원본 연결이면 사람 파일 쓰기·관측 근거도 필수 | `DocumentSaved`, `DocumentRestored`; 제목 변경 시 `DocumentUpdated` | `not_found`, `invalid_input`, `conflict`, `forbidden`, `unavailable` |

저장 scope는 → platform/identity, coding-agent/connection, lophn-agent/assignments, apps/blueprint이다. Operator는 assignment의 기존 Document에만 새 판을 쓰며 새 Document·자리·형식을 바꾸지 않는다. 앱은 자기 앱 place의 선언된 출력 이름만 쓴다. 허용 범위가 없는 place null도 거절한다.

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `DocumentCreated` | `doc` | `place, name, title, file_source, version` | documents/outline-and-search |
| `DocumentUpdated` | `doc` | `before_title, title, before_revision` | documents/outline-and-search, lophn-agent/revert |
| `DocumentSourceChanged` | `doc` | `before_source, source, before_revision` | documents/file-tracking |
| `DocumentArchived` | `doc` | `before_revision` | documents/file-tracking, documents/outline-and-search, lophn-agent/assignments |
| `DocumentUnarchived` | `doc` | `before_revision` | documents/file-tracking, documents/outline-and-search, lophn-agent/assignments |
| `DocumentSaved` | `doc` | `version, previous_version`(첫 판 null), `content_hash, format`, file source면 당시 source 요약 | documents/outline-and-search, documents/contexts, lophn-agent/observability |
| `DocumentRestored` | `doc` | `restore_version, previous_version, version` | lophn-agent/revert, documents/outline-and-search |

## 정책

- **run.** 종료한 run을 가진 새 대상 변경은 거절한다(→ lophn-agent/harness/run-loop). 저장된 동일 내용은 run 성공의 증명이 아니다.
- **revert.** agent run 이후의 판·revision이 그대로일 때만 보상한다. 이후 다른 변경은 `conflict`다. 생성 문서는 보관하며 원본 연결 문서의 디스크 revert는 run revert에 포함하지 않는다(→ lophn-agent/revert).
- **독립 결과.** 같은 산출물의 갱신은 같은 Document의 새 Version이다. 독립 편집 대상은 별도 Document이며 가족·멤버 key·다음 이름·draft는 → documents/series가 맡는다. SeriesDraft는 첫 Version 없는 Document를 만들지 않는다.

## 정할 것

- 독립 산출물 가족은 → documents/series의 채택한 모델을 따른다; Operator 출력 범위를 독립 문서로 넓힐지는 별도 결정이다.
- 문서·판 영구 삭제를 추가할지. 추가 시 고정 근거·address 예약·blob 보존 규칙도 함께 정한다.
- 정규화 파일 목록의 canonical JSON encoding과 content_hash 입력 필드 집합. 준비 처리와 blob 참조 검증이 같은 규약을 사용해야 한다.

## 지침 FileSource와 write 보호

→ lophn-agent/instructions의 InstructionLocation 또는 InstructionAttachment가 가리키는 문서는 instruction 대상이다. 이 분류는 이름·현재 place·본문만으로 추정하지 않고 정확한 등록 locator 또는 preset의 document 참조로 확인한다. 해당 문서의 agent/coding_agent/app create·save·title/move·source 변경은 현재 분류를 검사해 forbidden이다. 사람 파일 작업과 해당 locator를 관측한 좁은 machine만 Version을 확정한다. 지침 파일을 다른 출력으로 선택해도 금지를 해제하지 못한다.

FileSource는 `{kind: project_file, project, path}` 또는 `{kind: instruction_file, instruction_target, project?, path}`의 tagged union이다. 기존 source는 project_file로 해석한다. instruction_target은 → lophn-agent/instructions의 exact 층·대상·파일 등록 참조이며 global은 project=null, project/app은 등록 관계가 확인된 Project를 가리킨다. preset 첨부는 사람이 연결한 원본 범위를 따른다. 현재 place와 source는 여전히 독립이며 전역 지침은 사용자 Project나 system place를 자동 만들지 않고 place/name=null을 허용하는 지침 source 문서다.

VersionSource는 기존 file/app에 instruction_file을 추가하고 그 경우 instruction_target·path·original_hash·observed_at이 필수, project는 전역일 때만 null이다. instruction source 신규 최초 저장과 첫 Version은 같은 transaction이다. documents 표는 source_kind/source_instruction_target을 원본 가지에 추가하며 source_project의 null은 instruction_file 전역 가지에만 허용한다. source_path unique는 모든 가지에 걸쳐 유지한다. 같은 실제 파일의 기존 Document 연결을 재사용하며 두 Document로 중복 연결하지 않는다.

Instruction의 문서 조회는 허용된 층·첨부와 고정 판만 읽는다. 지침 읽기나 place=null 예외가 일반 자료 읽기·쓰기 범위를 넓히지 않는다. 문서 분류 해제·source 이동이 지침 편집 우회가 되지 않도록 현재 locator와 참조를 함께 재검사한다. → documents/versions#R19,R20
