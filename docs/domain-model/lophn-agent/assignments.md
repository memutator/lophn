---
type: domain-model
concerns: [lophn-agent/assignments]
---
# lophn-agent/assignments

Assignment의 preset 판, 실제 범위, Operator 남길 문서, 승인 묶음과 상태를 정의한다.

## Assignment (`asg`)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `asg` ID | 아니오 | PK | 수행 주체 ID |
| `preset` | `pst` ID | 아니오 | → lophn-agent/presets | 구성 |
| `preset_revision` | integer | 아니오 | 양수; 참조한 Preset의 존재하는 판 | 적용한 preset 판 |
| `scope` | AssignmentScope | 아니오 | Preset.kind와 일치하는 담당 범위 | 실제 담당 대상 |
| `state` | enum | 아니오 | `enabled`, `paused`, `withdrawn` | 접수 가능 여부 |
| `pause_reason` | PauseReason | 예 | `paused`일 때만 필수; 다른 상태는 null | 멈춤 근거 |
| `outputs` | OutputDeclaration[] | 아니오 | Operator는 1개 이상; 그 외 `[]`; document 중복 없음 | 남길 문서 |
| `read_apps` | `app` ID[] | 아니오 | Operator만 사용, 그 외 `[]`; 중복 없음; → apps/registration | 앱 읽기 명령 실행을 승인한 앱 |
| `read_commands` | `{app: App ID, command: string}[]` | 아니오 | Operator만 사용, 그 외 `[]`; `(app, command)` unique; app은 read_apps, command는 Preset.capability.tools에 선택; 승인한 정확한 쌍만 | 승인된 앱별 명령 |
| `schedule` | Schedule | 예 | Operator만 필수, 그 외 null; → lophn-agent/scheduling | 주기 값 |
| `last_due_at` | UTC 시각 | 예 | Operator만 사용; 처음·주기 변경 직후 null; → lophn-agent/scheduling | 접수 또는 skip한 마지막 예정 시점 |
| `approval` | approval request ID | 예 | Operator는 현재 승인 필수; 그 외 null; → platform/approvals | 정의·범위·남길 문서·주기·읽을 앱과 명령·tool 선택 전체의 승인 |
| `revision` | integer | 아니오 | 1부터 시작; 상태·승인 내용 변경마다 1 증가; 시점 이동은 증가하지 않음 | 내용 CAS 기준 |

### 상태

| 상태 | 뜻 |
|---|---|
| `enabled` | 새 사람 요청·허용한 handoff·Operator 회차를 접수 가능 |
| `paused` | 책임은 유지하나 새 Run 접수 금지 |
| `withdrawn` | 종료된 책임; 새 Run 접수 금지; 과거 기록 유지 |

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| 없음 | `enabled` | machine | 내장 lophn·CE 준비, `AppCreated`의 AE 준비 또는 유효한 Operator 승인 적용 | `AssignmentCreated` |
| `enabled` | `paused` | user | 현재 revision 일치 | `AssignmentPaused` |
| `enabled` | `paused` | machine | 실제 시작한 Run 최종 실패 연속 3회 또는 담당 project·app·남길 문서 archived | `AssignmentPaused` |
| `paused` | `enabled` | user | 현재 revision 일치; 대상·남길 문서 active; Operator 책임 변경은 새 승인 적용 완료 | `AssignmentResumed` |
| `enabled` / `paused` | `withdrawn` | user | 현재 revision 일치; lophn·CE 전체 범위 제외 | `AssignmentWithdrawn` |
| `enabled` / `paused` | 같은 상태 | machine | Operator 전체 변경 승인과 이전 Assignment 판·검토 Preset 판 일치 | `AssignmentChanged` |
| `enabled` / `paused` | 같은 상태 | user | lophn·AE·CE의 같은 kind Preset 판 명시 적용·현재 revision CAS 일치 | `AssignmentChanged` |

`withdrawn`에서 나가는 전이는 없다. 다시 맡기려면 새 Assignment와 Operator의 새 승인이 필요하다. 동일 중복 방지 키의 재전송만 기존 결과를 돌려준다.

### 불변 조건

- 거두지 않은 lophn·CE 전체 Assignment는 종류별 하나이며 withdraw할 수 없고 pause·resume만 가능하다. AE는 등록된 앱마다 거두지 않은 Assignment 하나다. `AppCreated`를 받은 machine만 자동 AE 생성한다.
- Operator는 project 또는 app 하나를 담당하며 같은 대상에 Assignment 여러 개를 허용한다. 읽을 자료는 Preset.context이고 담당 대상과 별개다. Assignment·남길 문서 수 상한은 없다.
- Operator 호출의 app은 `read_apps`에 있고 command 이름은 Preset 판의 capability.tools.app_command에 있어야 한다. 각 실제 `(app, command)` 쌍은 승인 묶음에 고정하고 현재 앱 계약에서 `effect = read`인지 확인한다. context item에 있다고 승인된 것은 아니다.
- 같은 document를 남길 문서로 선언한 거두지 않은 Operator Assignment는 하나뿐이다. paused도 이 독점을 유지한다.
- 승인 묶음은 context·MCP·skill·provider 계정·model·붙일 지침 연결을 포함한 Preset 전체 판과 scope, read_apps/read_commands, outputs, schedule을 고정한다. 지침 파일 내용 자체는 call마다 읽는다.
- 시작 기준은 → lophn-agent/harness/run-loop에서 고정한다. Assignment 변경은 이미 시작한 Run에 권한을 추가하지 않는다. pause·withdraw·현재 범위 회수는 즉시 적용한다.
- Assignment에는 `running`, Session, 현재 Run, 실패 counter를 중복 저장하지 않는다. → lophn-agent/harness/run-loop를 조회한다.

## AssignmentScope (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | enum | 아니오 | `all`, `project`, `app` | 범위 종류 |
| `id` | 대상 ID | 예 | `all`이면 null; `app`이면 존재하는 앱 ID → apps/registration; `project`이면 존재하는 Project ID → documents/projects | 담당 대상 |

범위 제약: lophn·Context Engineer는 all만, App Engineer는 app만, Operator는 project 또는 app만이다. lophn·Context Engineer는 종류별 하나, App Engineer는 app별 하나, Operator는 대상별 0..N이다. preset 수는 이 개수를 늘리지 않는다.

## PauseReason (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | enum | 아니오 | `user`, `consecutive_failures`, `scope_archived`, `output_archived` | 멈춤 분류 |
| `detail` | string | 아니오 | trim 뒤 1자 이상; secret 없음 | 안전한 설명 |
| `runs` | Run ID[] | 아니오 | `consecutive_failures`는 최종 실패 근거 3개, 종료 event seq 순; 그 외 `[]`; → lophn-agent/harness/run-loop | 실패 근거 |
| `target` | 대상 ID | 예 | `scope_archived`·`output_archived`만 필수; Assignment scope 또는 outputs의 대상 | 보관된 대상 |

## OutputDeclaration (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `document` | Document ID | 아니오 | 존재·active·새 Version 저장 가능; 원본 파일 연결 문서 불가; → documents/versions | 고정한 기존 문서 |
| `content` | string | 아니오 | trim 뒤 1자 이상 | 남길 판단 항목 |

- 적용 때 문서의 실제 첫 Version 존재를 검사한다. 빈 문서 예약·시리즈·동적 이름은 없다. CE가 만든 첫 양식은 아직 주기 결과가 아님을 명시한다.
- 문서의 rename·move는 선언 ID를 바꾸지 않는다. 저장 format은 최신 Version의 계약 → documents/formats이며 선언에 복사하지 않는다.
- Operator는 선언 문서를 읽을 수 있다. 이 예외는 문서 안의 주소로 다른 자료를 읽는 권한을 주지 않는다.
- 새 Version 저장은 읽은 Version을 비교 기준으로 한다. 사람의 직접 편집은 허용하고 충돌은 검출한다. 실제 Version event는 → documents/versions가 소유한다.

## OperatorApprovalBundle (값)

approval request에 고정하는 전체 입력이며 큰 내용은 blob으로 둔다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `draft_version` | Version ID | 아니오 | CE 초안의 존재하는 고정 판; → documents/versions | 검토한 초안 |
| `assignment` | `asg` ID | 예 | 생성이면 null, 변경이면 대상 ID | 적용 대상 |
| `expected_assignment_revision` | integer | 예 | 생성이면 null, 변경이면 양수 | 이전 내용 |
| `preset` | `pst` ID | 아니오 | 존재하는 Operator preset; 승인 전에 사람이 저장한 구성 | 구성 대상 |
| `preset_revision` | integer | 아니오 | 적용할 존재하는 고정 판; 내용 hash 일치 | 검토한 구성 판 |
| `preset_definition` | sha256 | 아니오 | Preset 판 전체 blob; → lophn-agent/presets | 적용할 prompt·capability·context·MCP·skill·provider 계정·model·지침 연결 |
| `scope` | AssignmentScope | 아니오 | `project` 또는 `app`만 가능 | 실제 담당 대상 |
| `outputs` | OutputDeclaration[] | 아니오 | 1개 이상 | 실제 남길 문서 |
| `read_apps` | App ID[] | 아니오 | 중복 없음; 선택된 앱 명령과 함께 승인 | 앱 목록 |
| `read_commands` | `{app: App ID, command: string}[]` | 아니오 | `(app, command)` unique; app은 read_apps에 존재; command는 Preset.capability.tools에 선택된 effect=read 이름; 호출은 이 정확한 쌍만 허용 | 승인한 실제 명령 쌍 |
| `schedule` | Schedule | 아니오 | → lophn-agent/scheduling | 적용할 주기 |
| `reason` | string | 아니오 | trim 뒤 1자 이상 | 변경 설명 |

Preset은 사람이 먼저 저장한 고정 판이다. Assignment 적용은 판·검토 hash 검증과 approval 한 번 사용을 같은 transaction에서 확정한다. 승인 처리로 Preset을 몰래 생성·수정하지 않는다. 승인이 있어도 적용이 실패하면 enabled Assignment는 생기지 않는다.

## 관계

| from | 관계 | to | 다중도 | 대상이 사라지면 |
|---|---|---|---|---|
| Assignment | 구성 판 | Preset → lophn-agent/presets | N:1 | 과거 판 유지; 삭제 금지 |
| AE Assignment | 범위 | App → apps/registration | N:1 | archive면 machine pause |
| Operator Assignment | 범위 | Project 또는 App → documents/projects, apps/registration | N:1 | archive면 machine pause |
| Operator Assignment | 남길 문서 | Document → documents/versions | N:M; 거두지 않은 선언은 document당 1 | archive면 machine pause |
| Operator Assignment | 승인 | ApprovalRequest → platform/approvals | N:1 | 승인 참조 유지 |
| Assignment | 수행 기록 | Run → lophn-agent/harness/run-loop | 1:N | 과거 기록 유지 |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `assignments` | 현재 Preset 판·scope·상태·pause·schedule·시점·approval·revision | PK `id` | partial unique `role_kind` WHERE `state != withdrawn` AND role_kind IN (lophn, context_engineer); partial unique `scope_id` WHERE `state != withdrawn` AND role_kind = app_engineer | `(state, role_kind)`, `(scope_kind, scope_id)` | `(preset_id, preset_revision)` → `preset_revisions`; scope → apps/registration 또는 documents/projects; approval → platform/approvals |
| `assignment_revisions` | 시점 이동을 제외한 내용 판 전체 blob | PK `(assignment_id, revision)` | — | `approval_id` | `assignment_id` → `assignments`; blob → platform/blob-store; approval → platform/approvals |
| `assignment_outputs` | 현재 남길 문서와 판단 항목, `owns_output` | PK `(assignment_id, document_id)` | partial unique `document_id` WHERE `owns_output = true` | `document_id` | assignment → `assignments`; document → documents/versions |
| `assignment_read_apps` | 현재 승인된 앱 목록 | PK `(assignment_id, app_id)` | — | `app_id` | assignment → `assignments`; app → apps/registration |
| `assignment_read_commands` | 현재 승인된 앱별 명령 쌍 | PK `(assignment_id, app_id, command)` | — | `(app_id, command)` | `(assignment_id, app_id)` → assignment_read_apps; command 존재·effect·Preset 선택 검사 → apps/blueprint, lophn-agent/presets |

`role_kind`는 참조한 Preset.kind와 항상 같다. preset_revision은 존재하는 immutable 판이어야 하며 새 revision 저장만으로 이동하지 않는다. `owns_output`은 Assignment가 withdrawn이 아니면 true다. 생성·변경·withdraw와 선언 표 갱신은 같은 transaction이다. 과거 outputs·앱 목록은 assignment_revisions blob에 보존한다. `last_due_at`은 내용 판에 넣지 않으며 → lophn-agent/scheduling의 회차 기록으로 보존한다.

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `CreateBuiltinAssignment` | machine | lophn 또는 CE Preset 판 | 종류별 거두지 않은 Assignment 없음; 재전송은 기존 결과 | `AssignmentCreated` | `invalid_input`, `conflict` |
| `CreateAppEngineerAssignment` | machine | `AppCreated` seq, 앱 ID, AE Preset 판 | 해당 event·앱·기존 AE 확인; event 재전송은 기존 결과; 반응이면 구독자 cursor CAS와 한 transaction | `AssignmentCreated` | `not_found`, `conflict`, `forbidden` |
| `ApplyOperatorAssignment` | machine | approval ID·결정 seq, OperatorApprovalBundle | 승인 전체 입력·초안 고정 판·검토 Preset 판과 이전 Assignment 판·대상·출력 독점; 승인 한 번 사용 | `AssignmentCreated` 또는 `AssignmentChanged` ; Preset 변경 event 없음 | `invalid_input`, `not_found`, `conflict`, `forbidden` |
| `ChangeAssignmentPreset` | user | ID, 새 preset ID·revision | 현재 Assignment revision CAS·같은 역할 kind·읽기/tool 상한; Operator는 ApplyOperatorAssignment로 전체 승인 필요; 다음 run부터 | `AssignmentChanged` | invalid_input, not_found, conflict, forbidden |
| `PauseAssignment` | user 또는 machine | ID, PauseReason | 현재 revision·state; machine은 archive 또는 실패 근거 재검사; `AppArchived` 반응이면 구독자 cursor CAS와 한 transaction | `AssignmentPaused` | `not_found`, `conflict`, `forbidden` |
| `ResumeAssignment` | user | ID | 현재 revision·paused; 대상·outputs active·현재 승인 유효 | `AssignmentResumed` | `not_found`, `conflict`, `forbidden` |
| `WithdrawAssignment` | user | ID | 현재 revision; enabled 또는 paused; lophn·CE 전체 범위면 forbidden | `AssignmentWithdrawn` | `not_found`, `conflict`, `forbidden` |

사람의 직접 pause·resume·withdraw에 추가 approval request를 붙이지 않는다. paused 변경은 paused를 유지한다. 주기 변경 시점 규칙은 → lophn-agent/scheduling이다.

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `AssignmentCreated` | Assignment | revision, 판 blob hash, Preset 판, scope, approval 또는 null | lophn-agent/scheduling, lophn-agent/harness/run-loop, shell/desktop |
| `AssignmentChanged` | Assignment | 이전·새 revision와 판 blob hash, preset 판, approval 또는 null, 주기 변경 여부 | lophn-agent/scheduling, lophn-agent/harness/run-loop, shell/desktop |
| `AssignmentPaused` | Assignment | 이전·새 revision, PauseReason, 판 blob hash | lophn-agent/scheduling, lophn-agent/harness/run-loop, platform/notifications(machine pause만), shell/desktop |
| `AssignmentResumed` | Assignment | 이전·새 revision, 판 blob hash | lophn-agent/scheduling, lophn-agent/harness/run-loop, shell/desktop |
| `AssignmentWithdrawn` | Assignment | 이전·새 revision, 판 blob hash | lophn-agent/scheduling, lophn-agent/harness/run-loop, shell/desktop |

회차 시점 이동 event는 → lophn-agent/scheduling이다.

## 정책

- **일시적 접근 실패.** 현재 대상 unavailable은 새 호출을 막는다. 자동 pause의 확정 사유는 위 archive·연속 실패 contract만 따른다.

- **연속 실패 3회.** 모든 Assignment에서 실제 시작한 Run의 최종 `failed`가 연속 3회면 machine pause한다. 근거는 → lophn-agent/harness/run-loop의 `RunFinished` 시작 여부·결과·이유다.
- **실패 집계.** `completed`는 실패 묶음을 끊는다. Operator의 무변화 완료도 포함한다. 미시작, 사람 중단·거절, 답 없음 `stopped`, 질문·approval 대기는 세지도 실패 묶음을 지우지도 않는다. ToolCall 실패 하나를 Run 실패로 세지 않는다.
- **새 실패 묶음.** 가장 최근 `AssignmentResumed` seq 이후의 종료 결과부터 센다. 처음에는 `AssignmentCreated` seq 이후다. 순서는 종료 event seq이며 재시작·시간 경과·정의 변경으로 초기화하지 않는다. 실패 counter entity·표는 없다.
- **대화 자격.** enabled·paused는 새 세션을 열 수 있고 withdrawn은 과거 세션 읽기만 가능하다. paused의 새 request는 → lophn-agent/conversation에서 담당 run 없이 보존하며 실행 접수·후속 호출은 허용하지 않는다.
- **멈춤 적용.** pause·withdraw 커밋 뒤 새 Run 접수와 후속 호출을 막는다. 접수·진행 Run의 안전한 stopped 처리는 → lophn-agent/harness/run-loop다. 이미 일어난 효과는 취소됐다고 하지 않는다.
- **겹침.** 사람 요청 accepted는 여러 개 가능하지만 assignment당 running·waiting_user는 합쳐 하나다. 회차는 accepted 포함 미종료 Run이 하나라도 있으면 skip한다.
- **되돌림.** → lophn-agent/revert는 현재 pause를 해제하거나 처리한 다음 회차를 재접수하지 못한다.

## preset 적용

- **고정 역할 preset 적용.** lophn·AE·CE도 사람이 같은 kind의 preset 판을 명시 적용할 수 있다. Assignment.scope와 개수는 바뀌지 않고 다음 Run부터 새 판을 쓴다. Operator는 model·context·MCP·skill 변경도 전체 승인에 포함한다.
