---
type: domain-model
concerns: [documents/file-tracking]
---
# documents/file-tracking

파일 관측·version 준비·사람 파일 작업의 입력, 비교 기준과 별개인 완료 결과를 정의한다.

## PreparedVersion (값)

신뢰한 준비 처리의 결과다. 준비 완료는 → documents/versions의 Version 확정이 아니다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `document` | `doc` ID | 아니오 | 기존 또는 준비 때 정한 새 ID → documents/versions | |
| `base_version` | `ver` ID | 예 | 기존 문서면 필수; 새 문서면 null → documents/versions | |
| `metadata` | `{title: string, place: PlaceRef?, name: Slug?}` | 조건부 | 새 문서에 필수; → documents/addressing | |
| `files_hash` | sha256 | 아니오 | 정규화 ContentFile 목록 blob; 준비 처리에서 검사 완료 → documents/versions | |
| `file_count` | integer | 아니오 | `>= 1`; 목록과 일치 | |
| `primary_path` | string | 아니오 | 목록의 유일한 대표 파일 경로 | |
| `content_hash` | sha256 | 아니오 | 정규화 목록 해시 | |
| `format` | FormatRef | 아니오 | → documents/formats; base_version의 저장 계약 | |
| `validation` | FormatValidationResult | 아니오 | → documents/formats; 실제 input hash·module hash 일치 | |
| `preparation_ref` | string | 아니오 | 신뢰한 준비 처리의 작은 검증 참조; 원래 요청·내용·검사·내구 blob에 결합 | |
| `file_basis` | FileObservationBasis | 조건부 | 파일 관측에만 필수 | |
| `source` | VersionSource | 예 | → documents/versions; 파일·앱 요청에는 필수 | |
| `idempotency_key` | string | 아니오 | 같은 요청 재전달에서 유지 → platform/ledger | |

큰 검사 결과·파일 목록은 blob 참조로 전달한다. 준비 증명은 호출자가 주장한 통과 문장이 아니다. 현재 actor·run·app·release는 서버가 확인하며 본문 값으로 인증을 대신하지 않는다.

## FileObservationBasis (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | `project_file / instruction_file` | 아니오 | 실제 등록 source 종류 | |
| `instruction_target`, `instruction_revision` | 등록 참조·판 | 조건부 | instruction_file에 필수; exact source CAS | |
| `project` | `prj` ID | 전역 instruction만 예 | → documents/projects | |
| `project_revision` | event seq | 전역 instruction만 예 | 관측에 적용한 폴더·tracking 기준; instruction 등록 판 별도 | |
| `path` | string | 아니오 | 정규화 절대 경로; 일반 등록 루트 또는 exact instruction 등록 경계 안 | |
| `document_revision` | event seq | 조건부 | 기존 연결 문서에 필수 | |
| `file_source` | FileSource | 예 | → documents/versions; 신규 연결이면 null | 현재 연결 비교 |
| `document_status` | `active` | 조건부 | 기존 문서에 필수; 보관 문서 확정 금지 | |
| `original_hash` | sha256 | 아니오 | blob과 같은 스트림의 실제 바이트 해시 | |
| `observed_at` | UTC 시각 | 아니오 | 안정된 읽기의 관측 시각 | |

신규 파일은 현재 정규화 `path`에 연결된 Document 미존재도 비교한다. 준비 이후 디스크 변경은 다음 관측 대상이며 준비한 바이트를 현재 디스크 최신이라고 표시하지 않는다.

## FileStatus (값)

ledger 열이 아닌 마지막 관측 결과다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `state` | `not_tracked \| tracked \| version_pending \| validation_failed \| source_missing \| unverified` | 아니오 | 아래 계산 규칙 | |
| `target` | FileTarget | 아니오 | 사람 파일 읽기 경로에만 반환 | |
| `observed_at` | UTC 시각 | 아니오 | 관측 시각 | |
| `observed_hash` | sha256 | 예 | 바이트를 확인한 경우만 | |
| `compared_version` | `ver` ID | 예 | → documents/versions; 비교 판이 있으면 반환 | |
| `project_revision` | event seq | 예 | Project 대상이면 반환 | 적용한 규칙 |
| `details` | string | 예 | 검사·접근 실패의 작은 설명 | |

| state | 계산 조건 |
|---|---|
| `not_tracked` | 일반 파일 규칙 미선택·Project/Document 보관 또는 지침 exact 등록 부재 |
| `tracked` | 관측 원본 해시 = 최신 파일 Version source의 original_hash |
| `version_pending` | 안정된 바이트가 최신 판과 다르고 아직 확정되지 않음 |
| `validation_failed` | 현재 바이트가 지정 format 검사를 통과하지 못함 |
| `source_missing` | 연결 경로의 파일 부재를 확인; 기존 판은 읽을 수 있음 |
| `unverified` | 접근 불가, 읽는 동안 변경, 관측 실패; 부재로 단정하지 않음 |

`conflict`는 요청의 비교 실패이지 지속되는 FileStatus 상태가 아니다. FileStatus 전이 command, `FileMissing` event, 감시 후보 ledger 큐는 없다.

## FileTarget (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | `project_file \| working_copy \| instruction_file` | 아니오 | tagged union | |
| `project` | `prj` ID | 조건부 | project_file과 project/app 지침에 필수; 전역 지침이면 null → documents/projects | |
| `path` | string | 조건부 | project_file/instruction_file에 필수; 등록 루트 안 또는 exact 지침 등록의 정규화 절대 경로 | |
| `instruction_target` | exact 등록 참조 | 조건부 | instruction_file에 필수; current 등록 판 확인 | |
| `document` | `doc` ID | 조건부 | working_copy에 필수; 지침은 연결 문서 또는 최초 저장 준비 ID; working_copy는 원본 연결 없는 문서 → documents/versions | |

다른 가지의 필드는 금지한다. working copy는 `doc`별 로컬 파일이며 고정 판에서 만들고 미확정 편집을 보존한다. place·tracking 원본이 아니고 derived store 자동 삭제 대상도 아니다. 임의 경로·루트 밖 symlink·일반 파일이 아닌 대상은 받지 않는다. instruction_file은 아래 exact 지침 등록의 단일 파일 예외만 따른다.

## FileWriteRequest (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `request_key` | string | 아니오 | 파일 작업 식별자; 결과 보고 재전달에 유지 | |
| `target` | FileTarget | 아니오 | 현재 사람의 허용 목표 | |
| `base_hash` | sha256 | 예 | 기존 파일이면 필수; 새 파일은 null = 없음 | 수정 전 실제 바이트 |
| `content` | byte stream | 아니오 | 원문 바이트; 전체 메모리 적재 불필요 | |
| `version_request` | PreparedVersion 준비용 입력 | 예 | 원본 기준 또는 working copy의 base_version 포함 | version 확정도 요청하는 경우 |

## FileOperationResult (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `request_key` | string | 아니오 | 요청과 동일 | |
| `operation` | `write \| rename \| delete` | 아니오 | enum | |
| `target` | FileTarget | 아니오 | 당시 허용된 목표 | |
| `outcome` | `written \| renamed \| deleted \| unverified` | 아니오 | 실제 작업 결과; 교체 여부 불명이면 unverified | |
| `before_path` | string | 예 | rename·delete 또는 기존 write의 경로 | |
| `after_path` | string | 예 | write·rename 결과 경로 | |
| `before_hash` | sha256 | 예 | 신규 파일이면 null | |
| `written_hash` | sha256 | 예 | write 실제 쓴 바이트 | |
| `observed_hash` | sha256 | 예 | 작업 뒤 재관측 가능한 경우 | |
| `observed_at` | UTC 시각 | 예 | 재관측한 경우 | |
| `changed_again` | boolean | 예 | 재관측 불가면 null; write hash와 다르면 true | |
| `recording` | `recorded \| unverified` | 아니오 | ledger 기록 확인과 별개 | |
| `event_seq` | event seq | 예 | recorded이면 필수 | |
| `version_result` | `not_requested \| preparing \| validation_failed \| conflict \| confirmed` | 아니오 | 파일 결과와 독립 | |
| `save_result` | SaveResult | 조건부 | confirmed이면 필수 → documents/versions | |

검색 반영은 이 결과에 합치지 않는다(→ documents/outline-and-search). 성공한 파일 쓰기를 version 검사 실패 때문에 파일 실패로 바꾸지 않는다.

## ledger 표

별도 파일 상태·관측 후보·working copy·PreparedVersion 표는 없다. 확정한 파일 작업 결과는 → platform/ledger의 `events`에 아래 event로 남긴다. 원본 연결은 → documents/versions, tracking 값은 → documents/projects가 저장한다. 파일 작업 보고의 idempotency는 platform/ledger의 공통 command receipt를 사용한다.

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `files.write` | `user` | FileWriteRequest | base_hash를 시작·교체 직전 실제 hash와 비교; 새 파일은 미존재 | 결과 보고 성공 시 `FileWritten` | `unauthorized`, `forbidden`, `invalid_input`, `conflict`, `unavailable` |
| `files.rename` | `user` | request_key, target, 새 허용 경로, base_hash | 기존 hash·경로 동일, 새 목표 미존재 | 결과 보고 성공 시 `FileRenamed` | `unauthorized`, `forbidden`, `invalid_input`, `conflict`, `unavailable` |
| `files.delete` | `user` | request_key, target, base_hash, 필요한 confirmation 근거 | 기존 hash·경로 동일, 현재 사람 결정 | 결과 보고 성공 시 `FileDeleted` | `unauthorized`, `forbidden`, `invalid_input`, `conflict`, `unavailable` |
| `file.record_result` | 좁은 범위의 `machine` | 원래 user 요청에 결합한 성공 결과와 request_key | 신뢰한 worker 결과; `(request_key, operation)` 중복 방지 | 대응하는 파일 event | `invalid_input`, `conflict`, `forbidden` |

`files.*`는 ledger transaction이 아니라 worker의 파일 작업 contract다. `file.record_result`만 짧은 ledger command다. file 결과 보고 event actor는 `machine`이다. 원래 사람 자격·목표·작업의 결합은 검증된 요청 근거에 남기며 machine을 `user`로 바꿔 기록하지 않는다. coding agent의 자기 shell 편집은 이 API의 자격이 아니며 외부 변화는 machine 관측으로 저장된다.

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `FileWritten` | 목표의 `prj` 또는 working copy의 `doc` | `path, before_hash, after_hash` | documents/file-tracking |
| `FileRenamed` | 목표의 `prj` 또는 working copy의 `doc` | `before_path, after_path, before_hash, after_hash` | documents/file-tracking |
| `FileDeleted` | 목표의 `prj` 또는 working copy의 `doc` | `path, before_hash, after_hash: null` | documents/file-tracking |

## 정책

- **안정된 관측.** watch 신호는 힌트다. 시작·절전 복귀·감시 넘침·규칙 변경과 주기적 루트 대조로 재관측한다. size·mtime가 같아도 hash를 영원히 생략하지 않는다.
- **읽기 근거.** 열기 전과 읽기 후의 경로·파일 식별을 비교하고 같은 스트림에서 hash·blob을 만든다. 불안정하면 제한된 재시도 뒤 unverified로 남긴다. 모든 중간 편집을 복원하지 않는다.
- **경계.** `.git`·lophn 데이터·등록 루트 밖 symlink를 제외하고 실제 열린 파일도 경계 안인지 검사한다(→ documents/projects).
- **version 경계.** 명시 저장·편집 종료 또는 안정된 외부 변경이 version 준비 경계다. 자동 저장·매 키 입력은 파일 쓰기만이다. 편집 표시·감시 후보는 worker 메모리 값이다.
- **원자 교체.** 같은 파일 시스템 임시 파일을 동기화한 뒤 원자 교체한다. 지원하지 않으면 비원자 쓰기로 바꾸지 않는다. 신규 파일은 미존재 조건의 생성으로 보호한다.
- **외부 쓰기.** 외부 편집기와 공동 잠금은 없다. 비교와 교체 사이의 외부 변경까지 막지 않으며 작업 뒤 재관측한다. 결과 불명이면 자동 재쓰기하지 않고 현재 파일을 읽는다.
- **삭제·이동.** 파일 부재·이동 관측으로 Document 삭제·source 자동 재연결을 하지 않는다. 사람의 파일 작업과 Document place 변경은 별개다.
- **단절.** core 단절을 알면 새 파일 변경을 시작하지 않는다. 이미 시작한 작업은 실제 결과 또는 unverified로 반환한다.
- **agent 읽기.** 현재 디스크 경로·hash·본문은 agent 문서 읽기에 섞지 않는다. 고정 Version 읽기는 → documents/outline-and-search이다.

## 정할 것

- 원본 연결 문서의 agent 직접 저장은 금지한다. 별도 승인된 원본 반영 경계는 두지 않는다.
- 준비 worker 수는 documents/file-tracking#R5의 2개다. 안정 읽기 재시도·대기·크기·시간 한도는 architecture의 초기 조절값이며 한도 초과는 미확인이다.
- FileOperationResult의 machine credential과 원래 user 요청 증명은 → platform/identity의 모양을 그대로 쓴다.

## instruction 파일 등록과 관측

일반 Project tracking과 별도로 → lophn-agent/instructions의 exact InstructionLocation/Attachment 등록만 해석한다. 일반 데이터 root·.git·루트 밖 symlink 제외는 유지하며 전역 ~/.lophn/LOPHN.md 단일 파일에만 명시 등록 예외를 적용한다. 폴더 재귀 추적·부모 순회·cwd 추측은 없다. 등록된 파일도 owner·실제 열린 파일·symlink·UTF-8·hash를 검사한다.

FileObservationBasis는 `kind=project_file/instruction_file`과 instruction_target 조건부 참조를 추가한다. project_file은 기존 project/project_revision 필수; instruction_file은 exact 등록 판·locator를 비교하고 전역이면 project/project_revision=null이다. PreparedVersion의 file_basis/source는 같은 instruction target을 가리켜야 하고 Document revision·source·status·base_version·실제 hash를 다시 확인한다. FileStatus는 지침의 exact 등록이 유효하면 일반 tracking enabled와 독립해 tracked/version_pending 등을 계산한다.

FileTarget.kind에 instruction_file을 추가한다. 이 가지는 instruction_target과 exact 등록 path를 가지며 전역 project는 null, project/app은 확인된 관계를 쓴다. 사람이 [Instructions]로 연 목표만 허용하고 임의 경로를 넣지 못한다. 최초 저장은 미존재 CAS, 기존 쓰기·복원은 base_hash CAS 후 재관측으로 Version을 준비한다. `file.record_result`·FileWritten/FileRenamed/FileDeleted subject는 전역 지침이면 확인된 doc 참조(최초 저장의 준비 ID), project/app이면 기존 prj/doc 참조를 사용한다. 일반 Project 폴더 등록을 가짜로 만들지 않는다.

agent 파일 작업·지침 document write는 forbidden이며 question은 적용 요청이 아니다. 외부 편집 관측은 허용해 version을 남기되 저장 실패·접근 불가·source missing을 지침 부재 성공으로 바꾸지 않는다. call별 크기·읽기 실패는 → lophn-agent/instructions의 32 KiB/128 KiB 검사로 차단한다. → documents/file-tracking#R19,R20
