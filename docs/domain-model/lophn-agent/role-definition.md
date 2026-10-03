---
type: domain-model
concerns: [lophn-agent/role-definition]
---
# lophn-agent/role-definition

Role의 판, prompt, tool 선택, 읽기 범위 종류, model slot 용도와 기대 결과의 모양을 정의한다.

## Role (`rol`)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `rol` ID | 아니오 | PK; 판이 바뀌어도 동일 | 역할 ID |
| `kind` | enum | 아니오 | `lophn`, `app_engineer`, `context_engineer`, `operator`; 변경 불가 | 책임 종류 |
| `name` | string | 아니오 | trim 뒤 1자 이상; trim·영문 대소문자를 무시한 이름은 전체 역할에서 unique | 고르는 이름 |
| `purpose` | string | 아니오 | trim 뒤 1자 이상 | 목적 |
| `situations` | string[] | 아니오 | 1개 이상; 각 값은 trim 뒤 1자 이상; 중복 없음 | 적용 가능한 상황 |
| `prompt` | sha256 | 아니오 | RolePrompt blob; → platform/blob-store | 네 설명 |
| `scope_kind` | enum | 아니오 | `all`, `app`, `context`; 종류별 실제 값은 → lophn-agent/roles | 읽기 범위 종류 |
| `tools` | ToolSelection[] | 아니오 | 중복 없음; 빈 목록은 tool 0개; 묶음을 펼친 개별 동작을 판에 고정 | 선택한 tool |
| `slot_uses` | SlotUse[] | 아니오 | `purpose` unique; model·provider ID를 담지 않음 | 용도별 공통 slot 이름 |
| `expected_results` | string[] | 아니오 | 1개 이상; 각 값은 trim 뒤 1자 이상 | 결과의 필수 내용과 제약 |
| `operator_judgment` | OperatorJudgment | 예 | `kind = operator`일 때만 필수, 나머지는 null | 구체적 반복 판단 |
| `revision` | integer | 아니오 | 1부터 시작; 변경마다 1 증가 | 현재 판 |

역할의 판 전체는 불변 blob으로 보존한다. `prompt`는 그 판의 책임·관점·기대 결과를 담으며 별도 편집 정본을 두지 않는다.

### 불변 조건

- `lophn`, `app_engineer`, `context_engineer`는 제품 정의 하나씩이다. 자유 복사본, 새 종류, subagent 정의는 없다.
- 실행 가능한 Operator는 CE 초안의 고정 version을 사람이 승인한 구체적 정의뿐이다. 미승인 Role이나 draft 상태는 없다.
- Operator tool 선택은 → lophn-agent/roles/operator의 상한 안에 있다. 정의의 글은 범위나 tool을 추가하는 권한이 아니다.
- Role에는 실제 scope 대상, 남길 문서, 주기, approval, pause 이유, Session, Run, run 한도, credential, 가격, model 선택, 권한 예외 목록, skill·외부 MCP 목록을 넣지 않는다. 역할별 skill·외부 MCP 선택은 → lophn-agent/extensions(ExtensionSettings.role_selections).
- 이전 판을 다시 적용해도 현재 판을 덮지 않고 새 revision을 만든다. 판 전체 적용은 atomic이며 하나라도 잘못되면 이전 판 전체를 유지한다.
- Role에는 업무 상태가 없다. 사용 중단은 → lophn-agent/assignments의 상태로 표현한다.

## RolePrompt (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `responsibility` | string | 아니오 | trim 뒤 1자 이상 | 맡은 책임의 설명 |
| `exclusions` | string | 아니오 | trim 뒤 1자 이상; 제외가 없어도 없다고 명시 | 책임 밖 설명 |
| `perspective` | string | 아니오 | trim 뒤 1자 이상 | 자료를 해석할 관점 |
| `expected_result` | string | 아니오 | trim 뒤 1자 이상; Role.expected_results와 일치 | 결과 설명 |

## ToolSelection (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `tool` | string | 아니오 | 등록된 개별 동작 이름; 계약은 → lophn-agent/harness/tools | 고정한 동작 |
| `app_command` | string | 예 | 앱 읽기 명령 동작에만 필수; → apps/blueprint의 `effect = read` 개별 명령 이름; 실제 앱 ID는 Assignment.read_apps | Operator가 선택한 개별 명령 |

- unique 기준은 `(tool, app_command)`다. 앱 명령 이외에는 `app_command = null`이다. 실제 호출 쌍은 Assignment.read_apps의 앱 ID와 이 명령 이름으로 검사한다. 승인 묶음은 각 앱에서 유효한 명령 쌍까지 고정한다.
- tool 묶음은 등록·변경 시 개별 동작으로 펼친다. 묶음에 새 동작이 생겨도 기존 판의 선택은 늘지 않는다.

## SlotUse (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `purpose` | string | 아니오 | trim 뒤 1자 이상; 같은 Role 판 안에서 unique | 호출 용도 |
| `slot` | enum | 아니오 | `judgment`, `organizing`; 선택한 model은 → lophn-agent/harness/model | 공통 설정의 slot |

## OperatorJudgment (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `question` | string | 아니오 | trim 뒤 1자 이상 | 반복할 판단 |
| `evidence` | string[] | 아니오 | 1개 이상; 각 값 trim 뒤 1자 이상 | 필요한 근거 종류 |
| `comparison_basis` | string | 아니오 | trim 뒤 1자 이상 | 비교 기준 |
| `update_condition` | string | 아니오 | trim 뒤 1자 이상 | 결과를 갱신할 조건 |
| `additional_exclusions` | string[] | 아니오 | 빈 목록 허용; 공통 금지를 제거하지 못함 | 구체적 책임 밖 |

## 관계

| from | 관계 | to | 다중도 | 대상이 사라지면 |
|---|---|---|---|---|
| Role | 판을 사용 | Assignment → lophn-agent/assignments | 1:N | 사용한 판은 유지 |
| Role 판 | 시작 기준 | Run → lophn-agent/harness/run-loop | 1:N | Run이 사용한 판은 삭제 불가 |
| Operator Role 판 | 승인 근거 | ApprovalRequest → platform/approvals | N:1 | 승인·과거 판 참조 유지 |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `roles` | ID, kind, 현재 revision, 현재 `name_key` | PK `id` | `name_key`; `kind`가 내장 세 종류인 행에 partial unique `kind` | `kind` | `(id, revision)` → `role_revisions`; `name_key`는 trim·영문 소문자 정규화 |
| `role_revisions` | 판 전체 blob hash, prompt hash, 승인 근거 | PK `(role_id, revision)` | — | `approval_id` | `role_id` → `roles`; blob → platform/blob-store; `approval_id` → platform/approvals(내장 판은 null) |

두 표는 같은 transaction에서 만든다. 순환 참조는 transaction 끝에 검사한다. 과거 판은 수정·삭제하지 않는다.

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `RegisterBuiltinRole` | machine | 내장 종류, 판 전체, blob hash | 같은 kind·name의 기존 정의; 같은 내용 재전송은 기존 ID | `RoleCreated` | `invalid_input`, `conflict`, `forbidden` |
| `CreateOperatorRole` | machine | 승인 ID·결정 seq, CE 초안 고정 version, 판 전체 | approval가 묶은 전체 내용; Assignment 생성과 같은 transaction | `RoleCreated` | `invalid_input`, `not_found`, `conflict`, `forbidden` |
| `ReviseOperatorRole` | machine | Role ID, 승인 ID·결정 seq, 새 판 전체 | 이전 Role revision와 승인 내용; 승인 대상 Assignment 변경과 같은 transaction | `RoleRevised` | `invalid_input`, `not_found`, `conflict`, `forbidden` |

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `RoleCreated` | Role | `kind`, `revision`, 판 blob hash, `approval` 또는 null, 초안 고정 version 또는 null | lophn-agent/assignments, lophn-agent/harness/run-loop, shell/desktop |
| `RoleRevised` | Role | 이전·새 revision, 이전·새 판 blob hash, `approval`, 초안 고정 version | lophn-agent/assignments, lophn-agent/harness/run-loop, shell/desktop |

## 정책

- **판 고정.** 시작한 Run은 사용한 Role revision을 유지한다. 현재 pause·withdraw·범위 회수는 다음 호출 전에 즉시 검사한다.
- **공통 model 설정.** 역할별 model override는 0개다. 공통 slot 변경은 다음 Run부터 적용하며 Operator 책임 변경 승인은 필요하지 않다.
- **승인 적용.** 승인 대상의 한 필드나 이전 판이 달라지면 전체 적용을 `conflict`로 거절한다. 재사용한 Operator 정의에 다른 Assignment의 scope·approval·이력·credential을 복사하지 않는다.

## 정할 것

- 내장 세 역할의 사용자 편집은 현재 금지다. 실제 필요가 생기면 자유 복사본 허용 여부를 별도로 정한다.
- 승인한 Operator Role을 여러 Assignment가 공유할 때 판 변경은 승인 대상 Assignment만 새 판으로 옮긴다. 다른 Assignment에 자동 적용하지 않는다.
