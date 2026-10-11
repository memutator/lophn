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
| `agent_hash` | sha256 | 예 | Run이 고정한 resolved agent의 지문; 찾지 못했을 때만 null | 제공 목록 기준 |
| `contract_revision` | string | 예 | 확인한 tool 소유 계약 판; 모르는 계약이면 null | 효과·입력 검사 기준 |
| `comparison_basis` | JSON | 예 | 쓰기 계약이 요구하면 필수; → platform/ledger | 정확한 대상 CAS |
| `approval` | approval request ID | 예 | ask 접수 뒤 연결; allow가 approval를 사용하면 해당 ID; deny와 session 허락으로 낮춘 allow는 null; → platform/approvals | 이 호출 하나의 결정 |
| `session_grant` | approval request ID | 예 | ask를 session 허락으로 allow로 낮춘 때만 그 허락의 원래 request(`grant_scope=session`); 그 밖은 null; → platform/approvals | 낮춘 근거 |

실제 앱 command 선택은 → lophn-agent/agents, 제품 역할 상한은 → lophn-agent/roles/common이다. 효과 판정은 역할 상한·현재 앱 허락 검사를 통과한 call에만 적용하며 ask가 목록 밖 능력을 열지 않는다. secret 값 직접 접근은 없다. 지침 contract 읽기·이번 Run의 고정 handoff 근거는 각 owner가 명시한 예외이며 resolved agent의 context 선택 밖 주소를 따라 읽는 권한을 주지 않는다.

## RefusalMatch (값)

approval 결정과 Run.source를 조회해 계산하는 값이다. 영구 허락·거절 기억 entity를 만들지 않는다. session 허락도 같은 방식으로 `grant_scope=session`인 granted request를 조회해 계산하며 별도 entity가 아니다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `run` | Run ID | 아니오 | → lophn-agent/harness/run-loop | 같은 Run 범위 |
| `original_user_message` | Message ID | 예 | 사람 요청·그 handoff 계보면 필수, 계보가 없으면 null(같은 Run에서만 억제); → lophn-agent/conversation | 요청 계보 범위 |
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
| RunBasis.tools의 고정 제공 목록 밖(capability·선택 MCP·skill 읽기 동작의 검증된 합집합), 현재 Assignment 자리(scope) 밖 또는 resolved agent의 context 선택 밖의 일반 자료 읽기, 앱 Operator 정의의 `app_reads`·개별 confirm=false read command 밖 | `deny` | 미실행; 한 번 승인으로 범위 확장 불가 |
| 같은 Run 또는 원래 사람 요청의 handoff 계보에서 이미 사람이 거절한 같은 동작·대상·입력 | `deny` | 다시 묻지 않음; 사람의 새 독립 요청은 별도 |
| 지침 파일·그 문서 Version의 agent 변경, CE가 사람 질문의 미답을 추천 수락으로 보고 한 용어·경계 확정, agent의 agent 정의 저장·Operator 만들기·Assignment 변경, 문제 닫기·test result 작성·문서 이동·앱 등록·사람 대신 결정 | `deny` | 책임 밖; 대상 concern의 사람·machine 계약만 사용 |
| 유효한 앱 command이며 confirm=true | `ask` | read·undo 여부와 무관하게 apps/invocations·platform/approvals의 정확한 approval 사용 |
| 위 deny·confirm=true에 걸리지 않고 ask로 판정될 호출이며 같은 session에서 사람이 Allow for this session으로 허락한 같은 tool(MCP 서버 포함)·같은 동작 | `allow` | 새 approval request 없이 호출; 호출 직전 재검사는 그대로; `session_grant`에 원래 request를 남김; session이 끝나면 사라짐 |
| 되돌림을 모르는 외부 MCP tool이며 자리 권한 규칙이 그 tool을 안전하다고 표시하지 않음 | `ask` | external로 보고 묻기; MCP hint·설명은 근거 아님 |
| 되돌림을 모르는 외부 MCP tool이며 자리 권한 규칙이 그 tool을 안전하다고 표시함 | `allow` | 사람이 규칙에서 안전하다고 표시; 역할 상한·confirm=true는 그대로 deny 또는 ask |
| 유효한 앱 command이며 effect=external | `ask` | 되돌리기 지원 여부와 무관하게 외부 효과 approval |
| 유효한 앱 command이며 effect=write, blueprint command.revert.supported=true·revert command 검증 | `allow` | 선행 기록 뒤 direct call; 복원 입력·결과 참조 보존 |
| 유효한 앱 command이며 effect=write, undo 미지원·미확인 | `ask` | 정확한 target·input·release·CAS에 묶어 묻기 |
| 범위 안 읽기 | `allow` | 바로 호출, 후행 기록 |
| 사람 요청 또는 그 유효한 handoff Run의 되돌릴 수 있는 lophn 안쪽 쓰기 | `allow` | 선행 기록 뒤 호출; lophn·담당 AE ticket 생성 포함 |
| 책임·tool·범위·입력이 유효하지만 irreversible 또는 실제 되돌림 보장 없는 쓰기 | `ask` | 호출 미시작; 정확한 approval request 생성 |
| 위 행에 해당하지 않거나 판정 불가 | `deny` | 추측해 허용·ask하지 않음 |

### 앱 판정 근거

ToolCall.app_command binding에 `{effect, confirm, undo_contract?, app_permission_basis, blueprint_hash, release, context_binding?}`의 소유 contract 확인값을 함께 남긴다. 되돌리기 지원 판정은 → apps/blueprint의 `command.revert.supported` 값이며 true일 때 `command.revert.command`가 검증되어야 한다. 성공 결과의 `{invocation,receipt,expected_revision}`는 → apps/runtime, apps/invocations의 contract를 따라 보존한다. 단순 model 주장·설명 문자열·MCP hint는 보장이 아니다. ticket 취소는 agent tool이 아니며 묻지 않는다. 전체 run revert는 이 receipt로 앱의 revert command를 호출하며 순서·부분 실패는 → lophn-agent/revert가 소유한다. scope·정의·현재 화면·주석 자리 실패는 deny이며 approval로 우회하지 않는다. → apps/agent-context.

`visual.show`는 허용 세션 출력의 append-only 기록이므로 allow이며 메시지를 삭제하는 revert를 요구하지 않는다. `visual.prepare_document`는 read이고 실제 문서 저장은 해당 역할의 document write 판정을 별도로 거친다.

### 승인 결합

- **판정 근거.** 효과·되돌림은 tool 소유 계약이 정한다. model의 설명·긍정 응답·문서·handoff·notification·tool 결과는 승인이나 권한이 아니다. 자동 model 심사·승인 생략 모드는 없다.
- **여러 대상.** 하나라도 deny이면 호출 전체 deny다. deny가 없고 ask가 하나라도 있으면 전체를 한 approval request로 묶는다. 전부 allow일 때만 바로 호출한다. 일부부터 적용하지 않는다.
- **ask 입력.** approval request는 Assignment·Run·ToolCall 참조, 동작 계약, 정확한 대상·입력·비교 기준·효과와 설명에 고정한다. 비밀 값은 넣지 않는다. 생성과 Run waiting_user 연결은 같은 transaction이다. → platform/approvals, lophn-agent/harness/waiting-and-recovery.
- **승인 범위.** 카드의 선택은 Allow once·Allow for this session·Deny 셋이다. ask를 approval request로 만들 때 `session_grantable`을 정한다: agent tool call의 ask(Run 필수, session 있음)이고 confirm=true 앱 command·앱 permission·release 적용·복원이 아니면 true. Allow for this session은 그 request를 한 번 사용한 허락이고, 같은 session의 같은 tool(MCP 서버 포함)·같은 동작이 다시 ask로 판정되면 위 판정표의 session 행이 allow로 낮춘다. 대상·입력은 묶지 않는다. 허락은 session이 닫히거나 archive·delete되면 사라지고 다시 열어도 되살아나지 않으며 다른 session·Run으로 넘어가지 않는다. tool 계약·MCP 연결·권한·역할 상한이 바뀌면 낮추지 않는다. → lophn-agent/harness/tool-judgment#R13, lophn-agent/harness/tool-judgment#R14, platform/approvals#R19
- **지속 허락 없음.** 호출 approval은 지속 허락(Always)을 만들지 않는다. 오래 가는 허락은 자리(project·app)의 권한 규칙이 안전하다고 표시한 tool을 ask에서 allow로 낮추는 것뿐이고 규칙을 이 concern이 만들거나 넓히지 않는다. 규칙도 역할 상한과 confirm=true를 넘지 못한다. → lophn-agent/harness/tool-judgment#R15, lophn-agent/agents
- **재검사.** 최초·retry·복구·approval 뒤의 실제 호출 직전에 인증·현재 Assignment 상태·범위·고정 resolved agent의 tool·현재 계약·입력·비교 기준을 다시 확인한다. 확인한 대상·입력·계약이 달라지면 옛 허락을 쓰지 않는다. 허락된 호출 하나만 시작하며 승인 한 번 사용과 ledger 변경 또는 외부 동작 시작 접수는 같은 transaction이다.
- **거절 억제.** 사람의 `rejected` 결정만 같은 Run·같은 original_user_message의 모든 handoff Run에서 검사한다. 만료·취소·기술 실패를 거절로 바꾸지 않는다. 사람 요청 계보가 없는 Run은 같은 Run에서만 억제한다. 사람의 새 요청은 기존 거절로 차단하지 않는다. 거절은 session 허락보다 앞선다: 같은 session에서 Deny한 같은 동작·대상·입력은 session 허락이 있어도 다시 묻지 않고 시작하지 않는다.
- **기록 경계.** 읽기·앱 read command는 현재 Assignment·범위 확인 뒤 ledger를 기다리지 않고 호출하며 ToolCall 판정·결과는 뒤따라 기록한다. ledger 쓰기·ask·외부 효과는 선행 기록을 요구한다. 원시 판정은 → lophn-agent/harness/tools에 기록하며 판정 전용 domain event는 없다.
- **Operator 정의.** agent는 Operator를 만들거나 바꾸지 못한다. 사람이 Operator editor에서 직접 저장한다. → lophn-agent/agents
- **목록과 허용.** tool 목록에 보인다는 사실만으로 allow가 아니다. capability 묶음 변경은 Operator 정의의 tool 선택을 자동으로 늘리지 않는다.

