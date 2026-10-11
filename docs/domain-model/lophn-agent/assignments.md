---
type: domain-model
concerns: [lophn-agent/assignments]
---
# lophn-agent/assignments

Assignment의 역할·자리(scope)·상태와 pause 근거를 정의한다. assignment는 자리에 놓인 agent 하나의 실행 정체이고, agent의 설정(model, 지침, context, skill, MCP, 권한)은 → lophn-agent/agents의 정의가 맡는다.

## Assignment (`asg`)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `asg` ID | 아니오 | PK; Operator 정의 파일 이름 → lophn-agent/agents | 수행 주체 ID |
| `role` | enum | 아니오 | `lophn / app_engineer / context_engineer / operator`; 불변 | 역할 종류 |
| `scope` | AssignmentScope | 아니오 | role과 일치하는 담당 범위; 불변 | 실제 담당 자리 |
| `state` | enum | 아니오 | `enabled`, `paused`, `withdrawn` | 접수 가능 여부 |
| `pause_reason` | PauseReason | 예 | `paused`일 때만 필수; 다른 상태는 null | 멈춤 근거 |
| `revision` | integer | 아니오 | 1부터 시작; 상태 변경마다 1 증가 | 내용 CAS 기준 |

### 상태

| 상태 | 뜻 |
|---|---|
| `enabled` | 새 사람 요청·허용한 handoff를 접수 가능 |
| `paused` | 책임은 유지하나 새 Run 접수 금지; 자리가 보관된 동안만 |
| `withdrawn` | 종료된 책임; 새 Run 접수 금지; 과거 기록 유지 |

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| 없음 | `enabled` | machine | 내장 lophn·Context Engineer 준비(core 기동) 또는 `AppCreated`의 App Engineer 준비 | `AssignmentCreated` |
| 없음 | `enabled` | user | 사람이 새 Operator 정의를 저장(`SaveAgent` → lophn-agent/agents) | `AssignmentCreated` |
| `enabled` | `paused` | machine | 담당 project 또는 앱이 archived | `AssignmentPaused` |
| `paused` | `enabled` | machine | 담당 project 또는 앱의 보관이 풀림 | `AssignmentResumed` |
| `enabled` / `paused` | `withdrawn` | user | 현재 revision 일치; Operator만(`DeleteAgent` → lophn-agent/agents) | `AssignmentWithdrawn` |

`withdrawn`에서 나가는 전이는 없다. 다시 맡기려면 새 Operator를 만든다. 동일 중복 방지 키의 재전송만 기존 결과를 돌려준다. 사람이 직접 멈추고 다시 켜는 전이는 없다.

### 불변 조건

- 거두지 않은 lophn·Context Engineer assignment는 역할마다 하나이고(scope `all`) withdraw할 수 없다. App Engineer는 등록된 앱마다 거두지 않은 assignment 하나이고 `AppCreated`를 받은 machine만 만든다. 이 셋은 사람이 거둘 수 없다.
- Operator는 project 또는 앱 하나를 담당하며 같은 자리에 assignment 여러 개를 허용한다. 수 상한은 없다. 사람이 새 Operator 정의를 저장할 때만 만들어진다.
- Assignment에는 설정(model, 지침, context, skill, MCP, 권한)과 이름, `running`, Session, 현재 Run, 실패 counter를 저장하지 않는다. 설정·이름은 → lophn-agent/agents, 실행 상태는 → lophn-agent/harness/run-loop에서 조회한다.
- run 시작 기준은 → lophn-agent/harness/run-loop가 고정한다. 정의가 바뀌어도 시작한 Run은 바뀌지 않는다. pause·withdraw·현재 범위 회수는 즉시 적용한다.
- lophn·Context Engineer는 전역 assignment 하나라 자리마다 만들지 않는다. 자리는 session의 작업 자리가 고른다(→ lophn-agent/conversation).

## AssignmentScope (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | enum | 아니오 | `all`, `project`, `app` | 범위 종류 |
| `id` | 대상 ID | 예 | `all`이면 null; `app`이면 존재하는 앱 ID → apps/registration; `project`이면 존재하는 Project ID → documents/projects | 담당 대상 |

범위 제약: lophn·Context Engineer는 all만, App Engineer는 app만, Operator는 project 또는 app만이다. lophn·Context Engineer는 역할마다 하나, App Engineer는 app마다 하나, Operator는 대상마다 0..N이다.

## PauseReason (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | enum | 아니오 | `scope_archived`만 | 멈춤 분류 |
| `detail` | string | 아니오 | trim 뒤 1자 이상; secret 없음 | 안전한 설명 |
| `target` | 대상 ID | 아니오 | 보관된 project 또는 앱의 ID | 보관된 대상 |

## 관계

| from | 관계 | to | 다중도 | 대상이 사라지면 |
|---|---|---|---|---|
| Assignment | 설정 | AgentDefinition → lophn-agent/agents | Operator 1:1(파일 이름 = ID); built-in은 자리별 override | 정의 파일이 없는 Operator는 agent가 아님 |
| App Engineer Assignment | 범위 | App → apps/registration | N:1 | archive면 machine pause |
| Operator Assignment | 범위 | Project 또는 App → documents/projects, apps/registration | N:1 | archive면 machine pause |
| Assignment | 수행 기록 | Run → lophn-agent/harness/run-loop | 1:N | 과거 기록 유지 |
| Assignment | 대화 | Session → lophn-agent/conversation | 1:N | 과거 기록 유지 |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `assignments` | role·scope·상태·pause·revision | PK `id` | partial unique `role` WHERE `state != withdrawn` AND `role` IN (lophn, context_engineer); partial unique `scope_id` WHERE `state != withdrawn` AND `role` = app_engineer | `(state, role)`, `(scope_kind, scope_id)` | scope → apps/registration 또는 documents/projects |

생성·상태 변경·withdraw는 한 transaction에서 event와 함께 확정한다. 정의 blob·남길 문서·읽을 앱 표는 없다.

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `CreateBuiltinAssignment` | machine | role(lophn 또는 context_engineer) | 역할마다 거두지 않은 Assignment 없음; 재전송은 기존 결과 | `AssignmentCreated` | `invalid_input`, `conflict` |
| `CreateAppEngineerAssignment` | machine | `AppCreated` seq, 앱 ID | 해당 event·앱·기존 App Engineer 확인; event 재전송은 기존 결과; 반응이면 구독자 cursor CAS와 한 transaction | `AssignmentCreated` | `not_found`, `conflict`, `forbidden` |
| `PauseAssignment` | machine | ID, PauseReason | 현재 revision·state; 대상이 실제 archived인지 재검사; `AppArchived`·project 보관 반응이면 구독자 cursor CAS와 한 transaction | `AssignmentPaused` | `not_found`, `conflict`, `forbidden` |
| `ResumeAssignment` | machine | ID | 현재 revision·paused; 대상이 다시 active; 보관 해제 반응이면 구독자 cursor CAS와 한 transaction | `AssignmentResumed` | `not_found`, `conflict`, `forbidden` |
| `WithdrawAssignment` | user | ID | 현재 revision; enabled 또는 paused; Operator만; `DeleteAgent`가 부른다 | `AssignmentWithdrawn` | `not_found`, `conflict`, `forbidden` |

Operator assignment를 만드는 것은 → lophn-agent/agents의 `SaveAgent`가 새 Operator에서 같은 일 안에서 `AssignmentCreated`를 내는 것이다. 별도 승인 request를 만들지 않는다. 사람의 직접 저장·삭제에 추가 approval request를 붙이지 않는다.

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `AssignmentCreated` | Assignment | revision, role, scope | lophn-agent/harness/run-loop, shell/desktop |
| `AssignmentPaused` | Assignment | 이전·새 revision, PauseReason | lophn-agent/harness/run-loop, platform/notifications, shell/desktop |
| `AssignmentResumed` | Assignment | 이전·새 revision | lophn-agent/harness/run-loop, shell/desktop |
| `AssignmentWithdrawn` | Assignment | 이전·새 revision | lophn-agent/harness/run-loop, shell/desktop |

## 정책

- **일시적 접근 실패.** 현재 대상 unavailable은 새 호출을 막는다. 자동 pause의 확정 사유는 자리 archived뿐이다.
- **대화 자격.** enabled는 새 세션을 열고 입력을 받는다. paused(`scope_archived`)는 과거 세션을 읽기만 하고 새 세션·새 입력을 거절한다(→ lophn-agent/conversation). withdrawn은 과거 세션 읽기만 가능하다. Operator를 거두면 열린 session은 `assignment_withdrawn`으로 닫힌다.
- **멈춤 적용.** pause·withdraw 커밋 뒤 새 Run 접수와 후속 호출을 막는다. 접수·진행 Run의 안전한 stopped 처리는 → lophn-agent/harness/run-loop다. 이미 일어난 효과는 취소됐다고 하지 않는다.
- **겹침.** run의 동시 실행 제한은 session 단위(session마다 running·waiting_user 하나)이고 session이 없는 run은 assignment 단위다. 규칙은 → lophn-agent/harness/run-loop가 소유한다.
- **정의와 수명.** Operator를 거두면 정의 파일도 지운다(`DeleteAgent`). 정의 파일이 없는 assignment는 시작하지 않는다.

## 정할 것

- 자리의 보관이 풀릴 때 machine이 멈춤을 푸는 규칙: lophn-agent/assignments#Q7.
