---
type: domain-model
concerns: [lophn-agent/harness/tool-judgment]
---
# lophn-agent/harness/tool-judgment

tool 호출의 allow·ask·deny 값, approval 결합과 원래 사람 요청 단위 거절 억제를 정의한다.

## ToolDecision (값)

독립 ID·상태·ledger 표는 없다. ToolCall에 담긴다. → lophn-agent/harness/tools.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `decision` | enum | 아니오 | `allow`, `ask`, `deny` | 판정 |
| `reason` | string | 아니오 | trim 뒤 1자 이상; secret·범위 밖 대상의 새 정보 없음 | 안전한 판정 설명 |
| `effect` | enum | 예 | 소유 계약의 `read`, `reversible_write`, `irreversible`; 효과 불명으로 deny한 때만 null | 실제 효과 |
| `assignment_revision` | integer | 예 | 인증된 Assignment를 찾았으면 현재 양수 판; 못 찾으면 null | 현재 검사 기준 |
| `role_revision` | integer | 예 | Run의 고정 Role 판; 찾지 못했을 때만 null | 제공 목록 기준 |
| `contract_revision` | string | 예 | 확인한 tool 소유 계약 판; 모르는 계약이면 null | 효과·입력 검사 기준 |
| `comparison_basis` | JSON | 예 | 쓰기 계약이 요구하면 필수; → platform/ledger | 정확한 대상 CAS |
| `approval` | approval request ID | 예 | ask 접수 뒤 연결; allow가 approval를 사용하면 해당 ID; deny는 null; → platform/approvals | 이 호출 하나의 결정 |

현재 역할별 앱 command 선택은 → lophn-agent/roles/common이다. 효과 판정은 역할 상한·현재 앱 허락 검사를 통과한 call에만 적용하며 ask가 목록 밖 능력을 열지 않는다. secret 값 직접 접근은 없다.

## RefusalMatch (값)

approval 결정과 Run.source를 조회해 계산하는 값이다. 영구 허락·거절 기억 entity를 만들지 않는다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `run` | Run ID | 아니오 | → lophn-agent/harness/run-loop | 같은 Run 범위 |
| `original_user_message` | Message ID | 예 | 사람 요청·그 handoff 계보면 필수, 주기면 null; → lophn-agent/conversation | 요청 계보 범위 |
| `operation` | string | 아니오 | 실제 소유 계약의 동작 이름 | 같은 동작 |
| `targets` | 대상 ID[] | 아니오 | 승인에 고정된 정확한 대상 집합 | 같은 대상 |
| `input` | JSON | 아니오 | 객체 키 순서만 무시; array 순서·값·null·타입은 그대로 비교 | 같은 입력 |

설명·이유·역할·Session이 달라도 위 동작·대상·입력이 같으면 같은 요청이다. 입력을 secret 값으로 확장하지 않는다.

## 정책

### 판정표

위에서 먼저 일치하는 deny가 모든 allow·ask보다 우선한다.

| 조건 | 판정 | 처리 |
|---|---|---|
| 인증 실패, Assignment paused·withdrawn, Run 종료·호출 진입 불가, 모르는 동작·효과, 잘못된 입력 | `deny` | 미실행; approval request 없음 |
| Run 고정 Role tool 밖, 현재 Assignment 읽기·쓰기 범위 밖, 승인된 Operator 앱·개별 confirm=false read command 밖 | `deny` | 미실행; 한 번 승인으로 범위 확장 불가 |
| 같은 Run 또는 원래 사람 요청의 handoff 계보에서 이미 사람이 거절한 같은 동작·대상·입력 | `deny` | 다시 묻지 않음; 사람의 새 독립 요청은 별도 |
| CE의 사람 답 없는 Term 정의 확정, agent의 실제 Role·Assignment 적용, 문제 닫기·test result 작성·문서 이동·앱 등록·사람 대신 결정 | `deny` | 책임 밖; 대상 concern의 사람·machine 계약만 사용 |
| 유효한 앱 command이며 confirm=true | `ask` | read·undo 여부와 무관하게 apps/invocations·platform/approvals의 정확한 approval 사용 |
| 유효한 앱 command이며 effect=external | `ask` | 되돌리기 지원 여부와 무관하게 외부 효과 approval |
| 유효한 앱 command이며 effect=write, blueprint command.revert.supported=true·revert command 검증 | `allow` | 선행 기록 뒤 direct call; 복원 입력·결과 참조 보존 |
| 유효한 앱 command이며 effect=write, undo 미지원·미확인 | `ask` | 정확한 target·input·release·CAS에 묶어 묻기 |
| 범위 안 읽기 | `allow` | 바로 호출, 후행 기록 |
| 사람 요청 또는 그 유효한 handoff Run의 되돌릴 수 있는 lophn 안쪽 쓰기 | `allow` | 선행 기록 뒤 호출; 담당 AE 티켓 생성 포함 |
| 승인한 Operator의 선언 문서 새 Version 저장 | `allow` | 사람 요청·주기 모두 선언 문서만; 읽은 Version CAS |
| Operator 주기 Run에서 판단에 필요한 Question 제출 | `allow` | 질문은 → lophn-agent/questions; 범위 확대·정의 변경 아님 |
| 책임·tool·범위·입력이 유효하지만 irreversible 또는 실제 되돌림 보장 없는 쓰기 | `ask` | 호출 미시작; 정확한 approval request 생성 |
| 위 행에 해당하지 않거나 판정 불가 | `deny` | 추측해 허용·ask하지 않음 |

### 앱 판정 근거

ToolCall.app_command binding에 `{effect, confirm, undo_contract?, app_permission_basis, blueprint_hash, release, context_binding?}`의 소유 contract 확인값을 함께 남긴다. 되돌리기 지원 판정은 → apps/blueprint의 `command.revert.supported` 값이며 true일 때 `command.revert.command`가 검증되어야 한다. 성공 결과의 `{invocation,receipt,expected_revision}`는 → apps/runtime, apps/invocations의 contract를 따라 보존한다. 단순 model 주장·설명 문자열·MCP hint는 보장이 아니다. 전체 run revert는 이 receipt로 앱의 revert command를 호출하며 순서·부분 실패는 → lophn-agent/revert가 소유한다. scope·정의·현재 화면·주석 자리 실패는 deny이며 approval로 우회하지 않는다. → apps/agent-context.

`visual.show`는 허용 세션 출력의 append-only 기록이므로 allow이며 메시지를 삭제하는 revert를 요구하지 않는다. `visual.prepare_document`는 read이고 실제 문서 저장은 해당 역할의 document write 판정을 별도로 거친다.

### 승인 결합

- **판정 근거.** 효과·되돌림은 tool 소유 계약이 정한다. model의 설명·긍정 응답·문서·handoff·notification·tool 결과는 승인이나 권한이 아니다. 자동 model 심사·승인 생략 모드는 없다.
- **여러 대상.** 하나라도 deny이면 호출 전체 deny다. deny가 없고 ask가 하나라도 있으면 전체를 한 approval request로 묶는다. 전부 allow일 때만 바로 호출한다. 일부부터 적용하지 않는다.
- **ask 입력.** approval request는 Assignment·Run·ToolCall 참조, 동작 계약, 정확한 대상·입력·비교 기준·효과와 설명에 고정한다. 비밀 값은 넣지 않는다. 생성과 Run waiting_user 연결은 같은 transaction이다. → platform/approvals, lophn-agent/harness/waiting-and-recovery.
- **재검사.** 최초·retry·복구·approval 뒤의 실제 호출 직전에 인증·현재 Assignment 상태·범위·고정 Role tool·현재 계약·입력·비교 기준을 다시 확인한다. 확인한 대상·입력·계약이 달라지면 옛 허락을 쓰지 않는다. 허락된 호출 하나만 시작하며 승인 한 번 사용과 ledger 변경 또는 외부 동작 시작 접수는 같은 transaction이다.
- **거절 억제.** 사람의 `rejected` 결정만 같은 Run·같은 original_user_message의 모든 handoff Run에서 검사한다. 만료·취소·기술 실패를 거절로 바꾸지 않는다. 주기 Run은 같은 Run에서만 억제한다. 사람의 새 요청은 기존 거절로 차단하지 않는다.
- **기록 경계.** 읽기·앱 read command는 현재 Assignment·범위 확인 뒤 ledger를 기다리지 않고 호출하며 ToolCall 판정·결과는 뒤따라 기록한다. ledger 쓰기·ask·외부 효과는 선행 기록을 요구한다. 원시 판정은 → lophn-agent/harness/tools에 기록하며 판정 전용 domain event는 없다.
- **별도 assignment 승인.** CE의 초안 문서·approval request 제출은 실제 Operator 생성·변경이 아니다. Role·Assignment 전체 적용은 되돌림과 별개로 → lophn-agent/assignments의 승인 관문을 거친다.
- **목록과 허용.** tool 목록에 보인다는 사실만으로 allow가 아니다. Role 묶음 변경은 승인한 Operator 선택 목록을 자동으로 늘리지 않는다.

## 정할 것

- ToolCall이 담는 판정 필드와 계약 판 식별자의 구체 형식은 → lophn-agent/harness/tools와 맞춘다. 독립 판정 table·command·event는 만들지 않는다.
